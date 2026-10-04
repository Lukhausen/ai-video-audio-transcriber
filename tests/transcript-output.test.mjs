import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function loadSource(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { formatTranscript, formatTimestamp, mergeTranscriptCues, joinCueText } = await loadSource('../src/transcripts/output.ts');
const { parseAudioTranscription } = await loadSource('../src/transcripts/metadata.ts');
const job = { transcript: 'Hello there. Good morning.', transcriptCues: [
  { text: 'Hello', start: 0, end: 0.3, speaker: 'Speaker 1' },
  { text: 'there.', start: 0.3, end: 0.8, speaker: 'Speaker 1' },
  { text: 'Good', start: 4, end: 4.3, speaker: 'Speaker 2' },
  { text: 'morning.', start: 4.3, end: 4.9, speaker: 'Speaker 2' },
] };

test('all four output modes retain speech and leave stored metadata unchanged', () => {
  const before = JSON.stringify(job);
  assert.equal(formatTranscript(job, { timestamps: false, speakers: false }), job.transcript);
  assert.equal(formatTranscript(job, { timestamps: true, speakers: false }), '[00:00] Hello there.\n[00:04] Good morning.');
  assert.equal(formatTranscript(job, { timestamps: false, speakers: true }), 'Speaker 1: Hello there.\nSpeaker 2: Good morning.');
  assert.equal(formatTranscript(job, { timestamps: true, speakers: true }), '[00:00] Speaker 1: Hello there.\n[00:04] Speaker 2: Good morning.');
  assert.equal(JSON.stringify(job), before);
  assert.equal(formatTimestamp(3661.9), '01:01:01');
});

test('old transcripts and missing capabilities fall back without inventing labels', () => {
  const options = { timestamps: true, speakers: true };
  assert.equal(formatTranscript({ transcript: 'Old cached text' }, options), 'Old cached text');
  assert.equal(formatTranscript({ ...job, transcriptCues: job.transcriptCues.map(({ speaker, ...cue }) => cue) }, options), '[00:00] Hello there.\n[00:04] Good morning.');
});

test('overlapping words occur once with original-file timestamps and independent speaker IDs', () => {
  const chunks = [
    { offset: 0, keepStart: 0, keepEnd: 10 },
    { offset: 7, keepStart: 10, keepEnd: Infinity },
  ];
  const cues = mergeTranscriptCues([
    { text: 'Before boundary After', cues: [
      { text: 'Before', start: 8, end: 9, speaker: 'Speaker 1' },
      { text: 'boundary', start: 9.5, end: 10.5, speaker: 'Speaker 1' },
      { text: 'After', start: 11, end: 12, speaker: 'Speaker 1' },
    ] },
    { text: 'Before boundary After', cues: [
      { text: 'Before', start: 1, end: 2, speaker: 'Speaker 1' },
      { text: 'boundary', start: 2.5, end: 3.5, speaker: 'Speaker 1' },
      { text: 'After', start: 4, end: 5, speaker: 'Speaker 1' },
    ] },
  ], chunks);
  assert.equal(joinCueText(cues), 'Before boundary After');
  assert.deepEqual(cues.map(cue => cue.start), [8, 9.5, 11]);
  assert.equal(cues[0].speaker, 'Part 1 / Speaker 1');
  assert.equal(cues[1].speaker, 'Part 2 / Speaker 1');
});

test('partial annotations cannot discard the rest of a transcript', () => {
  const chunks = [{ offset: 0, keepStart: 0, keepEnd: Infinity }];
  assert.equal(mergeTranscriptCues([{ text: 'Complete speech', cues: [{ text: 'Complete', start: 0, end: 1 }] }], chunks), undefined);
  assert.equal(mergeTranscriptCues([{ text: 'Complete speech' }], chunks), undefined);
});

test('Whisper words and diarized segments normalize without fabricating timestamps', () => {
  const whisper = parseAudioTranscription({ text: 'Hello.', words: [{ word: 'Hello.', start: 0, end: 1 }], segments: [{ text: 'Wrong' }] });
  assert.equal(whisper.cues[0].text, 'Hello.');
  assert.equal(whisper.cues[0].start, 0);
  const diarized = parseAudioTranscription({ text: 'Hello. Yes.', segments: [
    { text: 'Hello.', start: 0, end: 1, speaker: 'A' },
    { text: 'Yes.', start: 2, end: 3, speaker: 'B' },
    { text: 'Again', start: NaN, end: -1, speaker: 'A' },
  ] });
  assert.deepEqual(diarized.cues.map(cue => cue.speaker), ['Speaker 1', 'Speaker 2', 'Speaker 1']);
  assert.equal(diarized.cues[2].start, undefined);
  assert.equal(diarized.cues[2].end, undefined);
});
