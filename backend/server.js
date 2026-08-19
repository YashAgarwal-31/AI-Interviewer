import crypto from 'crypto';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import authRoutes from './routes/auth.js';
import candidateRoutes, { initializeCandidateRoutes } from './routes/candidates.js';
import emailRoutes, { closeEmailDatabase } from './routes/email.js';
import integrationRoutes from './routes/integrations.js';
import liveCompletionRoutes, { initializeLiveCompletionRoutes } from './routes/liveCompletion.js';
import platformRoutes, { initializePlatformRoutes } from './routes/platform.js';
import resultRoutes, { initializeResultRoutes } from './routes/results.js';
import scheduledSessionsRoutes from './routes/scheduledSessions.js';
import sessionRoutes, { initializeSessionRoutes } from './routes/sessions.js';
import { logAudit } from './utils/auth.js';
import emailService from './utils/emailService.js';
import { requireAdmin } from './utils/security.js';
import { initializeSessionActionGuard, requireLiveInterviewAction } from './utils/sessionActionGuard.js';
import { initializeScheduledSessions } from './utils/sessionScheduler.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';
let server = null;
let mongoConnected = false;
let mongoError = null;

let candidatesCollection = null;
let codeQuestionsCollection = null;
let interviewResultsCollection = null;
let scheduledSessionsCollection = null;

app.set('trust proxy', 1);
app.disable('x-powered-by');

function validateProductionConfig() {
  if (!isProduction) return;
  const required = ['ADMIN_API_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  if (!(process.env.MONGO_URI || process.env.MONGODB_URI)) missing.push('MONGO_URI');
  if (!(process.env.FRONTEND_URL || process.env.PRODUCTION_FRONTEND_URL || process.env.CORS_ORIGINS)) missing.push('FRONTEND_URL');
  if (missing.length) throw new Error(`Missing required production configuration: ${missing.join(', ')}`);
}

function configuredOrigins() {
  const configured = [process.env.FRONTEND_URL, process.env.PRODUCTION_FRONTEND_URL, ...(process.env.CORS_ORIGINS || '').split(',')]
    .filter(Boolean).map(origin => origin.trim().replace(/\/$/, ''));
  if (!isProduction) configured.push('http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:4000');
  return new Set(configured);
}
const allowedOrigins = configuredOrigins();

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalized = origin.replace(/\/$/, '');
    return allowedOrigins.has(normalized) ? callback(null, true) : callback(new Error('Origin is not allowed by CORS'));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key', 'X-Interview-Token', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

function createRateLimiter({ windowMs, maxRequests }) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) { bucket = { count: 0, resetAt: now + windowMs }; buckets.set(key, bucket); }
    bucket.count += 1;
    if (bucket.count > maxRequests) { res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000)); return res.status(429).json({ success: false, error: 'Too many requests. Please try again shortly.' }); }
    if (buckets.size > 5000 && Math.random() < 0.01) for (const [bucketKey, value] of buckets) if (now >= value.resetAt) buckets.delete(bucketKey);
    return next();
  };
}

const accessLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 40 });
const messageLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 90 });
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 25 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/bootstrap', authLimiter);
app.use('/api/sessions/access', accessLimiter);
app.use('/api/sessions/access-by-candidate', accessLimiter);
app.use('/api/scheduled-sessions/access', accessLimiter);
app.use('/api/sessions/message', messageLimiter);

app.use((req, res, next) => {
  const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const manuallyAudited = req.path.startsWith('/api/auth') || req.path.startsWith('/api/platform');
  if (isMutation && !manuallyAudited) {
    res.on('finish', () => {
      if (!req.actor) return;
      logAudit({ req, action: `api.${req.method.toLowerCase()}`, statusCode: res.statusCode, metadata: { path: req.originalUrl.split('?')[0] } });
    });
  }
  next();
});

async function connectDatabase() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    mongoError = new Error('MONGO_URI is not configured');
    if (isProduction) throw mongoError;
    console.warn('MongoDB is not configured. Database-backed routes will be unavailable.');
    return;
  }
  const configuredPoolSize = Number(process.env.MONGO_MAX_POOL_SIZE || 20);
  const maxPoolSize = Number.isFinite(configuredPoolSize) ? Math.min(50, Math.max(5, configuredPoolSize)) : 20;
  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME || 'ai_interviewer', serverSelectionTimeoutMS: 10000, maxPoolSize, minPoolSize: isProduction ? 2 : 0, maxIdleTimeMS: 30000 });
  const db = mongoose.connection.db;
  candidatesCollection = db.collection('candidates');
  codeQuestionsCollection = db.collection('code_questions');
  interviewResultsCollection = db.collection('interview_results');
  scheduledSessionsCollection = db.collection('scheduled_sessions');
  await Promise.all([
    initializeScheduledSessions(db),
    candidatesCollection.createIndex({ candidateId: 1 }, { unique: true }),
    candidatesCollection.createIndex({ updatedAt: -1 }),
    interviewResultsCollection.createIndex({ savedAt: -1 }),
    interviewResultsCollection.createIndex({ sessionId: 1 })
  ]);
  mongoConnected = true;
  mongoError = null;
}

