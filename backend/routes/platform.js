import express from 'express';
import AuditLog from '../models/AuditLog.js';
import User from '../models/User.js';
import {
  hashPassword,
  logAudit,
  normalizeEmail,
  revokeAllUserSessions,
  serializeUser,
  validatePassword
} from '../utils/auth.js';
import { requirePlatformUser, requireRoles } from '../utils/security.js';

const router = express.Router();
let candidatesCollection = null;
let scheduledSessionsCollection = null;
let interviewResultsCollection = null;

export function initializePlatformRoutes(collections = {}) {
  candidatesCollection = collections.candidatesCollection || null;
  scheduledSessionsCollection = collections.scheduledSessionsCollection || null;
  interviewResultsCollection = collections.interviewResultsCollection || null;
}

function safeSession(session) {
  return {
    sessionId: session.sessionId,
    candidateId: session.candidateId,
    candidateName: session.candidateName,
    candidateEmail: session.candidateEmail || null,
    position: session.position || null,
    status: session.status,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    updatedAt: session.updatedAt || null
  };
}

function safeResult(result) {
  return {
    fileName: result.fileName || null,
    sessionId: result.sessionId || null,
    candidateName: result.candidateInfo?.name || null,
    position: result.candidateInfo?.position || null,
    date: result.savedAt || result.createdAt || null,
    duration: result.interviewDetails?.duration || null,
    questionsAsked: result.interviewDetails?.totalQuestions || 0,
    codingTestsCompleted: result.interviewDetails?.codingTestsCompleted || 0
  };
}

router.get('/dashboard', requirePlatformUser, async (req, res) => {
  try {
    if (!candidatesCollection || !scheduledSessionsCollection || !interviewResultsCollection) {
      return res.status(503).json({ success: false, error: 'Platform database is not fully initialized' });
    }

    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [
      candidateCount,
      resultCount,
      activeTeamCount,
      statusGroups,
      upcomingCount,
      recentSessions,
      recentResults
    ] = await Promise.all([
      candidatesCollection.countDocuments({}),
      interviewResultsCollection.countDocuments({}),
      User.countDocuments({ isActive: true }),
      scheduledSessionsCollection.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]).toArray(),
      scheduledSessionsCollection.countDocuments({
        status: 'scheduled',
        startTime: { $gte: now, $lte: nextWeek }
      }),
      scheduledSessionsCollection.find({}).sort({ updatedAt: -1, startTime: -1 }).limit(8).toArray(),
      interviewResultsCollection.find({}).sort({ savedAt: -1, createdAt: -1 }).limit(8).toArray()
    ]);

    const sessionsByStatus = Object.fromEntries(statusGroups.map(item => [item._id || 'unknown', item.count]));
    const completed = sessionsByStatus.completed || 0;
    const terminal = completed + (sessionsByStatus.expired || 0) + (sessionsByStatus.cancelled || 0);

    return res.json({
      success: true,
      stats: {
        candidates: candidateCount,
        interviews: Object.values(sessionsByStatus).reduce((sum, value) => sum + value, 0),
        completedInterviews: completed,
        activeInterviews: sessionsByStatus.active || 0,
        upcomingInterviews: upcomingCount,
        results: resultCount,
        teamMembers: activeTeamCount,
        completionRate: terminal ? Math.round((completed / terminal) * 100) : 0
      },
      sessionsByStatus,
      recentSessions: recentSessions.map(safeSession),
      recentResults: recentResults.map(safeResult),
      user: serializeUser(req.platformUser)
    });
  } catch (error) {
    console.error('Dashboard load failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to load dashboard' });
  }
});

router.get('/team', requirePlatformUser, async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: 1 });
    return res.json({ success: true, users: users.map(serializeUser) });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load team members' });
  }
});

