export function parseInviteCredentials(locationLike = globalThis.location) {
  const search = new URLSearchParams(locationLike?.search || '');
  const hash = new URLSearchParams(String(locationLike?.hash || '').replace(/^#/, ''));
  return {
    candidateId: search.get('candidateId') || hash.get('candidateId') || '',
    sessionId: search.get('sessionId') || hash.get('sessionId') || '',
    accessToken: hash.get('accessToken') || search.get('accessToken') || ''
  };
}

export function normalizeEditorSubmissionEvent(event, { trustedOrigin, expectedSource }) {
  if (!trustedOrigin || event?.origin !== trustedOrigin || event?.source !== expectedSource) return null;

  let payload = event.data;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); }
    catch { return null; }
  }
  if (!payload || typeof payload !== 'object') return null;

  if (['editorReady', 'editorAck'].includes(payload.type)) {
    return { kind: 'ready' };
  }
  if (!['codeSubmission', 'code-result'].includes(payload.type) && payload.action !== 'submit') {
    return null;
  }

  const data = payload.payload && typeof payload.payload === 'object' ? payload.payload : payload;
  return {
    kind: 'submission',
    code: String(data.code || '').slice(0, 6000),
    language: String(data.language || 'text').slice(0, 40),
    result: String(data.result || data.output || '').slice(0, 1500)
  };
}
