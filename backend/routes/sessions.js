import express from 'express';
import { ObjectId } from 'mongodb';
import InterviewSession from '../models/InterviewSession.js';
import {
  generateAccessToken,
  hashAccessToken,
  isDemoEnabled,
  requireAdmin,
  verifyAccessToken
} from '../utils/security.js';
import {
  completeSession as completeScheduledSession,
  getScheduledSessionByCandidate,
  getScheduledSessionById,
  incrementAccessAttempts as incrementScheduledAccessAttempts,
  patchScheduledSession,
  resetAccessAttempts as resetScheduledAccessAttempts,
  startSession as startScheduledSession,
  updateSessionStatus,
  validateSessionTiming,
  verifyScheduledAccessToken
} from '../utils/sessionScheduler.js';

const router = express.Router();

let openai = null;
let candidatesCollection = null;
let codeQuestionsCollection = null;
let interviewResultsCollection = null;
const demoSessions = new Map();

export function initializeSessionRoutes(collections = {}, openaiInstance = null) {
  candidatesCollection = collections.candidatesCollection || null;
  codeQuestionsCollection = collections.codeQuestionsCollection || null;
  interviewResultsCollection = collections.interviewResultsCollection || null;
  openai = openaiInstance;
}

const frontendBaseUrl = () => (
  process.env.PRODUCTION_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173'
).replace(/\/$/, '');

const buildAccessUrl = ({ candidateId, sessionId, accessToken }) => {
  const params = new URLSearchParams({
    candidateId: String(candidateId),
    sessionId: String(sessionId),
    accessToken: String(accessToken)
  });
  return `${frontendBaseUrl()}/?${params.toString()}`;
};

function defaultQuestions() {
  return [
    'Tell me about a project you are most proud of and the most important technical decision you made.',
    'Describe how you debug a production issue when the root cause is not obvious.',
    'Explain the time and space complexity of a recent algorithm you implemented.',
    'How would you design a REST API for a task management application?',
    'When would you choose SQL over NoSQL, and why?',
    'Explain how asynchronous code executes in JavaScript.'
  ];
}

function defaultCodingTasks() {
  return [{
    id: 'sum-array',
    title: 'Sum of Array',
    description: 'Write a function `sumArray(arr)` that returns the sum of numeric elements in an array.',
    languageHints: ['javascript', 'python'],
    exampleInputOutput: { input: '[1,2,3]', output: '6' },
    tests: ['sumArray([1,2,3]) === 6', 'sumArray([-1,1]) === 0']
  }];
}

async function loadCandidateProfile(candidateId) {
  if (!candidatesCollection || !candidateId) return null;
  try {
    const candidateIdString = String(candidateId);
    let doc = await candidatesCollection.findOne({ candidateId: candidateIdString });
    if (!doc && ObjectId.isValid(candidateIdString)) {
      doc = await candidatesCollection.findOne({ _id: new ObjectId(candidateIdString) });
    }
    if (!doc) return null;
    const { _id, ...profile } = doc;
    return profile;
  } catch (error) {
    console.warn('Unable to load candidate profile:', error.message);
    return null;
  }
}

async function generateQuestions(profile) {
  if (Array.isArray(profile?.customQuestions) && profile.customQuestions.length) {
    return profile.customQuestions.slice(0, 12);
  }
  if (!openai) return defaultQuestions();

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_INTERVIEW_MODEL || 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You write concise, practical technical interview questions. Return only a JSON array of strings.'
        },
        {
          role: 'user',
          content: `Create 6-10 interview questions for this candidate. Include project depth, fundamentals, one architecture question, and one coding-oriented question.\n\nName: ${profile?.candidateName || 'Candidate'}\nRole: ${profile?.position || profile?.role || 'Software Developer'}\nSkills: ${Array.isArray(profile?.skills) ? profile.skills.join(', ') : (profile?.skills || 'Not provided')}\nExperience: ${profile?.experience || 'Not provided'}\nProjects: ${profile?.projectDetails || profile?.githubProjects || 'Not provided'}`
        }
      ],
      temperature: 0.4,
      max_tokens: 900
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.filter(item => typeof item === 'string' && item.trim()).slice(0, 12);
    }
  } catch (error) {
    console.warn('AI question generation failed, using defaults:', error.message);
  }
  return defaultQuestions();
}

