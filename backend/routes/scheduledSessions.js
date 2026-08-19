import express from 'express';
import { requireAdmin } from '../utils/security.js';
import {
    cleanupExpiredSessions,
    completeSession,
    createScheduledSession,
    getAllScheduledSessions,
    getScheduledSessionByCandidate,
    getScheduledSessionById,
    incrementAccessAttempts,
    patchScheduledSession,
    resetAccessAttempts,
    startSession,
    updateSessionStatus,
    validateSessionTiming,
    verifyScheduledAccessToken
} from '../utils/sessionScheduler.js';

const router = express.Router();

const frontendBaseUrl = () => (
    process.env.PRODUCTION_FRONTEND_URL || process.env.FRONTEND_URL || 'http://localhost:5173'
).replace(/\/$/, '');

function buildAccessUrl(session, accessToken) {
    const params = new URLSearchParams({
        candidateId: String(session.candidateId),
        sessionId: String(session.sessionId),
        accessToken: String(accessToken)
    });
    return `${frontendBaseUrl()}/?${params.toString()}`;
}

function publicSession(session, accessToken = null, validation = null) {
    return {
        sessionId: session.sessionId,
        candidateId: session.candidateId,
        candidateName: session.candidateName,
        candidateEmail: session.candidateEmail || null,
        companyName: session.companyName || null,
        position: session.position,
        role: session.position,
        interviewerName: session.interviewerName,
        startTime: session.startTime,
        endTime: session.endTime,
        scheduledStartTime: session.startTime,
        scheduledEndTime: session.endTime,
        duration: session.duration,
        timeRemaining: validation?.timeToEnd ?? null,
        skills: session.interviewConfig?.skills || [],
        experienceLevel: session.interviewConfig?.experienceLevel || 'intermediate',
        focusAreas: session.interviewConfig?.focusAreas || ['technical'],
        allowCodeEditor: session.interviewConfig?.allowCodeEditor !== false,
        customQuestions: session.interviewConfig?.customQuestions || [],
        recordingEnabled: session.metadata?.recordingEnabled !== false,
        language: session.metadata?.language || 'en',
        status: session.status,
        isScheduled: true,
        ...(accessToken ? { accessToken } : {})
    };
}

router.get('/candidate/:candidateId', requireAdmin, async (req, res) => {
    try {
        const session = await getScheduledSessionByCandidate(req.params.candidateId, { includeExpired: true });
        if (!session) {
            return res.status(404).json({ success: false, error: 'No session found for this candidate' });
        }
        return res.json({ success: true, session: publicSession(session) });
    } catch (error) {
        console.error('Error fetching scheduled session:', error);
        return res.status(500).json({ success: false, error: 'Failed to fetch scheduled session' });
    }
});

router.post('/create', requireAdmin, async (req, res) => {
    try {
        const sessionData = req.body || {};
        if (!sessionData.candidateId || !sessionData.candidateName || !sessionData.startTime || !sessionData.endTime) {
            return res.status(400).json({
                success: false,
                error: 'candidateId, candidateName, startTime and endTime are required'
            });
        }

        const startTime = new Date(sessionData.startTime);
        const endTime = new Date(sessionData.endTime);
        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
            return res.status(400).json({ success: false, error: 'Invalid start or end time' });
        }
        if (startTime >= endTime) {
            return res.status(400).json({ success: false, error: 'Start time must be before end time' });
        }
        if (endTime <= new Date()) {
            return res.status(400).json({ success: false, error: 'End time must be in the future' });
        }

        const existingSession = await getScheduledSessionByCandidate(sessionData.candidateId);
        if (existingSession) {
            return res.status(409).json({
                success: false,
                error: 'Candidate already has an active or scheduled session',
                existingSession: publicSession(existingSession)
            });
        }

        const createdSession = await createScheduledSession(sessionData);
        const accessUrl = buildAccessUrl(createdSession, createdSession.accessToken);

        return res.status(201).json({
            success: true,
            message: 'Scheduled session created successfully',
            session: {
                ...publicSession(createdSession),
                accessUrl
            }
        });
    } catch (error) {
        console.error('Error creating scheduled session:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to create scheduled session' });
    }
});

