import crypto from 'crypto';
import { generateAccessToken, hashAccessToken, verifyAccessToken } from './security.js';

let scheduledSessionsCollection = null;
const SESSION_STATUSES = new Set(['scheduled', 'active', 'completed', 'expired', 'cancelled']);

export async function initializeScheduledSessions(db) {
    if (!db) {
        throw new Error('Database instance is required to initialize scheduled sessions');
    }

    scheduledSessionsCollection = db.collection('scheduled_sessions');

    await Promise.all([
        scheduledSessionsCollection.createIndex({ candidateId: 1, startTime: 1 }),
        scheduledSessionsCollection.createIndex({ sessionId: 1 }, { unique: true }),
        scheduledSessionsCollection.createIndex({ status: 1, startTime: 1 }),
        scheduledSessionsCollection.createIndex({ endTime: 1 }),
        scheduledSessionsCollection.createIndex({ 'security.accessTokenHash': 1 }, { sparse: true })
    ]);
}

function requireCollection() {
    if (!scheduledSessionsCollection) {
        throw new Error('Scheduled sessions collection not initialized');
    }
}

function toValidDate(value, fieldName) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`${fieldName} must be a valid date`);
    }
    return date;
}

function positiveInteger(value, fallback, fieldName) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    const rounded = Math.floor(parsed);
    if (rounded <= 0) throw new Error(`${fieldName} must be greater than zero`);
    return rounded;
}

export async function createScheduledSession(sessionData) {
    requireCollection();

    if (!sessionData?.candidateId) throw new Error('candidateId is required');
    if (!sessionData?.candidateName) throw new Error('candidateName is required');

    const startTime = toValidDate(sessionData.startTime, 'startTime');
    const endTime = toValidDate(sessionData.endTime, 'endTime');
    if (endTime <= startTime) throw new Error('endTime must be after startTime');

    const rawToken = generateAccessToken();
    const now = new Date();
    const calculatedDuration = Math.max(1, Math.ceil((endTime - startTime) / 60000));
    const duration = positiveInteger(sessionData.duration, calculatedDuration, 'duration');
    const maxAccessAttempts = positiveInteger(sessionData.maxAccessAttempts, 5, 'maxAccessAttempts');

    const scheduledSession = {
        sessionId: `session_${crypto.randomUUID()}`,
        candidateId: String(sessionData.candidateId),
        candidateName: String(sessionData.candidateName).trim(),
        candidateEmail: sessionData.candidateEmail ? String(sessionData.candidateEmail).trim().toLowerCase() : null,
        companyName: sessionData.companyName || null,
        position: sessionData.position || 'Software Developer',
        interviewerName: sessionData.interviewerName || 'AI Interviewer',
        startTime,
        endTime,
        duration,
        accessWindow: {
            beforeStart: Math.max(0, Number(sessionData.accessWindow?.beforeStart ?? 15)),
            afterEnd: Math.max(0, Number(sessionData.accessWindow?.afterEnd ?? 15))
        },
        status: 'scheduled',
        accessAttempts: 0,
        maxAccessAttempts,
        security: {
            accessTokenHash: hashAccessToken(rawToken)
        },
        createdAt: now,
        updatedAt: now,
        interviewConfig: {
            skills: Array.isArray(sessionData.skills) ? sessionData.skills : [],
            experienceLevel: sessionData.experienceLevel || 'intermediate',
            focusAreas: Array.isArray(sessionData.focusAreas)
                ? sessionData.focusAreas
                : ['technical', 'problem-solving'],
            allowCodeEditor: sessionData.allowCodeEditor !== false,
            customQuestions: Array.isArray(sessionData.customQuestions)
                ? sessionData.customQuestions
                : []
        },
        metadata: {
            timeZone: sessionData.timeZone || 'UTC',
            language: sessionData.language || 'en',
            recordingEnabled: sessionData.recordingEnabled !== false,
            notes: sessionData.notes || ''
        },
        interviewData: sessionData.interviewData || null
    };

    const result = await scheduledSessionsCollection.insertOne(scheduledSession);
    return {
        ...scheduledSession,
        _id: result.insertedId,
        accessToken: rawToken
    };
}

export async function getScheduledSessionByCandidate(candidateId, { includeExpired = false } = {}) {
    requireCollection();
    const query = { candidateId: String(candidateId) };

    if (!includeExpired) {
        query.status = { $in: ['scheduled', 'active'] };
        query.endTime = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }

    return scheduledSessionsCollection.findOne(query, { sort: { startTime: 1 } });
}

export async function getScheduledSessionById(sessionId) {
    requireCollection();
    return scheduledSessionsCollection.findOne({ sessionId: String(sessionId) });
}

export function verifyScheduledAccessToken(session, accessToken) {
    return verifyAccessToken(session, accessToken);
}

export async function rotateScheduledAccessToken(sessionId) {
    requireCollection();
    const rawToken = generateAccessToken();
    const result = await scheduledSessionsCollection.updateOne(
        { sessionId: String(sessionId) },
        {
            $set: {
                'security.accessTokenHash': hashAccessToken(rawToken),
                updatedAt: new Date()
            },
            $unset: {
                accessToken: '',
                'security.accessToken': ''
            }
        }
    );

    if (!result.matchedCount) throw new Error('Scheduled session not found');
    return rawToken;
}

