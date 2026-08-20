import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRequestHeaders, parseResponse } from '../src/auth/http.js'

test('parseResponse returns successful JSON', async () => {
  const response = new Response(JSON.stringify({ success: true, user: { role: 'recruiter' } }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
  assert.deepEqual(await parseResponse(response), { success: true, user: { role: 'recruiter' } })
})

test('parseResponse exposes safe API errors and request IDs', async () => {
  const response = new Response(JSON.stringify({ error: 'Sign in is required' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'x-request-id': 'request-123' }
  })
  await assert.rejects(
    () => parseResponse(response),
    error => error.message === 'Sign in is required' && error.status === 401 && error.requestId === 'request-123'
  )
})

test('parseResponse handles invalid server bodies without leaking parser errors', async () => {
  const response = new Response('<html>gateway error</html>', { status: 502 })
  await assert.rejects(() => parseResponse(response), /Invalid server response/)
})

test('buildRequestHeaders adds bearer authorization and JSON content type', () => {
  const headers = buildRequestHeaders({ token: 'opaque-token', body: JSON.stringify({ answer: 'yes' }) })
  assert.equal(headers.get('authorization'), 'Bearer opaque-token')
  assert.equal(headers.get('content-type'), 'application/json')
})

test('buildRequestHeaders preserves explicit content types', () => {
  const headers = buildRequestHeaders({
    headers: { 'content-type': 'text/plain' },
    token: 'opaque-token',
    body: 'answer'
  })
  assert.equal(headers.get('content-type'), 'text/plain')
})

test('buildRequestHeaders does not force JSON for multipart forms', () => {
  const headers = buildRequestHeaders({ body: new FormData() })
  assert.equal(headers.has('content-type'), false)
})
