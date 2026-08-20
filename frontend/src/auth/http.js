export async function parseResponse(response) {
  const data = await response.json().catch(() => ({ success: false, error: 'Invalid server response' }))
  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed (${response.status})`)
    error.status = response.status
    error.requestId = data.requestId || response.headers.get('x-request-id')
    throw error
  }
  return data
}

export function buildRequestHeaders({ headers: initialHeaders, token = '', body = null } = {}) {
  const headers = new Headers(initialHeaders || {})
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body && !headers.has('Content-Type') && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}
