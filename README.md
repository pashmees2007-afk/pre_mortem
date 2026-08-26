# Pre-Mortem

Pre-Mortem is an evidence-led decision-support workspace for turning a sprint plan or PRD into an inspectable pre-mortem. It does not present a single opaque answer: it retains separated evidence, compares independent failure narratives, visibly flags meaningful disagreement, and records reversible mitigation re-scoring.

## Repository layout

| Directory | Purpose |
|---|---|
| [`secure-backend`](./secure-backend) | Node.js/TypeScript API and worker. It owns prompts, source policy, rate limits, evidence persistence, branch orchestration, disagreement synthesis, and severity rules. |
| [`dashboard`](./dashboard) | Next.js decision workspace. It provides plan submission, polling, a disagreement matrix, evidence ledger, risk register, and mitigation interface. |

## Security boundary

The browser is intentionally not a generic LLM client. The dashboard submits only project data, plan text, and mitigation answers to fixed secure routes. The backend keeps the Groq key, server prompts, model selection, source policy, queue controls, and deterministic scoring logic on the server.

The Next.js dashboard forwards requests through a narrow same-origin route using an HTTP-only access-token cookie. See the package-level READMEs for the required environment variables, PostgreSQL/Redis setup, JWT claim contract, migrations, and local run commands.

## Local development

Start the secure backend and queue worker first, then configure and run the dashboard in a second terminal. Each package includes its own `.env.example`, dependency lockfile, test suite, and detailed operating documentation.

```bash
cd secure-backend
pnpm install && pnpm check && pnpm test

cd ../dashboard
pnpm install && pnpm check && pnpm test && pnpm build
```

> The dashboard’s example dossier is illustrative and clearly labeled. A live analysis requires a configured secure backend, a project UUID, and a trusted HTTP-only JWT cookie bridge.
