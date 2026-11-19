import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiProvider } from '../types';
import { availabilityMessage, canAttemptTranscription, checkProviderAvailability, type Availability } from '../providers/availability';

const RECHECK_MS = 60_000;

interface Selection {
  provider: ApiProvider;
  key: string;
  last?: { status: Availability; time: number };
  active?: { controller: AbortController; result: Promise<Availability> };
}

export function useProviderAvailability(provider: ApiProvider, key: string) {
  const selection = useMemo<Selection>(() => ({ provider, key }), [provider, key]);
  const selected = useRef(selection);
  selected.current = selection;
  const [display, setDisplay] = useState<{ selection: Selection; status: Availability }>();

  const check = useCallback((input: Selection, force = false): Promise<Availability> => {
    if (!input.key) return Promise.resolve('missing-key');
    if (input.active) return input.active.result;
    if (!force && input.last && Date.now() - input.last.time <
      (canAttemptTranscription(input.last.status) ? RECHECK_MS : 3_000)) {
      return Promise.resolve(input.last.status);
    }

    setDisplay({ selection: input, status: 'checking' });
    const controller = new AbortController();
    const result = checkProviderAvailability(input.provider, input.key, controller.signal).then(status => {
      if (input.active?.controller !== controller) return 'cancelled';
      input.active = undefined;
      input.last = { status, time: Date.now() };
      if (selected.current === input) setDisplay({ selection: input, status });
      return status;
    });
    input.active = { controller, result };
    return result;
  }, []);

  useEffect(() => {
    if (!selection.key) return;
    const timer = window.setTimeout(() => void check(selection), 300);
    const recheck = () => void check(selection, true);
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) recheck(); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(selection);
    };
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
      document.removeEventListener('visibilitychange', onVisible);
      selection.active?.controller.abort();
      selection.active = undefined;
    };
  }, [check, selection]);

  const retry = useCallback(() => void check(selected.current, true), [check]);
  const ensureAvailable = useCallback(async (requested: ApiProvider, apiKey: string) => {
    const input = selected.current;
    const status = input.provider === requested && input.key === apiKey
      ? await check(input)
      : await checkProviderAvailability(requested, apiKey);
    if (!canAttemptTranscription(status)) throw new Error(availabilityMessage(requested, status));
  }, [check]);

  const status = !key ? 'missing-key' : display?.selection === selection ? display.status : 'checking';
  return { status, retry, ensureAvailable };
}
