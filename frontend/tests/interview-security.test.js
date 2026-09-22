import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEditorSubmissionEvent, parseInviteCredentials } from '../src/interview/security.js'

test('invite parser prefers fragment credentials and supports exact session links', () => {
  const credentials = parseInviteCredentials({
    search: '?candidateId=candidate-1&sessionId=session-1&accessToken=legacy-query-token',
    hash: '#accessToken=fragment-token'
  })
  assert.deepEqual(credentials, {
    candidateId: 'candidate-1',
    sessionId: 'session-1',
    accessToken: 'fragment-token'
  })
})

test('editor messages require both the configured origin and exact iframe source', () => {
  const source = {}
  const payload = { type: 'codeSubmission', code: 'return 1', language: 'javascript', output: '1' }
  assert.equal(normalizeEditorSubmissionEvent(
    { origin: 'https://evil.example', source, data: payload },
    { trustedOrigin: 'https://editor.example', expectedSource: source }
  ), null)
  assert.equal(normalizeEditorSubmissionEvent(
    { origin: 'https://editor.example', source: {}, data: payload },
    { trustedOrigin: 'https://editor.example', expectedSource: source }
  ), null)
})

test('editor submission data is normalized and bounded', () => {
  const source = {}
  const result = normalizeEditorSubmissionEvent({
    origin: 'https://editor.example',
    source,
    data: JSON.stringify({
      action: 'submit',
      payload: {
        code: 'x'.repeat(7000),
        language: 'javascript-with-an-unreasonably-long-language-identifier',
        output: 'y'.repeat(2000)
      }
    })
  }, {
    trustedOrigin: 'https://editor.example',
    expectedSource: source
  })

  assert.equal(result.kind, 'submission')
  assert.equal(result.code.length, 6000)
  assert.equal(result.language.length, 40)
  assert.equal(result.result.length, 1500)
})

test('editor ready messages cannot smuggle a submission', () => {
  const source = {}
  const result = normalizeEditorSubmissionEvent({
    origin: 'https://editor.example',
    source,
    data: { type: 'editorReady', code: 'malicious' }
  }, {
    trustedOrigin: 'https://editor.example',
    expectedSource: source
  })
  assert.deepEqual(result, { kind: 'ready' })
})
