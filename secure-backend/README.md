# Pre-Mortem Secure Backend

This is a production-oriented Node.js/TypeScript backend for the Pre-Mortem SaaS. It replaces the prototype’s generic browser-controlled `/api/agent` proxy with narrow, authenticated, rate-limited routes and server-owned orchestration.

## Security properties

The browser can submit only a project ID, plan text, idempotency key, and mitigation answer. It cannot supply system prompts, model IDs, web-search flags, completion limits, evidence, severity, or synthesis directions.

Every provider call has a server-defined prompt, bounded timeout, fixed model policy, structured output contract, and server-side Zod validation. Evidence is stored as an inspectable URL/snippet ledger. The system does not expose model reasoning or treat retrieved web content as instructions.

## Runtime requirements

Use Node.js 20.11 or later, PostgreSQL 15 or later, Redis 7 or later, a Gemini API key, and a Groq API key. This package uses PostgreSQL for tenant data/auditability and Redis/BullMQ for durable work dispatch.

> **Provider boundary:** Gemini (`gemini-3.6-flash` by default) performs every schema-constrained reasoning task: plan normalization, investigation planning, independent scenarios, comparison, evidence critique, risk synthesis, and mitigation assessment. Groq Compound Mini is restricted to source retrieval through its built-in web-search response. No provider key or model policy is exposed to the dashboard.

The free-tier path stages the two independent Groq evidence searches rather than sending them together, uses Groq basic web search only, and retries short Gemini quota windows. This intentionally trades a little latency for a more reliable, no-cost hackathon demo. A Gemini quota is still enforced per project/model; wait for the provider reset if it reports an exhausted daily limit.

```bash
cp .env.example .env
pnpm install
psql "$DATABASE_URL" -f migrations/001_initial.sql
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

## Authentication contract

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
