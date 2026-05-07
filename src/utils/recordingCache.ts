export type CachedRecordingStatus = 'draft';

export interface CachedRecording {
  id: string;
  fileName: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
  durationMs: number;
  status: CachedRecordingStatus;
}

const DB_NAME = 'transcriber-recordings';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

function openRecordingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openRecordingDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export async function getCachedRecordings(): Promise<CachedRecording[]> {
  const records = await withStore<CachedRecording[]>('readonly', store => store.getAll());

  return records
    .filter(record => record.blob?.size > 0)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDraftRecording(): Promise<CachedRecording | undefined> {
  const records = await getCachedRecordings();
  return records.find(record => record.status === 'draft');
}

export async function saveCachedRecording(record: CachedRecording): Promise<void> {
  const records = await getCachedRecordings();
  await Promise.all(records.filter(item => item.id !== record.id).map(item => deleteCachedRecording(item.id)));
  await withStore<IDBValidKey>('readwrite', store => store.put({ ...record, status: 'draft' }));
}

export async function deleteCachedRecording(id: string): Promise<void> {
  await withStore<undefined>('readwrite', store => store.delete(id));
}

export async function deleteDraftRecording(): Promise<void> {
  const draft = await getDraftRecording();
  if (draft) await deleteCachedRecording(draft.id);
}
