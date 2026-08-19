import crypto from 'crypto';

const TOKEN_BYTES = 32;

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

function extractAdminKey(req) {
  const headerKey = req.get('x-admin-key');
  if (headerKey) return headerKey;

  const auth = req.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  return '';
}

export function requireAdmin(req, res, next) {
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Admin API is not configured on the server'
      });
    }

    // Local development remains convenient, while production fails closed.
    return next();
  }

  const providedKey = extractAdminKey(req);
  if (!safeEqual(providedKey, expectedKey)) {
    return res.status(401).json({
      success: false,
      error: 'Admin authentication required'
    });
  }

  return next();
}

export function isDemoEnabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return String(process.env.ENABLE_DEMO_MODE || '').toLowerCase() === 'true';
}
