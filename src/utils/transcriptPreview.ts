const PREVIEW_SENTENCE_COUNT = 2;
const PREVIEW_WORD_LIMIT = 42;

function formatRemainingWords(count: number): string {
  if (count <= 0) return '';
  if (count < 20) return `${count.toLocaleString()} ${count === 1 ? 'word' : 'words'} left`;

  const roundingStep = count < 100 ? 10 : 25;
  const rounded = Math.max(roundingStep, Math.round(count / roundingStep) * roundingStep);
  return `~${rounded.toLocaleString()} words left`;
}

export function getTranscriptWords(text?: string): string[] {
  return text?.trim().split(/\s+/).filter(Boolean) || [];
}

export function countTranscriptWords(text?: string): number {
  return getTranscriptWords(text).length;
}

export function buildTranscriptPreview(transcript?: string, emptyText = 'No transcript text cached.') {
  const normalized = transcript?.replace(/\s+/g, ' ').trim() || '';
  if (!normalized) {
    return { text: emptyText, title: '', totalWords: 0, remainingWords: 0, remainingLabel: '' };
  }

  const allWords = getTranscriptWords(normalized);
  const sentenceMatches = normalized.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [normalized];
  const sentencePreview = sentenceMatches.slice(0, PREVIEW_SENTENCE_COUNT).join(' ').trim();
  const sentenceWords = getTranscriptWords(sentencePreview);
  const previewWords = sentenceWords.length > PREVIEW_WORD_LIMIT
    ? allWords.slice(0, PREVIEW_WORD_LIMIT)
    : sentenceWords;
  const remainingWords = Math.max(allWords.length - previewWords.length, 0);
  const previewText = previewWords.join(' ');

  return {
    text: remainingWords > 0
      ? `${previewText} \u2026`
      : previewText,
    title: normalized,
    totalWords: allWords.length,
    remainingWords,
    remainingLabel: formatRemainingWords(remainingWords),
  };
}

export function hasHiddenTranscriptPreview(transcript?: string): boolean {
  return buildTranscriptPreview(transcript).remainingWords > 0;
}
