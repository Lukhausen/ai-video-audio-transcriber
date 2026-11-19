import type { ApiProvider } from '../types';

export const PROVIDER_NAMES = { google: 'Google', groq: 'Groq', openai: 'OpenAI' } as const;
const MODEL_CATALOGS = {
  google: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
  groq: 'https://api.groq.com/openai/v1/models',
  openai: 'https://api.openai.com/v1/models',
};

export type Availability =
  | 'missing-key' | 'checking' | 'reachable' | 'invalid-key'
  | 'unverified' | 'rate-limited' | 'provider-error' | 'network-error' | 'timed-out' | 'cancelled';

export async function checkProviderAvailability(
  provider: ApiProvider, apiKey: string, signal?: AbortSignal,
): Promise<Availability> {
  const key = apiKey.trim();
  if (!key) return 'missing-key';
  if (signal?.aborted) return 'cancelled';

  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 7_000);
  try {
    const response = await fetch(MODEL_CATALOGS[provider], {
      method: 'GET',
      headers: provider === 'google' ? { 'x-goog-api-key': key } : { Authorization: 'Bearer ' + key },
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
    if (response.ok) {
      const catalog = await response.json();
      return Array.isArray(provider === 'google' ? catalog?.models : catalog?.data) ? 'reachable' : 'unverified';
    }
    if ((response.status === 400 && provider === 'google') || (response.status === 401 && provider === 'openai')) {
      const body = await response.json().catch(() => null);
      if (provider === 'google' && Array.isArray(body?.error?.details) &&
        body.error.details.some((detail: { reason?: string } | null) => detail?.reason === 'API_KEY_INVALID')) {
        return 'invalid-key';
      }
      if (provider === 'openai' && /\b(?:missing scopes|insufficient permissions|insufficient scope)\b/i.test(body?.error?.message ?? '')) {
        return 'unverified';
      }
    } else {
      void response.body?.cancel().catch(() => undefined);
    }
    if (response.status === 401) return 'invalid-key';
    if (response.status === 429) return 'rate-limited';
    return response.status >= 500 ? 'provider-error' : 'unverified';
  } catch {
    if (signal?.aborted) return 'cancelled';
    return controller.signal.aborted ? 'timed-out' : 'network-error';
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export function canAttemptTranscription(status: Availability): boolean {
  // Read permissions and rate limits for metadata can differ from audio endpoints.
  return status === 'reachable' || status === 'unverified' || status === 'rate-limited';
}

export function availabilityMessage(provider: ApiProvider, status: Availability): string {
  const name = PROVIDER_NAMES[provider];
  switch (status) {
    case 'missing-key': return 'Add your ' + name + ' API key before transcribing.';
    case 'checking': return 'Checking the connection to ' + name + '…';
    case 'reachable': return name + ' API reachable.';
    case 'invalid-key': return name + ' rejected the API key. Update it in Advanced.';
    case 'unverified': return name + ' responded, but the connection check could not verify access.';
    case 'rate-limited': return name + ' rate limited the connection check.';
    case 'provider-error': return name + ' returned a service error. Retry the connection.';
    case 'network-error': return 'Could not reach ' + name + ' from this browser. Check your connection and retry.';
    case 'timed-out': return name + ' did not respond in time. Retry the connection.';
    case 'cancelled': return 'The provider settings changed. Retry this file.';
  }
}