router.post('/access', async (req, res) => {
    try {
        const { candidateId, sessionId, accessToken } = req.body || {};
        if ((!candidateId && !sessionId) || !accessToken) {
            return res.status(400).json({
                success: false,
                error: 'candidateId or sessionId, plus accessToken, are required'
            });
        }

        const session = sessionId
            ? await getScheduledSessionById(sessionId)
            : await getScheduledSessionByCandidate(candidateId);

        if (!session || (candidateId && String(session.candidateId) !== String(candidateId))) {
            return res.status(404).json({ success: false, error: 'Scheduled session not found' });
        }

        if (!verifyScheduledAccessToken(session, accessToken)) {
            await incrementAccessAttempts(session.sessionId);
            return res.status(401).json({ success: false, error: 'Invalid interview access token' });
        }

        const validation = validateSessionTiming(session);
        if (!validation.isValid) {
            if (validation.shouldExpire) {
                await updateSessionStatus(session.sessionId, 'expired');
            }
            return res.status(403).json({
                success: false,
                error: validation.reason,
                sessionInfo: {
                    candidateName: session.candidateName,
                    position: session.position,
                    startTime: session.startTime,
                    endTime: session.endTime,
                    status: session.status,
                    timeToStart: validation.timeToStart,
                    timeToEnd: validation.timeToEnd,
                    accessibleFrom: validation.accessStart
                }
            });
        }

        let activeSession = session;
        if (session.status === 'scheduled') {
            activeSession = await startSession(session.sessionId);
        }
        await resetAccessAttempts(session.sessionId);

        return res.json({
            success: true,
            message: 'Session access granted',
            session: publicSession(activeSession, accessToken, validation),
            interviewData: activeSession.interviewData || null,
            initialMessage: `Hello ${activeSession.candidateName}! Welcome to your technical interview for the ${activeSession.position} position. Let's begin.`
        });
    } catch (error) {
        console.error('Error accessing scheduled session:', error);
        return res.status(500).json({ success: false, error: 'Failed to access session' });
    }
});

router.get('/status/:sessionId', async (req, res) => {
    try {
        const accessToken = req.query.token || req.get('x-interview-token');
        const session = await getScheduledSessionById(req.params.sessionId);
        if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
        if (!verifyScheduledAccessToken(session, accessToken)) {
            return res.status(401).json({ success: false, error: 'Invalid interview access token' });
        }

        const validation = validateSessionTiming(session);
        if (validation.shouldExpire) await updateSessionStatus(session.sessionId, 'expired');

        return res.json({
            success: true,
            sessionStatus: {
                ...publicSession(session, null, validation),
                isAccessible: validation.isValid,
                reason: validation.reason
            }
        });
    } catch (error) {
        console.error('Error checking scheduled session status:', error);
        return res.status(500).json({ success: false, error: 'Failed to check session status' });
    }
});

router.post('/complete', async (req, res) => {
    try {
        const { sessionId, accessToken, completionData } = req.body || {};
        if (!sessionId || !accessToken) {
            return res.status(400).json({ success: false, error: 'sessionId and accessToken are required' });
        }

        const session = await getScheduledSessionById(sessionId);
        if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
        if (!verifyScheduledAccessToken(session, accessToken)) {
            return res.status(401).json({ success: false, error: 'Invalid interview access token' });
        }

        const completed = await completeSession(sessionId, completionData || {});
        return res.json({ success: true, message: 'Session completed successfully', session: publicSession(completed) });
    } catch (error) {
        console.error('Error completing scheduled session:', error);
        return res.status(500).json({ success: false, error: 'Failed to complete session' });
    }
});

router.get('/list', requireAdmin, async (req, res) => {
    try {
        const filters = {
            status: req.query.status,
            candidateId: req.query.candidateId,
            dateFrom: req.query.dateFrom,
            dateTo: req.query.dateTo
        };
        Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

        const sessions = await getAllScheduledSessions(filters);
        return res.json({
            success: true,
            count: sessions.length,
            sessions: sessions.map(session => ({
                ...publicSession(session),
                accessAttempts: session.accessAttempts || 0,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt
            }))
        });
    } catch (error) {
        console.error('Error listing scheduled sessions:', error);
        return res.status(500).json({ success: false, error: 'Failed to list sessions' });
    }
});

router.put('/update/:sessionId', requireAdmin, async (req, res) => {
    try {
        const existing = await getScheduledSessionById(req.params.sessionId);
        if (!existing) return res.status(404).json({ success: false, error: 'Session not found' });

        const updateData = { ...req.body };
        const requestedStatus = updateData.status;
        delete updateData.status;
        delete updateData.security;
        delete updateData.accessAttempts;
        delete updateData.maxAccessAttempts;

        if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
        if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);

        const start = updateData.startTime || existing.startTime;
        const end = updateData.endTime || existing.endTime;
        if (new Date(start) >= new Date(end)) {
            return res.status(400).json({ success: false, error: 'Start time must be before end time' });
        }

        if (requestedStatus) await updateSessionStatus(req.params.sessionId, requestedStatus);
        if (Object.keys(updateData).length > 0) await patchScheduledSession(req.params.sessionId, updateData);

        const updated = await getScheduledSessionById(req.params.sessionId);
        return res.json({ success: true, message: 'Session updated successfully', session: publicSession(updated) });
    } catch (error) {
        console.error('Error updating scheduled session:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to update session' });
    }
});

router.post('/cleanup', requireAdmin, async (req, res) => {
    try {
        const result = await cleanupExpiredSessions({ deleteAfterDays: req.body?.deleteAfterDays || 30 });
        return res.json({
            success: true,
            message: 'Cleanup completed',
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('Error during session cleanup:', error);
        return res.status(500).json({ success: false, error: 'Failed to cleanup expired sessions' });
    }
});

export default router;
