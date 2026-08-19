import express from 'express';
import { completeSession as completeScheduledSession } from '../utils/sessionScheduler.js';

const router = express.Router();
let interviewResultsCollection = null;
let openai = null;

export function initializeLiveCompletionRoutes(collections = {}, openaiInstance = null) {
  interviewResultsCollection = collections.interviewResultsCollection || null;
  openai = openaiInstance;
}

function profileFromContext(context, interviewData = {}) {
  const stored = interviewData.candidateProfile || {};
  const session = context.session || {};
  if (context.type === 'scheduled') {
    return {
      id: String(session.candidateId || ''),
      name: stored.candidateName || session.candidateName || 'Candidate',
      email: stored.candidateEmail || session.candidateEmail || null,
      position: stored.position || stored.role || session.position || 'Software Developer',
      skills: stored.skills || session.interviewConfig?.skills || []
    };
  }
  return {
    id: String(session.candidateId || ''),
    name: stored.candidateName || session.candidateDetails?.candidateName || 'Candidate',
    email: stored.candidateEmail || session.candidateDetails?.candidateEmail || null,
    position: stored.position || stored.role || session.candidateDetails?.role || 'Software Developer',
    skills: stored.skills || stored.techStack || session.candidateDetails?.techStack || []
  };
}

function transcriptFromData(interviewData = {}) {
  return (interviewData.conversationHistory || [])
    .filter(message => message?.role !== 'system' && message?.content)
    .map((message, index) => ({
      sequence: index + 1,
      role: message.role === 'assistant' ? 'AI Interviewer' : 'Candidate',
      message: String(message.content),
      timestamp: message.timestamp || null
    }));
}

function fallbackEvaluation(reason = 'Automated evaluation is unavailable') {
  return {
    overallScore: null,
    recommendation: 'review_required',
    summary: reason,
    strengths: [],
    concerns: [],
    generatedBy: 'fallback'
  };
}

async function evaluateInterview(profile, interviewData, transcript) {
  if (!openai) return fallbackEvaluation('OpenAI is not configured. Recruiter review is required.');

  const candidateMessages = transcript
    .map(item => `${item.role}: ${item.message}`)
    .join('\n')
    .slice(-16000);

  if (!candidateMessages.trim()) return fallbackEvaluation('The interview transcript is empty. Recruiter review is required.');

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_INTERVIEW_MODEL || 'gpt-4.1-mini',
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: 'You are an interview evaluator. Return only valid JSON. Evaluate evidence in the transcript, not personality or protected traits. Use an integer overallScore from 0 to 100 and recommendation one of strong_yes, yes, mixed, no, review_required.'
        },
        {
          role: 'user',
          content: `Evaluate this technical interview.\n\nRole: ${profile.position}\nSkills: ${Array.isArray(profile.skills) ? profile.skills.join(', ') : ''}\nQuestions asked: ${interviewData.metadata?.questionsAsked || 0}\nAnswers received: ${interviewData.metadata?.answersReceived || 0}\nCoding submissions: ${interviewData.metadata?.codingTestsCompleted || 0}\n\nReturn this JSON shape: {"overallScore":0,"recommendation":"mixed","summary":"...","strengths":["..."],"concerns":["..."]}\n\nTranscript:\n${candidateMessages}`
        }
      ]
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || '';
    const parsed = JSON.parse(raw.replace(/```json\n?/gi, '').replace(/```/g, '').trim());
    const score = Number(parsed.overallScore);
    const allowed = new Set(['strong_yes', 'yes', 'mixed', 'no', 'review_required']);
    return {
      overallScore: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null,
      recommendation: allowed.has(parsed.recommendation) ? parsed.recommendation : 'review_required',
      summary: String(parsed.summary || 'No summary provided').slice(0, 4000),
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(value => String(value).slice(0, 500)).slice(0, 8) : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(value => String(value).slice(0, 500)).slice(0, 8) : [],
      generatedBy: 'openai'
    };
  } catch (error) {
    console.error('Interview evaluation failed:', error);
    return fallbackEvaluation('Automated evaluation failed. Recruiter review is required.');
  }
}

function safeFilePart(value) {
  return String(value || 'candidate').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'candidate';
}

