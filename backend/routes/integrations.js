import express from 'express';
import { requireAdmin } from '../utils/security.js';
import { createScheduledSession, getScheduledSessionByCandidate } from '../utils/sessionScheduler.js';

const router = express.Router();

const frontendBaseUrl = () => (
  process.env.PRODUCTION_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173'
).replace(/\/$/, '');

function parseMongoDate(value) {
  const raw = value?.$date || value;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid scheduled date');
  return date;
}

function parseScheduledSlot(slot) {
  if (!slot || typeof slot !== 'string') throw new Error('Scheduled slot is required');
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayMatch = slot.toLowerCase().match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
  const timeMatch = slot.toLowerCase().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (!dayMatch || !timeMatch) {
    throw new Error('Invalid scheduled slot format. Example: "Monday at 10:30 AM"');
  }

  const now = new Date();
  const targetDay = days.indexOf(dayMatch[1]);
  let daysUntilTarget = targetDay - now.getDay();
  if (daysUntilTarget < 0) daysUntilTarget += 7;

  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3];
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) throw new Error('Invalid scheduled time');
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  const target = new Date(now);
  target.setDate(target.getDate() + daysUntilTarget);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 7);
  return target;
}

function buildSecureUrl(session, accessToken) {
  const params = new URLSearchParams({
    candidateId: String(session.candidateId),
    sessionId: String(session.sessionId),
    accessToken: String(accessToken)
  });
  return `${frontendBaseUrl()}/?${params.toString()}`;
}

async function createFromCandidate(candidate) {
  if (!candidate?.candidateId) throw new Error('candidateId is required');
  if (!candidate?.candidateName) throw new Error('candidateName is required');

  const existing = await getScheduledSessionByCandidate(candidate.candidateId);
  if (existing) {
    const error = new Error('Candidate already has an active or scheduled session');
    error.status = 409;
    throw error;
  }

  let startTime;
  if (candidate.call_tracking?.interview_details?.scheduled_slot) {
    startTime = parseScheduledSlot(candidate.call_tracking.interview_details.scheduled_slot);
  } else if (candidate.scheduledInterviewDate) {
    startTime = parseMongoDate(candidate.scheduledInterviewDate);
  } else if (candidate.startTime) {
    startTime = parseMongoDate(candidate.startTime);
  } else {
    throw new Error('Provide scheduledInterviewDate, startTime, or call_tracking.interview_details.scheduled_slot');
  }

  const duration = Math.max(15, Number(candidate.duration) || 60);
  const endTime = candidate.endTime
    ? parseMongoDate(candidate.endTime)
    : new Date(startTime.getTime() + duration * 60000);

  const session = await createScheduledSession({
    candidateId: candidate.candidateId,
    candidateName: candidate.candidateName,
    candidateEmail: candidate.candidateEmail,
    companyName: candidate.companyName,
    position: candidate.role || candidate.position || 'Software Developer',
    startTime,
    endTime,
    duration,
    skills: Array.isArray(candidate.techStack) ? candidate.techStack : (candidate.skills || []),
    experienceLevel: candidate.experience || 'intermediate',
    focusAreas: candidate.focusAreas || ['technical', 'problem-solving'],
    customQuestions: candidate.customQuestions || [],
    timeZone: candidate.timeZone || 'UTC',
    notes: candidate.notes || '',
    accessWindow: candidate.accessWindow || { beforeStart: 15, afterEnd: 15 }
  });

  const accessUrl = buildSecureUrl(session, session.accessToken);
  return {
    sessionId: session.sessionId,
    candidateId: session.candidateId,
    candidateName: session.candidateName,
    position: session.position,
    startTime: session.startTime,
    endTime: session.endTime,
    duration: session.duration,
    status: session.status,
    accessUrl,
    accessToken: session.accessToken
  };
}

router.post('/create-from-shortlisted', requireAdmin, async (req, res) => {
  try {
    const sessionData = await createFromCandidate(req.body || {});
    return res.status(201).json({
      success: true,
      message: 'Interview session created from shortlisted candidate',
      sessionData,
      candidateInfo: {
        name: req.body?.candidateName,
        email: req.body?.candidateEmail,
        role: req.body?.role,
        company: req.body?.companyName
      }
    });
  } catch (error) {
    console.error('Integration session creation failed:', error);
    return res.status(error.status || 400).json({ success: false, error: error.message });
  }
});

router.post('/batch-create', requireAdmin, async (req, res) => {
  try {
    const candidates = req.body?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ success: false, error: 'candidates must be a non-empty array' });
    }
    if (candidates.length > 50) {
      return res.status(400).json({ success: false, error: 'A maximum of 50 candidates can be processed at once' });
    }

    const successful = [];
    const failed = [];
    for (const candidate of candidates) {
      try {
        successful.push({
          candidateId: candidate.candidateId,
          candidateName: candidate.candidateName,
          sessionData: await createFromCandidate(candidate)
        });
      } catch (error) {
        failed.push({
          candidateId: candidate.candidateId,
          candidateName: candidate.candidateName,
          error: error.message
        });
      }
    }

    return res.json({
      success: failed.length === 0,
      message: `Processed ${candidates.length} candidate(s)`,
      results: { successful, failed },
      summary: {
        total: candidates.length,
        successful: successful.length,
        failed: failed.length
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to process batch session creation' });
  }
});

export default router;
