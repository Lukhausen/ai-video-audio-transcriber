import { useCallback, useRef, useState } from 'react';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { transcribeGoogleAudio } from '../providers/google';
import type { FileJob, ApiConfig, AudioChunk, TranscriptionResult } from '../types';
import { AUDIO_WORKERS, type FFmpegPoolHandle } from './useFFmpegPool';
import { convertAudio, isSupportedMedia, MAX_INPUT_BYTES, splitAudio } from '../media/prepareAudio';
import { RateLimiter } from '../utils/rateLimiter';
import { parseAudioTranscription } from '../transcripts/metadata';
import { joinCueText, mergeTranscriptCues } from '../transcripts/output';
import { stitchTranscriptions } from '../utils/stitching';

type QueueStatus = 'idle' | 'processing' | 'paused';
type Log = (message: string, type: 'info' | 'error') => void;

interface Checkpoint {
  settings: string;
  segments: AudioChunk[];
  results: TranscriptionResult[];
}

interface QueueFile {
  file: File;
  checkpoint?: Checkpoint;
}

interface QueueConfig {
  ffmpegPool: FFmpegPoolHandle;
  apiConfigRef: React.RefObject<ApiConfig>;
  onLog: Log;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/api_key_invalid|api key not valid|invalid api key|\b401\b|unauthorized/i.test(message)) {
    return 'The provider rejected the API key. Check Advanced settings and retry.';
  }
  if (/\b429\b|rate limit/i.test(message)) return 'The provider is rate limiting requests. Wait a moment and retry.';
  if (/network|failed to fetch/i.test(message)) return 'Could not reach the provider. Check your connection and retry.';
  return message;
}

async function transcribeSegment(
  data: Uint8Array, name: string, config: ApiConfig, limiter: RateLimiter, onLog: Log,
): Promise<TranscriptionResult> {
  const audio = new File([data], name, { type: 'audio/mp3' });
  await limiter.acquire();
  try {
    let result: TranscriptionResult;
    if (config.selectedApi === 'groq') {
      const client = new Groq({ apiKey: config.groqKey, dangerouslyAllowBrowser: true });
      const response = await client.audio.transcriptions.create({
        file: audio, model: config.groqModel, response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'],
      });
      result = parseAudioTranscription(response);
    } else if (config.selectedApi === 'google') {
      result = await transcribeGoogleAudio(config.googleKey, config.googleModel, audio, message => onLog(message, 'error'));
    } else {
      const client = new OpenAI({ apiKey: config.openaiKey, dangerouslyAllowBrowser: true });
      const response = await client.audio.transcriptions.create({
        file: audio,
        model: config.openaiModel,
        ...(config.openaiModel === 'gpt-4o-transcribe-diarize'
          ? { response_format: 'diarized_json' as const, chunking_strategy: 'auto' as const }
          : config.openaiModel === 'whisper-1'
            ? { response_format: 'verbose_json' as const, timestamp_granularities: ['word', 'segment'] }
            : {}),
      });
      result = parseAudioTranscription(response);
    }
    limiter.onSuccess();
    return result;
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 429 || /\b429\b/.test(String(error))) limiter.on429();
    throw error;
  } finally {
    limiter.release();
  }
}

