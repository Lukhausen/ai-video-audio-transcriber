export const OPENAI_AUDIO_MODELS = [
  { value: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe (best)' },
  { value: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe (budget)' },
];

export const GROQ_AUDIO_MODELS = [
  { value: 'whisper-large-v3', label: 'whisper-large-v3 (best)' },
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (budget)' },
];

export const OPENAI_CHAT_MODELS = [
  { value: 'gpt-5.5', label: 'gpt-5.5 (best)' },
  { value: 'gpt-5.4-mini', label: 'gpt-5.4-mini (budget)' },
];

export const GROQ_CHAT_MODELS = [
  { value: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b (best)' },
  { value: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b (budget)' },
];

export function getStoredModel(key: string, options: { value: string }[]): string {
  const stored = localStorage.getItem(key);
  return options.some(option => option.value === stored) ? stored! : options[0].value;
}
