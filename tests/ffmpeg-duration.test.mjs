import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/media/prepareAudio.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const { splitAudio } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

function fixture(probeOutput) {
  const audio = Uint8Array.of(1, 2, 3);
  const deleted = [];
  const encoder = {
    writeFile: async () => undefined,
    ffprobe: async () => -1,
    readFile: async (_, encoding) => encoding === 'utf8' ? probeOutput : audio,
    deleteFile: async name => { deleted.push(name); },
  };
  const split = () => splitAudio(encoder, audio, 'fixture', { selectedApi: 'google', maxFileSizeMB: 25 });
  return { audio, deleted, split };
}

test('the bundled ffprobe may leave -1 after writing a valid duration', async () => {
  const { audio, deleted, split } = fixture('60.084000\n');
  const chunks = await split();
  assert.deepEqual(chunks.map(chunk => chunk.data), [audio]);
  assert.deepEqual(deleted, ['duration_fixture.txt', 'split_fixture.mp3']);
});

test('an invalid probe result is rejected and temporary files are cleaned up', async () => {
  const { deleted, split } = fixture('N/A\n');
  await assert.rejects(split(), /Could not determine audio duration/);
  assert.deepEqual(deleted, ['duration_fixture.txt', 'split_fixture.mp3']);
});
