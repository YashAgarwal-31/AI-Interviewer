# InterviewBuddy – AI Interview Operations Platform

InterviewBuddy is a full-stack recruiting and technical-interview platform for a single recruiting organization. It provides named recruiter accounts, role-based access, candidate management, secure scheduled AI interviews, voice interaction, optional coding exercises, browser monitoring, evaluated interview reports, CSV export, and an operational audit trail.

> **Production note:** the repository is code/build ready, but any real deployment must still pass the live provider/browser smoke test in [DEPLOYMENT.md](./DEPLOYMENT.md) before real candidates are invited.

## What is included

### Recruiter workspace
- Owner, Admin, Recruiter, and Reviewer roles
- Dashboard KPIs and recent activity
- Searchable candidate profiles with create, view, edit, and delete workflows
- Bounded 15–240 minute interview scheduling, filtering, cancellation, invite, and reminder actions
- Searchable interview results, readable transcripts, AI evaluation, and spreadsheet-safe CSV export
- Team administration, password resets, account disable/enable, profile settings, and sign-out-everywhere
- Owner/admin audit log and system-status views

### Live candidate interview
- Signed, time-bound invite access; candidate IDs are not credentials
- Exact session resolution from signed links
- Tab-scoped candidate credentials in `sessionStorage`
- Invite secret transported in the URL fragment and scrubbed from browser history immediately
- Dedicated live interview UI with text answers, browser speech recognition, interviewer text-to-speech, countdown, and cancellation/expiry checks
- Feature-aware coding flow: recruiter coding setting is enforced in both the AI prompt and backend API
- External code editor receives tasks/context only; the interview access token is never passed to the iframe
- Built-in code-submission fallback if the external editor cannot submit
- Optional camera/microphone monitoring with lazy-loaded face/object/audio analysis
- Server-side live-session guard blocks candidate actions after cancellation, completion, or expiry

### Results and evaluation
- One persisted report per interview session on the normal single-backend deployment
- Full transcript, duration, question/answer counts, and coding-submission count
- OpenAI-generated technical evaluation with score, recommendation, strengths, concerns, and summary
- Evaluation prompt treats candidate transcript as untrusted data and explicitly excludes protected-trait/personality judgments
- Retry-safe completion returns the already-persisted report instead of intentionally creating another report

### Security and reliability
- Recruiter passwords hashed with Node `scrypt` and per-user salts
- Opaque recruiter sessions stored as hashes with TTL expiry
- Login lockout, least-privilege RBAC, request IDs, payload limits, CORS allowlisting, HSTS in production, and rate limits
- Candidate invite-token hashes stored instead of plaintext
- Failed email delivery restores the previous valid candidate token instead of silently invalidating it
- Invite/reminder rotation is blocked after an interview starts
- MongoDB pooling/indexes, OpenAI timeout/retries, graceful shutdown, and health checks
- Legacy credential-issuing session routes are disabled in production

## Production requirements

Production startup requires:

```text
MONGO_URI
ADMIN_API_KEY
OPENAI_API_KEY
FRONTEND_URL or PRODUCTION_FRONTEND_URL/CORS_ORIGINS
```

OpenAI is optional only for local development fallback behavior; the production server intentionally fails closed without `OPENAI_API_KEY` so the advertised AI interview/evaluation experience is actually available.

Resend is optional. Configure `RESEND_API_KEY` and `FROM_EMAIL` only when email invites/reminders are required.

## Tech stack

**Frontend:** React 19, Vite 7, React Router 7, Tailwind CSS, Lucide React, MediaPipe, TensorFlow.js/COCO-SSD.

**Backend:** Node.js 20.19+, Express, MongoDB/Mongoose, OpenAI API, optional Resend, Node crypto/scrypt.

## Main routes

Candidate:
- `/` and `/interview` – signed invite validation
- `/interview-session` – validated live interview workspace

Recruiter:
- `/platform/login` – sign-in / first-owner bootstrap
- `/platform` – dashboard
- `/platform/schedule` – interview operations
- `/platform/candidates` – candidate management
- `/platform/results` – reports and export
- `/platform/team` – owner/admin team management
- `/platform/audit` – audit/system status
- `/platform/settings` – account/password/session settings

## Local development

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Default frontend: `http://localhost:5173`  
Default backend: `http://localhost:3000`

## CI quality gate

GitHub Actions runs the exact deployment branch with:

Backend:
```bash
npm ci
npm audit --omit=dev
npm test
npm run check
```

Frontend:
```bash
npm ci
npm audit --omit=dev
npm run lint
npm run build
```

The regression tests cover authentication/token primitives plus production session-state and CSV-export safety cases.

## Deployment

The repository contains:
- `render.yaml` for the backend
- `frontend/vercel.json` for Vercel SPA routing/security headers
- backend/frontend `.env.example` files
- [DEPLOYMENT.md](./DEPLOYMENT.md) with the exact launch order and live smoke test

This version is designed for a **single recruiting organization on one normal backend service with concurrent recruiters/candidates**. Before turning it into a public multi-company or multi-region SaaS, add organization tenant isolation plus shared rate-limit/coordination infrastructure such as Redis.

## Security notes

- Never commit `.env` files, API keys, recruiter passwords, candidate invitation URLs, or raw access tokens.
- Keep `ADMIN_API_KEY` private and use it for first-owner bootstrap/recovery only.
- Keep `ENABLE_DEMO_MODE=false` in production.
- Candidate IDs are identifiers, not passwords.
- Invite/reminder resend rotates the candidate credential only after a successful delivery path; failed email sends restore the prior credential.
- Keep MongoDB backups and Render/Vercel/provider monitoring enabled for real production use.