async function loadOrGenerateCodingTasks(candidateId, profile) {
  if (codeQuestionsCollection && candidateId) {
    try {
      const existing = await codeQuestionsCollection.findOne({ candidateId: String(candidateId) });
      if (Array.isArray(existing?.tasks) && existing.tasks.length) return existing.tasks;
    } catch (error) {
      console.warn('Unable to load stored coding tasks:', error.message);
    }
  }

  if (Array.isArray(profile?.codingAssessment?.questions) && profile.codingAssessment.questions.length) {
    const tasks = profile.codingAssessment.questions.slice(0, 3).map((question, index) => ({
      id: question.id || `task-${index + 1}`,
      title: question.title || `Coding Task ${index + 1}`,
      description: [question.prompt, question.signature].filter(Boolean).join('\n\n'),
      languageHints: question.language ? [question.language] : (question.languageHints || []),
      exampleInputOutput: Array.isArray(question.sampleTests) && question.sampleTests[0]
        ? { input: question.sampleTests[0].input, output: question.sampleTests[0].expected }
        : null,
      tests: [
        ...(question.sampleTests || []).map((test, i) => `sample-${i + 1}: input=${JSON.stringify(test.input)} expected=${JSON.stringify(test.expected)}`),
        ...(question.hiddenTests || []).map((test, i) => `hidden-${i + 1}: input=${JSON.stringify(test.input)} expected=${JSON.stringify(test.expected)}`)
      ]
    }));
    return tasks;
  }

  let tasks = null;
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_INTERVIEW_MODEL || 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'Write practical coding interview exercises. Return only valid JSON.'
          },
          {
            role: 'user',
            content: `Return a JSON array with 1-2 coding tasks. Each object must contain id, title, description, languageHints (array), exampleInputOutput (optional), and tests (array of strings).\n\nRole: ${profile?.position || profile?.role || 'Software Developer'}\nSkills: ${Array.isArray(profile?.skills) ? profile.skills.join(', ') : (profile?.skills || 'Not provided')}\nExperience: ${profile?.experience || 'Not provided'}`
          }
        ],
        temperature: 0.4,
        max_tokens: 1000
      });
      const raw = completion.choices?.[0]?.message?.content?.trim() || '';
      const parsed = JSON.parse(raw.replace(/```json\n?/gi, '').replace(/```/g, '').trim());
      if (Array.isArray(parsed) && parsed.length) tasks = parsed.slice(0, 3);
    } catch (error) {
      console.warn('AI coding task generation failed, using defaults:', error.message);
    }
  }

  tasks = tasks || defaultCodingTasks();
  if (codeQuestionsCollection && candidateId) {
    try {
      await codeQuestionsCollection.updateOne(
        { candidateId: String(candidateId) },
        { $set: { candidateId: String(candidateId), tasks, updatedAt: new Date().toISOString() } },
        { upsert: true }
      );
    } catch (error) {
      console.warn('Unable to persist generated coding tasks:', error.message);
    }
  }
  return tasks;
}

function buildSystemPrompt(profile, questions, codingTasks) {
  const candidateName = profile?.candidateName || 'Candidate';
  const position = profile?.position || profile?.role || 'Software Developer';
  const skills = Array.isArray(profile?.skills)
    ? profile.skills.join(', ')
    : (Array.isArray(profile?.techStack) ? profile.techStack.join(', ') : (profile?.skills || 'Not provided'));
  const projectDetails = profile?.projectDetails || profile?.githubProjects || '';

  return `You are conducting a professional technical interview for a ${position} role.\n\nCandidate: ${candidateName}\nSkills: ${skills}${projectDetails ? `\nProjects: ${projectDetails}` : ''}\n\nInterview rules:\n- Ask one clear question at a time.\n- Start with background, then move into technical depth.\n- Ask follow-ups based on the candidate's actual answer.\n- Adapt difficulty gradually.\n- Evaluate reasoning, trade-offs, correctness, and communication.\n- Keep spoken responses concise.\n- Do not reveal hidden tests or expected solutions.\n\nPriority questions:\n${questions.map((question, i) => `${i + 1}. ${question}`).join('\n')}\n\nCoding tasks available to the editor:\n${codingTasks.map((task, i) => `${i + 1}. ${task.title}: ${task.description}`).join('\n')}\n\nWhen starting a coding exercise, name one of the listed coding tasks clearly. Once coding starts, pause normal questioning until a submission arrives. After submission, evaluate the approach and ask a concise follow-up.`;
}

function sessionProfile(session, type) {
  if (type === 'scheduled') {
    return {
      candidateName: session.candidateName,
      candidateEmail: session.candidateEmail,
      companyName: session.companyName,
      position: session.position,
      role: session.position,
      skills: session.interviewConfig?.skills || [],
      experience: session.interviewConfig?.experienceLevel || ''
    };
  }
  if (type === 'demo') return session.profile;
  return {
    candidateName: session.candidateDetails?.candidateName,
    candidateEmail: session.candidateDetails?.candidateEmail,
    companyName: session.candidateDetails?.companyName,
    position: session.candidateDetails?.role,
    role: session.candidateDetails?.role,
    skills: session.candidateDetails?.techStack || [],
    experience: session.candidateDetails?.experience || ''
  };
}

