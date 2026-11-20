import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileJob, ApiConfig, ApiProvider, AudioChunk, TranscriptionResult } from '../types';
import { AUDIO_WORKERS, type FFmpegPoolHandle } from './useFFmpegPool';
import { convertAudio, isSupportedMedia, MAX_INPUT_BYTES, splitAudio } from '../media/prepareAudio';
import { PROVIDER_NAMES } from '../providers/availability';
import { prepareBackgroundWorker, runPreparedAudio } from '../transcription/background';
import { assembleTranscript, transcribePart } from '../transcription/processAudio';
import {
  listWork, readWork, readReceipt, saveWork, saveAudio, setWorkMode, removeWork, workLock, workSettings,
  type StoredWork, type Transcript, type WorkConfig,
} from '../transcription/workStorage';

type QueueStatus = 'idle' | 'processing' | 'paused';
type Log = (message: string, type: 'info' | 'error') => void;

interface QueueFile {
  file: File;
  config?: WorkConfig;
  saved?: Promise<boolean>;
  modeChange?: Promise<unknown>;
  retryInterrupted?: boolean;
  checkpoint?: { settings: string; segments: AudioChunk[]; results: TranscriptionResult[] };
}

interface QueueConfig {
  ffmpegPool: FFmpegPoolHandle;
  apiConfigRef: React.RefObject<ApiConfig>;
  ensureProviderAvailable: (provider: ApiProvider, key: string) => Promise<void>;
  onLog: Log;
}

function describeError(error: unknown, provider: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/api_key_invalid|api key not valid|invalid api key|\b401\b|unauthorized/i.test(message)) {
    return 'The provider rejected the API key. Check Advanced settings and retry.';
  }
  if (/\b429\b|rate limit/i.test(message)) return 'The provider is rate limiting requests. Wait a moment and retry.';
  if (/network|failed to fetch|connection error|load failed/i.test(message)) {
    return 'The connection to ' + provider + ' failed during transcription. Check your connection and retry.';
  }
  return message;
}

function getWorkConfig(config: ApiConfig): WorkConfig {
  const { selectedApi, sampleRate, maxFileSizeMB } = config;
  const model = { google: config.googleModel, groq: config.groqModel, openai: config.openaiModel }[selectedApi];
  return { selectedApi, model, sampleRate, maxFileSizeMB };
}

