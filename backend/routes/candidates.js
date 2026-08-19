import express from 'express';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '../utils/security.js';

const router = express.Router();
let candidatesCollection = null;
let codeQuestionsCollection = null;

export function initializeCandidateRoutes(collections = {}) {
  candidatesCollection = collections.candidatesCollection || null;
  codeQuestionsCollection = collections.codeQuestionsCollection || null;
}

function requireDatabase(res) {
  if (!candidatesCollection) {
    res.status(503).json({ success: false, error: 'Candidate database is not configured' });
    return false;
  }
  return true;
}

function normalizedCandidate(body = {}) {
  const raw = body.rawProfile && typeof body.rawProfile === 'object' ? body.rawProfile : {};
  const candidateId = String(body.candidateId || raw.candidateId || raw.id || '').trim();
  const candidateName = String(body.candidateName || raw.candidateName || raw.name || '').trim();
  if (!candidateId || !candidateName) return null;

  const now = new Date().toISOString();
  return {
    ...raw,
    candidateId,
    candidateName,
    position: body.position || raw.position || raw.role || 'Software Developer',
    skills: Array.isArray(body.skills) ? body.skills : (Array.isArray(raw.skills) ? raw.skills : []),
    projectDetails: body.projectDetails ?? raw.projectDetails ?? '',
    customQuestions: Array.isArray(body.customQuestions)
      ? body.customQuestions
      : (Array.isArray(raw.customQuestions) ? raw.customQuestions : []),
    githubProjects: body.githubProjects ?? raw.githubProjects ?? '',
    experience: body.experience ?? raw.experience ?? '',
    education: body.education ?? raw.education ?? '',
    metadata: body.metadata ?? raw.metadata ?? {},
    createdAt: raw.createdAt || now,
    updatedAt: now
  };
}

router.post('/save', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const profile = normalizedCandidate(req.body);
    if (!profile) {
      return res.status(400).json({ success: false, error: 'candidateId and candidateName are required' });
    }

    await candidatesCollection.updateOne(
      { candidateId: profile.candidateId },
      { $set: profile },
      { upsert: true }
    );
    return res.json({ success: true, message: 'Candidate profile saved', candidateId: profile.candidateId });
  } catch (error) {
    console.error('Candidate save failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to save candidate profile' });
  }
});

router.post('/upload', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    let rawProfile = req.body?.rawProfile;

    if (!rawProfile && typeof req.body?.fileContent === 'string') {
      try { rawProfile = JSON.parse(req.body.fileContent); }
      catch { return res.status(400).json({ success: false, error: 'Invalid JSON in fileContent' }); }
    }

    if (!rawProfile && typeof req.body?.fileBase64 === 'string') {
      try {
        rawProfile = JSON.parse(Buffer.from(req.body.fileBase64, 'base64').toString('utf8'));
      } catch {
        return res.status(400).json({ success: false, error: 'Invalid base64 JSON in fileBase64' });
      }
    }

    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
      return res.status(400).json({ success: false, error: 'A candidate profile object is required' });
    }

    let candidateId = rawProfile.candidateId || rawProfile.id;
    if (!candidateId) candidateId = new ObjectId().toHexString();
    const profile = normalizedCandidate({
      candidateId,
      candidateName: rawProfile.candidateName || rawProfile.name || 'Candidate',
      rawProfile
    });

    await candidatesCollection.updateOne(
      { candidateId: profile.candidateId },
      { $set: profile },
      { upsert: true }
    );
    return res.json({ success: true, message: 'Candidate profile uploaded', candidateId: profile.candidateId });
  } catch (error) {
    console.error('Candidate upload failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload candidate profile' });
  }
});

router.get('/load/:candidateId', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const doc = await candidatesCollection.findOne({ candidateId: String(req.params.candidateId) });
    if (!doc) return res.status(404).json({ success: false, error: 'Candidate profile not found' });
    const { _id, ...profile } = doc;
    return res.json({ success: true, profile });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load candidate profile' });
  }
});

router.get('/list', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const docs = await candidatesCollection.find({}).sort({ updatedAt: -1 }).limit(500).toArray();
    return res.json({
      success: true,
      count: docs.length,
      candidates: docs.map(doc => ({
        candidateId: doc.candidateId,
        candidateName: doc.candidateName,
        position: doc.position,
        skills: doc.skills || [],
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to list candidate profiles' });
  }
});

router.delete('/delete/:candidateId', requireAdmin, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const candidateId = String(req.params.candidateId);
    const result = await candidatesCollection.deleteOne({ candidateId });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Candidate profile not found' });
    if (codeQuestionsCollection) await codeQuestionsCollection.deleteMany({ candidateId });
    return res.json({ success: true, message: 'Candidate profile deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to delete candidate profile' });
  }
});

router.get('/code-questions/:candidateId', requireAdmin, async (req, res) => {
  try {
    if (!codeQuestionsCollection) {
      return res.status(503).json({ success: false, error: 'Code question database is not configured' });
    }
    const doc = await codeQuestionsCollection.findOne({ candidateId: String(req.params.candidateId) });
    if (!doc?.tasks) return res.status(404).json({ success: false, error: 'Code questions not found' });
    return res.json({ success: true, tasks: doc.tasks });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load code questions' });
  }
});

export default router;