async function prepareInterviewData(session, type) {
  const existing = session.interviewData;
  if (existing?.systemPrompt && Array.isArray(existing?.interviewQuestions) && existing.interviewQuestions.length) {
    return existing;
  }

  const candidateId = type === 'legacy' ? String(session.candidateId) : String(session.candidateId || 'demo');
  const fallback = sessionProfile(session, type);
  const storedProfile = type === 'demo' ? null : await loadCandidateProfile(candidateId);
  const profile = { ...fallback, ...(storedProfile || {}) };
  const interviewQuestions = await generateQuestions(profile);
  const codingTasks = type === 'demo'
    ? defaultCodingTasks()
    : await loadOrGenerateCodingTasks(candidateId, profile);

  return {
    candidateProfile: profile,
    interviewQuestions,
    codingTasks,
    systemPrompt: buildSystemPrompt(profile, interviewQuestions, codingTasks),
    conversationHistory: Array.isArray(existing?.conversationHistory) ? existing.conversationHistory : [],
    metadata: {
      ...(existing?.metadata || {}),
      dataLoadedAt: new Date().toISOString(),
      dataSource: storedProfile ? 'database' : 'session'
    },
    results: existing?.results || undefined
  };
}

async function findLegacyBySessionId(sessionId) {
  return InterviewSession.findOne({ sessionId })
    .select('+security.accessToken +security.accessTokenHash');
}

async function findLegacyByCandidate(candidateId) {
  if (!ObjectId.isValid(String(candidateId))) return null;
  return InterviewSession.findOne({
    candidateId: new ObjectId(String(candidateId)),
    sessionStatus: { $in: ['scheduled', 'active'] }
  })
    .sort({ 'sessionConfig.scheduledStartTime': -1 })
    .select('+security.accessToken +security.accessTokenHash');
}

async function getSessionById(sessionId) {
  const demo = demoSessions.get(String(sessionId));
  if (demo) return { type: 'demo', session: demo };

  try {
    const scheduled = await getScheduledSessionById(sessionId);
    if (scheduled) return { type: 'scheduled', session: scheduled };
  } catch (error) {
    // Scheduler may be unavailable when MongoDB is not configured in local demo mode.
  }

  const legacy = await findLegacyBySessionId(sessionId);
  return legacy ? { type: 'legacy', session: legacy } : null;
}

function verifySessionToken(context, token) {
  if (!context || !token) return false;
  if (context.type === 'scheduled') return verifyScheduledAccessToken(context.session, token);
  return verifyAccessToken(context.session, token);
}

function legacyTiming(session) {
  const now = new Date();
  const start = new Date(session.sessionConfig.scheduledStartTime);
  const end = new Date(session.sessionConfig.scheduledEndTime);
  const before = Number(session.sessionConfig.accessWindow?.beforeStart || 0);
  const after = Number(session.sessionConfig.accessWindow?.afterEnd || 0);
  const accessStart = new Date(start.getTime() - before * 60000);
  const accessEnd = new Date(end.getTime() + after * 60000);

  return {
    isValid: now >= accessStart && now <= accessEnd && ['scheduled', 'active'].includes(session.sessionStatus),
    tooEarly: now < accessStart,
    expired: now > accessEnd,
    accessStart,
    accessEnd,
    timeToStart: Math.max(0, Math.ceil((start - now) / 60000)),
    timeToEnd: Math.max(0, Math.ceil((end - now) / 60000))
  };
}

async function persistInterviewData(context, interviewData) {
  if (context.type === 'scheduled') {
    await patchScheduledSession(context.session.sessionId, { interviewData });
    context.session.interviewData = interviewData;
    return;
  }
  if (context.type === 'demo') {
    context.session.interviewData = interviewData;
    demoSessions.set(context.session.sessionId, context.session);
    return;
  }

  context.session.interviewData = interviewData;
  context.session.markModified('interviewData');
  await context.session.save();
}

function publicSession(context, accessToken, timing = null) {
  const { type, session } = context;
  const profile = sessionProfile(session, type);

  if (type === 'scheduled') {
    return {
      sessionId: session.sessionId,
      candidateId: session.candidateId,
      candidateName: profile.candidateName,
      companyName: profile.companyName,
      position: profile.position,
      role: profile.position,
      skills: session.interviewConfig?.skills || [],
      status: session.status,
      isScheduled: true,
      startTime: session.startTime,
      endTime: session.endTime,
      scheduledStartTime: session.startTime,
      scheduledEndTime: session.endTime,
      duration: session.duration,
      timeRemaining: timing?.timeToEnd ?? null,
      accessToken
    };
  }

  if (type === 'demo') {
    return {
      sessionId: session.sessionId,
      candidateId: session.candidateId,
      candidateName: profile.candidateName,
      companyName: profile.companyName,
      position: profile.position,
      role: profile.position,
      skills: profile.skills || [],
      status: session.status,
      isScheduled: false,
      duration: 60,
      timeRemaining: 60,
      accessToken
    };
  }

  return {
    sessionId: session.sessionId,
    candidateId: String(session.candidateId),
    candidateName: profile.candidateName,
    companyName: profile.companyName,
    position: profile.position,
    role: profile.position,
    skills: profile.skills || [],
    status: session.sessionStatus,
    isScheduled: true,
    startTime: session.sessionConfig.scheduledStartTime,
    endTime: session.sessionConfig.scheduledEndTime,
    scheduledStartTime: session.sessionConfig.scheduledStartTime,
    scheduledEndTime: session.sessionConfig.scheduledEndTime,
    duration: session.sessionConfig.duration,
    timeRemaining: timing?.timeToEnd ?? null,
    accessToken
  };
}