router.post('/team', requireRoles('owner', 'admin'), async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const role = String(req.body?.role || 'recruiter');
    const allowedRoles = req.platformUser.role === 'owner'
      ? new Set(['admin', 'recruiter', 'reviewer'])
      : new Set(['recruiter', 'reviewer']);

    if (!name || !email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid name and email are required' });
    }
    if (!allowedRoles.has(role)) {
      return res.status(403).json({ success: false, error: 'You cannot create a user with that role' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ success: false, error: passwordError });

    const { salt, hash } = await hashPassword(password);
    const user = await User.create({
      name,
      email,
      passwordHash: hash,
      passwordSalt: salt,
      role,
      organizationName: req.platformUser.organizationName,
      passwordChangedAt: new Date(),
      createdBy: req.platformUser._id
    });

    await logAudit({
      req,
      action: 'team.member.create',
      statusCode: 201,
      metadata: { targetUserId: String(user._id), role }
    });
    return res.status(201).json({ success: true, user: serializeUser(user) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists' });
    }
    console.error('Team member creation failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to create team member' });
  }
});

router.patch('/team/:userId', requireRoles('owner', 'admin'), async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ success: false, error: 'Team member not found' });
    if (String(target._id) === String(req.platformUser._id) && req.body?.isActive === false) {
      return res.status(400).json({ success: false, error: 'You cannot disable your own account' });
    }
    if (target.role === 'owner' && req.platformUser.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only the owner can modify the owner account' });
    }

    const update = {};
    if (req.body?.name !== undefined) update.name = String(req.body.name || '').trim().slice(0, 120);
    if (req.body?.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
    if (req.body?.role !== undefined) {
      const role = String(req.body.role);
      const roles = req.platformUser.role === 'owner'
        ? new Set(['admin', 'recruiter', 'reviewer'])
        : new Set(['recruiter', 'reviewer']);
      if (target.role === 'owner' || !roles.has(role)) {
        return res.status(403).json({ success: false, error: 'You cannot assign that role' });
      }
      update.role = role;
    }

    const user = await User.findByIdAndUpdate(target._id, { $set: update }, { new: true });
    if (update.isActive === false) await revokeAllUserSessions(user._id);
    await logAudit({
      req,
      action: 'team.member.update',
      statusCode: 200,
      metadata: { targetUserId: String(user._id), fields: Object.keys(update) }
    });
    return res.json({ success: true, user: serializeUser(user) });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(400).json({ success: false, error: 'Invalid team member ID' });
    return res.status(500).json({ success: false, error: 'Failed to update team member' });
  }
});

router.post('/team/:userId/reset-password', requireRoles('owner', 'admin'), async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ success: false, error: 'Team member not found' });
    if (target.role === 'owner' && req.platformUser.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only the owner can reset the owner password' });
    }

    const newPassword = String(req.body?.newPassword || '');
    const passwordError = validatePassword(newPassword);
    if (passwordError) return res.status(400).json({ success: false, error: passwordError });

    const { salt, hash } = await hashPassword(newPassword);
    await User.updateOne({ _id: target._id }, {
      $set: {
        passwordHash: hash,
        passwordSalt: salt,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
    await revokeAllUserSessions(target._id);
    await logAudit({
      req,
      action: 'team.member.password-reset',
      statusCode: 200,
      metadata: { targetUserId: String(target._id) }
    });
    return res.json({ success: true, message: 'Password reset and all existing sessions revoked' });
  } catch (error) {
    if (error?.name === 'CastError') return res.status(400).json({ success: false, error: 'Invalid team member ID' });
    return res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

router.get('/audit', requireRoles('owner', 'admin'), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({
      success: true,
      logs: logs.map(log => ({
        id: String(log._id),
        actorEmail: log.actorEmail,
        actorType: log.actorType,
        action: log.action,
        method: log.method,
        path: log.path,
        statusCode: log.statusCode,
        requestId: log.requestId,
        ip: log.ip,
        metadata: log.metadata,
        createdAt: log.createdAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load audit log' });
  }
});

router.get('/system', requireRoles('owner', 'admin'), async (req, res) => {
  const health = req.app.locals.platformHealth || {};
  return res.json({
    success: true,
    system: {
      mongoConnected: Boolean(health.mongoConnected),
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      emailConfigured: Boolean(health.emailConfigured),
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime())
    }
  });
});

export default router;
