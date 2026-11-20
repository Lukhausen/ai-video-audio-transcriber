import workerURL from './background.worker?worker&url';
import { processSavedAudio, type ReportProgress, type WorkOutcome } from './processAudio';
import { readWork, workLock } from './workStorage';
import type { BackgroundReply, BackgroundRequest } from './background.worker';

let registration: Promise<ServiceWorker | undefined> | undefined;

export function prepareBackgroundWorker(): Promise<ServiceWorker | undefined> {
  if (!('serviceWorker' in navigator) || !navigator.userAgent.includes('Chrome/')) return Promise.resolve(undefined);
  registration ??= (async () => {
    const url = new URL(workerURL, location.href);
    // Keep the worker outside the app's navigation scope. It only handles messages.
    const registered = await navigator.serviceWorker.register(url, { scope: new URL(url.pathname + '/', url).href });
    if (registered.active?.state === 'activated') return registered.active;
    const worker = registered.installing ?? registered.waiting ?? registered.active;
    if (!worker) return;
    return await new Promise<ServiceWorker | undefined>(resolve => {
      const finish = () => {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', onState);
        resolve(worker.state === 'activated' ? worker : undefined);
      };
      const onState = () => { if (worker.state === 'activated' || worker.state === 'redundant') finish(); };
      const timer = window.setTimeout(finish, 10_000);
      worker.addEventListener('statechange', onState);
      onState();
    });
  })().catch(() => undefined).then(worker => {
    if (!worker) registration = undefined;
    return worker;
  });
  return registration;
}

export async function runPreparedAudio(
  request: BackgroundRequest, report: ReportProgress, onWarning: (message: string) => void,
): Promise<WorkOutcome> {
  if (!request.key) return processSavedAudio(request.id, request.key, report, onWarning);
  // A slow first installation must not block the foreground fallback indefinitely.
  let deadline: number | undefined;
  const worker = await Promise.race([
    prepareBackgroundWorker(),
    new Promise<undefined>(resolve => { deadline = window.setTimeout(() => resolve(undefined), 4_000); }),
  ]);
  window.clearTimeout(deadline);
  if (worker?.state !== 'activated') return processSavedAudio(request.id, request.key, report, onWarning);

  return new Promise((resolve, reject) => {
    const { port1, port2 } = new MessageChannel();
    const started = Date.now();
    let heardFromWorker = false;
    let closed = false;
    let checking = false;
    let missingChecks = 0;
    let timeout: number;
    const close = () => {
      closed = true;
      window.clearTimeout(timeout);
      window.clearInterval(periodicCheck);
      document.removeEventListener('visibilitychange', checkWorker);
      port1.close();
    };
    const resetTimeout = () => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        close();
        reject(new Error('The background worker stopped responding. Retry this file to recover its saved progress.'));
      }, 330_000);
    };
    const checkWorker = async () => {
      if (closed || checking || document.visibilityState !== 'visible') return;
      checking = true;
      try {
        const work = await readWork(request.id);
        if (closed) return;
        if (work?.mode === 'done' && work.transcript) {
          close();
          resolve({ state: 'done', transcript: work.transcript });
          return;
        }
        if (!heardFromWorker && Date.now() - started < 8_000) return;
        const { held, pending } = await navigator.locks.query();
        const busy = [...(held ?? []), ...(pending ?? [])].some(lock => lock.name === workLock(request.id));
        missingChecks = busy ? 0 : missingChecks + 1;
        if (closed || missingChecks < 2) return;
        close();
        if (work?.mode === 'failed') {
          reject(new Error('The background job stopped. Retry the unfinished part.'));
        } else {
          // Reacquire the job lock and let the durable request marker decide whether it is safe to continue.
          void processSavedAudio(request.id, request.key, report, onWarning).then(resolve, reject);
        }
      } catch { /* The message port and inactivity timeout still handle this job. */ }
      finally { checking = false; }
    };
    const periodicCheck = window.setInterval(checkWorker, 2_000);
    document.addEventListener('visibilitychange', checkWorker);
    resetTimeout();
    port1.onmessage = ({ data }: MessageEvent<BackgroundReply>) => {
      if (data.type === 'progress') {
        heardFromWorker = true;
        resetTimeout();
        return report(data.completed, data.total, data.stage);
      }
      if (data.type === 'warning') return onWarning(data.message);
      close();
      if (data.type === 'result') resolve(data.result);
      else reject(new Error(data.message));
    };
    try {
      worker.postMessage(request, [port2]);
    } catch {
      close();
      port2.close();
      void processSavedAudio(request.id, request.key, report, onWarning).then(resolve, reject);
    }
  });
}
