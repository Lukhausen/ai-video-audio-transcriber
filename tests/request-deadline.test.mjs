import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/providers/requestDeadline.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const { withRequestDeadline } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

test('a stalled provider call releases the caller and aborts the active HTTP signal', async () => {
  let signal;
  const request = withRequestDeadline(10, 'Fixture upload timed out.', activeSignal => {
    signal = activeSignal;
    return new Promise(() => {});
  });
  await assert.rejects(request, /Fixture upload timed out/);
  assert.equal(signal.aborted, true);
});

test('completed and rejected provider requests preserve their original outcomes', async () => {
  assert.equal(await withRequestDeadline(100, 'Timeout', async () => 'transcript'), 'transcript');
  const error = new Error('Provider quota');
  await assert.rejects(withRequestDeadline(100, 'Timeout', async () => { throw error; }), candidate => candidate === error);
});
