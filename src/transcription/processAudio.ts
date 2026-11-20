import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { transcribeGoogleAudio } from '../providers/google';
import { parseAudioTranscription } from '../transcripts/metadata';
import { joinCueText, mergeTranscriptCues } from '../transcripts/output';
import { RateLimiter } from '../utils/rateLimiter';
import { stitchTranscriptions } from '../utils/stitching';
import type { AudioChunk, TranscriptionResult } from '../types';
import {
  beginPart, finishWork, readAudio, readReceipt, readWork, saveReceipt, setWorkMode, workLock, workSettings,
  type ProviderConfig, type Transcript,
} from './workStorage';

export type WorkOutcome = { state: 'done'; transcript: Transcript } | { state: 'paused' };
export type ReportProgress = (done: number, total: number, stage?: string) => void;
const limiter = new RateLimiter(10);

export async function transcribePart(
  data: Uint8Array, fileName: string, index: number, config: ProviderConfig, onWarning: (message: string) => void,
  onStage: (message: string) => void,
): Promise<TranscriptionResult> {
  const name = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) + '_seg' + index + '.mp3';
  const file = new File([data], name, { type: 'audio/mp3' });
  await limiter.acquire();
  try {
    let result: TranscriptionResult;
    if (config.provider === 'google') {
      result = await transcribeGoogleAudio(config.key, config.model, file, onWarning, onStage);
    } else if (config.provider === 'groq') {
      const client = new Groq({ apiKey: config.key, dangerouslyAllowBrowser: true });
      result = parseAudioTranscription(await client.audio.transcriptions.create({
        file, model: config.model, response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'],
      }));
    } else {
      const client = new OpenAI({ apiKey: config.key, dangerouslyAllowBrowser: true });
      result = parseAudioTranscription(await client.audio.transcriptions.create({
        file, model: config.model,
        ...(config.model === 'gpt-4o-transcribe-diarize'
          ? { response_format: 'diarized_json' as const, chunking_strategy: 'auto' as const }
          : config.model === 'whisper-1'
            ? { response_format: 'verbose_json' as const, timestamp_granularities: ['word', 'segment'] }
            : {}),
      }));
    }
    limiter.onSuccess();
    if (!result.text.trim()) {
      throw new Error('The provider returned no speech for part ' + (index + 1) + '. Check that the audio contains speech, then retry.');
    }
    return result;
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 429 || /\b429\b/.test(String(error))) limiter.on429();
    throw error;
  } finally {
    limiter.release();
  }
}

export function assembleTranscript(results: TranscriptionResult[], segments: AudioChunk[]): Transcript {
  const transcriptCues = mergeTranscriptCues(results, segments);
  let transcript: string;
  if (results.length === 1) transcript = results[0].text;
  else if (transcriptCues) transcript = joinCueText(transcriptCues);
  else if (segments[1].offset < segments[1].keepStart) transcript = stitchTranscriptions(results.map(result => result.text));
  else transcript = results.map(result => result.text.trim()).join('\n');
  return { transcript, transcriptCues };
}

export function processSavedAudio(
  id: string, key: string, retryInterrupted: boolean, report: ReportProgress, onWarning: (message: string) => void,
): Promise<WorkOutcome> {
  return navigator.locks.request(workLock(id), async () => {
    const work = await readWork(id);
    if (work?.mode === 'done' && work.transcript) return { state: 'done', transcript: work.transcript };
    if (work?.mode !== 'active') return { state: 'paused' };

    const settings = workSettings(work.config);
    const audio = await readAudio(id);
    if (!audio || audio.settings !== settings) throw new Error('The saved audio could not be loaded. Retry this file.');
    const saved = await readReceipt(id);
    const receipt = saved?.settings === settings ? saved : { settings, results: [], pending: false };
    try {
      if (receipt.pending && !retryInterrupted) {
        throw new Error('The browser interrupted a provider request. Retry this file to submit the unfinished part again.');
      }
      const provider = { provider: work.config.selectedApi, model: work.config.model, key };
      const { segments } = audio;
      const results = receipt.results;
      report(results.length, segments.length);
      for (let index = results.length; index < segments.length; index++) {
        if (!await beginPart(id, { settings, results, pending: true })) return { state: 'paused' };
        results.push(await transcribePart(segments[index].data, work.job.fileName, index, provider, onWarning,
          stage => report(index, segments.length, stage)));
        await saveReceipt(id, { settings, results, pending: false });
        report(results.length, segments.length);
      }
      const transcript = assembleTranscript(results, segments);
      await finishWork(work, transcript);
      return { state: 'done', transcript };
    } catch (error) {
      await setWorkMode(id, 'failed').catch(() => undefined);
      throw error;
    }
  });
}
