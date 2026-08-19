import crypto from 'crypto';

let scheduledSessionsCollection = null;

export async function initializeScheduledSessions(db) {
    if (!db) {
        throw new Error('Database instance is required to initialize scheduled sessions');
    }

    scheduledSessionsCollection = db.collection('scheduled_sessions');

    await Promise.all([
        scheduledSessionsCollection.createIndex({ candidateId: 1, startTime: 1 }),
        scheduledSessionsCollection.createIndex({ sessionId: 1 }, { unique: true }),
        scheduledSessionsCollection.createIndex({ startTime: 1 }),
        scheduledSessionsCollection.createIndex({ endTime: 1 }),
        scheduledSessionsCollection.createIndex({ status: 1, startTime: 1 })
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

export async function createScheduledSession(sessionData) {
    requireCollection();

    if (!sessionData?.candidateId) {
        throw new Error('candidateId is required');
    }
    if (!sessionData?.candidateName) {
        throw new Error('candidateName is required');
    }

    const startTime = toValidDate(sessionData.startTime, 'startTime');
    const endTime = toValidDate(sessionData.endTime, 'endTime');

    if (endTime <= startTime) {
        throw new Error('endTime must be after startTime');
    }

    const duration = Number(sessionData.duration) || Math.ceil((endTime - startTime) / 60000);
    if (duration <= 0) {
        throw new Error('duration must be greater than zero');
    }

    const now = new Date();
    const scheduledSession = {
        sessionId: `session_${crypto.randomUUID()}`,
        candidateId: String(sessionData.candidateId),
        candidateName: String(sessionData.candidateName).trim(),
        position: sessionData.position || 'Software Developer',
        interviewerName: sessionData.interviewerName || 'AI Interviewer',
        startTime,
        endTime,
        duration,
        status: 'scheduled',
        accessAttempts: 0,
        maxAccessAttempts: Number(sessionData.maxAccessAttempts) || 3,
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
        }
    };

    const result = await scheduledSessionsCollection.insertOne(scheduledSession);
    return { ...scheduledSession, _id: result.insertedId };
}

export async function getScheduledSessionByCandidate(candidateId) {
    requireCollection();

    const now = new Date();
    return scheduledSessionsCollection.findOne(
        {
            candidateId: String(candidateId),
            status: { $in: ['scheduled', 'active'] },
            endTime: { $gte: now }
        },
        { sort: { startTime: 1 } }
    );
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

    const validation = {
        isValid: false,
        reason: '',
        timeToStart: Math.max(0, Math.ceil((startTime - now) / 60000)),
        timeToEnd: Math.max(0, Math.ceil((endTime - now) / 60000)),
        status: session.status,
        shouldExpire: false
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

    if (now < startTime) {
        validation.reason = `Session hasn't started yet. Please come back at ${startTime.toLocaleString()}`;
        return validation;
    }

    if (now > endTime) {
        validation.reason = `Session time has expired. Session was valid until ${endTime.toLocaleString()}`;
        validation.shouldExpire = true;
        return validation;
    }

    validation.isValid = true;
    validation.reason = 'Session is active and accessible';
    return validation;
}

export async function updateSessionStatus(sessionId, status, additionalData = {}) {
    requireCollection();

    const allowedStatuses = new Set(['scheduled', 'active', 'completed', 'expired', 'cancelled']);
    if (!allowedStatuses.has(status)) {
        throw new Error(`Invalid session status: ${status}`);
    }

    return scheduledSessionsCollection.updateOne(
        { sessionId },
        {
            $set: {
                status,
                updatedAt: new Date(),
                ...additionalData
            }
        }
    );
}

export async function incrementAccessAttempts(sessionId) {
    requireCollection();

    return scheduledSessionsCollection.updateOne(
        { sessionId },
        {
            $inc: { accessAttempts: 1 },
            $set: { updatedAt: new Date() }
        }
    );
}

export async function startSession(sessionId) {
    requireCollection();
    return updateSessionStatus(sessionId, 'active', {
        actualStartTime: new Date()
    });
}

export async function completeSession(sessionId, completionData = {}) {
    requireCollection();
    return updateSessionStatus(sessionId, 'completed', {
        actualEndTime: new Date(),
        completionData
    });
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

export async function cleanupExpiredSessions() {
    requireCollection();

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
        updatedAt: { $lt: oneDayAgo }
    });
}
