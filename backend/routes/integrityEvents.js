import express from 'express';
import { appendScheduledIntegrityEvent } from '../utils/sessionScheduler.js';

const router = express.Router();
const ALLOWED_TYPES = new Set([
  'no_face',
  'multiple_faces',
  'face_state_restored',
  'restricted_object_detected',
  'restricted_object_cleared',
  'sustained_loud_audio',
  'audio_level_restored',
  'monitoring_unavailable'
]);
const MAX_EVENTS = 200;

function cleanDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const serialized = JSON.stringify(value);
  if (serialized.length > 4000) return { truncated: true };
  return JSON.parse(serialized);
}

async function persist(context, event) {
  if (context.type === 'scheduled') {
    const updated = await appendScheduledIntegrityEvent(context.session.sessionId, event, MAX_EVENTS);
    context.session.interviewData = updated?.interviewData || context.session.interviewData;
    return;
  }

  const data = context.session.interviewData || {};
  const events = Array.isArray(data.integrityEvents) ? data.integrityEvents.slice(-(MAX_EVENTS - 1)) : [];
  events.push(event);
  context.session.interviewData = { ...data, integrityEvents: events };
  context.session.markModified('interviewData.integrityEvents');
  await context.session.save();
}

router.post('/message/:sessionId', async (req, res, next) => {
  if (req.body?.messageType !== 'integrity_event') return next();
  try {
    const context = req.liveInterviewContext;
    if (!context) return res.status(500).json({ success: false, error: 'Validated interview context is missing' });
    const incoming = req.body?.integrityEvent || {};
    const type = String(incoming.type || '');
    if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ success: false, error: 'Unsupported integrity event type' });

    const observed = new Date(incoming.observedAt);
    const event = {
      type,
      details: cleanDetails(incoming.details),
      observedAt: Number.isNaN(observed.getTime()) ? new Date().toISOString() : observed.toISOString(),
      receivedAt: new Date().toISOString(),
      source: 'candidate_browser_monitor'
    };
    await persist(context, event);
    return res.json({ success: true, message: 'Integrity signal recorded' });
  } catch (error) {
    console.error('Integrity signal persistence failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to record integrity signal' });
  }
});

export default router;