export function validateSessionTiming(session) {
    if (!session) {
        return {
            isValid: false,
            reason: 'Session not found',
            timeToStart: 0,
            timeToEnd: 0,
            status: null,
            shouldExpire: false
        };
    }

    const now = new Date();
    const startTime = new Date(session.startTime);
    const endTime = new Date(session.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
        return {
            isValid: false,
            reason: 'Session timing is invalid',
            timeToStart: 0,
            timeToEnd: 0,
            status: session.status,
            shouldExpire: false
        };
    }

    const beforeStart = Math.max(0, Number(session.accessWindow?.beforeStart ?? 0));
    const afterEnd = Math.max(0, Number(session.accessWindow?.afterEnd ?? 0));
    const accessStart = new Date(startTime.getTime() - beforeStart * 60000);
    const accessEnd = new Date(endTime.getTime() + afterEnd * 60000);

    const validation = {
        isValid: false,
        reason: '',
        timeToStart: Math.max(0, Math.ceil((startTime - now) / 60000)),
        timeToEnd: Math.max(0, Math.ceil((endTime - now) / 60000)),
        status: session.status,
        shouldExpire: false,
        accessStart,
        accessEnd
    };

    if (session.status === 'cancelled') {
        validation.reason = 'Session has been cancelled';
        return validation;
    }
    if (session.status === 'completed') {
        validation.reason = 'Session has already been completed';
        return validation;
    }
    if (session.status === 'expired') {
        validation.reason = 'Session has expired';
        return validation;
    }
    if ((session.accessAttempts || 0) >= (session.maxAccessAttempts || 5)) {
        validation.reason = 'Maximum failed access attempts exceeded';
        return validation;
    }
    if (now < accessStart) {
        validation.reason = `Session is not accessible yet. Access starts at ${accessStart.toLocaleString()}`;
        return validation;
    }
    if (now > accessEnd) {
        validation.reason = 'Session access window has expired';
        validation.shouldExpire = true;
        return validation;
    }

    validation.isValid = true;
    validation.reason = 'Session is active and accessible';
    return validation;
}

export async function patchScheduledSession(sessionId, patch = {}) {
    requireCollection();
    const safePatch = { ...patch, updatedAt: new Date() };
    delete safePatch._id;
    delete safePatch.sessionId;
    delete safePatch.createdAt;
    delete safePatch.security;
    delete safePatch.accessToken;
    delete safePatch.accessTokenHash;

    const result = await scheduledSessionsCollection.findOneAndUpdate(
        { sessionId: String(sessionId) },
        { $set: safePatch },
        { returnDocument: 'after' }
    );

    return result || null;
}

export async function updateSessionStatus(sessionId, status, additionalData = {}) {
    requireCollection();
    if (!SESSION_STATUSES.has(status)) throw new Error(`Invalid session status: ${status}`);

    const patch = {
        ...additionalData,
        status,
        updatedAt: new Date()
    };
    delete patch.security;

    return scheduledSessionsCollection.updateOne(
        { sessionId: String(sessionId) },
        { $set: patch }
    );
}

export async function incrementAccessAttempts(sessionId) {
    requireCollection();
    return scheduledSessionsCollection.updateOne(
        { sessionId: String(sessionId) },
        {
            $inc: { accessAttempts: 1 },
            $set: { updatedAt: new Date() }
        }
    );
}

export async function resetAccessAttempts(sessionId) {
    requireCollection();
    return scheduledSessionsCollection.updateOne(
        { sessionId: String(sessionId) },
        {
            $set: {
                accessAttempts: 0,
                updatedAt: new Date()
            }
        }
    );
}

export async function startSession(sessionId) {
    requireCollection();
    const session = await getScheduledSessionById(sessionId);
    if (!session) throw new Error('Scheduled session not found');
    if (session.status === 'active') return session;
    if (session.status !== 'scheduled') throw new Error(`Cannot start a ${session.status} session`);

    await updateSessionStatus(sessionId, 'active', {
        actualStartTime: session.actualStartTime || new Date()
    });
    return getScheduledSessionById(sessionId);
}

export async function completeSession(sessionId, completionData = {}) {
    requireCollection();
    await updateSessionStatus(sessionId, 'completed', {
        actualEndTime: new Date(),
        completionData
    });
    return getScheduledSessionById(sessionId);
}

export async function getAllScheduledSessions(filters = {}) {
    requireCollection();
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.candidateId) query.candidateId = String(filters.candidateId);
    if (filters.dateFrom || filters.dateTo) {
        query.startTime = {};
        if (filters.dateFrom) query.startTime.$gte = toValidDate(filters.dateFrom, 'dateFrom');
        if (filters.dateTo) query.startTime.$lte = toValidDate(filters.dateTo, 'dateTo');
    }

    return scheduledSessionsCollection.find(query).sort({ startTime: 1 }).toArray();
}

export async function cleanupExpiredSessions({ deleteAfterDays = 30 } = {}) {
    requireCollection();
    const now = new Date();
    const cutoff = new Date(now.getTime() - Math.max(1, Number(deleteAfterDays)) * 24 * 60 * 60 * 1000);

    await scheduledSessionsCollection.updateMany(
        {
            endTime: { $lt: now },
            status: { $in: ['scheduled', 'active'] }
        },
        {
            $set: {
                status: 'expired',
                updatedAt: now
            }
        }
    );

    return scheduledSessionsCollection.deleteMany({
        status: 'expired',
        updatedAt: { $lt: cutoff }
    });
}
