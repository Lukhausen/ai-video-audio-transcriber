// Main processing orchestrator for multi-file transcription
import { useReducer, useRef, useCallback } from 'react';
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import { transcribeGoogleAudio } from '../providers/google';
import type { FileJob, ApiConfig, SegmentInfo, AudioChunk, TranscriptionResult } from '../types';
import type { FFmpegPoolHandle } from './useFFmpegPool';
import { RateLimiter } from '../utils/rateLimiter';
import { parseAudioTranscription } from '../transcripts/metadata';
import { joinCueText, mergeTranscriptCues } from '../transcripts/output';
import { stitchTranscriptions } from '../utils/stitching';

// ---- Reducer types ----
type QueueAction =
  | { type: 'ADD_FILES'; jobs: FileJob[] }
  | { type: 'REMOVE_JOB'; id: string }
  | { type: 'UPDATE_JOB'; id: string; updates: Partial<FileJob> }
  | { type: 'QUEUE_READY' }
  | { type: 'CLEAR_COMPLETED' }
  | { type: 'SET_GLOBAL'; status: 'idle' | 'processing' | 'paused' };

interface QueueState {
  jobs: FileJob[];
  globalStatus: 'idle' | 'processing' | 'paused';
}

const initialState: QueueState = {
  jobs: [],
  globalStatus: 'idle',
};

function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'ADD_FILES':
      return { ...state, jobs: [...state.jobs, ...action.jobs] };
    case 'REMOVE_JOB':
      return { ...state, jobs: state.jobs.filter(j => j.id !== action.id) };
    case 'UPDATE_JOB':
      return {
        ...state,
        jobs: state.jobs.map(j =>
          j.id === action.id ? { ...j, ...action.updates } : j
        ),
      };
    case 'QUEUE_READY':
      return {
        ...state,
        jobs: state.jobs.map(j =>
          j.status === 'ready' ? { ...j, status: 'queued' } : j
        ),
      };
    case 'CLEAR_COMPLETED':
      return { ...state, jobs: state.jobs.filter(j => j.status !== 'done') };
    case 'SET_GLOBAL':
      return { ...state, globalStatus: action.status };
    default:
      return state;
  }
}

// ---- Side-channel for binary data (never in React state) ----
interface BinaryData {
  file: File;
  segments?: AudioChunk[];
  segmentInfos?: SegmentInfo[];
}

// ---- Supported media types ----
const SUPPORTED_PREFIXES = ['audio/', 'video/'];
const SUPPORTED_EXTENSIONS = [
  '.mp4', '.mkv', '.mov', '.avi', '.wmv', '.webm', '.flv',
  '.mp3', '.wav', '.aac', '.ogg', '.flac', '.m4a', '.wma', '.opus',
];
const MIN_MEDIA_FILE_BYTES = 1024;

function isSupported(file: File): boolean {
  if (SUPPORTED_PREFIXES.some(p => file.type.startsWith(p))) return true;
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function makeId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Sanitize filename for FFmpeg FS — replace problematic chars
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getRawErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createConversionError(fileName: string, err: unknown, ffmpegOutput: string): Error {
  const rawMessage = getRawErrorMessage(err);
  const output = ffmpegOutput.toLowerCase();
  const looksInvalid =
    output.includes('invalid frame size') ||
    output.includes('invalid argument') ||
    output.includes('format mp3 detected only with low score') ||
    output.includes('could not find codec parameters');

  if (looksInvalid) {
    return new Error(`"${fileName}" does not appear to contain valid audio or video data.`);
  }

  return new Error(rawMessage || `Could not convert "${fileName}".`);
}

function createUserFacingError(fileName: string, err: unknown): string {
  const rawMessage = getRawErrorMessage(err);
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes('errnoerror') ||
    normalized.includes('fs error') ||
    normalized.includes('invalid frame size') ||
    normalized.includes('invalid argument') ||
    normalized.includes('valid audio or video')
  ) {
    return `This file could not be read. It may be empty, corrupted, or not a real audio/video file: "${fileName}".`;
  }

  if (normalized.includes('no groq api key')) {
    return 'Add your Groq API key before transcribing.';
  }

  if (normalized.includes('no openai api key')) {
    return 'Add your OpenAI API key before transcribing.';
  }

  if (normalized.includes('no google api key')) {
    return 'Add your Google API key before transcribing.';
  }

  if (normalized.includes('api_key_invalid') || normalized.includes('api key not valid')) {
    return 'The selected provider rejected the API key. Check it in Advanced settings and try again.';
  }

  if (normalized.includes('401') || normalized.includes('unauthorized') || normalized.includes('invalid api key')) {
    return 'The selected provider rejected the API key. Check it in Advanced settings and try again.';
  }

  if (normalized.includes('429') || normalized.includes('rate limit')) {
    return 'The selected provider is rate limiting requests. Wait a moment, then retry this file.';
  }

  if (normalized.includes('network') || normalized.includes('failed to fetch')) {
    return 'The transcription request could not reach the selected provider. Check your connection and try again.';
  }

  return rawMessage || `Could not transcribe "${fileName}".`;
}

