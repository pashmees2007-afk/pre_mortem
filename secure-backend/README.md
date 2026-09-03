# Pre-Mortem Secure Backend

This is a production-oriented Node.js/TypeScript backend for the Pre-Mortem SaaS. It replaces the prototype’s generic browser-controlled `/api/agent` proxy with narrow, authenticated, rate-limited routes and server-owned orchestration.

## Security properties

The browser can submit only a project ID, plan text, idempotency key, and mitigation answer. It cannot supply system prompts, model IDs, web-search flags, completion limits, evidence, severity, or synthesis directions.

Every provider call has a server-defined prompt, bounded timeout, fixed model policy, structured output contract, and server-side Zod validation. Evidence is stored as an inspectable URL/snippet ledger. The system does not expose model reasoning or treat retrieved web content as instructions.

## Runtime requirements

Use Node.js 20.11 or later, PostgreSQL 15 or later, Redis 7 or later, and a Groq API key. This package uses PostgreSQL for tenant data/auditability and Redis/BullMQ for durable work dispatch.

> **Provider boundary:** Groq Qwen (`qwen/qwen3.8-27b` by default) performs plan normalization, investigation planning, independent scenarios, comparison, evidence critique, risk synthesis, and mitigation assessment. Groq Compound Mini is restricted to source retrieval through its built-in web-search response. No provider key or model policy is exposed to the dashboard.

The free-tier path stages the two independent Groq evidence searches rather than sending them together and uses Groq basic web search only. A full analysis has eight structured Qwen stages. Every typed Qwen request carries its exact output contract and an example shape for its short intermediary stage. Compact stages—comparison, evidence critique, and mitigation classification—use JSON-object mode from the first call to avoid native-schema rejection, receive only the fields needed for their decision, and have enough completion budget to finish their object. The client accepts an otherwise-valid JSON object after an accidental prose prefix, then validates it locally with Zod. For a wrong shape or truncated JSON response, it asks once for a fresh contract-constrained response that names the failed fields, then allows one schema repair pass. If a completed comparison, critic, synthesis, or mitigation classification remains invalid, PreMortem records an **attention** trace and uses a clearly labelled deterministic, evidence-preserving fallback rather than hiding the limitation or fabricating evidence. The queue never restarts the full job after a provider failure, preventing completed stages from being duplicated. This intentionally trades a little latency for a more reliable, no-cost hackathon demo. Groq rate limits remain enforced per model and organization.

### Evidence quality policy

Each research branch queries a maintained, topic-specific Tier-1 domain set first. Software plans use official Kubernetes and Stripe documentation, Google SRE guidance, AWS documentation, Microsoft Learn, Cloudflare engineering material, GitHub engineering material, and MDN. Payment, wallet, cross-border, KYC, AML, sanctions, settlement, or reconciliation plans use relevant Financial Stability Board, Bank of England, U.S. Treasury OFAC, FFIEC BSA/AML, FinCEN, FCA, ICO, Stripe, AWS, and Google SRE material. When that query returns fewer than two usable sources, the branch runs a broad search to fill the remaining slots, then makes one final official-guidance search before declaring the evidence insufficient. Every source still must pass the HTTPS, title, snippet, deduplication, and source-ledger checks. The critic evaluates Tier-1 coverage separately for branch A and branch B, not merely across the combined result.

### Live validation

The local validation run completed an evidence-backed subscription-payment launch analysis, retained 13 HTTPS evidence sources across two independent branches, generated three evidence-linked risks, accepted a human mitigation response, created an approved mock action, and turned a failed mock verification into `replan_required`. The trace labels provider-output fallbacks as `attention`, keeping the decision path inspectable.

```bash
cp .env.example .env
pnpm install
psql "$DATABASE_URL" -f migrations/001_initial.sql
psql "$DATABASE_URL" -f migrations/002_agentic_mvp.sql
psql "$DATABASE_URL" -f migrations/003_self_service_product.sql
psql "$DATABASE_URL" -f migrations/004_password_reset.sql
pnpm dev               # terminal 1: API
pnpm worker            # terminal 2: analysis worker
```

### Local-only token helper

For a development-only authenticated smoke test, use the helper with local seed or test identities supplied through environment variables. It refuses to run in production and never embeds an identity or secret in source code.

```bash
DEV_ORG_ID="organization UUID" \
DEV_USER_ID="user UUID" \
DEV_ROLE="admin" \
JWT_SECRET="local development secret" \
JWT_ISSUER="premortem-api" \
JWT_AUDIENCE="premortem-web" \
node scripts/issue-local-token.mjs
```

Copy the resulting 10-minute token only into a local shell command or HTTP-only development cookie. Do not commit it, put it in a browser bundle, or use the helper in a deployed environment.

Run the validation suite with:

```bash
pnpm check
pnpm test
```

