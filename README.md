# InterviewBuddy – AI Interview Operations Platform

InterviewBuddy is a full-stack recruiting and technical-interview platform for running secure, time-bound AI interviews with named recruiter accounts, role-based access, candidate management, voice interaction, coding exercises, browser monitoring, persistent results, and an operational audit trail.

The current architecture is intended as a production-oriented **single-workspace platform** for one recruiting team. See [DEPLOYMENT.md](./DEPLOYMENT.md) before onboarding real candidates.

## Platform Features

### Recruiter workspace
- Secure named recruiter accounts and expiring server-side sessions
- Roles: **Owner**, **Admin**, **Recruiter**, and **Reviewer**
- Dashboard with candidate/interview/result/team KPIs
- Interview scheduling, filtering, invitation, reminder, and cancellation workflows
- Searchable/paginated candidate management
- Searchable/paginated interview results and CSV export
- Team administration, role changes, account disable/enable, and password resets
- Account settings, self-service password changes, and sign-out-everywhere
- Owner/admin audit and system-status views

### AI interview experience
- Candidate-aware technical questions based on profile, skills, experience, and projects
- Conversational follow-ups through the OpenAI API
- Browser speech recognition and text-to-speech
- Coding-task synchronization with an external code-editor experience
- Interview transcript and result persistence
- Graceful local fallback prompts when OpenAI is not configured during development

### Interview integrity
- MediaPipe face detection
- TensorFlow.js / COCO-SSD object detection
- Browser audio-level monitoring
- Monitoring models loaded on demand to reduce initial bundle cost
- Throttled inference so monitoring is lighter on candidate laptops

### Secure candidate access
- Time-bound scheduled interview sessions
- Cryptographically random invitation credentials
- New candidate access tokens stored as hashes rather than plaintext
- Candidate IDs are identifiers only; they cannot unlock interviews
- Token rotation whenever a new invitation/reminder is issued
- Dedicated secure candidate-entry screen before the interview UI is mounted
- New invite secrets transported in the URL fragment (`#accessToken=...`) so hosting servers do not receive them in the HTTP request URL
- Invite credentials scrubbed from browser history after capture
- Candidate session credentials kept tab-scoped in `sessionStorage`
- Failed-access tracking and request rate limiting
- Token-bearing invite URLs deliberately excluded from email logs

### Recruiter authentication and security
- Password hashing with Node.js `scrypt` and per-user random salts
- Strong-password policy and repeated-login lockout
- Random opaque recruiter bearer sessions; only session-token hashes are stored
- MongoDB TTL expiry for recruiter sessions and audit records
- Session revocation after password resets/account disable actions
- Least-privilege RBAC across candidate, result, interview, team, and audit APIs
- `ADMIN_API_KEY` retained primarily for first-owner bootstrap/recovery rather than normal recruiter usage

## Tech Stack

### Frontend
- React 19
- Vite 7
- React Router 7
- Tailwind CSS
- Lucide React
- MediaPipe
- TensorFlow.js / COCO-SSD
- Three.js / React Three Fiber

### Backend
- Node.js 20.19+
- Express
- MongoDB / Mongoose
- OpenAI API
- Resend (optional email delivery)
- Node `crypto` / `scrypt` for authentication primitives

## Main Routes

### Candidate
- `/` – secure invite validation
- `/interview` – secure invite validation alias
- `/interview-session` – authenticated interview workspace

### Recruiter platform
- `/platform/login` – recruiter sign-in / first-owner bootstrap
- `/platform` – dashboard
- `/platform/schedule` – interview operations
- `/platform/candidates` – candidate management
- `/platform/results` – interview results
- `/platform/team` – owner/admin team management
- `/platform/audit` – owner/admin audit and system status
- `/platform/settings` – profile, password, and session settings

The old `/admin/schedule` URL redirects to the authenticated platform scheduler.

## Repository Structure

