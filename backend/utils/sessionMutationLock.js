const sessionLocks = new Map();

function sessionKey(req) {
  if (req.params?.sessionId) return String(req.params.sessionId);
  const match = String(req.originalUrl || req.url || '').match(/\/api\/sessions\/(?:initialize-interview|message|coding-tasks|end)\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function acquire(key) {
  const previous = sessionLocks.get(key) || Promise.resolve();
  let releaseCurrent;
  const current = new Promise(resolve => { releaseCurrent = resolve; });
  sessionLocks.set(key, current);

  return previous.catch(() => {}).then(() => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      if (sessionLocks.get(key) === current) sessionLocks.delete(key);
    };
  });
}

export async function serializeSessionMutation(req, res, next) {
  const key = sessionKey(req);
  if (!key) return next();

  try {
    const release = await acquire(key);
    res.once('finish', release);
    res.once('close', release);
    return next();
  } catch (error) {
    return next(error);
  }
}

export function activeSessionLockCount() {
  return sessionLocks.size;
}