function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) { console.warn('OPENAI_API_KEY is not configured. Interview questions will use local fallbacks.'); return null; }
  try { return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: Math.max(5000, Number(process.env.OPENAI_TIMEOUT_MS) || 45000), maxRetries: Math.min(5, Math.max(0, Number(process.env.OPENAI_MAX_RETRIES) || 2)) }); }
  catch (error) { console.error('OpenAI client initialization failed:', error); return null; }
}

function initializeRoutes(openai) {
  const collections = { candidatesCollection, codeQuestionsCollection, interviewResultsCollection, scheduledSessionsCollection };
  initializeSessionRoutes(collections, openai);
  initializeLiveCompletionRoutes(collections, openai);
  initializeCandidateRoutes(collections);
  initializeResultRoutes(collections);
  initializePlatformRoutes(collections);
  initializeSessionActionGuard(collections);

  app.use('/api/auth', authRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/sessions/integrations', integrationRoutes);
  app.use('/api/sessions/message/:sessionId', requireLiveInterviewAction);
  app.use('/api/sessions/coding-tasks/:sessionId', requireLiveInterviewAction);
  app.use('/api/sessions/end/:sessionId', requireLiveInterviewAction);
  app.use('/api/sessions', liveCompletionRoutes);
  // Legacy session-creation responses use an older URL format. Keep them for
  // local compatibility, but prevent them from issuing production credentials.
  app.post(['/api/sessions/create', '/api/sessions/create-from-shortlisted'], (req, res, next) => {
    if (!isProduction) return next();
    return res.status(410).json({ success: false, error: 'Legacy session creation is disabled in production. Use /api/scheduled-sessions/create or /api/sessions/integrations/create-from-shortlisted.' });
  });
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/scheduled-sessions', scheduledSessionsRoutes);
  app.use('/api/email', emailRoutes);
  app.use('/api/candidate', candidateRoutes);
  app.use('/api/interview/results', resultRoutes);
}

app.get('/api/health', (req, res) => {
  const healthy = !isProduction || mongoConnected;
  return res.status(healthy ? 200 : 503).json({ success: healthy, status: healthy ? 'ok' : 'degraded', service: 'ai-interviewer-backend', mongoConnected, openaiConfigured: Boolean(process.env.OPENAI_API_KEY), emailConfigured: emailService.isConfigured(), version: process.env.RENDER_GIT_COMMIT?.slice(0, 12) || process.env.APP_VERSION || null, uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

app.get('/api/db-health', requireAdmin, (req, res) => res.status(mongoConnected ? 200 : 503).json({ success: mongoConnected, mongo: { configured: Boolean(process.env.MONGO_URI || process.env.MONGODB_URI), connected: mongoConnected, error: mongoError ? mongoError.message : null } }));

async function startServer() {
  try { validateProductionConfig(); await connectDatabase(); }
  catch (error) { mongoConnected = false; mongoError = error; console.error('Server initialization failed:', error.message); if (isProduction) { process.exitCode = 1; return; } }
  const openai = createOpenAIClient();
  app.locals.platformHealth = { mongoConnected, emailConfigured: emailService.isConfigured() };
  initializeRoutes(openai);
  app.use((req, res) => res.status(404).json({ success: false, error: 'API route not found', requestId: req.requestId }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.message === 'Origin is not allowed by CORS') return res.status(403).json({ success: false, error: 'Origin is not allowed', requestId: req.requestId });
    if (error?.type === 'entity.too.large') return res.status(413).json({ success: false, error: 'Request payload is too large', requestId: req.requestId });
    console.error(`Unhandled API error [${req.requestId}]:`, error);
    return res.status(500).json({ success: false, error: 'Internal server error', requestId: req.requestId });
  });
  server = app.listen(port, () => { console.log(`AI Interviewer backend listening on port ${port}`); console.log(`Environment: ${process.env.NODE_ENV || 'development'}`); console.log(`MongoDB: ${mongoConnected ? 'connected' : 'not connected'}`); });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

async function shutdown(signal) {
  console.log(`${signal} received. Shutting down...`);
  if (server) await Promise.race([new Promise(resolve => server.close(resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
  try { await closeEmailDatabase(); } catch (error) { console.warn('Email DB close failed:', error.message); }
  try { await mongoose.disconnect(); } catch (error) { console.warn('Mongo close failed:', error.message); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', error => { console.error('Unhandled promise rejection:', error); });
startServer();