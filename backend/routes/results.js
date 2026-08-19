import express from 'express';
import { requireRoles } from '../utils/security.js';

const router = express.Router();
let interviewResultsCollection = null;
const canView = requireRoles('owner', 'admin', 'recruiter', 'reviewer');

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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function summary(doc) {
  return {
    fileName: doc.fileName || null,
    sessionId: doc.sessionId || null,
    candidateName: doc.candidateInfo?.name || doc.candidateName || null,
    candidateEmail: doc.candidateInfo?.email || doc.candidateEmail || null,
    position: doc.candidateInfo?.position || doc.position || null,
    date: doc.savedAt || doc.createdAt || null,
    duration: doc.interviewDetails?.duration || null,
    questionsAsked: doc.interviewDetails?.totalQuestions || 0,
    codingTestsCompleted: doc.interviewDetails?.codingTestsCompleted || 0,
    overallScore: doc.evaluation?.overallScore ?? doc.overallScore ?? doc.summary?.overallScore ?? null,
    recommendation: doc.evaluation?.recommendation ?? doc.recommendation ?? doc.summary?.recommendation ?? null
  };
}

function queryFromRequest(req) {
  const query = {};
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q) {
    const regex = new RegExp(escapeRegex(q), 'i');
    query.$or = [
      { sessionId: regex },
      { fileName: regex },
      { 'candidateInfo.name': regex },
      { 'candidateInfo.email': regex },
      { 'candidateInfo.position': regex },
      { candidateName: regex },
      { position: regex }
    ];
  }
  return query;
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet programs can execute cell formulas. Treat exported recruiter
  // data as text when a user-controlled value starts with a formula marker.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

router.get('/', canView, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const page = Math.max(1, Number(req.query.page) || 1);
    const query = queryFromRequest(req);

    const [docs, total] = await Promise.all([
      interviewResultsCollection.find(query).sort({ savedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      interviewResultsCollection.countDocuments(query)
    ]);

    return res.json({
      success: true,
      count: docs.length,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      results: docs.map(summary)
    });
  } catch (error) {
    console.error('Result listing failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch interview results' });
  }
});

router.get('/export.csv', canView, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const docs = await interviewResultsCollection.find(queryFromRequest(req)).sort({ savedAt: -1, createdAt: -1 }).limit(5000).toArray();
    const rows = [
      ['Candidate', 'Email', 'Position', 'Session ID', 'Date', 'Duration', 'Questions', 'Coding Tests', 'Score', 'Recommendation'],
      ...docs.map(doc => {
        const item = summary(doc);
        return [
          item.candidateName,
          item.candidateEmail,
          item.position,
          item.sessionId,
          item.date,
          item.duration,
          item.questionsAsked,
          item.codingTestsCompleted,
          item.overallScore,
          item.recommendation
        ];
      })
    ];
    const csv = `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="interview-results-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (error) {
    console.error('Result export failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to export interview results' });
  }
});

router.get('/:fileName', canView, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const fileName = String(req.params.fileName || '').slice(0, 300);
    const doc = await interviewResultsCollection.findOne({ fileName });
    if (!doc) return res.status(404).json({ success: false, error: 'Interview result not found' });
    return res.json({ success: true, data: doc });
  } catch (error) {
    console.error('Result fetch failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch interview result' });
  }
});

export default router;