async function activateAndValidate(context) {
  if (context.type === 'scheduled') {
    const validation = validateSessionTiming(context.session);
    if (!validation.isValid) {
      if (validation.shouldExpire) await updateSessionStatus(context.session.sessionId, 'expired');
      return { ok: false, validation };
    }
    if (context.session.status === 'scheduled') {
      context.session = await startScheduledSession(context.session.sessionId);
    }
    await resetScheduledAccessAttempts(context.session.sessionId);
    return { ok: true, timing: validation };
  }

  if (context.type === 'demo') return { ok: true, timing: { timeToEnd: 60 } };

  const timing = legacyTiming(context.session);
  if (!timing.isValid) {
    if (timing.expired && !['completed', 'cancelled', 'expired'].includes(context.session.sessionStatus)) {
      context.session.sessionStatus = 'expired';
      context.session.accessControl.isActive = false;
      await context.session.save();
    }
    return { ok: false, validation: { ...timing, reason: timing.tooEarly ? 'Interview session is not accessible yet' : 'Interview session has expired' } };
  }
  if (context.session.sessionStatus === 'scheduled') await context.session.activateSession();
  context.session.security.loginAttempts = 0;
  await context.session.save();
  return { ok: true, timing };
}

async function authorizedContextById(sessionId, accessToken) {
  const context = await getSessionById(sessionId);
  if (!context) return { error: { status: 404, message: 'Session not found' } };
  if (!verifySessionToken(context, accessToken)) {
    if (context.type === 'scheduled') {
      await incrementScheduledAccessAttempts(context.session.sessionId);
    } else if (context.type === 'legacy') {
      context.session.security.loginAttempts = (context.session.security.loginAttempts || 0) + 1;
      context.session.security.lastLoginAttempt = new Date();
      await context.session.save();
    }
    return { error: { status: 401, message: 'Invalid interview access token' } };
  }
  return { context };
}

async function createLegacySession(payload) {
  const {
    candidateId,
    applicationId,
    jobId,
    recruiterId,
    candidateDetails = {},
    scheduledDate,
    scheduledTime,
    duration = 60,
    timeZone = 'UTC',
    accessWindow = { beforeStart: 15, afterEnd: 15 }
  } = payload;

  const objectIds = { candidateId, applicationId, jobId, recruiterId };
  for (const [name, value] of Object.entries(objectIds)) {
    if (!ObjectId.isValid(String(value))) throw new Error(`${name} must be a valid MongoDB ObjectId`);
  }
  if (!candidateDetails.candidateName && !candidateDetails.name) throw new Error('candidate name is required');
  if (!candidateDetails.candidateEmail && !candidateDetails.email) throw new Error('candidate email is required');
  if (!scheduledDate || !scheduledTime) throw new Error('scheduledDate and scheduledTime are required');

  const scheduledStartTime = new Date(`${scheduledDate}T${scheduledTime}`);
  if (Number.isNaN(scheduledStartTime.getTime())) throw new Error('Invalid scheduled date/time');
  const durationMinutes = Math.max(1, Number(duration) || 60);
  const scheduledEndTime = new Date(scheduledStartTime.getTime() + durationMinutes * 60000);

  const existing = await InterviewSession.findOne({
    candidateId: new ObjectId(String(candidateId)),
    jobId: new ObjectId(String(jobId)),
    sessionStatus: { $in: ['scheduled', 'active'] }
  });
  if (existing) {
    const conflict = new Error('Active session already exists for this candidate and job');
    conflict.status = 409;
    conflict.existingSessionId = existing.sessionId;
    throw conflict;
  }

  const accessToken = generateAccessToken();
  const session = new InterviewSession({
    sessionId: `interview_${cryptoRandomId()}`,
    candidateId: new ObjectId(String(candidateId)),
    applicationId: new ObjectId(String(applicationId)),
    jobId: new ObjectId(String(jobId)),
    recruiterId: new ObjectId(String(recruiterId)),
    candidateDetails: {
      candidateName: candidateDetails.candidateName || candidateDetails.name,
      candidateEmail: candidateDetails.candidateEmail || candidateDetails.email,
      phoneNumber: candidateDetails.phoneNumber || candidateDetails.phone,
      companyName: candidateDetails.companyName || '',
      role: candidateDetails.role || 'Software Developer',
      techStack: Array.isArray(candidateDetails.techStack) ? candidateDetails.techStack : [],
      experience: candidateDetails.experience || ''
    },
    sessionConfig: {
      scheduledStartTime,
      scheduledEndTime,
      timeZone,
      duration: durationMinutes,
      accessWindow
    },
    security: {
      accessTokenHash: hashAccessToken(accessToken),
      loginAttempts: 0,
      maxLoginAttempts: 5
    },
    sessionStatus: 'scheduled'
  });
  await session.save();

  return { session, accessToken };
}