```text
AI-Interviewer/
├── backend/
│   ├── models/
│   │   ├── AuditLog.js
│   │   ├── AuthSession.js
│   │   ├── InterviewSession.js
│   │   └── User.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── candidates.js
│   │   ├── email.js
│   │   ├── integrations.js
│   │   ├── platform.js
│   │   ├── results.js
│   │   ├── scheduledSessions.js
│   │   └── sessions.js
│   ├── tests/
│   │   └── auth.test.js
│   ├── utils/
│   │   ├── auth.js
│   │   ├── emailService.js
│   │   ├── security.js
│   │   └── sessionScheduler.js
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── src/
│   │   ├── auth/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── config.js
│   ├── .env.example
│   ├── package.json
│   └── vercel.json
├── .github/workflows/ci.yml
├── DEPLOYMENT.md
├── render.yaml
└── README.md
```

## Local Development

### Prerequisites

- Node.js `>=20.19`
- npm
- MongoDB for database-backed workflows
- OpenAI API key for the complete AI experience
- Resend API key only if you need email invitations/reminders

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Important local settings:

```env
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=ai_interviewer
MONGO_MAX_POOL_SIZE=20
ADMIN_API_KEY=replace-with-a-long-random-secret
AUTH_SESSION_HOURS=12
OPENAI_API_KEY=
OPENAI_INTERVIEW_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=45000
OPENAI_MAX_RETRIES=2
FRONTEND_URL=http://localhost:5173
ENABLE_DEMO_MODE=false
```

Backend default: `http://localhost:3000`

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

```env
VITE_AI_BACKEND_URL=http://localhost:3000
VITE_CODE_EDITOR_URL=https://ai-code-editor-psi-two.vercel.app/
```

Frontend default: `http://localhost:5173`

## First Owner Setup

1. Configure a long random `ADMIN_API_KEY` on the backend.
2. Open `/platform/login`.
3. If no owner exists, the page enters one-time bootstrap mode.
4. Create the owner account using the private server admin key.
5. After the owner exists, use named recruiter accounts for normal operations; do not distribute the server key.

## Typical Recruiter Flow

1. Sign in at `/platform/login`.
2. Create/import a candidate profile.
3. Schedule an interview from **Interviews**.
4. Copy the generated secure candidate URL or email it through Resend.
5. The candidate opens the complete signed link; candidate ID alone is rejected.
6. The candidate completes voice/technical/coding portions of the interview.
7. Review the persisted result under **Results** and export CSV if needed.
8. Owners/admins can inspect recruiter actions under **Audit log**.

Resending an invite/reminder rotates the candidate access token and invalidates the previous link.

## Production Deployment

The repository includes:

- **Render** backend blueprint via `render.yaml`
- **Vercel** frontend configuration via `frontend/vercel.json`
- **MongoDB** persistence for users, recruiter sessions, candidates, interview sessions, results, and audit history

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the exact deployment order, first-owner bootstrap, required environment variables, production smoke test, and scaling notes.

Production fails closed if required configuration or MongoDB initialization is unavailable.

## CI / Quality Gates

GitHub Actions is read-only and blocks failures in the following checks.

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

The backend tests cover password policy, password hashing/verification, email normalization, and interview access-token verification.

## Health Check

```text
GET /api/health
```

The response reports backend health plus MongoDB, OpenAI/email configuration state, uptime, and deployment version metadata when available.

## Production Scope

This version is designed for a **single recruiting organization on a normal single backend deployment with concurrent candidates/recruiters**. It includes database-backed authentication, persistence, pooling, indexes, rate limits, audit history, and deployment health checks.

Before inviting real candidates, complete the smoke test in `DEPLOYMENT.md` on the actual Render/Vercel/MongoDB deployment, including Chrome/Edge device permissions, microphone/camera, interview access timing, coding flow, result persistence, and email token rotation.

For a future public multi-company SaaS or multi-instance/multi-region backend, add organization-level tenant isolation and a shared coordination/rate-limit store such as Redis before onboarding unrelated companies into the same deployment.

## Security Notes

- Never commit `.env` files, API keys, recruiter passwords, or candidate invitation URLs.
- Keep `ENABLE_DEMO_MODE=false` in production.
- Candidate IDs are not passwords.
- Keep `ADMIN_API_KEY` private and use it only for bootstrap/recovery workflows.
- Candidate invitation credentials are hashed at rest and rotated on resend/reminder.
- New invite secrets use URL fragments and are removed from browser history after capture.
- Email logs do not persist the token-bearing URL.
- Keep MongoDB backups and provider monitoring enabled for real production use.