async function finalizeSession(context, result) {
  if (context.type === 'scheduled') {
    await completeScheduledSession(context.session.sessionId, {
      fileName: result.fileName,
      resultSummary: result.interviewDetails,
      evaluation: {
        overallScore: result.evaluation?.overallScore ?? null,
        recommendation: result.evaluation?.recommendation || 'review_required'
      }
    });
    return;
  }

  if (context.type === 'legacy') {
    if (typeof context.session.completeSession === 'function') await context.session.completeSession();
    else {
      context.session.sessionStatus = 'completed';
      if (context.session.accessControl) context.session.accessControl.isActive = false;
      await context.session.save();
    }
  }
}

router.post('/end/:sessionId', async (req, res) => {
  try {
    if (!interviewResultsCollection) {
      return res.status(503).json({ success: false, error: 'Interview result storage is not configured' });
    }

    const context = req.liveInterviewContext;
    if (!context) return res.status(500).json({ success: false, error: 'Validated interview context is missing' });

    const existing = await interviewResultsCollection.findOne({ sessionId: String(req.params.sessionId) });
    if (existing) {
      return res.json({
        success: true,
        alreadyCompleted: true,
        fileName: existing.fileName || null,
        summary: {
          candidateName: existing.candidateInfo?.name || 'Candidate',
          duration: existing.interviewDetails?.duration || null,
          questionsAsked: existing.interviewDetails?.totalQuestions || 0,
          totalTimeSpent: existing.interviewDetails?.durationSeconds ? Math.ceil(existing.interviewDetails.durationSeconds / 60) : 0,
          overallScore: existing.evaluation?.overallScore ?? null,
          recommendation: existing.evaluation?.recommendation || 'review_required'
        }
      });
    }

    const interviewData = context.session.interviewData || {};
    const profile = profileFromContext(context, interviewData);
    const transcript = transcriptFromData(interviewData);
    const metadata = interviewData.metadata || {};
    const endTime = new Date();
    const startTime = metadata.startTime ? new Date(metadata.startTime) : (context.session.actualStartTime ? new Date(context.session.actualStartTime) : endTime);
    const durationSeconds = Number.isNaN(startTime.getTime()) ? 0 : Math.max(0, Math.floor((endTime - startTime) / 1000));
    const evaluation = await evaluateInterview(profile, interviewData, transcript);
    const fileName = `interview_${safeFilePart(profile.name)}_${safeFilePart(context.session.sessionId)}.json`;

    const result = {
      fileName,
      sessionId: String(context.session.sessionId),
      candidateInfo: profile,
      interviewDetails: {
        startTime,
        endTime,
        durationSeconds,
        duration: `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s`,
        totalQuestions: metadata.questionsAsked || 0,
        totalAnswers: metadata.answersReceived || 0,
        codingTestsCompleted: metadata.codingTestsCompleted || 0
      },
      evaluation,
      fullTranscript: transcript,
      savedAt: endTime
    };

    await interviewResultsCollection.replaceOne(
      { sessionId: result.sessionId },
      result,
      { upsert: true }
    );

    await finalizeSession(context, result);

    return res.json({
      success: true,
      message: 'Interview completed successfully',
      fileName,
      summary: {
        candidateName: profile.name,
        duration: result.interviewDetails.duration,
        questionsAsked: result.interviewDetails.totalQuestions,
        totalTimeSpent: Math.ceil(durationSeconds / 60),
        overallScore: evaluation.overallScore,
        recommendation: evaluation.recommendation
      }
    });
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await interviewResultsCollection?.findOne({ sessionId: String(req.params.sessionId) });
      if (existing) {
        return res.json({
          success: true,
          alreadyCompleted: true,
          fileName: existing.fileName || null,
          summary: {
            candidateName: existing.candidateInfo?.name || 'Candidate',
            duration: existing.interviewDetails?.duration || null,
            questionsAsked: existing.interviewDetails?.totalQuestions || 0,
            overallScore: existing.evaluation?.overallScore ?? null,
            recommendation: existing.evaluation?.recommendation || 'review_required'
          }
        });
      }
    }
    console.error('Live interview completion failed:', error);
    return res.status(500).json({ success: false, error: 'Failed to complete and save interview' });
  }
});

export default router;