function cryptoRandomId() {
  return `${Date.now()}_${generateAccessToken().slice(0, 16)}`;
}

router.post('/create', requireAdmin, async (req, res) => {
  try {
    const { session, accessToken } = await createLegacySession(req.body || {});
    return res.status(201).json({
      success: true,
      message: 'Interview session created successfully',
      sessionId: session.sessionId,
      accessToken,
      sessionDetails: {
        scheduledStartTime: session.sessionConfig.scheduledStartTime,
        scheduledEndTime: session.sessionConfig.scheduledEndTime,
        duration: session.sessionConfig.duration,
        accessWindow: session.sessionConfig.accessWindow
      },
      accessUrl: buildAccessUrl({ candidateId: session.candidateId, sessionId: session.sessionId, accessToken })
    });
  } catch (error) {
    console.error('Error creating interview session:', error);
    return res.status(error.status || 400).json({
      success: false,
      error: error.message || 'Failed to create interview session',
      existingSessionId: error.existingSessionId || undefined
    });
  }
});

router.post('/create-from-shortlisted', requireAdmin, async (req, res) => {
  try {
    const { shortlistedCandidateId, ...rest } = req.body || {};
    const { session, accessToken } = await createLegacySession({
      ...rest,
      candidateId: shortlistedCandidateId,
      candidateDetails: {
        candidateName: rest.candidateName,
        candidateEmail: rest.candidateEmail,
        phoneNumber: rest.phoneNumber,
        companyName: rest.companyName,
        role: rest.role,
        techStack: rest.techStack || [],
        experience: rest.experience
      }
    });
    return res.status(201).json({
      success: true,
      sessionId: session.sessionId,
      accessToken,
      accessUrl: buildAccessUrl({ candidateId: session.candidateId, sessionId: session.sessionId, accessToken })
    });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, error: error.message });
  }
});

