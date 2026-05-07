// FFmpeg WASM pool — manages multiple instances for parallel conversion
import { useRef, useState, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';

interface PoolEntry {
  instance: FFmpeg;
  busy: boolean;
}

export interface FFmpegPoolHandle {
  isReady: boolean;
  acquire: () => Promise<{ instance: FFmpeg; release: () => void }>;
  terminateAll: () => Promise<void>;
}

export function useFFmpegPool(
  poolSize: number = 2,
  onLog?: (msg: string, type: 'info' | 'error') => void
): FFmpegPoolHandle {
  const poolRef = useRef<PoolEntry[]>([]);
  const [isReady, setIsReady] = useState(false);
  const waitingRef = useRef<Array<(entry: PoolEntry) => void>>([]);
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;

  useEffect(() => {
    let cancelled = false;

    const initPool = async () => {
      const entries: PoolEntry[] = [];
      for (let i = 0; i < poolSize; i++) {
        const ffmpeg = new FFmpeg();
        ffmpeg.on('log', ({ message }) => {
          onLogRef.current?.(`FFmpeg[${i}]: ${message}`, 'info');
        });
        try {
          await ffmpeg.load({
            coreURL: `${window.location.origin}/ffmpeg/ffmpeg-core.js`,
            wasmURL: `${window.location.origin}/ffmpeg/ffmpeg-core.wasm`,
            workerURL: `${window.location.origin}/ffmpeg/worker.js`,
          });
          entries.push({ instance: ffmpeg, busy: false });
          onLogRef.current?.(`FFmpeg instance ${i + 1}/${poolSize} loaded.`, 'info');
        } catch (err) {
          onLogRef.current?.(`Failed to load FFmpeg instance ${i + 1}: ${err}`, 'error');
        }
      }

      if (!cancelled) {
        poolRef.current = entries;
        setIsReady(entries.length > 0);
        onLogRef.current?.(`FFmpeg pool ready (${entries.length}/${poolSize} instances).`, 'info');
      }
    };

    initPool();

    return () => {
      cancelled = true;
      poolRef.current.forEach(entry => {
        try { entry.instance.terminate(); } catch { /* ignore */ }
      });
      poolRef.current = [];
    };
  }, [poolSize]);

  const releaseEntry = useCallback((entry: PoolEntry) => {
    entry.busy = false;
    // Check if anyone is waiting
    if (waitingRef.current.length > 0) {
      const next = waitingRef.current.shift()!;
      entry.busy = true;
      next(entry);
    }
  }, []);

  const acquire = useCallback((): Promise<{ instance: FFmpeg; release: () => void }> => {
    return new Promise((resolve) => {
      const idle = poolRef.current.find(e => !e.busy);

      if (idle) {
        idle.busy = true;
        resolve({
          instance: idle.instance,
          release: () => releaseEntry(idle),
        });
      } else {
        // All busy, enqueue
        waitingRef.current.push((entry) => {
          resolve({
            instance: entry.instance,
            release: () => releaseEntry(entry),
          });
        });
      }
    });
  }, [releaseEntry]);

  const terminateAll = useCallback(async () => {
    // Clear waiting queue
    waitingRef.current = [];
    for (const entry of poolRef.current) {
      try { entry.instance.terminate(); } catch { /* ignore */ }
    }
    poolRef.current = [];
    setIsReady(false);
  }, []);

  return { isReady, acquire, terminateAll };
}
