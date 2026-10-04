# Deploying Pre-Mortem

This deploys the backend (API + worker + Postgres + Redis) to **Railway** and the dashboard to **Vercel**. Both have free tiers sufficient for a hackathon demo. Total time: ~20 minutes.

## 1. Backend, worker, Postgres, Redis — Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → select `pashmees2007-afk/pre_mortem`.
3. Railway creates one service from the repo root. Open its settings and set:
   - **Root Directory**: `secure-backend`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm start`
   - Rename this service to `api`.
4. In the same project, **New → Database → Add PostgreSQL**, and **New → Database → Add Redis**. Railway provisions both and exposes `DATABASE_URL` / connection variables automatically.
5. Add a second service for the worker: **New → GitHub Repo** (same repo again) → set:
   - **Root Directory**: `secure-backend`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `pnpm worker`
   - Rename this service to `worker`.
6. On **both** the `api` and `worker` services, set these variables (Settings → Variables). Reference the Postgres/Redis plugins with Railway's variable picker rather than typing the values by hand:
   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   GROQ_API_KEY=<your Groq key>
   GROQ_RETRIEVAL_MODEL=groq/compound-mini
   GROQ_STRUCTURED_MODEL=qwen/qwen3.8-27b
   JWT_SECRET=<32+ char random string — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
   JWT_ISSUER=premortem-api
   JWT_AUDIENCE=premortem-web
   ANALYSIS_TIMEOUT_MS=25000
   MAX_PLAN_CHARS=12000
   ANALYSIS_RATE_LIMIT=3
   ANALYSIS_RATE_WINDOW_SECONDS=600
   ```
   `JWT_SECRET` must be identical on both services (and later, matched by the dashboard's JWT verification expectations — the dashboard never sees it, but both backend services must agree).
7. On the `api` service only, Railway sets `PORT` automatically — the app already reads it (`config.ts` coerces `PORT` from the environment). Do not hardcode `PORT`.
8. Run the migrations once, against the Railway Postgres instance. Easiest path: open the Postgres plugin's **Connect** tab, copy its external `DATABASE_URL`, then from your own machine:
   ```bash
   psql "<railway external DATABASE_URL>" -f secure-backend/migrations/001_initial.sql
   psql "<railway external DATABASE_URL>" -f secure-backend/migrations/002_agentic_mvp.sql
   psql "<railway external DATABASE_URL>" -f secure-backend/migrations/003_self_service_product.sql
   psql "<railway external DATABASE_URL>" -f secure-backend/migrations/004_password_reset.sql
   ```
9. Deploy both services. Once `api` is up, open its **Settings → Networking → Generate Domain** to get a public HTTPS URL, e.g. `https://premortem-api.up.railway.app`. Note it — the dashboard needs it next.

### Optional: real password-reset emails

Without `RESEND_API_KEY`, reset links are logged to the `api` service's console only (fine for a judged demo where you control the console, not fine for real users). To send real emails, add to the `api` service:
```
RESEND_API_KEY=<your Resend key>
MAIL_FROM=PreMortem <no-reply@yourdomain.com>
APP_BASE_URL=https://<your-vercel-dashboard-domain>
```

## 2. Dashboard — Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. **Add New → Project** → import `pashmees2007-afk/pre_mortem`.
3. In the import screen, set **Root Directory** to `dashboard`. Vercel auto-detects Next.js; leave the build/output settings at their defaults.
4. Add environment variables (Project Settings → Environment Variables):
   ```
   PREMORTEM_API_URL=https://premortem-api.up.railway.app
   PREMORTEM_ACCESS_COOKIE=pm_access_token
   ```
   Use the actual Railway `api` domain from step 1.9.
5. Deploy. Vercel gives you a URL like `https://pre-mortem.vercel.app` — this is the one to put in the README and share with judges.

## 3. Verify the live deployment

1. Open the Vercel URL, register a workspace account, create a project.
2. Submit a realistic plan (80+ characters, with a deadline, an external dependency, and no rollback plan).
3. Confirm the run reaches `succeeded` with retained evidence sources and ranked risks, then walk through approving a mitigation and verifying the mock action.
4. If the analysis fails immediately, check the Railway `worker` service logs first — a Groq-side error shows up there, not in Vercel's logs.

## Notes

- The `api` and `worker` services must both build successfully from `secure-backend` before either can start — Railway builds them independently even though they share a root directory and codebase, so a build failure in one does not block the other.
- Redis and Postgres on Railway's free tier are usable for a demo but are not provisioned for production load or durability guarantees; see each package's README for what a real production deployment still needs (HTTPS enforcement, verified email, MFA/SSO, monitoring).
- Never put `GROQ_API_KEY` or `JWT_SECRET` in a `NEXT_PUBLIC_*` variable or in the dashboard's environment — they belong only on the Railway backend services.