router.post('/access', async (req, res) => {
  try {
    const { sessionId, accessToken } = req.body || {};
    if (!sessionId || !accessToken) {
      return res.status(400).json({ success: false, error: 'sessionId and accessToken are required' });
    }

    const auth = await authorizedContextById(sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    const validation = await activateAndValidate(auth.context);
    if (!validation.ok) {
      return res.status(403).json({
        success: false,
        error: validation.validation.reason || 'Session is not accessible',
        accessibleFrom: validation.validation.accessStart,
        timeUntilAccess: validation.validation.timeToStart
      });
    }

    const interviewData = await prepareInterviewData(auth.context.session, auth.context.type);
    await persistInterviewData(auth.context, interviewData);

    return res.json({
      success: true,
      message: 'Session access granted',
      session: publicSession(auth.context, accessToken, validation.timing),
      interviewData
    });
  } catch (error) {
    console.error('Error accessing interview session:', error);
    return res.status(500).json({ success: false, error: 'Failed to access session' });
  }
});

router.post('/access-by-candidate', async (req, res) => {
  try {
    const { candidateId, accessToken } = req.body || {};
    if (!candidateId || !accessToken) {
      return res.status(400).json({
        success: false,
        error: 'candidateId and accessToken are required. Use the secure interview link from your invitation.'
      });
    }

    let context = null;
    try {
      const scheduled = await getScheduledSessionByCandidate(candidateId);
      if (scheduled) context = { type: 'scheduled', session: scheduled };
    } catch (error) {
      // Fall through to legacy lookup for local environments without scheduler initialization.
    }

    if (!context) {
      const legacy = await findLegacyByCandidate(candidateId);
      if (legacy) context = { type: 'legacy', session: legacy };
    }

    if (!context) return res.status(404).json({ success: false, error: 'No active interview session found' });
    if (!verifySessionToken(context, accessToken)) {
      if (context.type === 'scheduled') await incrementScheduledAccessAttempts(context.session.sessionId);
      else {
        context.session.security.loginAttempts = (context.session.security.loginAttempts || 0) + 1;
        context.session.security.lastLoginAttempt = new Date();
        await context.session.save();
      }
      return res.status(401).json({ success: false, error: 'Invalid interview access token' });
    }

    const validation = await activateAndValidate(context);
    if (!validation.ok) {
      return res.status(403).json({
        success: false,
        error: validation.validation.reason || 'Session is not accessible',
        message: validation.validation.reason || 'Session is not accessible',
        sessionInfo: {
          candidateName: sessionProfile(context.session, context.type).candidateName,
          role: sessionProfile(context.session, context.type).position,
          companyName: sessionProfile(context.session, context.type).companyName,
          scheduledStartTime: context.type === 'scheduled' ? context.session.startTime : context.session.sessionConfig.scheduledStartTime,
          accessibleFrom: validation.validation.accessStart,
          timeUntilAccess: validation.validation.timeToStart
        }
      });
    }

    const interviewData = await prepareInterviewData(context.session, context.type);
    await persistInterviewData(context, interviewData);

    return res.json({
      success: true,
      message: 'Session access granted',
      sessionType: context.type,
      session: publicSession(context, accessToken, validation.timing),
      interviewData,
      accessUrl: buildAccessUrl({ candidateId, sessionId: context.session.sessionId, accessToken })
    });
  } catch (error) {
    console.error('Error accessing session by candidate:', error);
    return res.status(500).json({ success: false, error: 'Failed to access session' });
  }
});

router.get('/status/:sessionId', async (req, res) => {
  try {
    const accessToken = req.query.token || req.get('x-interview-token');
    if (!accessToken) return res.status(400).json({ success: false, error: 'Interview access token is required' });

    const auth = await authorizedContextById(req.params.sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    let timing;
    if (auth.context.type === 'scheduled') timing = validateSessionTiming(auth.context.session);
    else if (auth.context.type === 'legacy') timing = legacyTiming(auth.context.session);
    else timing = { isValid: true, timeToStart: 0, timeToEnd: 60 };

    return res.json({
      success: true,
      status: {
        ...publicSession(auth.context, null, timing),
        isAccessible: Boolean(timing.isValid)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to get session status' });
  }
});

router.post('/initialize-interview/:sessionId', async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    const auth = await authorizedContextById(req.params.sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    const validation = await activateAndValidate(auth.context);
    if (!validation.ok) return res.status(403).json({ success: false, error: validation.validation.reason });

    const interviewData = await prepareInterviewData(auth.context.session, auth.context.type);
    let initialMessage = interviewData.conversationHistory?.find(message => message.role === 'assistant')?.content;

    if (!interviewData.metadata?.interviewStarted || !initialMessage) {
      const profile = interviewData.candidateProfile || sessionProfile(auth.context.session, auth.context.type);
      initialMessage = `Hello ${profile.candidateName || 'there'}! Welcome to your technical interview for the ${profile.position || profile.role || 'position'} role. Let's start with: Can you tell me about yourself and your technical background?`;
      interviewData.conversationHistory = [
        { role: 'system', content: interviewData.systemPrompt, timestamp: new Date() },
        { role: 'assistant', content: initialMessage, timestamp: new Date() }
      ];
      interviewData.metadata = {
        ...(interviewData.metadata || {}),
        interviewStarted: true,
        startTime: interviewData.metadata?.startTime || new Date(),
        questionsAsked: interviewData.metadata?.questionsAsked || 1,
        answersReceived: interviewData.metadata?.answersReceived || 0,
        codingTestsCompleted: interviewData.metadata?.codingTestsCompleted || 0,
        awaitingCodingSubmission: false
      };
      await persistInterviewData(auth.context, interviewData);
    }

    return res.json({
      success: true,
      message: 'Interview session initialized',
      sessionId: auth.context.session.sessionId,
      initialMessage,
      sessionInfo: publicSession(auth.context, accessToken, validation.timing),
      interviewData
    });
  } catch (error) {
    console.error('Error initializing interview:', error);
    return res.status(500).json({ success: false, error: 'Failed to initialize interview session' });
  }
});

async function generateAiReply(interviewData) {
  if (!openai) {
    return 'Thanks for your answer. Could you explain the reasoning behind your approach and one trade-off you considered?';
  }

  const messages = [
    { role: 'system', content: interviewData.systemPrompt },
    ...(interviewData.conversationHistory || [])
      .filter(message => message.role !== 'system')
      .slice(-12)
      .map(message => ({ role: message.role, content: message.content }))
  ];

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_INTERVIEW_MODEL || 'gpt-4.1-mini',
    messages,
    temperature: 0.6,
    max_tokens: 500
  });
  return completion.choices?.[0]?.message?.content?.trim()
    || 'Thanks. Let’s continue with the next question.';
}

router.post('/message/:sessionId', async (req, res) => {
  try {
    const { message, accessToken, messageType = 'answer', codeResult = null } = req.body || {};
    if (!accessToken || (!message && messageType !== 'code_result')) {
      return res.status(400).json({ success: false, error: 'message and accessToken are required' });
    }

    const auth = await authorizedContextById(req.params.sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    const interviewData = await prepareInterviewData(auth.context.session, auth.context.type);
    interviewData.conversationHistory = Array.isArray(interviewData.conversationHistory)
      ? interviewData.conversationHistory
      : [];
    interviewData.metadata = interviewData.metadata || {};

    if (messageType === 'system') {
      interviewData.metadata.awaitingCodingSubmission = true;
      interviewData.metadata.codingStartedAt = new Date();
      await persistInterviewData(auth.context, interviewData);
      return res.json({ success: true, message: 'Coding exercise started. The interviewer will wait for the submission.', paused: true });
    }

    if (interviewData.metadata.awaitingCodingSubmission && messageType !== 'code_result') {
      return res.json({
        success: true,
        message: 'I’ll wait while you complete the coding exercise. Submit it in the editor when you are ready.',
        paused: true
      });
    }

    let userContent = String(message || '').trim();
    if (messageType === 'code_result') {
      const code = String(codeResult?.code || '').slice(0, 6000);
      const resultSummary = String(codeResult?.result || codeResult?.output || '').slice(0, 1500);
      userContent = `Candidate submitted the coding exercise.${codeResult?.language ? ` Language: ${codeResult.language}.` : ''}${resultSummary ? ` Result: ${resultSummary}` : ''}${code ? `\nCandidate code:\n${code}` : ''}`;
      interviewData.metadata.awaitingCodingSubmission = false;
      interviewData.metadata.codingTestsCompleted = (interviewData.metadata.codingTestsCompleted || 0) + 1;
    }

    interviewData.conversationHistory.push({ role: 'user', content: userContent, timestamp: new Date() });
    interviewData.metadata.answersReceived = (interviewData.metadata.answersReceived || 0) + 1;

    let aiResponse;
    try {
      aiResponse = await generateAiReply(interviewData);
    } catch (error) {
      console.error('AI response error:', error);
      aiResponse = 'Thanks for your answer. I had a temporary AI-service issue, so let’s continue with your reasoning and the trade-offs you considered.';
    }

    interviewData.conversationHistory.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
    interviewData.metadata.questionsAsked = (interviewData.metadata.questionsAsked || 0) + 1;
    interviewData.metadata.lastMessageAt = new Date();
    await persistInterviewData(auth.context, interviewData);

    return res.json({
      success: true,
      message: aiResponse,
      aiResponse,
      response: aiResponse,
      conversationId: interviewData.conversationHistory.length,
      metadata: {
        timestamp: new Date(),
        messageCount: interviewData.conversationHistory.length
      }
    });
  } catch (error) {
    console.error('Error processing interview message:', error);
    return res.status(500).json({ success: false, error: 'Failed to process message' });
  }
});

router.get('/coding-tasks/:sessionId', async (req, res) => {
  try {
    const accessToken = req.query.token || req.get('x-interview-token');
    const auth = await authorizedContextById(req.params.sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    const interviewData = await prepareInterviewData(auth.context.session, auth.context.type);
    await persistInterviewData(auth.context, interviewData);
    return res.json({
      success: true,
      sessionId: auth.context.session.sessionId,
      codingTasks: interviewData.codingTasks || []
    });
  } catch (error) {
    console.error('Error getting coding tasks:', error);
    return res.status(500).json({ success: false, error: 'Failed to get coding tasks' });
  }
});

function buildInterviewResult(context, interviewData) {
  const profile = interviewData.candidateProfile || sessionProfile(context.session, context.type);
  const metadata = interviewData.metadata || {};
  const endTime = new Date();
  const startTime = metadata.startTime ? new Date(metadata.startTime) : endTime;
  const durationSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000));
  const transcript = (interviewData.conversationHistory || [])
    .filter(message => message.role !== 'system')
    .map((message, index) => ({
      sequence: index + 1,
      role: message.role === 'assistant' ? 'AI Interviewer' : 'Candidate',
      message: message.content,
      timestamp: message.timestamp || null
    }));

  const fileName = `interview_${String(profile.candidateName || 'candidate').replace(/[^a-z0-9]+/gi, '_')}_${Date.now()}.json`;
  return {
    fileName,
    sessionId: context.session.sessionId,
    candidateInfo: {
      id: String(context.session.candidateId || ''),
      name: profile.candidateName || 'Candidate',
      position: profile.position || profile.role || 'Software Developer',
      skills: profile.skills || profile.techStack || []
    },
    interviewDetails: {
      startTime,
      endTime,
      durationSeconds,
      duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
      totalQuestions: metadata.questionsAsked || 0,
      totalAnswers: metadata.answersReceived || 0,
      codingTestsCompleted: metadata.codingTestsCompleted || 0
    },
    fullTranscript: transcript,
    savedAt: endTime
  };
}

router.post('/end/:sessionId', async (req, res) => {
  try {
    const { accessToken } = req.body || {};
    const auth = await authorizedContextById(req.params.sessionId, accessToken);
    if (auth.error) return res.status(auth.error.status).json({ success: false, error: auth.error.message });

    const interviewData = await prepareInterviewData(auth.context.session, auth.context.type);
    const result = buildInterviewResult(auth.context, interviewData);

    if (interviewResultsCollection) {
      try {
        await interviewResultsCollection.insertOne(result);
      } catch (error) {
        console.error('Unable to persist interview result:', error);
        return res.status(500).json({ success: false, error: 'Failed to save interview result' });
      }
    } else if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({ success: false, error: 'Interview result storage is not configured' });
    }

    if (auth.context.type === 'scheduled') {
      auth.context.session = await completeScheduledSession(auth.context.session.sessionId, {
        fileName: result.fileName,
        resultSummary: result.interviewDetails
      });
    } else if (auth.context.type === 'legacy') {
      await auth.context.session.completeSession();
    } else {
      auth.context.session.status = 'completed';
      demoSessions.delete(auth.context.session.sessionId);
    }

    return res.json({
      success: true,
      message: 'Interview completed successfully',
      fileName: result.fileName,
      summary: {
        candidateName: result.candidateInfo.name,
        duration: result.interviewDetails.duration,
        questionsAsked: result.interviewDetails.totalQuestions,
        totalTimeSpent: Math.ceil(result.interviewDetails.durationSeconds / 60)
      }
    });
  } catch (error) {
    console.error('Error ending interview:', error);
    return res.status(500).json({ success: false, error: 'Failed to end interview' });
  }
});

router.get('/list', requireAdmin, async (req, res) => {
  try {
    const query = {};
    if (req.query.status) query.sessionStatus = req.query.status;
    if (req.query.recruiterId) {
      if (!ObjectId.isValid(req.query.recruiterId)) return res.status(400).json({ success: false, error: 'Invalid recruiterId' });
      query.recruiterId = new ObjectId(req.query.recruiterId);
    }
    if (req.query.candidateId) {
      if (!ObjectId.isValid(req.query.candidateId)) return res.status(400).json({ success: false, error: 'Invalid candidateId' });
      query.candidateId = new ObjectId(req.query.candidateId);
    }

    const sessions = await InterviewSession.find(query)
      .select('sessionId candidateId candidateDetails sessionConfig sessionStatus accessControl createdAt')
      .sort({ 'sessionConfig.scheduledStartTime': -1 });

    return res.json({
      success: true,
      count: sessions.length,
      sessions: sessions.map(session => ({
        sessionId: session.sessionId,
        candidateId: String(session.candidateId),
        candidateName: session.candidateDetails.candidateName,
        candidateEmail: session.candidateDetails.candidateEmail,
        role: session.candidateDetails.role,
        companyName: session.candidateDetails.companyName,
        scheduledStartTime: session.sessionConfig.scheduledStartTime,
        scheduledEndTime: session.sessionConfig.scheduledEndTime,
        status: session.sessionStatus,
        totalTimeSpent: session.accessControl.totalTimeSpent,
        createdAt: session.createdAt
      }))
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    return res.status(500).json({ success: false, error: 'Failed to list sessions' });
  }
});

router.put('/update/:sessionId', requireAdmin, async (req, res) => {
  try {
    const session = await findLegacyBySessionId(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    if (!['scheduled', 'active'].includes(session.sessionStatus)) {
      return res.status(400).json({ success: false, error: 'Only scheduled or active sessions can be updated' });
    }

    const { scheduledDate, scheduledTime, duration, sessionStatus } = req.body || {};
    if (scheduledDate && scheduledTime) {
      const start = new Date(`${scheduledDate}T${scheduledTime}`);
      if (Number.isNaN(start.getTime())) return res.status(400).json({ success: false, error: 'Invalid scheduled date/time' });
      const minutes = Math.max(1, Number(duration) || session.sessionConfig.duration || 60);
      session.sessionConfig.scheduledStartTime = start;
      session.sessionConfig.scheduledEndTime = new Date(start.getTime() + minutes * 60000);
      session.sessionConfig.duration = minutes;
    }
    if (sessionStatus && ['scheduled', 'active', 'completed', 'expired', 'cancelled'].includes(sessionStatus)) {
      session.sessionStatus = sessionStatus;
    }
    await session.save();
    return res.json({ success: true, message: 'Session updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to update session' });
  }
});

router.delete('/cancel/:sessionId', requireAdmin, async (req, res) => {
  try {
    const context = await getSessionById(req.params.sessionId);
    if (!context) return res.status(404).json({ success: false, error: 'Session not found' });
    if (context.type === 'scheduled') await updateSessionStatus(context.session.sessionId, 'cancelled');
    else if (context.type === 'legacy') {
      context.session.sessionStatus = 'cancelled';
      context.session.accessControl.isActive = false;
      await context.session.save();
    } else demoSessions.delete(context.session.sessionId);
    return res.json({ success: true, message: 'Session cancelled successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to cancel session' });
  }
});

router.post('/access-demo/:candidateId', async (req, res) => {
  if (!isDemoEnabled()) return res.status(404).json({ success: false, error: 'Demo mode is disabled' });

  const candidateId = req.params.candidateId || 'demo';
  const accessToken = generateAccessToken();
  const sessionId = `demo_${cryptoRandomId()}`;
  const profile = {
    candidateName: 'Demo Candidate',
    companyName: 'Demo Company',
    position: 'Full Stack Developer',
    skills: ['JavaScript', 'React', 'Node.js', 'MongoDB']
  };
  const session = {
    sessionId,
    candidateId,
    status: 'active',
    profile,
    security: { accessToken },
    interviewData: null
  };
  demoSessions.set(sessionId, session);
  const context = { type: 'demo', session };
  const interviewData = await prepareInterviewData(session, 'demo');
  await persistInterviewData(context, interviewData);

  return res.json({
    success: true,
    sessionType: 'demo',
    session: publicSession(context, accessToken),
    accessToken,
    interviewData,
    initialMessage: `Hello! Welcome to your demo technical interview for the ${profile.position} role.`
  });
});

router.post('/demo-candidate', async (req, res) => {
  req.params.candidateId = 'demo';
  return router.handle({ ...req, url: '/access-demo/demo', method: 'POST' }, res);
});

export default router;
