import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeminiClient } from '../utils/geminiClient.js';

function response({ status = 200, body = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; }, async text() { return JSON.stringify(body); } };
}

test('Gemini client sends a stateless Interactions request and returns model text', async () => {
  let captured = null;
  const client = createGeminiClient({
    apiKey: 'test-key', model: 'gemini-test', maxRetries: 0,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response({ body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Next question?' }] }] } });
    }
  });
  const result = await client.generateText({ systemInstruction: 'Interview safely.', input: 'Candidate: answer', temperature: 0.2, maxOutputTokens: 200 });
  assert.equal(result, 'Next question?');
  assert.equal(captured.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(captured.options.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'gemini-test');
  assert.equal(body.store, false);
  assert.equal(body.system_instruction, 'Interview safely.');
  assert.equal(body.generation_config.max_output_tokens, 200);
});

test('Gemini client requests structured JSON and retries transient failures', async () => {
  let calls = 0;
  const client = createGeminiClient({
    apiKey: 'test-key', maxRetries: 1, sleepImpl: async () => {},
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({ status: 429, body: { error: 'rate limited' } });
      return response({ body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"score":90}' }] }] } });
    }
  });
  const result = await client.generateText({ input: 'Evaluate', responseSchema: { type: 'object', properties: { score: { type: 'integer' } }, required: ['score'] } });
  assert.equal(result, '{"score":90}');
  assert.equal(calls, 2);
});

test('Gemini client rejects missing credentials', () => {
  assert.throws(() => createGeminiClient({ apiKey: '', fetchImpl: async () => response() }), /GEMINI_API_KEY is required/);
});
