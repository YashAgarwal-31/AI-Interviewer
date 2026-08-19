import InterviewSession from '../models/InterviewSession.js';
import { verifyAccessToken } from './security.js';
import {
  getScheduledSessionById,
  updateSessionStatus,
  validateSessionTiming,
  verifyScheduledAccessToken
} from './sessionScheduler.js';

let interviewResultsCollection = null;

export function initializeSessionActionGuard(collections = {}) {
  interviewResultsCollection = collections.interviewResultsCollection || null;
}

function providedToken(req) {
  return req.body?.accessToken || req.get('x-interview-token') || req.query?.token || '';
}

function legacyTiming(session) {
  const start = new Date(session.sessionConfig?.scheduledStartTime);
  const end = new Date(session.sessionConfig?.scheduledEndTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { isValid: false, reason: 'Session timing is invalid', shouldExpire: false };
  }

  const before = Math.max(0, Number(session.sessionConfig?.accessWindow?.beforeStart || 0));
  const after = Math.max(0, Number(session.sessionConfig?.accessWindow?.afterEnd || 0));
  const now = new Date();
  const accessStart = new Date(start.getTime() - before * 60000);
  const accessEnd = new Date(end.getTime() + after * 60000);

  if (session.sessionStatus === 'cancelled') return { isValid: false, reason: 'Session has been cancelled', shouldExpire: false };
  if (session.sessionStatus === 'completed') return { isValid: false, reason: 'Session has already been completed', shouldExpire: false };
  if (session.sessionStatus === 'expired') return { isValid: false, reason: 'Session has expired', shouldExpire: false };
  if (now < accessStart) return { isValid: false, reason: 'Interview session is not accessible yet', shouldExpire: false };
  if (now > accessEnd) return { isValid: false, reason: 'Interview session has expired', shouldExpire: true };
  return { isValid: true, reason: 'Session is active and accessible', shouldExpire: false };
}

async function loadSession(sessionId) {
  try {
    const scheduled = await getScheduledSessionById(sessionId);
    if (scheduled) return { type: 'scheduled', session: scheduled };
  } catch {
    // Fall through for local/legacy data where the scheduler is not initialized.
  }

  const legacy = await InterviewSession.findOne({ sessionId })
    .select('+security.accessToken +security.accessTokenHash');
  return legacy ? { type: 'legacy', session: legacy } : null;
}

function tokenIsValid(context, token) {
  if (!context || !token) return false;
  if (context.type === 'scheduled') return verifyScheduledAccessToken(context.session, token);
  return verifyAccessToken(context.session, token);
}

async function markExpired(context) {
  if (context.type === 'scheduled') {
    await updateSessionStatus(context.session.sessionId, 'expired');
    return;
  }
  context.session.sessionStatus = 'expired';
  if (context.session.accessControl) context.session.accessControl.isActive = false;
  await context.session.save();
}

async function existingCompletion(sessionId) {
  if (!interviewResultsCollection) return null;
  return interviewResultsCollection.findOne({ sessionId: String(sessionId) }, { sort: { savedAt: -1 } });
}

function completionResponse(result) {
  const details = result?.interviewDetails || {};
  return {
    success: true,
    message: 'Interview was already completed successfully',
    alreadyCompleted: true,
    fileName: result?.fileName || null,
    summary: {
      candidateName: result?.candidateInfo?.name || 'Candidate',
      duration: details.duration || null,
      questionsAsked: details.totalQuestions || 0,
      totalTimeSpent: details.durationSeconds ? Math.ceil(details.durationSeconds / 60) : 0
    }
  };
}

export async function requireLiveInterviewAction(req, res, next) {
  try {
    const sessionId = String(req.params.sessionId || '');
    const token = providedToken(req);
    if (!sessionId || !token) {
      return res.status(400).json({ success: false, error: 'sessionId and interview access token are required' });
    }

    const context = await loadSession(sessionId);
    if (!context) return res.status(404).json({ success: false, error: 'Session not found' });
    if (!tokenIsValid(context, token)) {
      return res.status(401).json({ success: false, error: 'Invalid interview access token' });
    }

    const isEndRequest = req.method === 'POST' && /\/end\//.test(req.originalUrl || req.path || '');
    const status = context.type === 'scheduled' ? context.session.status : context.session.sessionStatus;

    if (status === 'completed' && isEndRequest) {
      const result = await existingCompletion(sessionId);
      if (result) return res.json(completionResponse(result));
      return res.status(409).json({ success: false, error: 'Interview is completed but its result record could not be found' });
    }

    const validation = context.type === 'scheduled'
      ? validateSessionTiming(context.session)
      : legacyTiming(context.session);

    if (!validation.isValid) {
      if (validation.shouldExpire) await markExpired(context);
      return res.status(403).json({ success: false, error: validation.reason || 'Interview session is not active' });
    }

    if (status !== 'active') {
      return res.status(409).json({ success: false, error: 'Interview has not been started yet' });
    }

    if (req.body?.messageType !== 'code_result' && typeof req.body?.message === 'string' && req.body.message.length > 12000) {
      return res.status(413).json({ success: false, error: 'Interview answer is too large' });
    }

    req.liveInterviewContext = context;
    return next();
  } catch (error) {
    console.error('Live interview action guard failed:', error);
    return res.status(500).json({ success: false, error: 'Unable to validate interview session state' });
  }
}
