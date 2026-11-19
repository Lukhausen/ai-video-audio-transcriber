import type { AudioChunk, FileJob, TranscriptionResult, TranscriptCue, TranscriptOutputOptions } from '../types';

export function hasTimestamp(cue: TranscriptCue): boolean {
  return typeof cue.start === 'number' && Number.isFinite(cue.start) && cue.start >= 0;
}

export function joinCueText(cues: TranscriptCue[]): string {
  return cues.map(cue => cue.text.trim()).filter(Boolean).join(' ')
    .replace(/\s+([,.;:!?、。！？])/g, '$1')
    .replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]) (?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, '$1');
}

const speech = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const midpoint = (cue: TranscriptCue) => cue.start === undefined ? undefined : (cue.start + (cue.end ?? cue.start)) / 2;
const TIMESTAMP_TOLERANCE = 1.5;

function mergeOverlap(previous: TranscriptCue[], current: TranscriptCue[], chunk: AudioChunk): TranscriptCue[] {
  const overlap = chunk.keepStart - chunk.offset;
  if (overlap <= 0) return previous.concat(current);

  const start = chunk.offset - TIMESTAMP_TOLERANCE;
  const end = chunk.keepStart + overlap + TIMESTAMP_TOLERANCE;
  const leftStart = previous.findIndex(cue => (midpoint(cue) ?? -Infinity) >= start);
  const rightEnd = current.findIndex(cue => (midpoint(cue) ?? -Infinity) > end);
  if (leftStart === -1 || rightEnd === 0) return previous.concat(current);
  const left = previous.slice(leftStart);
  const right = rightEnd === -1 ? current : current.slice(0, rightEnd);
  if (left.length * right.length > 40_000) return previous.concat(current);

  const keys = [left.map(cue => speech(cue.text)), right.map(cue => speech(cue.text))];
  const times = [left.map(midpoint), right.map(midpoint)];
  const sameWord = (i: number, j: number) => {
    const a = times[0][i];
    const b = times[1][j];
    return Boolean(keys[0][i] && keys[0][i] === keys[1][j] && a !== undefined && b !== undefined &&
      a <= end && b >= start && Math.abs(a - b) <= TIMESTAMP_TOLERANCE);
  };

  // Align words in the overlap before removing duplicates. A timestamp by itself
  // can't establish that the other response contains this word.
  const matches = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      matches[i][j] = sameWord(i, j) ? 1 + matches[i + 1][j + 1] : Math.max(matches[i + 1][j], matches[i][j + 1]);
    }
  }
  const merged = previous.slice(0, leftStart);
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (sameWord(i, j)) {
      merged.push((times[1][j] ?? 0) >= chunk.keepStart ? right[j] : left[i]);
      i++;
      j++;
    } else if (matches[i + 1][j] > matches[i][j + 1] ||
      (matches[i + 1][j] === matches[i][j + 1] && (times[0][i] ?? -Infinity) <= (times[1][j] ?? Infinity))) {
      merged.push(left[i++]);
    } else {
      merged.push(right[j++]);
    }
  }
  return merged.concat(left.slice(i), right.slice(j), rightEnd === -1 ? [] : current.slice(rightEnd));
}

export function mergeTranscriptCues(results: TranscriptionResult[], chunks: AudioChunk[]): TranscriptCue[] | undefined {
  // Incomplete annotations must never replace a complete transcript with partial text.
  if (results.some(result => result.text.trim() && (
    !result.cues?.length || speech(result.text) !== speech(joinCueText(result.cues))
  ))) return undefined;
  const cues = results.reduce<TranscriptCue[]>((merged, result, index) => {
    const chunk = chunks[index];
    const absolute = (result.cues || []).map(cue => {
      const start = hasTimestamp(cue) ? cue.start! + chunk.offset : undefined;
      const end = typeof cue.end === 'number' && Number.isFinite(cue.end) ? cue.end + chunk.offset : start;
      return { ...cue, start, end,
        speaker: cue.speaker && chunks.length > 1 ? 'Part ' + (index + 1) + ' / ' + cue.speaker : cue.speaker };
    });
    return index ? mergeOverlap(merged, absolute, chunk) : absolute;
  }, []);
  return cues.length ? cues : undefined;
}

export function formatTimestamp(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60).toString().padStart(2, '0');
  const secs = (total % 60).toString().padStart(2, '0');
  return hours ? `${hours.toString().padStart(2, '0')}:${minutes}:${secs}` : `${minutes}:${secs}`;
}

export function formatTranscript(job: Pick<FileJob, 'transcript' | 'transcriptCues'>, options: TranscriptOutputOptions): string {
  const cues = job.transcriptCues;
  const timestamps = options.timestamps && Boolean(cues?.some(hasTimestamp));
  const speakers = options.speakers && Boolean(cues?.some(cue => cue.speaker));
  if (!cues?.length || (!timestamps && !speakers)) return job.transcript || '';

  const groups: TranscriptCue[][] = [];
  for (const cue of cues) {
    if (!cue.text.trim()) continue;
    const group = groups[groups.length - 1];
    const first = group?.[0];
    const previous = group?.[group.length - 1];
    const speakerChanged = speakers && previous?.speaker !== cue.speaker;
    const timeBreak = timestamps && hasTimestamp(cue) && first && hasTimestamp(first) && (
      cue.start! - first.start! >= 15 || cue.start! - (previous?.end ?? cue.start!) >= 1.5
    );
    if (!group || speakerChanged || timeBreak) groups.push([cue]);
    else group.push(cue);
  }
  return groups.map(group => {
    const cue = group[0];
    const prefix = [timestamps && hasTimestamp(cue) ? `[${formatTimestamp(cue.start!)}]` : '',
      speakers && cue.speaker ? `${cue.speaker}:` : ''].filter(Boolean).join(' ');
    return `${prefix}${prefix ? ' ' : ''}${joinCueText(group)}`;
  }).join('\n');
}
