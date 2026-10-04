import type { AudioChunk, FileJob, TranscriptionResult, TranscriptCue, TranscriptOutputOptions } from '../types';

export function hasTimestamp(cue: TranscriptCue): boolean {
  return typeof cue.start === 'number' && Number.isFinite(cue.start) && cue.start >= 0;
}

export function joinCueText(cues: TranscriptCue[]): string {
  return cues.map(cue => cue.text.trim()).filter(Boolean).join(' ').replace(/\s+([,.;:!?])/g, '$1');
}

// Use the split's ownership boundaries to remove overlapping words. Speaker IDs
// belong to one provider request; never imply the same voice across separate parts.
export function mergeTranscriptCues(results: TranscriptionResult[], chunks: AudioChunk[]): TranscriptCue[] | undefined {
  const speech = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // Incomplete annotations must never replace a complete transcript with partial text.
  if (results.some(result => result.text.trim() && (
    !result.cues?.length || speech(result.text) !== speech(joinCueText(result.cues))
  ))) return undefined;
  const cues = results.flatMap((result, index) => {
    const chunk = chunks[index];
    return (result.cues || []).flatMap(cue => {
      const start = hasTimestamp(cue) ? cue.start! + chunk.offset : undefined;
      const end = typeof cue.end === 'number' && Number.isFinite(cue.end) ? cue.end + chunk.offset : start;
      const midpoint = start === undefined ? undefined : (start + (end ?? start)) / 2;
      if (midpoint !== undefined && (midpoint < chunk.keepStart || midpoint >= chunk.keepEnd)) return [];
      return [{ ...cue, start, end,
        speaker: cue.speaker && chunks.length > 1 ? `Part ${index + 1} / ${cue.speaker}` : cue.speaker }];
    });
  });
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
