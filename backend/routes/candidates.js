import express from 'express';
import { ObjectId } from 'mongodb';
import { requireRoles } from '../utils/security.js';

const router = express.Router();
let candidatesCollection = null;
let codeQuestionsCollection = null;

const canManage = requireRoles('owner', 'admin', 'recruiter');
const canView = requireRoles('owner', 'admin', 'recruiter', 'reviewer');

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

function text(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeSkills(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => text(item, 80)).filter(Boolean))].slice(0, 50);
}

function normalizedCandidate(body = {}) {
  const raw = body.rawProfile && typeof body.rawProfile === 'object' && !Array.isArray(body.rawProfile)
    ? body.rawProfile
    : {};
  const candidateId = text(body.candidateId || raw.candidateId || raw.id, 160);
  const candidateName = text(body.candidateName || raw.candidateName || raw.name, 160);
  if (!candidateId || !candidateName) return null;

  const candidateEmail = text(body.candidateEmail || raw.candidateEmail || raw.email, 254).toLowerCase();
  if (candidateEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidateEmail)) {
    return { validationError: 'Candidate email is invalid' };
  }

  const bodySkills = Array.isArray(body.skills) ? body.skills : raw.skills;
  const bodyQuestions = Array.isArray(body.customQuestions) ? body.customQuestions : raw.customQuestions;

  return {
    candidateId,
    candidateName,
    candidateEmail: candidateEmail || null,
    phoneNumber: text(body.phoneNumber || raw.phoneNumber || raw.phone, 60) || null,
    position: text(body.position || raw.position || raw.role || 'Software Developer', 160) || 'Software Developer',
    skills: normalizeSkills(bodySkills),
    projectDetails: text(body.projectDetails ?? raw.projectDetails, 20000),
    customQuestions: Array.isArray(bodyQuestions)
      ? bodyQuestions.map(question => text(question, 2000)).filter(Boolean).slice(0, 30)
      : [],
    githubProjects: text(body.githubProjects ?? raw.githubProjects, 10000),
    experience: text(body.experience ?? raw.experience, 5000),
    education: text(body.education ?? raw.education, 5000),
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {}),
    updatedAt: new Date().toISOString()
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function saveProfile(profile) {
  const createdAt = new Date().toISOString();
  await candidatesCollection.updateOne(
    { candidateId: profile.candidateId },
    {
      $set: profile,
      $setOnInsert: { createdAt }
    },
    { upsert: true }
  );
}

router.post('/save', canManage, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const profile = normalizedCandidate(req.body);
    if (!profile) {
      return res.status(400).json({ success: false, error: 'candidateId and candidateName are required' });
    }
    if (profile.validationError) {
      return res.status(400).json({ success: false, error: profile.validationError });
    }

    await saveProfile(profile);
    return res.json({ success: true, message: 'Candidate profile saved', candidateId: profile.candidateId });
  } catch (error) {
    console.error('Candidate save failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to save candidate profile' });
  }
});

router.post('/upload', canManage, async (req, res) => {
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
    if (!profile || profile.validationError) {
      return res.status(400).json({ success: false, error: profile?.validationError || 'Invalid candidate profile' });
    }

    await saveProfile(profile);
    return res.json({ success: true, message: 'Candidate profile uploaded', candidateId: profile.candidateId });
  } catch (error) {
    console.error('Candidate upload failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to upload candidate profile' });
  }
});

router.get('/load/:candidateId', canView, async (req, res) => {
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

router.get('/list', canView, async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = String(req.query.q || '').trim().slice(0, 200);
    const query = {};

    if (q) {
      const regex = new RegExp(escapeRegex(q), 'i');
      query.$or = [
        { candidateId: regex },
        { candidateName: regex },
        { candidateEmail: regex },
        { position: regex },
        { skills: regex }
      ];
    }

    const [docs, total] = await Promise.all([
      candidatesCollection.find(query).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
      candidatesCollection.countDocuments(query)
    ]);

    return res.json({
      success: true,
      count: docs.length,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      candidates: docs.map(doc => ({
        candidateId: doc.candidateId,
        candidateName: doc.candidateName,
        candidateEmail: doc.candidateEmail || null,
        phoneNumber: doc.phoneNumber || null,
        position: doc.position,
        skills: doc.skills || [],
        experience: doc.experience || '',
        education: doc.education || '',
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt
      }))
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to list candidate profiles' });
  }
});

router.delete('/delete/:candidateId', canManage, async (req, res) => {
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

router.get('/code-questions/:candidateId', canView, async (req, res) => {
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