/// <reference lib="webworker" />
import { processSavedAudio, type WorkOutcome } from './processAudio';

export type BackgroundRequest = { id: string; key: string };
export type BackgroundReply =
  | { type: 'progress'; completed: number; total: number; stage?: string }
  | { type: 'warning'; message: string }
  | { type: 'result'; result: WorkOutcome }
  | { type: 'error'; message: string };

const worker = self as unknown as ServiceWorkerGlobalScope;
worker.addEventListener('message', event => {
  const port = event.ports[0];
  const request = event.data as BackgroundRequest;
  if (!port || !request?.id || !request.key) return;

  const respond = (reply: BackgroundReply) => port.postMessage(reply);
  event.waitUntil(processSavedAudio(
    request.id, request.key,
    (completed, total, stage) => respond({ type: 'progress', completed, total, stage }),
    message => respond({ type: 'warning', message }),
  ).then(
    result => respond({ type: 'result', result }),
    error => respond({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
  ).finally(() => port.close()));
});
