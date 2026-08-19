# Production Deployment Guide

InterviewBuddy is configured for a **Render backend + Vercel frontend + MongoDB** single-workspace production deployment.

The repository can pass all static/build/security gates without proving that your real Render, Vercel, MongoDB, OpenAI, Resend, browser camera/microphone, and external editor accounts are configured correctly. Complete the live smoke test below before sending invitations to real candidates.

## 1. Required services

Required for the advertised production experience:
- GitHub repository access
- MongoDB Atlas (or another reachable MongoDB)
- Render
- Vercel
- OpenAI API key

Optional:
- Resend, only when email invitations/reminders are required

## 2. Backend production environment

Generate a long bootstrap/recovery key:

```bash
openssl rand -hex 32
```

Configure Render:

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
FRONTEND_URL=https://<your-vercel-domain>
PRODUCTION_FRONTEND_URL=https://<your-vercel-domain>
ENABLE_DEMO_MODE=false
```

Optional email settings:

```text
RESEND_API_KEY=...
FROM_EMAIL=Interviews <interviews@your-domain.com>
```

`CORS_ORIGINS` may contain extra exact origins separated by commas.

**Production intentionally refuses to start without MongoDB, `ADMIN_API_KEY`, OpenAI, and an allowed frontend origin.**

## 3. Deploy backend on Render

Use the root `render.yaml` Blueprint.

After deployment, verify:

```text
GET https://<render-service>/api/health
```

Expected: HTTP 200 with Mongo connected and OpenAI configured.

## 4. Deploy frontend on Vercel

Set project root to `frontend` and configure:

```text
VITE_AI_BACKEND_URL=https://<render-service>
VITE_CODE_EDITOR_URL=https://<your-code-editor-domain>/
```

Use the Vite defaults (`npm run build`, output `dist`). `frontend/vercel.json` contains SPA rewrites and browser security headers.

## 5. First owner bootstrap

Open:

```text
https://<vercel-domain>/platform/login
```

When no owner exists, bootstrap mode asks for:
- name
- work email
- organization name
- strong password (12+ chars, uppercase, lowercase, number)
- private `ADMIN_API_KEY`

After the owner exists, do not distribute the server admin key. Create named users under **Platform → Team**.

Roles:
- Owner – full workspace/team control
- Admin – team administration and recruiter operations
- Recruiter – candidate/interview/results operations
- Reviewer – read-only candidate/results access

## 6. Candidate and interview workflow

1. Create or edit a candidate under **Candidates**.
2. Schedule a 15–240 minute interview under **Interviews**.
3. Copy the secure link or send it by email.
4. The link contains candidate/session identifiers in the query and the secret in `#accessToken=...`.
5. The candidate page captures the secret, removes it from browser history, and keeps it only in tab-scoped storage.
6. Candidate actions are server-validated against the current session state; cancellation/expiry/completion cannot be bypassed by a stale browser tab.
7. If coding is disabled for that interview, the AI prompt, backend coding API, and candidate UI all disable coding.
8. Ending the interview persists a transcript and evaluation report and returns the persisted report safely on retries.

## 7. Email behavior

If Resend is enabled:
- invites/reminders can be sent only before the interview starts
- a successful resend rotates the candidate credential and invalidates the older link
- a failed delivery attempts to restore the previous valid credential
- token-bearing URLs are not persisted in email logs

## 8. CI gate

Do not deploy a failing branch.

Backend:

```bash
cd backend
npm ci
npm audit --omit=dev
npm test
npm run check
```

Frontend:

```bash
cd frontend
npm ci
npm audit --omit=dev
npm run lint
npm run build
```

## 9. Mandatory first live smoke test

Run this on the real deployed URLs before inviting users:

1. `/api/health` returns HTTP 200.
2. Bootstrap the owner, sign out, and sign back in.
3. Create an Admin, Recruiter, and Reviewer test account; verify role restrictions.
4. Create a candidate, edit the profile, reload, and confirm persistence.
5. Schedule a 15–30 minute test interview.
6. Open the signed candidate link in Chrome/Edge incognito/private mode.
7. Confirm the link is scrubbed from the address bar after validation.
8. Send several text answers and confirm AI follow-ups.
9. Test voice input; if the browser lacks SpeechRecognition, verify text fallback still works.
10. Enable camera/microphone monitoring and confirm permission-denial behavior is non-fatal.
11. With coding enabled, open the external editor and confirm it receives tasks but no access token; also test the built-in code fallback.
12. Run a second interview with coding disabled and confirm no coding control/question appears.
13. Cancel a separate active test interview from the recruiter workspace and confirm the candidate tab can no longer send answers.
14. Let one short test session expire and confirm stale actions are rejected.
15. End an interview, click/retry completion if possible, and verify only the same persisted report is returned.
16. Confirm **Results** shows readable transcript, score/recommendation, and CSV export opens safely.
17. Confirm recruiter mutations appear in **Audit**.
18. If Resend is enabled: send an invite, resend it, verify old-link invalidation, and test a deliberately failed email path before real rollout.
19. Restart the Render service and confirm candidates/results/team data persist.
20. Run 5–10 simultaneous test candidate sessions from separate browsers/devices before your first real batch.

## 10. Browser/device matrix

At minimum test:
- current Chrome on Windows/macOS
- current Edge on Windows if that is part of your candidate base
- one lower-spec laptop similar to your expected candidates
- camera denied, microphone denied, no SpeechRecognition, slower connection, and page refresh/reopen cases

Browser speech recognition is capability-dependent; typed answers remain the required fallback.

## 11. Monitoring and backups

For real usage:
- enable MongoDB backups
- enable Render/Vercel logs and uptime alerts
- monitor OpenAI errors/rate limits/costs
- monitor Resend delivery failures if email is enabled
- review audit logs after the first interview batches

## 12. Scaling boundary

This build is designed for **one recruiting organization on one normal backend service** with concurrent recruiters and candidates.

Before running multiple backend instances/regions or onboarding unrelated companies:
- add organization-level tenant isolation
- move rate limiting/shared coordination to Redis or equivalent
- use a distributed idempotency/locking mechanism for interview finalization
- add a job queue for high-volume email/evaluation work
- run dedicated load testing against the target infrastructure

These are scaling requirements, not blockers for the intended single-workspace/single-backend launch.
