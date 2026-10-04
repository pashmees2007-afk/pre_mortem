# Pre-Mortem

[![CI](https://github.com/pashmees2007-afk/pre_mortem/actions/workflows/ci.yml/badge.svg)](https://github.com/pashmees2007-afk/pre_mortem/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

**Most "AI risk analysis" tools give you one confident paragraph and no way to check it. Pre-Mortem gives you a risk register you can actually audit.**

Paste a sprint plan or PRD in and two separate research branches investigate it, each grounded in retrieved web evidence instead of the model's own guesses. The branches never see each other's output, draw on evidence pools that share no source website, and can be written by different model families. A critic stage compares the branches, calls out where they disagree, and flags any risk that isn't backed by a real source. Nothing gets escalated to a mitigation action without a human approving it first. The result is a risk register where every claim traces back to an inspectable source, every disagreement is visible instead of averaged away, and every action requires a person to sign off — built for teams who need to trust *why* a risk was flagged, not just that it was.

## How it works

Pre-Mortem is an evidence-led decision-support workspace for turning a sprint plan or PRD into an inspectable pre-mortem. It does not present a single opaque answer: it retains separated evidence, compares independent failure narratives, visibly flags meaningful disagreement, and records reversible mitigation re-scoring.

The Agentic MVP adds an inspectable closed loop: **understand the plan → choose research angles → retrieve and check evidence → form independent failure hypotheses → critique evidence gaps → rank risks → ask for human approval → record a safe mock action → verify or replan**.

| Step | System behavior | What the user can inspect |
|---|---|---|
| Investigation Planner | Chooses the risk angles and writes two focused research queries for the current plan. | Chosen angles, branch assignment, and query text. |
| Research Skill | Retrieves HTTPS evidence for each branch from its own set of source websites and retains only structured source records. | Research trace, retained sources, evidence ledger, and any shared website flagged in the trace. |
| Independent branches and Critic | Creates two evidence-limited failure hypotheses, compares them, and calls out the most important evidence gap. | Scenarios, disagreement matrix, critic finding, and next check. |
| Human Approval Gate | Requires a person to approve a mitigation before an action is recorded. | Approval note, owner, and due date. |
| Mock Action and Verification | Records a reversible mock task; a human marks it verified or failed. A failed verification creates a replan trace. | Action board, verification note, and replan event. |

## Repository layout

| Directory | Purpose |
|---|---|
| [`secure-backend`](./secure-backend) | Node.js/TypeScript API and worker. It owns prompts, source policy, rate limits, planner-selected research angles, evidence persistence, independent branches, evidence critique, approval records, mock actions, verification, replanning, and severity rules. |
| [`dashboard`](./dashboard) | Next.js decision workspace. It provides plan submission, polling, an agent activity trace, planner and critic view, disagreement matrix, evidence ledger, risk register, mitigation interface, approval gate, mock action board, and verification controls. |

## Security boundary

The browser is intentionally not a generic LLM client. The dashboard submits only project data, plan text, mitigation answers, approval details, and verification notes to fixed secure routes. The backend keeps all provider keys, server prompts, model selection, source policy, queue controls, and deterministic scoring logic on the server.

The production reasoning path uses **Groq Qwen `qwen/qwen3.8-27b`** with JSON Schema output for typed plan facts, planning, scenarios, comparison, critique, synthesis, and mitigation assessment. Each Qwen stage receives its schema contract and, if needed, one constrained regeneration plus one local repair pass before Zod decides whether the output is valid. When a small typed-output stage remains invalid, PreMortem visibly uses an evidence-preserving deterministic fallback rather than silently inventing facts. **Groq Compound Mini** remains limited to web-evidence retrieval because the research skill relies on its structured search-tool response. Each evidence branch prioritises maintained Tier-1 engineering sources before broader web research. The Groq key is server-only and must never be committed or exposed to the dashboard.

The mock action board deliberately **does not** write to Jira, GitHub, or another external project system. It is a safe demo of agent task execution with a human approval gate. A future integration should retain the approval record and add a separate, narrowly scoped connector for each external action.

The Next.js dashboard forwards requests through a narrow same-origin route using an HTTP-only access-token cookie. See the package-level READMEs for the required environment variables, PostgreSQL/Redis setup, JWT claim contract, migrations, and local run commands.

## The numbers, not just the pitch

A project that argues for evidence over vibes should hold itself to the same standard. These are facts about the pipeline, not marketing copy:

- **One analysis makes 9–13 provider calls when every stage succeeds on the first try**: 7 structured Qwen stages (plan normalization, investigation planning, two independent scenarios, comparison, evidence critique, risk synthesis) plus 2–6 Compound Mini web searches (each research branch makes 1–3 searches, stopping once it has retained 2 sources). See [`engine.ts`](./secure-backend/src/engine.ts) and [`evidence.ts`](./secure-backend/src/evidence.ts).
- **Recovery can add calls, and that's the point**: when Qwen returns an invalid or truncated object, a stage can make up to 3 extra calls (a JSON-object retry if strict schema mode is rejected, one regeneration, one repair) plus one retry when Groq returns a rate-limit wait hint ([`groq.ts`](./secure-backend/src/groq.ts)). So 9–13 is the clean-run count, not a ceiling. Assessing a mitigation is a separate Qwen call each time a user submits one.
- **The pipeline is deliberately paced**: a mandatory 62-second cooldown ([`GROQ_EVIDENCE_COOLDOWN_MS`](./secure-backend/src/engine.ts)) separates the two evidence branches to stay under Groq's free-tier tokens-per-minute budget, so a successful run takes at least ~62 seconds before any model latency is added.
- **Completed runs record their own cost**: the engine records how many successful Groq responses the run received and the token usage Groq reported for them, as a `Usage Ledger` event in the agent trace ([`groq.ts`](./secure-backend/src/groq.ts), [`engine.ts`](./secure-backend/src/engine.ts)). Run `pnpm verify:groq -- --full` in `secure-backend/` with a live key to print the real `elapsedMs`, response count, and token totals for a fresh run. No measured figures are published here yet.
- **Recorded live validation runs** (logged during development in [`todo.md`](./todo.md) and [`secure-backend/README.md`](./secure-backend/README.md); not yet re-run against the current code): a subscription-payment launch analysis retained 13 HTTPS evidence sources across two branches and produced 3 evidence-linked risks; a separate run retained 16 Tier-1 sources and surfaced 3 severity-5 operational-readiness risks; a comparative fintech scenario retained 14 sources and its critic correctly flagged that only one of the two branches had Tier-1 coverage.

## Local development

Start the secure backend and queue worker first, then configure and run the dashboard in a second terminal. Each package includes its own `.env.example`, dependency lockfile, test suite, and detailed operating documentation.

Apply the backend migrations in order: `001_initial.sql`, `002_agentic_mvp.sql`, `003_self_service_product.sql`, then `004_password_reset.sql`.

```bash
cd secure-backend
pnpm install && pnpm check && pnpm test

cd ../dashboard
pnpm install && pnpm check && pnpm test && pnpm build
```

> The dashboard's example dossier is illustrative and clearly labeled. A live analysis requires a configured secure backend, a project UUID, and a trusted HTTP-only JWT cookie bridge.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for deploying the backend to Railway and the dashboard to Vercel.

## License

[MIT](./LICENSE)
