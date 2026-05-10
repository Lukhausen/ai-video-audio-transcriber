// Main processing orchestrator for multi-file transcription
import { useReducer, useRef, useCallback } from 'react';
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import Groq from 'groq-sdk';
import OpenAI from 'openai';
import type { FileJob, ApiConfig, SegmentInfo } from '../types';
import type { FFmpegPoolHandle } from './useFFmpegPool';
import { RateLimiter } from '../utils/rateLimiter';
import { stitchTranscriptions } from '../utils/stitching';

// ---- Reducer types ----
type QueueAction =
  | { type: 'ADD_FILES'; jobs: FileJob[] }
  | { type: 'REMOVE_JOB'; id: string }
  | { type: 'UPDATE_JOB'; id: string; updates: Partial<FileJob> }
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
  segments?: Uint8Array[];
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

function createConversionError(fileName: string, err: unknown, ffmpegOutput: string): Error {
  const rawMessage = err instanceof Error ? err.message : String(err);
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
        status: 'queued',
        progress: 0,
        addedAt: Date.now(),
      };
      newJobs.push(job);
      binaryRef.current.set(id, { file });
      onLog(`Added "${file.name}" to queue.`, 'info');
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
    file: File
  ): Promise<{ mp3Data: Uint8Array }> => {
    const cfg = getApiConfig();
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
  }, [getApiConfig]);

  // ---- Split file if too large (recursive binary split) ----
  const splitFile = useCallback(async (
    ffmpeg: FFmpeg,
    jobId: string,
    mp3Data: Uint8Array
  ): Promise<Uint8Array[]> => {
    const cfg = getApiConfig();
    const MAX_BYTES = cfg.maxFileSizeMB * 1024 * 1024;

    if (mp3Data.byteLength <= MAX_BYTES) {
      return [mp3Data];
    }

    onLog(`[${jobId.slice(0, 6)}] File too large (${(mp3Data.byteLength / 1024 / 1024).toFixed(1)}MB), splitting...`, 'info');

    // Write MP3 to FFmpeg FS for splitting
    const rootName = `split_${jobId}.mp3`;
    await ffmpeg.writeFile(rootName, mp3Data);

    const recursiveSplit = async (filename: string): Promise<string[]> => {
      const fileData = await ffmpeg.readFile(filename) as Uint8Array;
      if (fileData.byteLength <= MAX_BYTES) {
        return [filename];
      }

      // Get duration
      let tempOut = '';
      const tempLogHandler = ({ message }: { message: string }) => { tempOut += message + '\n'; };
      ffmpeg.on('log', tempLogHandler);
      await ffmpeg.exec(['-i', filename, '-f', 'null', '-']);
      ffmpeg.off('log', tempLogHandler);

      const durationMatch = tempOut.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!durationMatch) {
        return [filename]; // Can't determine duration, return as-is
      }
      const totalDuration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);

      const halfTime = totalDuration / 2;
      const leftEnd = Math.min(halfTime + 3, totalDuration);
      const rightStart = Math.max(halfTime - 3, 0);
      const leftName = `${filename}_L.mp3`;
      const rightName = `${filename}_R.mp3`;

      await ffmpeg.exec(['-i', filename, '-ss', '0', '-to', leftEnd.toString(), '-c', 'copy', leftName]);
      await ffmpeg.exec(['-i', filename, '-ss', rightStart.toString(), '-to', totalDuration.toString(), '-c', 'copy', rightName]);

      const leftSegments = await recursiveSplit(leftName);
      const rightSegments = await recursiveSplit(rightName);
      return [...leftSegments, ...rightSegments];
    };

    const segmentNames = await recursiveSplit(rootName);

    // Read all segments out as Uint8Array
    const segments: Uint8Array[] = [];
    for (const name of segmentNames) {
      const data = await ffmpeg.readFile(name) as Uint8Array;
      segments.push(data);
      try { ffmpeg.deleteFile(name); } catch { /* ok */ }
    }

    // Cleanup root file
    try { ffmpeg.deleteFile(rootName); } catch { /* ok */ }

    onLog(`[${jobId.slice(0, 6)}] Split into ${segments.length} segments.`, 'info');
    return segments;
  }, [getApiConfig, onLog]);

  // ---- Transcribe a single segment ----
  const transcribeSegment = useCallback(async (
    segmentData: Uint8Array,
    segmentName: string,
    jobId: string
  ): Promise<string> => {
    const cfg = getApiConfig();
    const limiter = rateLimiterRef.current;

    await limiter.acquire();
    try {
      const blob = new Blob([segmentData.buffer], { type: 'audio/mp3' });
      const audioFile = new File([blob], segmentName, { type: 'audio/mp3' });

      let text = '';

      if (cfg.selectedApi === 'groq') {
        if (!cfg.groqKey) throw new Error('No Groq API key set.');
        const client = new Groq({ apiKey: cfg.groqKey, dangerouslyAllowBrowser: true });
        const resp = await client.audio.transcriptions.create({
          file: audioFile,
          model: cfg.groqModel,
          response_format: 'verbose_json',
        });
        text = resp?.text || '';
      } else {
        if (!cfg.openaiKey) throw new Error('No OpenAI API key set.');
        const client = new OpenAI({ apiKey: cfg.openaiKey, dangerouslyAllowBrowser: true });
        const resp = await client.audio.transcriptions.create({
          file: audioFile,
          model: cfg.openaiModel,
          response_format: 'verbose_json',
        });
        text = resp?.text || '';
      }

      limiter.release();
      limiter.onSuccess();
      return text;
    } catch (err: any) {
      limiter.release();
      if (err?.status === 429 || err?.message?.includes('429')) {
        limiter.on429();
        onLog(`[${jobId.slice(0, 6)}] Rate limited (429). Backing off...`, 'error');
      }
      throw err;
    }
  }, [getApiConfig, onLog]);

  // ---- Process a single job end-to-end ----
  const processJob = useCallback(async (jobId: string) => {
    const bd = binaryRef.current.get(jobId);
    if (!bd) return;

    try {
      // Step 1: Convert
      updateJob(jobId, { status: 'converting', progress: 10 });
      onLog(`[${bd.file.name}] Converting to MP3...`, 'info');

      const { instance, release } = await ffmpegPool.acquire();
      let segments: Uint8Array[] | null = null;
      try {
        const result = await convertFile(instance, jobId, bd.file);
        const mp3Data = result.mp3Data;
        updateJob(jobId, { progress: 30 });
        onLog(`[${bd.file.name}] Conversion complete (${(mp3Data.byteLength / 1024 / 1024).toFixed(1)}MB).`, 'info');

        // Step 2: Split
        updateJob(jobId, { status: 'splitting', progress: 35 });
        segments = await splitFile(instance, jobId, mp3Data);

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

      const transcripts: string[] = [];
      for (let i = 0; i < segments.length; i++) {
        if (pausedRef.current) {
          updateJob(jobId, { status: 'queued', progress: 0 });
          return;
        }

        const segName = `${sanitizeFilename(bd.file.name)}_seg${i}.mp3`;
        const text = await transcribeSegment(segments[i], segName, jobId);
        transcripts.push(text);

        const transcribeProgress = 45 + ((i + 1) / segments.length) * 45;
        updateJob(jobId, {
          segmentsTranscribed: i + 1,
          progress: Math.round(transcribeProgress),
        });
      }

      // Step 4: Stitch
      updateJob(jobId, { status: 'stitching', progress: 92 });
      const transcript = stitchTranscriptions(transcripts, (msg: string, type?: "info" | "error") => onLog(msg, type || 'info'));

      // Done!
      updateJob(jobId, { status: 'done', progress: 100, transcript });
      onLog(`[${bd.file.name}] ✓ Transcription complete.`, 'info');

      // Free binary data — no longer needed
      delete bd.segments;

    } catch (err: any) {
      const msg = err?.message || String(err);
      updateJob(jobId, { status: 'error', error: msg });
      onLog(`[${bd?.file?.name}] Error: ${msg}`, 'error');
    }
  }, [ffmpegPool, convertFile, splitFile, transcribeSegment, updateJob, onLog]);

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
    dispatch({ type: 'SET_GLOBAL', status: 'processing' });

    // Launch multiple processing loops (one per FFmpeg pool slot)
    const poolSize = 2;
    const loops = Array.from({ length: poolSize }, () =>
      (async () => {
        while (true) {
          if (pausedRef.current) break;
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