### Replacement Groq key verification runner

Use this **local-only** runner after creating a replacement Groq key. It validates Qwen typed JSON and Compound Mini web-search access without printing the API key. It uses the same backend client, model policy, validation, and evidence logic as the production workflow.

```bash
export GROQ_API_KEY="new key in your local shell only"
export DATABASE_URL="postgres://..."
export REDIS_URL="redis://..."
export JWT_SECRET="local development secret with at least 32 characters"
export JWT_ISSUER="premortem-api"
export JWT_AUDIENCE="premortem-web"
export DEV_ORG_ID="organization UUID"
export DEV_USER_ID="user UUID"
export DEV_PROJECT_ID="project UUID"

pnpm verify:groq            # verifies Qwen and Compound Mini only
pnpm verify:groq -- --full  # submits a fresh full local analysis and prints a safe summary
```

The summary includes the run ID, source counts by tier, risk titles/severity, fallback stages, and agent trace. It never prints `GROQ_API_KEY`. The runner refuses to execute with `NODE_ENV=production`; use an ignored local environment file or your shell, never Git.

## Authentication contract

For a self-hosted hackathon deployment, PreMortem includes a small server-side account bootstrap. `POST /v1/auth/register` creates an organization, administrator membership, and scrypt-hashed password record in one transaction; `POST /v1/auth/login` verifies the password and issues the same short-lived internal JWT described below. Both routes are rate-limited by IP and email, and request logging redacts password fields. The dashboard consumes these endpoints only through its own server routes, which place the JWT in an HTTP-only cookie; browser JavaScript never receives the token.

> This bootstrap is suitable for the MVP. Before a public multi-tenant launch, replace or supplement it with verified email, MFA/SSO, organization selection for multi-organization users, and an approved identity provider.

### Password reset

`POST /v1/auth/password-reset/request` accepts `{ "email": "..." }` and always returns `202 { "ok": true }`, whether or not an account exists for that email, so the route cannot be used to enumerate accounts. When the account exists, a single-use token valid for 30 minutes is stored (hashed, never in plaintext) and emailed through the configured `Mailer` (`src/mailer.ts`). `POST /v1/auth/password-reset/confirm` accepts `{ "token": "...", "password": "..." }`, validates the token against the same plan-facts-grade Zod password policy used at registration, and invalidates every outstanding token for that user once one is consumed.

Without `RESEND_API_KEY` configured, the mailer falls back to logging the reset link to the server console only — useful for local development, never expose this fallback in a production deployment. Swap `createMailer` in `src/mailer.ts` for any other HTTPS transactional email API; the `Mailer` interface is a single `send({ to, subject, text })` method.

The API expects a verified HS256 JWT with these claims:

```json
{
  "sub": "user UUID",
  "org_id": "organization UUID",
  "role": "member",
  "iss": "premortem-api",
  "aud": "premortem-web"
}
```

For an external identity provider, terminate OIDC/JWKS verification in a trusted edge/auth service and issue a short-lived internal HS256 service token with the least claims shown above. Do not trust organization IDs submitted in JSON request bodies.

## API

### Create an analysis run

```http
POST /v1/analyses
Authorization: Bearer <token>
Content-Type: application/json

{
  "projectId": "project UUID",
  "plan": "At least 80 characters of sprint plan or PRD",
  "idempotencyKey": "new UUID for this submission"
}
```

The API returns `202` with a run ID. Poll `GET /v1/analyses/:analysisId` until it reports `succeeded` or `failed`.

### Projects and saved analysis history

Authenticated users can create and rename only projects in their own organization, then list the most recent saved runs for a selected project. This supports dashboard reload and resume for a durable queued or running analysis.

| Action | Route |
|---|---|
| Read current session | `GET /v1/session` |
| List projects | `GET /v1/projects` |
| Create project | `POST /v1/projects` |
| Rename project | `PATCH /v1/projects/:projectId` |
| List saved project analyses | `GET /v1/projects/:projectId/analyses` |

### Submit mitigation evidence

```http
POST /v1/risks/:riskId/mitigations
Authorization: Bearer <token>
Content-Type: application/json

{ "answer": "The named owner completed staging rollback and recorded the alert threshold." }
```

The model classifies control evidence, but the severity change is applied by deterministic server logic. The response preserves `before`, `after`, `delta`, rationale, and outstanding gaps.

## Production deployment notes

Run the API and worker as separate process groups. Use a shared managed Redis service; do not use an in-memory queue or rate limiter in a multi-instance deployment. Set a provider spending limit and alerts, enforce the rate limits in `.env`, and send API/worker logs to your central log platform with plan/mitigation fields redacted.

The package deliberately omits a generic prompt endpoint. Do not add one. Product teams should create additional typed routes and server-owned prompt modules for each new workflow.
