import { useCallback, useEffect, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';

export const AUDIO_WORKERS = 2;
const LOAD_TIMEOUT_MS = 90_000;

interface WorkerSlot {
  index: number;
  instance?: FFmpeg;
  busy: boolean;
}

interface WorkerWaiter {
  resolve: (slot: WorkerSlot) => void;
  reject: (error: Error) => void;
}

export interface FFmpegPoolHandle {
  acquire: () => Promise<{ instance: FFmpeg; release: () => void }>;
}

export function useFFmpegPool(onLog: (message: string, type: 'info' | 'error') => void): FFmpegPoolHandle {
  const [pool] = useState(() => ({
    slots: Array.from({ length: AUDIO_WORKERS }, (_, index): WorkerSlot => ({ index, busy: false })),
    waiters: [] as WorkerWaiter[],
  }));

  useEffect(() => () => {
    for (const waiter of pool.waiters.splice(0)) waiter.reject(new Error('Audio tools closed.'));
    for (const slot of pool.slots) {
      slot.instance?.terminate();
      slot.instance = undefined;
      slot.busy = false;
    }
  }, [pool]);

  const acquire = useCallback(async () => {
    const slot = await new Promise<WorkerSlot>((resolve, reject) => {
      const idle = pool.slots.find(candidate => !candidate.busy);
      if (!idle) {
        pool.waiters.push({ resolve, reject });
        return;
      }
      idle.busy = true;
      resolve(idle);
    });
    const release = () => {
      const next = pool.waiters.shift();
      if (next) next.resolve(slot);
      else slot.busy = false;
    };

    if (slot.instance) return { instance: slot.instance, release };

    const instance = new FFmpeg();
    slot.instance = instance;
    instance.on('log', ({ message }) => {
      // The WASM wrapper emits this line during ordinary command exit.
      if (message.trim() !== 'Aborted()') onLog('FFmpeg[' + slot.index + ']: ' + message, 'info');
    });
    const timeout = window.setTimeout(() => instance.terminate(), LOAD_TIMEOUT_MS);
    try {
      await instance.load({
        coreURL: new URL(import.meta.env.BASE_URL + 'ffmpeg/ffmpeg-core.js', window.location.href).href,
        wasmURL: new URL(import.meta.env.BASE_URL + 'ffmpeg/ffmpeg-core.wasm', window.location.href).href,
      });
      return { instance, release };
    } catch (error) {
      instance.terminate();
      slot.instance = undefined;
      release();
      onLog('Could not load FFmpeg worker ' + (slot.index + 1) + ' (' + String(error) + ').', 'error');
      throw new Error('Could not load the audio tools. Check your connection, then retry this file.');
    } finally {
      window.clearTimeout(timeout);
    }
  }, [onLog, pool]);

  return { acquire };
}