// ---- Hook config ----
interface QueueConfig {
  ffmpegPool: FFmpegPoolHandle;
  apiConfigRef: React.RefObject<ApiConfig>;
  onLog: (msg: string, type: 'info' | 'error') => void;
}

export function useTranscriptionQueue(config: QueueConfig) {
  const { ffmpegPool, apiConfigRef, onLog } = config;
  const [state, dispatch] = useReducer(queueReducer, initialState);

  // Binary data side-channel
  const binaryRef = useRef<Map<string, BinaryData>>(new Map());
  // Rate limiter (persists across renders)
  const rateLimiterRef = useRef(new RateLimiter(10));
  // Paused flag (ref for async access)
  const pausedRef = useRef(false);
  // Keep a ref to current jobs for async access
  const jobsRef = useRef(state.jobs);
  jobsRef.current = state.jobs;
  // Track which job IDs are currently being claimed for processing
  const claimedJobsRef = useRef<Set<string>>(new Set());

  // ---- Helpers ----
  const updateJob = useCallback((id: string, updates: Partial<FileJob>) => {
    dispatch({ type: 'UPDATE_JOB', id, updates });
  }, []);

  const getApiConfig = useCallback((): ApiConfig => {
    return apiConfigRef.current!;
  }, [apiConfigRef]);

  // ---- File addition with validation ----
  const addFiles = useCallback((files: File[]) => {
    const newJobs: FileJob[] = [];
    const existing = jobsRef.current;

    for (const file of files) {
      // Validate format
      if (!isSupported(file)) {
        onLog(`Rejected "${file.name}" - unsupported format (${file.type || 'unknown'}).`, 'error');
        continue;
      }
      if (file.size < MIN_MEDIA_FILE_BYTES) {
        onLog(`Rejected "${file.name}" - file is too small to contain usable audio or video data.`, 'error');
        continue;
      }
      // Duplicate detection
      const fingerprint = `${file.name}_${file.size}_${file.lastModified}`;
      const isDupe = existing.some(j => {
        const bd = binaryRef.current.get(j.id);
        if (!bd) return false;
        return `${bd.file.name}_${bd.file.size}_${bd.file.lastModified}` === fingerprint;
      });
      if (isDupe) {
        onLog(`"${file.name}" already in queue - adding anyway.`, 'info');
      }

      const id = makeId();
      const job: FileJob = {
        id,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        status: 'ready',
        progress: 0,
        addedAt: Date.now(),
      };
      newJobs.push(job);
      binaryRef.current.set(id, { file });
      onLog(`Added "${file.name}".`, 'info');
    }

    if (newJobs.length > 0) {
      dispatch({ type: 'ADD_FILES', jobs: newJobs });
    }
  }, [onLog]);

  // ---- Remove job ----
  const removeJob = useCallback((id: string) => {
    binaryRef.current.delete(id);
    dispatch({ type: 'REMOVE_JOB', id });
  }, []);

  // ---- Clean an FFmpeg instance's FS before use ----
  const cleanFFmpegFS = async (ffmpeg: FFmpeg, mountDir: string) => {
    // Try to unmount if something was left mounted
    try { await ffmpeg.unmount(mountDir); } catch { /* not mounted, fine */ }
    // Try to remove the directory
    try { await ffmpeg.deleteDir(mountDir); } catch { /* doesn't exist, fine */ }
  };

  // ---- Convert a single file using an FFmpeg instance ----
  const convertFile = useCallback(async (
    ffmpeg: FFmpeg,
    jobId: string,
    file: File,
    cfg: ApiConfig
  ): Promise<{ mp3Data: Uint8Array }> => {
    // Use a unique mount dir per job to avoid collisions
    const mountDir = `/mnt_${jobId}`;
    const outputFileName = `out_${jobId}.mp3`;

    // Clean any leftover state
    await cleanFFmpegFS(ffmpeg, mountDir);
    let ffmpegOutput = '';
    const logHandler = ({ message }: { message: string }) => {
      ffmpegOutput += `${message}\n`;
    };

    try {
      await ffmpeg.createDir(mountDir);
      await ffmpeg.mount('WORKERFS' as FFFSType, { files: [file] }, mountDir);

      // WORKERFS exposes the file by its original name
      const inputPath = `${mountDir}/${file.name}`;

      const ffmpegCmd = file.type.startsWith('video/')
        ? ['-i', inputPath, '-map', '0:a:0', '-ar', cfg.sampleRate.toString(), '-ac', '1', '-c:a', 'libmp3lame', '-f', 'mp3', outputFileName]
        : ['-i', inputPath, '-vn', '-map', '0:a:0', '-ar', cfg.sampleRate.toString(), '-ac', '1', '-c:a', 'libmp3lame', '-f', 'mp3', outputFileName];

      ffmpeg.on('log', logHandler);
      await ffmpeg.exec(ffmpegCmd);
      ffmpeg.off('log', logHandler);

      const mp3Data = await ffmpeg.readFile(outputFileName) as unknown as Uint8Array;

      // Cleanup
      try { await ffmpeg.unmount(mountDir); } catch { /* ok */ }
      try { await ffmpeg.deleteDir(mountDir); } catch { /* ok */ }
      try { ffmpeg.deleteFile(outputFileName); } catch { /* ok */ }

      return { mp3Data };
    } catch (err) {
      try { ffmpeg.off('log', logHandler); } catch { /* ok */ }
      // Cleanup on error too
      try { await ffmpeg.unmount(mountDir); } catch { /* ok */ }
      try { await ffmpeg.deleteDir(mountDir); } catch { /* ok */ }
      try { ffmpeg.deleteFile(outputFileName); } catch { /* ok */ }
      throw createConversionError(file.name, err, ffmpegOutput);
    }
  }, []);

  // ---- Split audio to fit provider byte and duration limits ----
  const splitFile = useCallback(async (
    ffmpeg: FFmpeg,
    jobId: string,
    mp3Data: Uint8Array,
    cfg: ApiConfig
  ): Promise<AudioChunk[]> => {
    const maxBytes = cfg.selectedApi === 'google'
      ? Math.min(cfg.maxFileSizeMB * 1024 * 1024, 2 * 1024 ** 3)
      : cfg.maxFileSizeMB * 1024 * 1024;
    // Speaker/word annotations limit Google requests to 30 minutes.
    const maxDuration = cfg.selectedApi === 'google' ? 1790 : Infinity;
    const overlap = cfg.selectedApi === 'openai' && cfg.openaiModel === 'gpt-4o-transcribe-diarize' ? 0 : 3;
    if (mp3Data.byteLength <= maxBytes && maxDuration === Infinity) return [{ data: mp3Data, offset: 0, keepStart: 0, keepEnd: Infinity }];

    const rootName = `split_${jobId}.mp3`;
    const temporaryFiles = new Set([rootName]);
    try {
      await ffmpeg.writeFile(rootName, mp3Data);
      const recursiveSplit = async (
        filename: string, offset: number, keepStart: number, keepEnd: number,
      ): Promise<AudioChunk[]> => {
        const fileData = await ffmpeg.readFile(filename) as Uint8Array;
        if (fileData.byteLength <= maxBytes && maxDuration === Infinity) return [{ data: fileData, offset, keepStart, keepEnd }];

        let output = '';
        const logHandler = ({ message }: { message: string }) => { output += message + '\n'; };
        ffmpeg.on('log', logHandler);
        try {
          await ffmpeg.exec(['-i', filename, '-t', '0', '-f', 'null', '-']);
        } finally {
          ffmpeg.off('log', logHandler);
        }
        const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!durationMatch) throw new Error('Could not determine audio duration for safe splitting.');
        const duration = Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        if (fileData.byteLength <= maxBytes && duration <= maxDuration) return [{ data: fileData, offset, keepStart, keepEnd }];
        // Overlapping halves must shrink, including for unusually small chunk settings.
        if (duration <= overlap * 2 || duration <= 0) throw new Error('Audio cannot fit the selected chunk size. Increase it in Advanced settings.');

        const halfTime = duration / 2;
        const leftName = `${filename}_L.mp3`;
        const rightName = `${filename}_R.mp3`;
        temporaryFiles.add(leftName);
        temporaryFiles.add(rightName);
        await ffmpeg.exec(['-i', filename, '-ss', '0', '-to', (halfTime + overlap).toString(), '-c', 'copy', leftName]);
        await ffmpeg.exec(['-i', filename, '-ss', (halfTime - overlap).toString(), '-to', duration.toString(), '-c', 'copy', rightName]);
        const boundary = offset + halfTime;
        return [
          ...await recursiveSplit(leftName, offset, keepStart, Math.min(keepEnd, boundary)),
          ...await recursiveSplit(rightName, offset + halfTime - overlap, Math.max(keepStart, boundary), keepEnd),
        ];
      };

      const segments: AudioChunk[] = await recursiveSplit(rootName, 0, 0, Infinity);
      if (segments.length > 1) onLog(`[${jobId.slice(0, 6)}] Split into ${segments.length} segments.`, 'info');
      return segments;
    } finally {
      for (const name of temporaryFiles) {
        try { await ffmpeg.deleteFile(name); } catch { /* already removed */ }
      }
    }
  }, [onLog]);

  // ---- Transcribe a single segment ----
  const transcribeSegment = useCallback(async (
    segmentData: Uint8Array,
    segmentName: string,
    jobId: string,
    cfg: ApiConfig
  ): Promise<TranscriptionResult> => {
    const limiter = rateLimiterRef.current;

    await limiter.acquire();
    try {
      const bytes = segmentData.byteOffset === 0 && segmentData.byteLength === segmentData.buffer.byteLength
        ? segmentData.buffer
        : segmentData.buffer.slice(segmentData.byteOffset, segmentData.byteOffset + segmentData.byteLength);
      const blob = new Blob([bytes], { type: 'audio/mp3' });
      const audioFile = new File([blob], segmentName, { type: 'audio/mp3' });

      let result: TranscriptionResult;

      if (cfg.selectedApi === 'groq') {
        if (!cfg.groqKey) throw new Error('No Groq API key set.');
        const client = new Groq({ apiKey: cfg.groqKey, dangerouslyAllowBrowser: true });
        const resp = await client.audio.transcriptions.create({
          file: audioFile,
          model: cfg.groqModel,
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
        });
        result = parseAudioTranscription(resp);
      } else if (cfg.selectedApi === 'google') {
        result = await transcribeGoogleAudio(cfg.googleKey, cfg.googleModel, audioFile, message => onLog(message, 'error'));
      } else {
        if (!cfg.openaiKey) throw new Error('No OpenAI API key set.');
        const client = new OpenAI({ apiKey: cfg.openaiKey, dangerouslyAllowBrowser: true });
        const resp = await client.audio.transcriptions.create({
          file: audioFile,
          model: cfg.openaiModel,
          ...(cfg.openaiModel === 'gpt-4o-transcribe-diarize'
            ? { response_format: 'diarized_json' as const, chunking_strategy: 'auto' as const }
            : cfg.openaiModel === 'whisper-1'
              ? { response_format: 'verbose_json' as const, timestamp_granularities: ['word', 'segment'] }
              : {}),
        });
        result = parseAudioTranscription(resp);
      }

      limiter.release();
      limiter.onSuccess();
      return result;
    } catch (err: unknown) {
      limiter.release();
      const providerError = err as { status?: number; message?: string };
      if (providerError.status === 429 || providerError.message?.includes('429')) {
        limiter.on429();
        onLog(`[${jobId.slice(0, 6)}] Rate limited (429). Backing off...`, 'error');
      }
      throw err;
    }
  }, [onLog]);

  // ---- Process a single job end-to-end ----
  const processJob = useCallback(async (jobId: string) => {
    const bd = binaryRef.current.get(jobId);
    if (!bd) return;
    const cfg = { ...getApiConfig() };

    try {
      // Step 1: Convert
      updateJob(jobId, { status: 'converting', progress: 10 });
      onLog(`[${bd.file.name}] Converting to MP3...`, 'info');

      const { instance, release } = await ffmpegPool.acquire();
      let segments: AudioChunk[] | null = null;
      try {
        const result = await convertFile(instance, jobId, bd.file, cfg);
        const mp3Data = result.mp3Data;
        updateJob(jobId, { progress: 30 });
        onLog(`[${bd.file.name}] Conversion complete (${(mp3Data.byteLength / 1024 / 1024).toFixed(1)}MB).`, 'info');

        // Step 2: Split
        updateJob(jobId, { status: 'splitting', progress: 35 });
        segments = await splitFile(instance, jobId, mp3Data, cfg);

        release(); // Free the FFmpeg instance for other jobs
      } catch (err) {
        release();
        throw err;
      }

      // Store segments
      bd.segments = segments;
      updateJob(jobId, { segmentCount: segments.length, progress: 40 });

      // Check if paused
      if (pausedRef.current) {
        updateJob(jobId, { status: 'queued', progress: 0 });
        return;
      }

      // Step 3: Transcribe
      updateJob(jobId, { status: 'transcribing', progress: 45 });
      onLog(`[${bd.file.name}] Transcribing ${segments.length} segment(s)...`, 'info');

      const results: TranscriptionResult[] = [];
      for (let i = 0; i < segments.length; i++) {
        if (pausedRef.current) {
          updateJob(jobId, { status: 'queued', progress: 0 });
          return;
        }

        const segName = `${sanitizeFilename(bd.file.name)}_seg${i}.mp3`;
        const result = await transcribeSegment(segments[i].data, segName, jobId, cfg);
        results.push(result);

        const transcribeProgress = 45 + ((i + 1) / segments.length) * 45;
        updateJob(jobId, {
          segmentsTranscribed: i + 1,
          progress: Math.round(transcribeProgress),
        });
      }

      // Step 4: Stitch
      updateJob(jobId, { status: 'stitching', progress: 92 });
      const transcriptCues = mergeTranscriptCues(results, segments);
      const transcript = transcriptCues
        ? results.length === 1 ? results[0].text : joinCueText(transcriptCues)
        : stitchTranscriptions(results.map(result => result.text), (msg, type) => onLog(msg, type || 'info'));

      // Done!
      updateJob(jobId, { status: 'done', progress: 100, transcript, transcriptCues });
      onLog(`[${bd.file.name}] ✓ Transcription complete.`, 'info');

      // Free binary data — no longer needed
      delete bd.segments;

    } catch (err: unknown) {
      const msg = createUserFacingError(bd?.file?.name || 'this file', err);
      updateJob(jobId, { status: 'error', error: msg });
      onLog(`[${bd?.file?.name}] Error: ${msg}`, 'error');
    }
  }, [ffmpegPool, convertFile, splitFile, transcribeSegment, updateJob, onLog, getApiConfig]);

  // ---- Claim next available queued job (thread-safe via Set) ----
  const claimNextJob = useCallback((): string | null => {
    const nextJob = jobsRef.current.find(
      j => j.status === 'queued' && !claimedJobsRef.current.has(j.id)
    );
    if (!nextJob) return null;
    claimedJobsRef.current.add(nextJob.id);
    return nextJob.id;
  }, []);

  // ---- Start all: process jobs with parallelism ----
  const startAll = useCallback(async () => {
    pausedRef.current = false;
    claimedJobsRef.current.clear();
    jobsRef.current = jobsRef.current.map(j =>
      j.status === 'ready' ? { ...j, status: 'queued' } : j
    );
    dispatch({ type: 'QUEUE_READY' });
    dispatch({ type: 'SET_GLOBAL', status: 'processing' });

    // Launch multiple processing loops (one per FFmpeg pool slot)
    const poolSize = 2;
    const loops = Array.from({ length: poolSize }, () =>
      (async () => {
        while (!pausedRef.current) {
          const jobId = claimNextJob();
          if (!jobId) break;
          updateJob(jobId, { status: 'converting', progress: 5 });
          await processJob(jobId);
          claimedJobsRef.current.delete(jobId);
        }
      })()
    );

    await Promise.all(loops);
    claimedJobsRef.current.clear();
    if (!pausedRef.current) {
      dispatch({ type: 'SET_GLOBAL', status: 'idle' });
      onLog('All jobs complete.', 'info');
    }
  }, [processJob, updateJob, onLog, claimNextJob]);

  // ---- Pause ----
  const pause = useCallback(() => {
    pausedRef.current = true;
    dispatch({ type: 'SET_GLOBAL', status: 'paused' });
    onLog('Processing paused.', 'info');
  }, [onLog]);

  // ---- Resume ----
  const resume = useCallback(() => {
    pausedRef.current = false;
    startAll();
  }, [startAll]);

  // ---- Retry a failed job ----
  const retryJob = useCallback(async (id: string) => {
    updateJob(id, { status: 'queued', progress: 0, error: undefined });
    if (state.globalStatus !== 'processing') {
      pausedRef.current = false;
      dispatch({ type: 'SET_GLOBAL', status: 'processing' });
      await processJob(id);
      dispatch({ type: 'SET_GLOBAL', status: 'idle' });
    }
  }, [state.globalStatus, processJob, updateJob]);

  // ---- Process one queued job ----
  const startJob = useCallback(async (id: string) => {
    if (state.globalStatus === 'processing') return;

    pausedRef.current = false;
    dispatch({ type: 'SET_GLOBAL', status: 'processing' });
    await processJob(id);
    dispatch({ type: 'SET_GLOBAL', status: 'idle' });
  }, [state.globalStatus, processJob]);

  // ---- Update transcript (user editing) ----
  const updateTranscript = useCallback((id: string, text: string) => {
    updateJob(id, { transcript: text });
  }, [updateJob]);

  // ---- Clear completed ----
  const clearCompleted = useCallback(() => {
    const completed = state.jobs.filter(j => j.status === 'done');
    completed.forEach(j => binaryRef.current.delete(j.id));
    dispatch({ type: 'CLEAR_COMPLETED' });
  }, [state.jobs]);

  // ---- Update LLM result for a job ----
  const setLLMResult = useCallback((id: string, result: string) => {
    updateJob(id, { llmResult: result });
  }, [updateJob]);

  return {
    jobs: state.jobs,
    globalStatus: state.globalStatus,
    completedCount: state.jobs.filter(j => j.status === 'done').length,
    totalCount: state.jobs.length,
    addFiles,
    removeJob,
    startAll,
    pause,
    resume,
    startJob,
    retryJob,
    updateTranscript,
    clearCompleted,
    setLLMResult,
  };
}
