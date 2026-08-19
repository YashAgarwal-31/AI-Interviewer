import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import emailService from '../utils/emailService.js';
import { requireAdmin } from '../utils/security.js';
import {
  getScheduledSessionByCandidate,
  getScheduledSessionById,
  rotateScheduledAccessToken
} from '../utils/sessionScheduler.js';

const router = express.Router();
let emailMongoClient = null;
let emailDb = null;

const frontendBaseUrl = () => (
  process.env.PRODUCTION_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173'
).replace(/\/$/, '');

async function getDatabase() {
  if (emailDb) return emailDb;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is required for email workflows');

  emailMongoClient = new MongoClient(uri);
  await emailMongoClient.connect();
  emailDb = emailMongoClient.db(process.env.MONGO_DB_NAME || 'ai_interviewer');
  return emailDb;
}

async function findCandidate(db, candidateId) {
  const id = String(candidateId);
  let candidate = await db.collection('candidates').findOne({ candidateId: id });
  if (candidate) return candidate;

  if (ObjectId.isValid(id)) {
    candidate = await db.collection('shortlistedcandidates').findOne({ _id: new ObjectId(id) });
  }
  return candidate;
}

function candidateEmail(candidate) {
  return candidate?.email || candidate?.candidateEmail || null;
}

function candidateName(candidate) {
  return candidate?.name || candidate?.full_name || candidate?.candidateName || 'Candidate';
}

function buildSecureUrl(session, accessToken) {
  const params = new URLSearchParams({
    candidateId: String(session.candidateId),
    sessionId: String(session.sessionId)
  });
  const fragment = new URLSearchParams({ accessToken: String(accessToken) });
  return `${frontendBaseUrl()}/?${params.toString()}#${fragment.toString()}`;
}

async function resolveCandidateAndSession(candidateId, sessionId = null) {
  const db = await getDatabase();
  const session = sessionId
    ? await getScheduledSessionById(sessionId)
    : await getScheduledSessionByCandidate(candidateId);

  if (!session || String(session.candidateId) !== String(candidateId)) {
    const error = new Error('Scheduled session not found for this candidate');
    error.status = 404;
    throw error;
  }

  const candidate = await findCandidate(db, candidateId);
  const email = candidateEmail(candidate) || session.candidateEmail;
  if (!email) {
    const error = new Error('Candidate email is not available');
    error.status = 400;
    throw error;
  }

  return { db, session, candidate, email };
}

async function sendInvite({ candidateId, sessionId = null, reminderMinutes = null }) {
  const { db, session, candidate, email } = await resolveCandidateAndSession(candidateId, sessionId);
  const token = await rotateScheduledAccessToken(session.sessionId);
  const secureUrl = buildSecureUrl(session, token);
  const candidateData = {
    name: candidateName(candidate) || session.candidateName,
    email,
    candidateId: String(candidateId)
  };
  const sessionDetails = {
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration || 60,
    sessionId: session.sessionId
  };

  const result = reminderMinutes === null
    ? await emailService.sendSessionInvite(candidateData, secureUrl, sessionDetails)
    : await emailService.sendSessionReminder(candidateData, secureUrl, sessionDetails, reminderMinutes);

  if (!result.success) {
    const error = new Error(result.error || 'Failed to send email');
    error.status = 502;
    throw error;
  }

  const sentAt = new Date();
  await db.collection('scheduled_sessions').updateOne(
    { sessionId: session.sessionId },
    {
      $set: {
        emailSent: true,
        emailSentAt: sentAt,
        emailMessageId: result.messageId || null,
        updatedAt: sentAt
      },
      ...(reminderMinutes !== null ? {
        $push: {
          reminders: {
            sentAt,
            minutesUntilStart: reminderMinutes,
            messageId: result.messageId || null
          }
        }
      } : {})
    }
  );

  await db.collection('email_logs').insertOne({
    type: reminderMinutes === null ? 'candidate_session_invite' : 'candidate_session_reminder',
    candidateId: String(candidateId),
    candidateEmail: email,
    candidateName: candidateData.name,
    sessionId: session.sessionId,
    emailSent: true,
    emailSentAt: sentAt,
    emailMessageId: result.messageId || null,
    // Deliberately do not persist the token-bearing URL.
    createdAt: sentAt
  });

  return {
    candidateId: String(candidateId),
    candidateName: candidateData.name,
    candidateEmail: email,
    sessionId: session.sessionId,
    sessionUrl: secureUrl,
    emailMessageId: result.messageId || null,
    sessionDetails
  };
}