export function useTranscriptionQueue({ ffmpegPool: { acquire }, apiConfigRef, ensureProviderAvailable, onLog }: QueueConfig) {
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const jobsRef = useRef<FileJob[]>([]);
  const [globalStatus, setStatus] = useState<QueueStatus>('idle');
  const statusRef = useRef<QueueStatus>('idle');
  const files = useRef(new Map<string, QueueFile>());
  const active = useRef(new Set<string>());

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
      const id = 'media-' + (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2));
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

  const changeSavedMode = useCallback((item: QueueFile, id: string, mode: 'active' | 'paused') => {
    if (!item.saved) return;
    item.modeChange = (item.modeChange ?? item.saved).then(async () => {
      if (await item.saved) await setWorkMode(id, mode);
    }).catch(() => onLog('Could not save the queue state for "' + item.file.name + '".', 'error'));
  }, [onLog]);

  const stage = useCallback((job: FileJob) => {
    const item = files.current.get(job.id);
    const runtime = apiConfigRef.current;
    if (!item || !runtime || !navigator.locks) return;
    if (item.saved) {
      if (job.status === 'error') item.retryInterrupted = true;
      changeSavedMode(item, job.id, statusRef.current === 'paused' ? 'paused' : 'active');
      return;
    }
    const config = getWorkConfig(runtime);
    item.config = config;
    void prepareBackgroundWorker();
    const { id, fileName, fileSize, mimeType, addedAt } = job;
    const record: StoredWork = {
      job: { id, fileName, fileSize, mimeType, addedAt }, config, file: item.file,
      mode: statusRef.current === 'paused' ? 'paused' : 'active',
    };
    item.saved = saveWork(record).then(() => true).catch(() => {
      onLog('Browser storage could not save "' + fileName + '". Keep this tab open while it transcribes.', 'info');
      return false;
    });
  }, [apiConfigRef, changeSavedMode, onLog]);

  const processJob = useCallback(async (id: string) => {
    const item = files.current.get(id);
    const runtime = apiConfigRef.current;
    if (!item || !runtime) return;
    const { file } = item;
    const config = item.config ?? getWorkConfig(runtime);
    const key = { google: runtime.googleKey, groq: runtime.groqKey, openai: runtime.openaiKey }[config.selectedApi].trim();
    const provider = { provider: config.selectedApi, model: config.model, key };
    const settings = workSettings(config);
    const pauseAtCheckpoint = () => {
      if (statusRef.current !== 'paused') return false;
      updateJob(id, { status: 'queued' });
      return true;
    };
    const report = (done: number, total: number, stage?: string) => {
      if (stage) onLog('"' + file.name + '" part ' + (done + 1) + '/' + total + ' · ' + stage, 'info');
      updateJob(id, { status: 'transcribing', providerStage: stage, segmentCount: total, segmentsTranscribed: done,
        progress: Math.round(45 + 45 * done / total) });
    };
    const onWarning = (message: string) => onLog(message, 'error');
    const complete = (transcript: Transcript) => {
      updateJob(id, { status: 'done', progress: 100, ...transcript });
      files.current.delete(id);
      onLog('"' + file.name + '" transcription complete.', 'info');
    };
    const prepare = async () => {
      updateJob(id, { status: 'converting', progress: 10, segmentCount: undefined, segmentsTranscribed: 0 });
      const { instance, release } = await acquire();
      try {
        if (pauseAtCheckpoint()) return;
        const data = await convertAudio(instance, file, id, config.sampleRate,
          track => onLog('"' + file.name + '": using audio track ' + track + ' because earlier tracks were silent.', 'info'));
        updateJob(id, { status: 'splitting', progress: 35 });
        return await splitAudio(instance, data, id, {
          ...runtime, ...config, openaiModel: config.selectedApi === 'openai' ? config.model : runtime.openaiModel,
        });
      } finally {
        release();
      }
    };

    let durable: boolean | undefined;
    let dispatched = false;
    try {
      await item.modeChange;
      durable = await item.saved;
      if (durable) {
        // The file may already have finished in a worker launched by an earlier page.
        const stored = await readWork(id);
        if (stored?.mode === 'done' && stored.transcript) {
          complete(stored.transcript);
          return;
        }
        const receipt = await readReceipt(id);
        const finished = stored?.segmentCount && receipt?.settings === settings && receipt.results.length === stored.segmentCount;
        if (!finished) await ensureProviderAvailable(config.selectedApi, key);
        if (pauseAtCheckpoint()) return;

        const segmentCount = stored?.segmentCount ?? await navigator.locks.request('transcriber-prepare:' + id, async () => {
          const existing = await readWork(id);
          if (existing?.segmentCount) return existing.segmentCount;
          const segments = await prepare();
          if (!segments) return;
          try {
            await saveAudio(id, settings, segments);
          } catch {
            await removeWork(id);
            item.saved = Promise.resolve(false);
            item.checkpoint = { settings, segments, results: [] };
            durable = false;
            onLog('Browser storage ran out of space. Keep this tab open while "' + file.name + '" transcribes.', 'info');
          }
          return segments.length;
        });
        if (!segmentCount || pauseAtCheckpoint()) return;
        if (durable) {
          if (!finished) await ensureProviderAvailable(config.selectedApi, key);
          report(receipt?.results.length ?? 0, segmentCount);
          dispatched = true;
          const outcome = await runPreparedAudio({ id, key, retryInterrupted: !!item.retryInterrupted }, report, onWarning);
          item.retryInterrupted = false;
          if (outcome.state === 'done') complete(outcome.transcript);
          else {
            await item.modeChange;
            const current = await readWork(id);
            if (current?.mode === 'done' && current.transcript) complete(current.transcript);
            else if (current?.mode === 'failed') {
              updateJob(id, { status: 'error', error: 'Progress was saved. Retry to submit the unfinished part again.' });
            } else if (!pauseAtCheckpoint()) {
              if (!current) item.saved = Promise.resolve(false);
              updateJob(id, { status: current?.mode === 'active' ? 'queued' : 'ready' });
            }
          }
          return;
        }
      }

      await ensureProviderAvailable(config.selectedApi, key);
      if (pauseAtCheckpoint()) return;
      if (item.checkpoint?.settings !== settings) {
        const segments = await prepare();
        if (!segments) return;
        item.checkpoint = { settings, segments, results: [] };
      }
      const { segments, results } = item.checkpoint;
      await ensureProviderAvailable(config.selectedApi, key);
      report(results.length, segments.length);
      for (let index = results.length; index < segments.length; index++) {
        if (pauseAtCheckpoint()) return;
        results.push(await transcribePart(segments[index].data, file.name, index, provider, onWarning,
          stage => report(index, segments.length, stage)));
        report(results.length, segments.length);
      }
      complete(assembleTranscript(results, segments));
    } catch (error) {
      if (durable && !dispatched) {
        await navigator.locks.request(workLock(id), { ifAvailable: true }, async lock => {
          if (lock) await setWorkMode(id, 'failed');
        }).catch(() => undefined);
      }
      const message = describeError(error, PROVIDER_NAMES[config.selectedApi]);
      updateJob(id, { status: 'error', error: message });
      onLog('"' + file.name + '": ' + message, 'error');
    }
  }, [acquire, apiConfigRef, ensureProviderAvailable, onLog, updateJob]);

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

  useEffect(() => {
    if (!navigator.locks) return;
    let cancelled = false;
    void listWork().then(records => {
      if (cancelled || !records?.length) return;
      const known = new Set(jobsRef.current.map(job => job.id));
      const restored: FileJob[] = [];
      for (const work of records.sort((a, b) => a.job.addedAt - b.job.addedAt)) {
        if (known.has(work.job.id)) continue;
        if (work.mode === 'done' && work.transcript) {
          restored.push({ ...work.job, ...work.transcript, progress: 100, status: 'done' });
        } else if (work.file) {
          files.current.set(work.job.id, { file: work.file, config: work.config, saved: Promise.resolve(true) });
          const status = work.mode === 'active' ? 'queued' : work.mode === 'paused' ? 'ready' : 'error';
          restored.push({ ...work.job, status, progress: 0,
            error: status === 'error' ? 'Progress was saved. Retry to submit the unfinished part again.' : undefined });
        }
      }
      if (restored.length) changeJobs(previous => [...restored, ...previous]);
      pump();
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [changeJobs, pump]);

  const startAll = useCallback(() => {
    for (const job of jobsRef.current) if (job.status === 'ready') stage(job);
    changeJobs(all => all.map(job => job.status === 'ready' ? { ...job, status: 'queued' } : job));
    pump();
  }, [changeJobs, pump, stage]);

  const startJob = useCallback((id: string) => {
    if (active.current.has(id)) return;
    const job = jobsRef.current.find(candidate => candidate.id === id);
    if (job && (job.status === 'ready' || job.status === 'queued' || job.status === 'error')) {
      stage(job);
      updateJob(id, { status: 'queued', error: undefined });
      pump();
    }
  }, [pump, stage, updateJob]);

  const pause = useCallback(() => {
    changeStatus('paused');
    for (const job of jobsRef.current) {
      const item = files.current.get(job.id);
      if (item && (job.status === 'queued' || active.current.has(job.id))) changeSavedMode(item, job.id, 'paused');
    }
  }, [changeSavedMode, changeStatus]);

  const resume = useCallback(() => {
    for (const job of jobsRef.current) {
      const item = files.current.get(job.id);
      if (item && (job.status === 'queued' || active.current.has(job.id))) changeSavedMode(item, job.id, 'active');
    }
    changeStatus('idle');
    pump();
  }, [changeSavedMode, changeStatus, pump]);

  const removeJob = useCallback((id: string) => {
    if (active.current.has(id)) return;
    const item = files.current.get(id);
    if (item?.saved) void item.saved.then(saved => saved && removeWork(id)).catch(() => onLog('Could not remove saved audio.', 'error'));
    else if (jobsRef.current.some(job => job.id === id && job.status === 'done')) void removeWork(id).catch(() => undefined);
    files.current.delete(id);
    changeJobs(previous => previous.filter(job => job.id !== id));
    pump();
  }, [changeJobs, onLog, pump]);

  const clearCompleted = useCallback(() => {
    for (const job of jobsRef.current) {
      if (job.status === 'done') void removeWork(job.id).catch(() => undefined);
    }
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
