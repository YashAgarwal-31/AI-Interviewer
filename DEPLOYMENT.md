# Deployment Guide

This repository is set up for a **Render backend + Vercel frontend + MongoDB** deployment.

## 1. Required accounts/services

- GitHub repository access
- MongoDB Atlas (or another reachable MongoDB deployment)
- Render for the Express backend
- Vercel for the Vite frontend
- OpenAI API key for AI-generated interview questions/responses
- Resend is optional and only required if you want interview links emailed to candidates

## 2. Create production secrets

Generate a long admin key locally:

```bash
openssl rand -hex 32
```

Keep this value private. It is the `ADMIN_API_KEY` used by recruiter/admin endpoints.

Prepare these backend values:

```text
MONGO_URI=...
MONGO_DB_NAME=ai_interviewer
ADMIN_API_KEY=...
OPENAI_API_KEY=...
OPENAI_INTERVIEW_MODEL=gpt-4.1-mini
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
3. Add the secret environment variables when Render prompts for values marked `sync: false`.
4. Deploy the Blueprint.
5. Confirm this endpoint returns HTTP 200:

```text
https://<your-render-service>/api/health
```

The production server intentionally refuses to start without a working MongoDB connection. This prevents a deployment from appearing healthy while interview data cannot be persisted.

## 4. Deploy the frontend on Vercel

1. Import the same GitHub repository in Vercel.
2. Set **Root Directory** to `frontend`.
3. Use the Vite framework/build defaults (`npm run build`, output `dist`).
4. Add these environment variables:

```text
VITE_AI_BACKEND_URL=https://<your-render-service>
VITE_CODE_EDITOR_URL=https://ai-code-editor-psi-two.vercel.app/
```

5. Deploy.

`frontend/vercel.json` rewrites browser routes to `index.html`, so React Router URLs such as `/interview-session` and `/admin/schedule` continue to work after a refresh.

## 5. Update backend CORS after the frontend URL is final

Return to Render and set both:

```text
FRONTEND_URL=https://<your-vercel-production-domain>
PRODUCTION_FRONTEND_URL=https://<your-vercel-production-domain>
```

Redeploy the backend after changing them.

## 6. Create a secure interview

Open:

```text
https://<your-vercel-production-domain>/admin/schedule
```

Enter the same `ADMIN_API_KEY` configured on Render. The key is stored only in browser session storage and is sent in the `X-Admin-Key` header; it is not bundled into the frontend JavaScript.

After creating a session, the scheduler returns a candidate URL containing:

- candidate ID
- session ID
- a random interview access token

Only a hash of new access tokens is stored in MongoDB. Treat the generated candidate URL like a password.

## 7. Optional email invites

Configure `RESEND_API_KEY` and `FROM_EMAIL` on Render. Recruiter email endpoints are admin-protected. Resending an invite or reminder rotates the candidate token, which invalidates previously issued invite links.

## 8. Production checks

GitHub Actions runs on pull requests and deployment branches:

### Backend

```bash
cd backend
npm ci
npm run check
```

### Frontend

```bash
cd frontend
npm ci
npm run lint
npm run build
```

Do not merge a deployment change if the production build is failing.

## 9. Local development

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
- Backend: `http://localhost:3000`
- Backend health: `http://localhost:3000/api/health`

## Security notes

- Never commit `.env` files or API keys.
- Keep `ENABLE_DEMO_MODE=false` in production.
- Candidate IDs are identifiers, not authentication credentials.
- Candidate interview access requires the secure invitation token.
- Candidate/result management and recruiter scheduling endpoints require `ADMIN_API_KEY`.
- Token-bearing candidate URLs are deliberately not written into email logs.
