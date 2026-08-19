import express from 'express';
import User from '../models/User.js';
import {
  createPlatformSession,
  hashPassword,
  logAudit,
  normalizeEmail,
  revokeAllUserSessions,
  revokeSession,
  serializeUser,
  validatePassword,
  verifyPassword,
  verifyServerAdminKey
} from '../utils/auth.js';
import { requirePlatformUser } from '../utils/security.js';

const router = express.Router();
const LOGIN_LOCK_MINUTES = 15;
const MAX_LOGIN_FAILURES = 5;

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicAuthPayload(user, session) {
  return {
    user: serializeUser(user),
    token: session.token,
    expiresAt: session.expiresAt
  };
}

router.get('/bootstrap-status', async (req, res) => {
  try {
    const ownerExists = await User.exists({ role: 'owner' });
    return res.json({
      success: true,
      requiresBootstrap: !ownerExists,
      adminKeyConfigured: Boolean(process.env.ADMIN_API_KEY)
    });
  } catch (error) {
    console.error('Bootstrap status failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to check account setup' });
  }
});

router.post('/bootstrap', async (req, res) => {
  try {
    if (!verifyServerAdminKey(req)) {
      return res.status(401).json({ success: false, error: 'Valid server admin key is required for first-owner setup' });
    }

    if (await User.exists({ role: 'owner' })) {
      return res.status(409).json({ success: false, error: 'Platform owner has already been created' });
    }

    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const organizationName = String(req.body?.organizationName || 'InterviewBuddy').trim();
    const passwordError = validatePassword(password);

    if (!name || !validEmail(email)) {
      return res.status(400).json({ success: false, error: 'Valid name and email are required' });
    }
    if (passwordError) return res.status(400).json({ success: false, error: passwordError });

    const { salt, hash } = await hashPassword(password);
    const user = await User.create({
      name,
      email,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'owner',
      organizationName: organizationName || 'InterviewBuddy',
      passwordChangedAt: new Date()
    });

    const session = await createPlatformSession(user, req);
    await logAudit({ req, actor: { type: 'user', user }, action: 'auth.bootstrap', statusCode: 201 });
    return res.status(201).json({ success: true, ...publicAuthPayload(user, session) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: 'An account with this email already exists' });
    }
    console.error('Owner bootstrap failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to create platform owner' });
  }
});

router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const genericError = 'Invalid email or password';

  try {
    if (!email || !password) return res.status(400).json({ success: false, error: genericError });

    const user = await User.findOne({ email }).select('+passwordHash +passwordSalt');
    if (!user) {
      // Keep unknown-account requests computationally similar to real password verification.
      await hashPassword(password, '00000000000000000000000000000000');
      await logAudit({ req, actor: { type: 'system', email }, action: 'auth.login.failed', statusCode: 401, metadata: { reason: 'invalid-credentials' } });
      return res.status(401).json({ success: false, error: genericError });
    }

    if (!user.isActive) {
      await logAudit({ req, actor: { type: 'user', user }, action: 'auth.login.failed', statusCode: 403, metadata: { reason: 'inactive' } });
      return res.status(403).json({ success: false, error: 'This account is disabled' });
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await logAudit({ req, actor: { type: 'user', user }, action: 'auth.login.failed', statusCode: 429, metadata: { reason: 'locked' } });
      return res.status(429).json({ success: false, error: 'Too many failed sign-in attempts. Try again later.' });
    }

    const valid = await verifyPassword(password, user.passwordSalt, user.passwordHash);
    if (!valid) {
      const failures = (user.failedLoginAttempts || 0) + 1;
      const update = { failedLoginAttempts: failures };
      if (failures >= MAX_LOGIN_FAILURES) {
        update.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000);
        update.failedLoginAttempts = 0;
      }
      await User.updateOne({ _id: user._id }, { $set: update });
      await logAudit({ req, actor: { type: 'user', user }, action: 'auth.login.failed', statusCode: 401, metadata: { reason: 'invalid-credentials' } });
      return res.status(401).json({ success: false, error: genericError });
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = now;
    await user.save();

    const session = await createPlatformSession(user, req);
    await logAudit({ req, actor: { type: 'user', user }, action: 'auth.login', statusCode: 200 });
    return res.json({ success: true, ...publicAuthPayload(user, session) });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ success: false, error: 'Sign-in service failed' });
  }
});

router.get('/me', requirePlatformUser, async (req, res) => {
  return res.json({ success: true, user: serializeUser(req.platformUser) });
});

router.post('/logout', requirePlatformUser, async (req, res) => {
  await revokeSession(req.platformSession?._id);
  await logAudit({ req, action: 'auth.logout', statusCode: 200 });
  return res.json({ success: true });
});

router.post('/logout-all', requirePlatformUser, async (req, res) => {
  await revokeAllUserSessions(req.platformUser._id);
  await logAudit({ req, action: 'auth.logout-all', statusCode: 200 });
  return res.json({ success: true });
});

router.patch('/profile', requirePlatformUser, async (req, res) => {
  try {
    const update = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ success: false, error: 'Name cannot be empty' });
      update.name = name.slice(0, 120);
    }
    if (req.body?.organizationName !== undefined && ['owner', 'admin'].includes(req.platformUser.role)) {
      update.organizationName = String(req.body.organizationName || '').trim().slice(0, 160) || 'InterviewBuddy';
    }

    const user = await User.findByIdAndUpdate(req.platformUser._id, { $set: update }, { new: true });
    await logAudit({ req, action: 'auth.profile.update', statusCode: 200 });
    return res.json({ success: true, user: serializeUser(user) });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

router.post('/change-password', requirePlatformUser, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ success: false, error: passwordError });

    const user = await User.findById(req.platformUser._id).select('+passwordHash +passwordSalt');
    if (!user || !(await verifyPassword(currentPassword, user.passwordSalt, user.passwordHash))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    const { salt, hash } = await hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.passwordChangedAt = new Date();
    await user.save();
    await revokeAllUserSessions(user._id, req.platformSession?._id);
    await logAudit({ req, action: 'auth.password.change', statusCode: 200 });
    return res.json({ success: true, message: 'Password changed. Other sessions were signed out.' });
  } catch (error) {
    console.error('Password change failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

export default router;
