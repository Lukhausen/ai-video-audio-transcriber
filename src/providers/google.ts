import { GoogleGenAI } from '@google/genai';
import type { TranscriptionResult, TranscriptCue } from '../types';
import { withRequestDeadline } from './requestDeadline';

const UPLOAD_DEADLINE = 120_000;
const PREPARATION_DEADLINE = 120_000;
const TRANSCRIPTION_DEADLINE = 240_000;
const CLEANUP_DEADLINE = 5_000;

function getCompletedText(interaction: { status?: string; output_text?: string }): string {
  if (interaction.status !== 'completed' || typeof interaction.output_text !== 'string') {
    throw new Error('Google did not return a completed text response. Please retry.');
  }
  return interaction.output_text;
}

function parseOffset(offset?: string): number | undefined {
  if (!offset || !/^\d+(?:\.\d+)?s$/.test(offset)) return undefined;
  const seconds = Number(offset.slice(0, -1));
  return Number.isFinite(seconds) ? seconds : undefined;
}

export async function transcribeGoogleAudio(
  apiKey: string,
  model: string,
  audio: File,
  onCleanupError: (message: string) => void,
  onStage: (message: string) => void,
): Promise<TranscriptionResult> {
  if (!apiKey.trim()) throw new Error('No Google API key set.');
  const client = new GoogleGenAI({ apiKey });
  onStage('Uploading to Google');
  const uploaded = await withRequestDeadline(UPLOAD_DEADLINE, 'The audio upload to Google timed out. Retry this part.', signal => {
    // The SDK's browser uploader does not forward a file-level abort signal to the binary upload.
    const uploader = new GoogleGenAI({ apiKey, httpOptions: { fetch: (input, init) => fetch(input, { ...init, signal }) } });
    return uploader.files.upload({ file: audio, config: { mimeType: 'audio/mp3' } });
  });
  const name = uploaded.name;
  try {
    if (!name) throw new Error('Google did not return an uploaded file name.');
    let ready = uploaded;
    if (ready.state === 'PROCESSING') {
      onStage('Google preparing audio');
      ready = await withRequestDeadline(PREPARATION_DEADLINE, 'Google took too long to prepare the audio. Retry this part.', async signal => {
        let current = uploaded;
        while (current.state === 'PROCESSING' && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          if (signal.aborted) throw signal.reason;
          current = await client.files.get({ name, config: { abortSignal: signal } });
        }
        return current;
      });
    }
    if (ready.state !== 'ACTIVE' || !ready.uri) {
      throw new Error('Google could not prepare the audio for transcription. Please retry.');
    }
    const uri = ready.uri;
    onStage('Google transcribing');
    const interaction = await withRequestDeadline(TRANSCRIPTION_DEADLINE,
      'Google did not return a transcript in time. Retry the unfinished part if you want to submit it again.',
      signal => client.interactions.create({
        model,
        input: [{ type: 'audio', uri, mime_type: 'audio/mp3' }],
        store: false,
        generation_config: {
          transcription_config: {
            mode: { type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'] },
          },
        },
      }, { signal, retries: { strategy: 'none' } }));
    const cues: TranscriptCue[] = [];
    const speakers = new Map<string, string>();
    for (const step of interaction.steps || []) {
      if (step.type !== 'model_output') continue;
      for (const content of step.content || []) {
        if (content.type !== 'text') continue;
        for (const word of content.annotations || []) {
          if (word.type !== 'word_info' || !word.text) continue;
          if (word.speaker && !speakers.has(word.speaker)) speakers.set(word.speaker, `Speaker ${speakers.size + 1}`);
          cues.push({ text: word.text, start: parseOffset(word.start_offset), end: parseOffset(word.end_offset),
            speaker: word.speaker ? speakers.get(word.speaker) : undefined });
        }
      }
    }
    return { text: getCompletedText(interaction), cues: cues.length ? cues : undefined };
  } finally {
    if (name) {
      try {
        await withRequestDeadline(CLEANUP_DEADLINE, 'Google temporary audio cleanup timed out.',
          signal => client.files.delete({ name, config: { abortSignal: signal } }));
      } catch {
        onCleanupError('Google temporary audio cleanup failed. The uploaded file expires automatically after 48 hours.');
      }
    }
  }
}

export async function transformGoogleTranscript(
  apiKey: string,
  model: string,
  transcript: string,
  instruction: string,
): Promise<string> {
  if (!apiKey.trim()) throw new Error('No Google API key set.');
  const client = new GoogleGenAI({ apiKey });
  const interaction = await client.interactions.create({
    model,
    input: transcript,
    system_instruction: instruction || 'You are a helpful assistant.',
    store: false,
  });
  return getCompletedText(interaction);
}