export function useTranscriptionQueue({ ffmpegPool: { acquire }, apiConfigRef, onLog }: QueueConfig) {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const jobsRef = useRef<FileJob[]>([]);
  const [globalStatus, setStatus] = useState<QueueStatus>('idle');
  const statusRef = useRef<QueueStatus>('idle');
  const files = useRef(new Map<string, QueueFile>());
  const active = useRef(new Set<string>());
  const limiter = useRef(new RateLimiter(10));

  const changeJobs = useCallback((update: (previous: FileJob[]) => FileJob[]) => {
    jobsRef.current = update(jobsRef.current);
    setJobs(jobsRef.current);
  }, []);

  const updateJob = useCallback((id: string, updates: Partial<FileJob>) => {
    changeJobs(all => all.map(job => job.id === id ? { ...job, ...updates } : job));
  }, [changeJobs]);

  const changeStatus = useCallback((status: QueueStatus) => {
    statusRef.current = status;
    setStatus(status);
  }, []);

  const addFiles = useCallback((incoming: File[]): string[] => {
    const added: FileJob[] = [];
    for (const file of incoming) {
      if (!file.size || !isSupportedMedia(file)) {
        onLog('Rejected "' + file.name + '". Choose a nonempty audio or video file.', 'error');
        continue;
      }
      if (file.size >= MAX_INPUT_BYTES) {
        onLog('"' + file.name + '" exceeds the browser audio tools’ 2 GiB input limit. Split it before adding it.', 'error');
        continue;
      }
      const id = 'media-' + Math.random().toString(36).slice(2);
      added.push({
        id, fileName: file.name, fileSize: file.size, mimeType: file.type,
        status: 'ready', progress: 0, addedAt: Date.now(),
      });
      files.current.set(id, { file });
      onLog('Added "' + file.name + '".', 'info');
    }
    if (added.length) changeJobs(previous => [...previous, ...added]);
    return added.map(job => job.id);
  }, [changeJobs, onLog]);

  const processJob = useCallback(async (id: string) => {
    const item = files.current.get(id);
    const config = apiConfigRef.current;
    if (!item || !config) return;
    const { file } = item;
    const provider = {
      google: { name: 'Google', key: config.googleKey, model: config.googleModel },
      groq: { name: 'Groq', key: config.groqKey, model: config.groqModel },
      openai: { name: 'OpenAI', key: config.openaiKey, model: config.openaiModel },
    }[config.selectedApi];
    const settings = JSON.stringify([config.selectedApi, provider.model, config.sampleRate, config.maxFileSizeMB]);
    const pauseAtCheckpoint = () => {
      if (statusRef.current !== 'paused') return false;
      updateJob(id, { status: 'queued' });
      return true;
    };

    try {
      if (!provider.key.trim()) throw new Error('Add your ' + provider.name + ' API key before transcribing.');
      if (item.checkpoint?.settings !== settings) {
        item.checkpoint = undefined;
        updateJob(id, { status: 'converting', progress: 10, segmentCount: undefined, segmentsTranscribed: 0 });
        const { instance, release } = await acquire();
        try {
          if (pauseAtCheckpoint()) return;
          const data = await convertAudio(instance, file, id, config.sampleRate,
            track => onLog('"' + file.name + '": using audio track ' + track + ' because earlier tracks were silent.', 'info'));
          updateJob(id, { status: 'splitting', progress: 35 });
          const segments = await splitAudio(instance, data, id, config);
          item.checkpoint = { settings, segments, results: [] };
        } finally {
          release();
        }
      }

      const { segments, results } = item.checkpoint;
      const progress = () => Math.round(45 + 45 * results.length / segments.length);
      updateJob(id, { status: 'transcribing', segmentCount: segments.length, segmentsTranscribed: results.length, progress: progress() });
      const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      for (let index = results.length; index < segments.length; index++) {
        if (pauseAtCheckpoint()) return;
        const result = await transcribeSegment(segments[index].data, filename + '_seg' + index + '.mp3', config, limiter.current, onLog);
        if (!result.text.trim()) {
          throw new Error('The provider returned no speech for part ' + (index + 1) + '. Check that the audio contains speech, then retry.');
        }
        results.push(result);
        updateJob(id, { segmentsTranscribed: results.length, progress: progress() });
      }
      updateJob(id, { status: 'stitching', progress: 92 });
      const transcriptCues = mergeTranscriptCues(results, segments);
      const transcript = results.length === 1 ? results[0].text
        : transcriptCues ? joinCueText(transcriptCues)
          : segments[1].offset < segments[1].keepStart
            ? stitchTranscriptions(results.map(result => result.text), (message, type) => onLog(message, type || 'info'))
            : results.map(result => result.text.trim()).join('\n');
      updateJob(id, { status: 'done', progress: 100, transcript, transcriptCues });
      files.current.delete(id);
      onLog('"' + file.name + '" transcription complete.', 'info');
    } catch (error) {
      const message = describeError(error);
      updateJob(id, { status: 'error', error: message });
      onLog('"' + file.name + '": ' + message, 'error');
    }
  }, [acquire, apiConfigRef, onLog, updateJob]);

  const pump = useCallback(function pumpQueue() {
    if (statusRef.current === 'paused') {
      if (!active.current.size && !jobsRef.current.some(job => job.status === 'queued')) changeStatus('idle');
      return;
    }

    const slots = AUDIO_WORKERS - active.current.size;
    const queued = jobsRef.current.filter(job => job.status === 'queued' && !active.current.has(job.id));
    const scheduled = queued.slice(0, slots);
    if ((scheduled.length || active.current.size) && statusRef.current !== 'processing') changeStatus('processing');
    for (const job of scheduled) {
      active.current.add(job.id);
      void processJob(job.id).finally(() => {
        active.current.delete(job.id);
        pumpQueue();
      });
    }
    if (!active.current.size && statusRef.current !== 'idle') changeStatus('idle');
  }, [changeStatus, processJob]);

  const startAll = useCallback(() => {
    changeJobs(all => all.map(job => job.status === 'ready' ? { ...job, status: 'queued' } : job));
    pump();
  }, [changeJobs, pump]);

  const startJob = useCallback((id: string) => {
    if (active.current.has(id)) return;
    const job = jobsRef.current.find(candidate => candidate.id === id);
    if (job && (job.status === 'ready' || job.status === 'queued' || job.status === 'error')) {
      updateJob(id, { status: 'queued', error: undefined });
      pump();
    }
  }, [pump, updateJob]);

  const pause = useCallback(() => changeStatus('paused'), [changeStatus]);

  const resume = useCallback(() => {
    changeStatus('idle');
    pump();
  }, [changeStatus, pump]);

  const removeJob = useCallback((id: string) => {
    if (active.current.has(id)) return;
    files.current.delete(id);
    changeJobs(previous => previous.filter(job => job.id !== id));
    pump();
  }, [changeJobs, pump]);

  const clearCompleted = useCallback(() => {
    changeJobs(previous => previous.filter(job => job.status !== 'done'));
  }, [changeJobs]);

  const setLLMResult = useCallback((id: string, result: string) => {
    updateJob(id, { llmResult: result });
  }, [updateJob]);

  return {
    jobs, globalStatus, completedCount: jobs.filter(job => job.status === 'done').length, totalCount: jobs.length,
    addFiles, removeJob, startAll, pause, resume, startJob, retryJob: startJob, clearCompleted, setLLMResult,
  };
}
