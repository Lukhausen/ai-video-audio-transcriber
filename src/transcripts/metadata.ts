import type { TranscriptionResult, TranscriptCue } from '../types';

// Whisper word timestamps and OpenAI diarized segments share numeric offsets.
export function parseAudioTranscription(response: unknown): TranscriptionResult {
  const body = response as { text?: string; words?: unknown[]; segments?: unknown[] };
  const entries = body.words?.length ? body.words : body.segments || [];
  const cues: TranscriptCue[] = [];
  const speakers = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const cue = entry as Record<string, unknown>;
    const text = typeof cue.word === 'string' ? cue.word : cue.text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const speaker = typeof cue.speaker === 'string' ? cue.speaker : undefined;
    if (speaker && !speakers.has(speaker)) speakers.set(speaker, `Speaker ${speakers.size + 1}`);
    const start = typeof cue.start === 'number' && Number.isFinite(cue.start) && cue.start >= 0 ? cue.start : undefined;
    const end = typeof cue.end === 'number' && Number.isFinite(cue.end) && cue.end >= (start ?? 0) ? cue.end : undefined;
    cues.push({ text, start, end, speaker: speaker ? speakers.get(speaker) : undefined });
  }
  return { text: body.text || '', cues: cues.length ? cues : undefined };
}
