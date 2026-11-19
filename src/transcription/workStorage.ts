import type { ApiConfig, ApiProvider, AudioChunk, FileJob, TranscriptionResult } from '../types';

export type WorkConfig = Pick<ApiConfig, 'selectedApi' | 'sampleRate' | 'maxFileSizeMB'> & { model: string };
export type ProviderConfig = { provider: ApiProvider; model: string; key: string };
export type Transcript = Pick<FileJob, 'transcript' | 'transcriptCues'>;

export interface StoredWork {
  job: Pick<FileJob, 'id' | 'fileName' | 'fileSize' | 'mimeType' | 'addedAt'>;
  file?: File;
  config: WorkConfig;
  mode: 'active' | 'paused' | 'failed' | 'done';
  segmentCount?: number;
  transcript?: Transcript;
}

export interface WorkReceipt {
  settings: string;
  results: TranscriptionResult[];
  pending: boolean;
}

const DATABASE = 'transcriber-work';
const JOBS = 'jobs';
const AUDIO = 'audio';
const RECEIPTS = 'receipts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      for (const name of [JOBS, AUDIO, RECEIPTS]) request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(
  stores: string | string[], mode: IDBTransactionMode, use: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.onabort = () => reject(tx.error ?? new Error('The browser could not save transcription progress.'));
      const request = use(tx);
      tx.oncomplete = () => resolve(request?.result);
    });
  } finally {
    db.close();
  }
}

function read<T>(store: string, id: string) {
  return transaction<T>(store, 'readonly', tx => tx.objectStore(store).get(id));
}

function write(store: string, id: string, data: unknown) {
  return transaction(store, 'readwrite', tx => tx.objectStore(store).put(data, id));
}

export const readWork = (id: string) => read<StoredWork>(JOBS, id);
export const listWork = () => transaction<StoredWork[]>(JOBS, 'readonly', tx => tx.objectStore(JOBS).getAll());
export const saveWork = (work: StoredWork) => write(JOBS, work.job.id, work);
export const readAudio = (id: string) => read<{ settings: string; segments: AudioChunk[] }>(AUDIO, id);
export const readReceipt = (id: string) => read<WorkReceipt>(RECEIPTS, id);
export const saveReceipt = (id: string, receipt: WorkReceipt) => write(RECEIPTS, id, receipt);
export const workLock = (id: string) => 'transcriber-job:' + id;

export function saveAudio(id: string, settings: string, segments: AudioChunk[]) {
  return transaction([JOBS, AUDIO], 'readwrite', tx => {
    const jobs = tx.objectStore(JOBS);
    const request = jobs.get(id);
    request.onsuccess = () => {
      const work = request.result as StoredWork | undefined;
      if (!work || work.mode === 'done') return;
      jobs.put({ ...work, segmentCount: segments.length }, id);
      tx.objectStore(AUDIO).put({ settings, segments }, id);
    };
  });
}

export async function beginPart(id: string, receipt: WorkReceipt): Promise<boolean> {
  return (await transaction<StoredWork>([JOBS, RECEIPTS], 'readwrite', tx => {
    const request = tx.objectStore(JOBS).get(id);
    request.onsuccess = () => {
      if (request.result?.mode === 'active') tx.objectStore(RECEIPTS).put({ ...receipt, pending: true }, id);
    };
    return request;
  }))?.mode === 'active';
}

export function setWorkMode(id: string, mode: StoredWork['mode']) {
  return transaction(JOBS, 'readwrite', tx => {
    const store = tx.objectStore(JOBS);
    const request = store.get(id);
    request.onsuccess = () => {
      const work = request.result as StoredWork | undefined;
      if (work && work.mode !== 'done') store.put({ ...work, mode }, id);
    };
  });
}

export function finishWork(work: StoredWork, transcript: Transcript) {
  const id = work.job.id;
  return transaction([JOBS, AUDIO, RECEIPTS], 'readwrite', tx => {
    tx.objectStore(JOBS).put({ ...work, file: undefined, mode: 'done', transcript }, id);
    tx.objectStore(AUDIO).delete(id);
    tx.objectStore(RECEIPTS).delete(id);
  });
}

export function removeWork(id: string) {
  return transaction([JOBS, AUDIO, RECEIPTS], 'readwrite', tx => {
    for (const store of [JOBS, AUDIO, RECEIPTS]) tx.objectStore(store).delete(id);
  });
}

export function workSettings(config: WorkConfig): string {
  return JSON.stringify([config.selectedApi, config.model, config.sampleRate, config.maxFileSizeMB]);
}
