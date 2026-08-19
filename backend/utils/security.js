import crypto from 'crypto';
import { authenticatePlatformRequest } from './auth.js';

const TOKEN_BYTES = 32;
const RECRUITER_ROLES = new Set(['owner', 'admin', 'recruiter']);

export function generateAccessToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashAccessToken(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function safeEqual(left, right) {
  if (left === undefined || left === null || right === undefined || right === null) {
    return false;
  }

  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyAccessToken(record, providedToken) {
  if (!record || !providedToken) return false;

  const security = record.security || record;
  if (security.accessTokenHash) {
    return safeEqual(security.accessTokenHash, hashAccessToken(providedToken));
  }

  // Backward compatibility for sessions created before token hashing was added.
  if (security.accessToken) {
    return safeEqual(security.accessToken, providedToken);
  }

  return false;
}

function serverAdminAuthenticated(req) {
  const expectedKey = process.env.ADMIN_API_KEY;
  const providedKey = req.get('x-admin-key');
  return Boolean(expectedKey && providedKey && safeEqual(providedKey, expectedKey));
}

function attachServerAdmin(req) {
  req.actor = { type: 'server-admin', email: null };
}

async function platformAuth(req) {
  if (req.platformUser && req.platformSession) {
    return { user: req.platformUser, session: req.platformSession };
  }
  return authenticatePlatformRequest(req);
}

function attachPlatformIdentity(req, auth) {
  req.platformUser = auth.user;
  req.platformSession = auth.session;
  req.actor = {
    type: 'user',
    user: auth.user,
    email: auth.user.email
  };
}

export async function requirePlatformUser(req, res, next) {
  try {
    const auth = await platformAuth(req);
    if (!auth) {
      return res.status(401).json({ success: false, error: 'Sign in is required' });
    }
    attachPlatformIdentity(req, auth);
    return next();
  } catch (error) {
    console.error('Platform authentication failed:', error);
    return res.status(500).json({ success: false, error: 'Authentication service failed' });
  }
}

export function requireRoles(...roles) {
  const allowed = new Set(roles);
  return async (req, res, next) => {
    if (serverAdminAuthenticated(req)) {
      attachServerAdmin(req);
      return next();
    }

    try {
      const auth = await platformAuth(req);
      if (!auth) {
        return res.status(401).json({ success: false, error: 'Sign in is required' });
      }
      attachPlatformIdentity(req, auth);
      if (!allowed.has(auth.user.role)) {
        return res.status(403).json({ success: false, error: 'You do not have permission for this action' });
      }
      return next();
    } catch (error) {
      console.error('Role authorization failed:', error);
      return res.status(500).json({ success: false, error: 'Authorization service failed' });
    }
  };
}

export async function requireAdmin(req, res, next) {
  if (serverAdminAuthenticated(req)) {
    attachServerAdmin(req);
    return next();
  }

  try {
    const auth = await platformAuth(req);
    if (auth) {
      attachPlatformIdentity(req, auth);
      if (!RECRUITER_ROLES.has(auth.user.role)) {
        return res.status(403).json({ success: false, error: 'Recruiter access is required' });
      }
      return next();
    }
  } catch (error) {
    console.error('Admin authentication failed:', error);
    return res.status(500).json({ success: false, error: 'Authentication service failed' });
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.ADMIN_API_KEY) {
    attachServerAdmin(req);
    req.actor.email = 'local-development';
    return next();
  }

  return res.status(401).json({
    success: false,
    error: 'Recruiter authentication required'
  });
}

export function isDemoEnabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.ENABLE_DEMO_MODE || '').toLowerCase() === 'true';
}
