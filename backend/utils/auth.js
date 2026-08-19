import crypto from 'crypto';
import { promisify } from 'util';
import AuditLog from '../models/AuditLog.js';
import AuthSession from '../models/AuthSession.js';
import User from '../models/User.js';

const scryptAsync = promisify(crypto.scrypt);
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_KEY_BYTES = 64;
const DEFAULT_SESSION_HOURS = 12;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) return 'Password must be at least 12 characters long';
  if (value.length > 128) return 'Password must be 128 characters or fewer';
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include uppercase, lowercase, and a number';
  }
  return null;
}

export async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scryptAsync(String(password), salt, PASSWORD_KEY_BYTES);
  return { salt, hash: Buffer.from(derived).toString('hex') };
}

export async function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyServerAdminKey(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return process.env.NODE_ENV !== 'production';
  return safeEqual(req.get('x-admin-key'), expected);
}

export function serializeUser(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    organizationName: user.organizationName,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function sessionHours() {
  const configured = Number(process.env.AUTH_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  if (!Number.isFinite(configured)) return DEFAULT_SESSION_HOURS;
  return Math.min(168, Math.max(1, configured));
}

export async function createPlatformSession(user, req) {
  const rawToken = crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionHours() * 60 * 60 * 1000);

  const session = await AuthSession.create({
    tokenHash: hashSessionToken(rawToken),
    userId: user._id,
    expiresAt,
    lastSeenAt: now,
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: String(req.get('user-agent') || '').slice(0, 500)
  });

  return {
    token: rawToken,
    expiresAt,
    sessionId: String(session._id)
  };
}

export function extractBearerToken(req) {
  const auth = req.get('authorization');
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) return '';
  return auth.slice(7).trim();
}

export async function authenticatePlatformRequest(req) {
  const token = extractBearerToken(req);
  if (!token) return null;

  const now = new Date();
  const session = await AuthSession.findOne({
    tokenHash: hashSessionToken(token),
    expiresAt: { $gt: now }
  });
  if (!session) return null;

  const user = await User.findOne({ _id: session.userId, isActive: true });
  if (!user) {
    await AuthSession.deleteOne({ _id: session._id });
    return null;
  }

  if (!session.lastSeenAt || now - session.lastSeenAt > 5 * 60 * 1000) {
    AuthSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: now } }).catch(() => {});
  }

  return { user, session, token };
}

export async function revokeSession(sessionId) {
  if (!sessionId) return;
  await AuthSession.deleteOne({ _id: sessionId });
}

export async function revokeAllUserSessions(userId, exceptSessionId = null) {
  const query = { userId };
  if (exceptSessionId) query._id = { $ne: exceptSessionId };
  await AuthSession.deleteMany(query);
}

export async function logAudit({ req, actor = null, action, statusCode = null, metadata = {} }) {
  try {
    const user = actor?.user || req?.platformUser || null;
    await AuditLog.create({
      actorId: user?._id || null,
      actorEmail: user?.email || actor?.email || null,
      actorType: actor?.type || (user ? 'user' : 'system'),
      action,
      method: req?.method || null,
      path: req?.originalUrl || req?.path || null,
      statusCode,
      requestId: req?.requestId || null,
      ip: req?.ip || req?.socket?.remoteAddress || null,
      metadata
    });
  } catch (error) {
    console.warn('Audit logging failed:', error.message);
  }
}
