# Pre-Mortem Next.js Dashboard

This package is the React/Next.js decision-support interface for the secure Pre-Mortem backend. It visualizes the pre-mortem workflow as an auditable record: a submitted plan, separated evidence branches, a visible disagreement matrix, an evidence-linked risk register, and reversible mitigation scoring.

## Security model

The browser never receives a Groq key, backend URL, bearer token, server prompt, source-policy setting, or model configuration. Client code calls only the same-origin `/api/backend/*` route. That route reads an HTTP-only access-token cookie on the server, allowlists the needed analysis, project, and history API shapes, and forwards the token to the secure backend.

> Do not replace the route handler with a client-side `NEXT_PUBLIC_*` backend URL or store the bearer token in local storage. Doing either would weaken the server-owned trust boundary established by the backend package.

## Run locally

Copy the environment template, then install and start the app.

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

Run the quality checks with:

```bash
pnpm check
pnpm test
pnpm build
```

The initial screen uses a clearly labeled illustrative evidence dossier so the visual workflow can be reviewed without a live backend. The **Start secure analysis** action requires a real project UUID, an authenticated session cookie, and a reachable backend service.

## Required server-side configuration

| Variable | Purpose |
|---|---|
| `PREMORTEM_API_URL` | HTTPS base URL of the secure Node.js backend, such as `https://api.your-domain.example`. It remains server-only. |
| `PREMORTEM_ACCESS_COOKIE` | HTTP-only cookie name containing a short-lived JWT accepted by the backend. Defaults to `pm_access_token`. |

The dashboard now includes server-side sign-in, registration, session, and logout routes. They relay credentials to the secure backend and set or clear an HTTP-only cookie; browser JavaScript never receives, decodes, or persists the JWT. The token includes the `sub`, `org_id`, and `role` claims expected by the backend package.

## Secure backend endpoints consumed

| Action | Dashboard request | Backend route |
|---|---|---|
| Start analysis | `POST /api/backend/v1/analyses` | `POST /v1/analyses` |
| Poll analysis | `GET /api/backend/v1/analyses/:id` | `GET /v1/analyses/:id` |
| Assess mitigation | `POST /api/backend/v1/risks/:id/mitigations` | `POST /v1/risks/:id/mitigations` |
| Create/select/rename project | `/api/backend/v1/projects` | `GET`/`POST /v1/projects`, `PATCH /v1/projects/:id` |
| Load saved run history | `/api/backend/v1/projects/:id/analyses` | `GET /v1/projects/:id/analyses` |

The proxy route rejects every other backend path. It does not permit generic agent calls, user-selected model settings, prompt bodies, token limits, source objects, or severity values.

## UX structure

The dashboard starts with sign-in or workspace creation, then provides project creation, selection, and renaming instead of exposing raw UUIDs. The workspace persists up to 30 runs per project, automatically detects a saved queued/running run after reload, and resumes polling for up to roughly nine minutes. The intake card submits only plan text and the server-owned selected project. The disagreement matrix places independent branches side-by-side and shows the deterministic display status, category relationship, and evidence overlap. The risk register exposes severity, uncertainty, source links, and a selected-risk mitigation panel. Finally, the evidence ledger preserves the source record used by each branch rather than presenting invented citations.

## Production notes

Deploy this dashboard behind the same authentication domain or a trusted identity bridge that can set the HTTP-only access cookie. Configure a restrictive Content Security Policy at the edge, ensure the backend URL uses HTTPS, and rotate the JWT signing or verification keys using your identity provider’s normal process. The Next.js app can scale independently because it has no in-memory session or analysis state; all durable work belongs to the backend, its database, and its queue worker.
