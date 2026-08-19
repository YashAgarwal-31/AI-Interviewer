import express from 'express';
import { requireAdmin } from '../utils/security.js';

const router = express.Router();
let interviewResultsCollection = null;

export function initializeResultRoutes(collections = {}) {
  interviewResultsCollection = collections.interviewResultsCollection || null;
}

function requireDatabase(res) {
  if (!interviewResultsCollection) {
    res.status(503).json({ success: false, error: 'Interview result database is not configured' });
    return false;
  }
  return true;
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const docs = await interviewResultsCollection.find({}).sort({ savedAt: -1 }).limit(limit).toArray();
    return res.json({
      success: true,
      count: docs.length,
      results: docs.map(doc => ({
        fileName: doc.fileName || null,
        sessionId: doc.sessionId || null,
        candidateName: doc.candidateInfo?.name || null,
        position: doc.candidateInfo?.position || null,
        date: doc.savedAt || doc.createdAt || null,
        duration: doc.interviewDetails?.duration || null,
        questionsAsked: doc.interviewDetails?.totalQuestions || 0,
        codingTestsCompleted: doc.interviewDetails?.codingTestsCompleted || 0
      }))
    });
  } catch (error) {
    console.error('Result listing failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch interview results' });
  }
});

router.get('/:fileName', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const doc = await interviewResultsCollection.findOne({ fileName: req.params.fileName });
    if (!doc) return res.status(404).json({ success: false, error: 'Interview result not found' });
    return res.json({ success: true, data: doc });
  } catch (error) {
    console.error('Result fetch failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch interview result' });
  }
});

export default router;
