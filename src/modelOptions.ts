export type ModelOption = {
  value: string;
  label: string;
};

// Verified against the providers' official catalogs on 2026-10-04.
// Keep the recommended quality default first; saved user choices take precedence.
export const OPENAI_AUDIO_MODELS: ModelOption[] = [
  { value: 'gpt-transcribe', label: 'gpt-transcribe (best)' },
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe' },
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (budget)' },
  { value: 'gpt-4o-transcribe-diarize', label: 'gpt-4o-transcribe-diarize (speakers)' },
  { value: 'whisper-1', label: 'whisper-1 (timestamps)' },
];

export const GROQ_AUDIO_MODELS: ModelOption[] = [
  { value: 'whisper-large-v3', label: 'whisper-large-v3 (best)' },
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (budget)' },
];

export const OPENAI_CHAT_MODELS: ModelOption[] = [
  { value: 'gpt-6-astra', label: 'gpt-6-astra (best)' },
  { value: 'gpt-6.1-sol', label: 'gpt-6.1-sol (balanced)' },
  { value: 'gpt-6-luna', label: 'gpt-6-luna (budget)' },
  { value: 'gpt-5.5', label: 'gpt-5.5 (previous)' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini (previous)' },
];

export const GROQ_CHAT_MODELS: ModelOption[] = [
  { value: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b (best)' },
  { value: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b (budget)' },
];

export const GOOGLE_AUDIO_MODELS: ModelOption[] = [
  { value: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe' },
];

export const GOOGLE_CHAT_MODELS: ModelOption[] = [
  { value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (best)' },
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (budget)' },
];

export function getStoredModel(key: string, options: ModelOption[]): string {
  const stored = localStorage.getItem(key);
  return options.some(option => option.value === stored) ? stored! : options[0].value;
}
