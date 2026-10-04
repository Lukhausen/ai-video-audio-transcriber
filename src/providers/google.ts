import { GoogleGenAI } from '@google/genai';
import type { TranscriptionResult, TranscriptCue } from '../types';

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
): Promise<TranscriptionResult> {
  if (!apiKey.trim()) throw new Error('No Google API key set.');
  const client = new GoogleGenAI({ apiKey });
  let uploaded = await client.files.upload({ file: audio, config: { mimeType: 'audio/mp3' } });
  const name = uploaded.name;
  try {
    if (!name) throw new Error('Google did not return an uploaded file name.');
    const deadline = Date.now() + 120_000;
    while (uploaded.state === 'PROCESSING' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      uploaded = await client.files.get({ name });
    }
    if (uploaded.state !== 'ACTIVE' || !uploaded.uri) {
      throw new Error('Google could not prepare the audio for transcription. Please retry.');
    }
    const interaction = await client.interactions.create({
      model,
      input: [{ type: 'audio', uri: uploaded.uri, mime_type: 'audio/mp3' }],
      store: false,
      generation_config: {
        transcription_config: {
          mode: { type: 'verbatim', diarization_mode: 'speaker', timestamp_granularities: ['word'] },
        },
      },
    });
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
        await client.files.delete({ name });
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
