import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';

const skipHttpSmoke = process.env.SKIP_HTTP_SMOKE === '1';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForOutput(child, pattern, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for server output. Received:\n${output}`)), timeoutMs);
    const collect = chunk => {
      output += chunk.toString();
      if (pattern.test(output)) {
        clearTimeout(timeout);
        resolve(output);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with status ${code}. Output:\n${output}`));
    });
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timeout = setTimeout(() => reject(new Error('Server did not exit after shutdown signal')), timeoutMs);
    child.once('exit', code => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

test('backend serves health, security, CORS, payload, and not-found behavior', { timeout: 30_000, skip: skipHttpSmoke }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGO_URI: '',
      MONGODB_URI: '',
      OPENAI_API_KEY: '',
      ADMIN_API_KEY: '',
      FRONTEND_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForOutput(child, /listening on port/i);
    const baseUrl = `http://127.0.0.1:${port}`;

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'ai-interviewer-backend');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.ok(health.headers.get('x-request-id'));

    const blockedOrigin = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'https://malicious.example' }
    });
    assert.equal(blockedOrigin.status, 403);
    assert.match((await blockedOrigin.json()).error, /origin/i);

    const missing = await fetch(`${baseUrl}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.match((await missing.json()).error, /not found/i);

    const oversized = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(1_100_000) })
    });
    assert.equal(oversized.status, 413);
    assert.match((await oversized.json()).error, /too large/i);
  } finally {
    child.kill('SIGTERM');
    assert.equal(await waitForExit(child), 0);
  }
});

test('production startup fails closed when required configuration is absent', { timeout: 15_000, skip: skipHttpSmoke }, async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      PORT: '0',
      MONGO_URI: '',
      MONGODB_URI: '',
      OPENAI_API_KEY: '',
      ADMIN_API_KEY: '',
      FRONTEND_URL: '',
      PRODUCTION_FRONTEND_URL: '',
      CORS_ORIGINS: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  const code = await waitForExit(child);
  assert.equal(code, 1);
  assert.match(output, /missing required production configuration/i);
  assert.match(output, /ADMIN_API_KEY/);
  assert.match(output, /OPENAI_API_KEY/);
  assert.match(output, /MONGO_URI/);
  assert.match(output, /FRONTEND_URL/);
});