router.post('/send-session-invite', requireAdmin, async (req, res) => {
  try {
    const { candidateId, sessionId } = req.body || {};
    if (!candidateId || !sessionId) {
      return res.status(400).json({ success: false, message: 'candidateId and sessionId are required' });
    }
    const data = await sendInvite({ candidateId, sessionId });
    return res.json({ success: true, message: 'Session invite email sent successfully', data });
  } catch (error) {
    console.error('Send session invite failed:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/send-reminder', requireAdmin, async (req, res) => {
  try {
    const { candidateId, sessionId, minutesUntilStart = 15 } = req.body || {};
    if (!candidateId || !sessionId) {
      return res.status(400).json({ success: false, message: 'candidateId and sessionId are required' });
    }
    const data = await sendInvite({
      candidateId,
      sessionId,
      reminderMinutes: Math.max(1, Number(minutesUntilStart) || 15)
    });
    return res.json({ success: true, message: 'Reminder email sent successfully', data });
  } catch (error) {
    console.error('Send reminder failed:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.post('/send-bulk-invites', requireAdmin, async (req, res) => {
  try {
    const sessions = req.body?.sessions;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return res.status(400).json({ success: false, message: 'sessions must be a non-empty array' });
    }
    if (sessions.length > 50) {
      return res.status(400).json({ success: false, message: 'A maximum of 50 invites can be sent per request' });
    }

    const successful = [];
    const failed = [];
    for (const item of sessions) {
      try {
        successful.push(await sendInvite({ candidateId: item.candidateId, sessionId: item.sessionId }));
      } catch (error) {
        failed.push({ candidateId: item.candidateId, sessionId: item.sessionId, error: error.message });
      }
    }

    return res.json({
      success: failed.length === 0,
      message: `Processed ${sessions.length} invite(s)`,
      results: { successful, failed }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to process bulk invites' });
  }
});

router.post('/send-candidate-session', requireAdmin, async (req, res) => {
  try {
    const { candidateId } = req.body || {};
    if (!candidateId) return res.status(400).json({ success: false, message: 'candidateId is required' });

    const session = await getScheduledSessionByCandidate(candidateId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'No scheduled interview exists for this candidate. Create a session before sending an invite.'
      });
    }

    const data = await sendInvite({ candidateId, sessionId: session.sessionId });
    return res.json({ success: true, message: 'Secure session link sent successfully', data });
  } catch (error) {
    console.error('Send candidate session failed:', error);
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
});

router.get('/status/:sessionId', requireAdmin, async (req, res) => {
  try {
    const session = await getScheduledSessionById(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    return res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        emailSent: session.emailSent || false,
        emailSentAt: session.emailSentAt || null,
        emailMessageId: session.emailMessageId || null,
        reminders: session.reminders || []
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get email status' });
  }
});

router.get('/logs/:candidateId', requireAdmin, async (req, res) => {
  try {
    const db = await getDatabase();
    const logs = await db.collection('email_logs')
      .find({ candidateId: String(req.params.candidateId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    return res.json({
      success: true,
      data: {
        candidateId: String(req.params.candidateId),
        totalEmails: logs.length,
        emails: logs.map(log => ({
          id: log._id,
          type: log.type,
          emailSent: log.emailSent,
          sentAt: log.emailSentAt,
          recipientEmail: log.candidateEmail,
          sessionId: log.sessionId,
          error: log.emailError || null
        }))
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get email logs' });
  }
});

router.get('/test', requireAdmin, (req, res) => {
  return res.json({ success: true, message: 'Email routes are available' });
});

router.get('/test-config', requireAdmin, async (req, res) => {
  const result = await emailService.testEmailConfiguration();
  return res.status(result.success ? 200 : 503).json(result);
});

export async function closeEmailDatabase() {
  if (emailMongoClient) {
    await emailMongoClient.close();
    emailMongoClient = null;
    emailDb = null;
  }
}

export default router;
