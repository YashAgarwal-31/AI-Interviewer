# InterviewBuddy – AI-Powered Technical Interview Platform

InterviewBuddy is a full-stack technical interview platform for running secure, time-bound AI interviews with voice interaction, coding exercises, candidate monitoring, session scheduling, and persistent interview results.

## Key Features

### AI interview experience
- Candidate-aware technical questions generated from profile, skills, experience, and projects
- Conversational follow-up questions through the OpenAI API
- Browser speech recognition and text-to-speech support
- Coding task synchronization with an external code-editor experience
- Interview transcript and session-result persistence

### Interview integrity
- MediaPipe face detection
- TensorFlow.js / COCO-SSD object detection
- Browser audio-level monitoring
- Monitoring models are loaded on demand so the initial application bundle stays lightweight

### Secure session management
- Time-bound interview sessions
- Cryptographically random invitation tokens
- New session tokens are stored as hashes rather than plaintext
- Candidate IDs are identifiers only; they do not grant interview access by themselves
- Token rotation when a new invitation/reminder is issued
- Failed-access tracking and request rate limiting
- Recruiter/admin routes protected by `ADMIN_API_KEY`
- Demo access disabled by default in production

### Recruiter tools
- Candidate profile management
- Interview scheduling UI at `/admin/schedule`
- Secure candidate-link generation
- Optional Resend email invitations and reminders
- Protected interview result APIs

## Tech Stack

### Frontend
- React 19
- Vite 7
- React Router 7
- Tailwind CSS
- MediaPipe
- TensorFlow.js / COCO-SSD
- Three.js / React Three Fiber

### Backend
- Node.js 20+
- Express
- MongoDB / Mongoose
- OpenAI API
- Resend (optional email delivery)

## Repository Structure

```text
AI-Interviewer/
├── backend/
│   ├── models/
│   │   └── InterviewSession.js
│   ├── routes/
│   │   ├── candidates.js
│   │   ├── email.js
│   │   ├── integrations.js
│   │   ├── results.js
│   │   ├── scheduledSessions.js
│   │   └── sessions.js
│   ├── utils/
│   │   ├── emailService.js
│   │   ├── security.js
│   │   └── sessionScheduler.js
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── src/
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
- MongoDB connection string for database-backed functionality
- OpenAI API key if you want AI-generated responses instead of local fallback prompts
- Resend API key only if you want email invitations

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

The backend runs on `http://localhost:3000` by default.

Important local variables:

```env
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017
MONGO_DB_NAME=ai_interviewer
ADMIN_API_KEY=replace-with-a-long-random-secret
OPENAI_API_KEY=
FRONTEND_URL=http://localhost:5173
ENABLE_DEMO_MODE=false
```

### Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend environment:

```env
VITE_AI_BACKEND_URL=http://localhost:3000
VITE_CODE_EDITOR_URL=https://ai-code-editor-psi-two.vercel.app/
```

The Vite development server runs on `http://localhost:5173` by default.

## Recruiter / Admin Flow

1. Configure `ADMIN_API_KEY` on the backend.
2. Open `/admin/schedule` in the frontend.
3. Enter the same admin key when prompted.
4. Create a time-bound candidate session.
5. Copy the generated secure candidate link or send it through the protected email API.
6. Treat the candidate URL like a password because it contains the one-time session credential.

The admin key is entered at runtime and stored only in browser session storage; it is not compiled into the frontend JavaScript bundle.

## Candidate Flow

Candidates should enter through the secure invitation URL. The link contains:

- candidate ID
- session ID
- secure access token

The backend validates both session timing and the access token before starting the interview. Entering a candidate ID alone is intentionally insufficient.

## Production Deployment

The repository includes deployment configuration for:

- **Render** backend through `render.yaml`
- **Vercel** frontend through `frontend/vercel.json`
- **MongoDB** for persistent candidate/session/result data

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the complete production checklist, required environment variables, CORS setup, health checks, and deployment sequence.

Production intentionally fails closed if MongoDB cannot initialize, preventing the service from appearing healthy while interview results cannot be persisted.

## CI / Quality Gates

GitHub Actions runs separate backend and frontend jobs.

Backend:

```bash
npm ci
npm audit --omit=dev
npm run check
```

Frontend:

```bash
npm ci
npm audit --omit=dev
npm run lint
npm run build
```

Production dependency audits are blocking CI checks.

## Security Notes

- Never commit `.env` files or API keys.
- Keep `ENABLE_DEMO_MODE=false` in production.
- Use a long random value for `ADMIN_API_KEY`.
- Candidate invitation URLs must not be shared publicly.
- Email logs intentionally do not store token-bearing candidate URLs.
- Issuing a new invite/reminder rotates the candidate token and can invalidate older links.

## Health Check

After the backend starts:

```text
GET /api/health
```

A production deployment returns a healthy status only when the required database connection is available.
