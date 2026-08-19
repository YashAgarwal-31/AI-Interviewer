# Deployment Guide

This repository is set up for a **Render backend + Vercel frontend + MongoDB** production deployment with named recruiter accounts, role-based access, secure candidate invite links, audit logs, and CI security gates.

## 1. Required accounts/services

- GitHub repository access
- MongoDB Atlas (or another reachable MongoDB deployment)
- Render for the Express backend
- Vercel for the Vite frontend
- OpenAI API key for AI-generated interview questions/responses
- Resend is optional and only required if you want interview links emailed to candidates

## 2. Create production secrets

Generate a long emergency/bootstrap admin key locally:

```bash
openssl rand -hex 32
```

Keep this value private. `ADMIN_API_KEY` is now primarily a server bootstrap/recovery credential; normal recruiter operations use named platform accounts and bearer sessions.

Prepare these backend values:

```text
NODE_ENV=production
MONGO_URI=...
MONGO_DB_NAME=ai_interviewer
MONGO_MAX_POOL_SIZE=20
ADMIN_API_KEY=...
AUTH_SESSION_HOURS=12
OPENAI_API_KEY=...
OPENAI_INTERVIEW_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=45000
OPENAI_MAX_RETRIES=2
FRONTEND_URL=<your final Vercel URL>
PRODUCTION_FRONTEND_URL=<your final Vercel URL>
ENABLE_DEMO_MODE=false
```

Optional email values:

```text
RESEND_API_KEY=...
FROM_EMAIL=Interviews <interviews@your-domain.com>
```

`CORS_ORIGINS` can contain extra exact browser origins separated by commas when needed.

## 3. Deploy the backend on Render

The repository root contains `render.yaml`.

1. In Render, create a new **Blueprint** from this GitHub repository.
2. Render will use `backend/` as the service root directory.
3. Add all secret environment variables marked `sync: false`.
4. Deploy the Blueprint.
5. Confirm this endpoint returns HTTP 200:

```text
https://<your-render-service>/api/health
```

The production server intentionally refuses to start without required production configuration and a working MongoDB connection. This prevents a deployment from appearing healthy while interview data cannot be persisted.

## 4. Deploy the frontend on Vercel

1. Import the same GitHub repository in Vercel.
2. Set **Root Directory** to `frontend`.
3. Use the Vite build defaults (`npm run build`, output `dist`).
4. Add:

```text
VITE_AI_BACKEND_URL=https://<your-render-service>
VITE_CODE_EDITOR_URL=https://ai-code-editor-psi-two.vercel.app/
```

5. Deploy.

`frontend/vercel.json` includes SPA rewrites and browser security headers. Platform routes such as `/platform`, `/platform/candidates`, `/platform/results`, and `/platform/schedule` continue to work after refresh.

## 5. Update backend CORS after the frontend URL is final

Return to Render and set:

```text
FRONTEND_URL=https://<your-vercel-production-domain>
PRODUCTION_FRONTEND_URL=https://<your-vercel-production-domain>
```

Redeploy the backend after changing them.

## 6. Create the first owner account

Open:

```text
https://<your-vercel-production-domain>/platform/login
```

If no owner exists, the page switches to one-time bootstrap mode. Enter:

- your name
- work email
- organization name
- a strong password (12+ characters with uppercase, lowercase, and a number)
- the private `ADMIN_API_KEY` configured on Render

After the first owner is created, bootstrap is disabled. Do not distribute `ADMIN_API_KEY` to recruiters.

## 7. Team access and roles

From **Platform → Team**, the owner/admin can create named accounts.

- **Owner**: full workspace and team control
- **Admin**: team administration plus recruiter operations
- **Recruiter**: candidate/interview management and results
- **Reviewer**: read-only candidate/result access

Recruiter browser sessions are opaque, server-stored credentials with expiry. Password changes and admin resets revoke other active sessions.

## 8. Create and send a secure interview

Open:

```text
https://<your-vercel-production-domain>/platform/schedule
```

A recruiter can create a scheduled session and receive a secure candidate link. New invite credentials are random and only their hash is stored in MongoDB.

For new links the sensitive access token is transported in the URL fragment (`#accessToken=...`), which browsers do not send to Vercel/Render as part of the HTTP request. The candidate app captures the credential, stores it only for the current browser-tab session, and removes it from the visible URL.

Treat a candidate invite URL like a password. Resending an invite or reminder rotates the access token and invalidates the previous link.

## 9. Candidate, results, and audit workflows

The recruiter platform provides:

- searchable/paginated candidate profiles
- secure interview scheduling and cancellation
- invitation and reminder email actions when Resend is configured
- searchable/paginated interview results
- CSV result export
- team/RBAC management
- operational/system status
- audit history for authentication, team changes, and recruiter mutations

Audit records expire automatically after the configured retention built into the application (currently 180 days).

## 10. Production checks

GitHub Actions blocks the PR/deployment branch when the following fail.

### Backend

```bash
cd backend
npm ci
npm audit --omit=dev
npm test
npm run check
```

### Frontend

```bash
cd frontend
npm ci
npm audit --omit=dev
npm run lint
npm run build
```

Do not merge or deploy a branch with a failing CI run.

## 11. First production smoke test

After both services are live:

1. Confirm `/api/health` returns HTTP 200.
2. Bootstrap the owner account.
3. Sign out and sign back in.
4. Create one test candidate.
5. Schedule a short test interview.
6. Open the secure candidate link in a private/incognito browser window.
7. Confirm microphone/camera permission handling.
8. Send at least one text/voice answer.
9. Open and complete one coding task if enabled.
10. End the interview and confirm a result appears in **Platform → Results**.
11. Confirm the recruiter action appears in **Platform → Audit log**.
12. Send an email invite/reminder if Resend is enabled and verify the old token is invalidated after rotation.

Run this smoke test before inviting real candidates.

## 12. Local development

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Default local URLs:

- Frontend: `http://localhost:5173`
- Recruiter login: `http://localhost:5173/platform/login`
- Backend: `http://localhost:3000`
- Backend health: `http://localhost:3000/api/health`

## Security notes

- Never commit `.env` files, API keys, recruiter passwords, or candidate invite URLs.
- Keep `ENABLE_DEMO_MODE=false` in production.
- Candidate IDs are identifiers, not authentication credentials.
- Candidate interview access requires the secure invitation token.
- Normal recruiter access uses named accounts rather than a shared admin key.
- Use the server `ADMIN_API_KEY` only for first-owner bootstrap/recovery workflows.
- Candidate access tokens are hashed in MongoDB and rotated when invitations/reminders are reissued.
- Token-bearing invite URLs are deliberately not persisted in email logs.
- Keep MongoDB backups and provider monitoring enabled for a real production deployment.

## Scaling note

The current deployment is designed as a production-oriented **single-workspace platform** and works well on a normal single backend service with concurrent users. If you later run multiple backend instances across regions, move shared rate limiting/session coordination to Redis (or another shared low-latency store) and introduce organization-level tenant isolation before hosting unrelated companies in the same deployment.
