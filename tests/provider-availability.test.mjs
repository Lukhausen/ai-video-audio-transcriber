import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/providers/availability.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 },
});
const { checkProviderAvailability, canAttemptTranscription } = await import('data:text/javascript;base64,' +
  Buffer.from(outputText).toString('base64'));

test('provider checks use only metadata GET requests and send the key to its own provider', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('googleapis.com') ? { models: [] } : { data: [] });
  });
  for (const provider of ['google', 'groq', 'openai']) {
    assert.equal(await checkProviderAvailability(provider, ' fixture-key '), 'reachable');
  }
  assert.deepEqual(calls.map(call => call.url), [
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    'https://api.groq.com/openai/v1/models',
    'https://api.openai.com/v1/models',
  ]);
  assert.deepEqual(calls.map(call => call.options.headers), [
    { 'x-goog-api-key': 'fixture-key' },
    { Authorization: 'Bearer fixture-key' },
    { Authorization: 'Bearer fixture-key' },
  ]);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
  }
  assert.equal(await checkProviderAvailability('google', ' '), 'missing-key');
  assert.equal(calls.length, 3);
});

test('preflight distinguishes bad keys, restricted metadata, throttling and unavailable providers', async t => {
  const results = [
    Response.json({ error: { details: [{ reason: 'API_KEY_INVALID' }] } }, { status: 400 }),
    new Response(null, { status: 401 }),
    Response.json({ error: { message: 'Missing scopes: api.model.read' } }, { status: 401 }),
    new Response(null, { status: 403 }),
    new Response(null, { status: 429 }),
    new Response(null, { status: 503 }),
  ];
  t.mock.method(globalThis, 'fetch', async () => {
    if (!results.length) throw new TypeError('Failed to fetch');
    return results.shift();
  });
  assert.equal(await checkProviderAvailability('google', 'key'), 'invalid-key');
  for (const status of ['invalid-key', 'unverified', 'unverified', 'rate-limited', 'provider-error', 'network-error']) {
    assert.equal(await checkProviderAvailability('openai', 'key'), status);
  }
  assert.equal(canAttemptTranscription('unverified'), true);
  assert.equal(canAttemptTranscription('rate-limited'), true);
  assert.equal(canAttemptTranscription('network-error'), false);
});

test('changing providers cancels an in-flight check', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const result = checkProviderAvailability('groq', 'key', controller.signal);
  controller.abort();
  assert.equal(await result, 'cancelled');
});
