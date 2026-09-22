import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import test from 'node:test';
import { MongoClient } from 'mongodb';

const integrationUri = process.env.MONGO_INTEGRATION_URI || '';

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

function waitForOutput(child, pattern, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out:\n${output}`)), timeoutMs);
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
      reject(new Error(`Server exited with ${code}:\n${output}`));
    });
  });
}

async function request(baseUrl, path, { method = 'GET', token = '', interviewToken = '', adminKey = '', body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (interviewToken) headers['x-interview-token'] = interviewToken;
  if (adminKey) headers['x-admin-key'] = adminKey;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path} failed (${response.status}): ${JSON.stringify(data)}`);
  return data;
}

test('real MongoDB recruiter-to-result interview flow preserves concurrent activity', {
  timeout: 60_000,
  skip: !integrationUri
}, async () => {
  const databaseName = `ai_interviewer_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      MONGO_URI: integrationUri,
      MONGO_DB_NAME: databaseName,
      ADMIN_API_KEY: 'integration-admin-key',
      GEMINI_API_KEY: '',
      FRONTEND_URL: 'http://localhost:5173',
      ENABLE_DEMO_MODE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const mongo = new MongoClient(integrationUri);

  try {
    await waitForOutput(child, /listening on port/i);

    const owner = await request(baseUrl, '/api/auth/bootstrap', {
      method: 'POST',
      adminKey: 'integration-admin-key',
      body: {
        name: 'Integration Owner',
        email: 'owner@example.com',
        password: 'StrongPassword123',
        organizationName: 'InterviewBuddy'
      }
    });

    const recruiterToken = owner.token;
    await request(baseUrl, '/api/candidate/save', {
      method: 'POST',
      token: recruiterToken,
      body: {
        candidateId: 'candidate-integration',
        candidateName: 'Integration Candidate',
        candidateEmail: 'candidate@example.com',
        position: 'Software Engineer',
        skills: ['JavaScript', 'Node.js']
      }
    });

    const now = Date.now();
    const scheduled = await request(baseUrl, '/api/scheduled-sessions/create', {
      method: 'POST',
      token: recruiterToken,
      body: {
        candidateId: 'candidate-integration',
        candidateName: 'Integration Candidate',
        candidateEmail: 'candidate@example.com',
        position: 'Software Engineer',
        startTime: new Date(now + 60_000).toISOString(),
        endTime: new Date(now + 31 * 60_000).toISOString(),
        recordingEnabled: true,
        allowCodeEditor: true
      }
    });

    const invite = new URL(scheduled.session.accessUrl);
    const sessionId = invite.searchParams.get('sessionId');
    const accessToken = new URLSearchParams(invite.hash.slice(1)).get('accessToken');
    assert.ok(sessionId && accessToken);

    const access = await request(baseUrl, '/api/scheduled-sessions/access', {
      method: 'POST',
      interviewToken: accessToken,
      body: { candidateId: 'candidate-integration', sessionId, accessToken }
    });
    assert.equal(access.session.status, 'active');

    await request(baseUrl, `/api/sessions/initialize-interview/${sessionId}`, {
      method: 'POST',
      interviewToken: accessToken,
      body: { accessToken }
    });

    await Promise.all([
      request(baseUrl, `/api/sessions/message/${sessionId}`, {
        method: 'POST',
        interviewToken: accessToken,
        body: {
          accessToken,
          messageType: 'answer',
          message: 'I would use an idempotency key and a database uniqueness constraint.'
        }
      }),
      request(baseUrl, `/api/sessions/message/${sessionId}`, {
        method: 'POST',
        interviewToken: accessToken,
        body: {
          accessToken,
          messageType: 'integrity_event',
          integrityEvent: {
            type: 'multiple_faces',
            observedAt: new Date().toISOString(),
            details: { faceCount: 2 }
          }
        }
      })
    ]);

    const completed = await request(baseUrl, `/api/sessions/end/${sessionId}`, {
      method: 'POST',
      interviewToken: accessToken,
      body: { accessToken }
    });
    assert.equal(completed.success, true);
    assert.ok(completed.fileName);

    const result = await request(baseUrl, `/api/interview/results/${encodeURIComponent(completed.fileName)}`, {
      token: recruiterToken
    });
    assert.equal(result.data.sessionId, sessionId);
    assert.equal(result.data.integrity.flaggedEvents, 1);
    assert.ok(result.data.fullTranscript.some(item => item.message.includes('idempotency key')));

    const repeated = await request(baseUrl, `/api/sessions/end/${sessionId}`, {
      method: 'POST',
      interviewToken: accessToken,
      body: { accessToken }
    });
    assert.equal(repeated.alreadyCompleted, true);

    await mongo.connect();
    const duplicateCount = await mongo.db(databaseName).collection('interview_results').countDocuments({ sessionId });
    assert.equal(duplicateCount, 1);
  } finally {
    child.kill('SIGTERM');
    await mongo.connect().catch(() => {});
    await mongo.db(databaseName).dropDatabase().catch(() => {});
    await mongo.close().catch(() => {});
  }
});
