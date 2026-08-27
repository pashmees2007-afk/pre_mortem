# Pre-Mortem

Pre-Mortem is an evidence-led decision-support workspace for turning a sprint plan or PRD into an inspectable pre-mortem. It does not present a single opaque answer: it retains separated evidence, compares independent failure narratives, visibly flags meaningful disagreement, and records reversible mitigation re-scoring.

The Agentic MVP adds an inspectable closed loop: **understand the plan → choose research angles → retrieve and check evidence → form independent failure hypotheses → critique evidence gaps → rank risks → ask for human approval → record a safe mock action → verify or replan**.

## Repository layout

| Directory | Purpose |
|---|---|
| [`secure-backend`](./secure-backend) | Node.js/TypeScript API and worker. It owns prompts, source policy, rate limits, planner-selected research angles, evidence persistence, independent branches, evidence critique, approval records, mock actions, verification, replanning, and severity rules. |
| [`dashboard`](./dashboard) | Next.js decision workspace. It provides plan submission, polling, an agent activity trace, planner and critic view, disagreement matrix, evidence ledger, risk register, mitigation interface, approval gate, mock action board, and verification controls. |

## Agentic MVP behavior

| Step | System behavior | What the user can inspect |
|---|---|---|
| Investigation Planner | Chooses the risk angles and writes two focused research queries for the current plan. | Chosen angles, branch assignment, and query text. |
| Research Skill | Retrieves HTTPS evidence for each branch and retains only structured source records. | Research trace, retained sources, evidence ledger. |
| Independent branches and Critic | Creates two evidence-limited failure hypotheses, compares them, and calls out the most important evidence gap. | Scenarios, disagreement matrix, critic finding, and next check. |
| Human Approval Gate | Requires a person to approve a mitigation before an action is recorded. | Approval note, owner, and due date. |
| Mock Action and Verification | Records a reversible mock task; a human marks it verified or failed. A failed verification creates a replan trace. | Action board, verification note, and replan event. |

## Security boundary

The browser is intentionally not a generic LLM client. The dashboard submits only project data, plan text, mitigation answers, approval details, and verification notes to fixed secure routes. The backend keeps all provider keys, server prompts, model selection, source policy, queue controls, and deterministic scoring logic on the server.

The production reasoning path uses **Groq Qwen `qwen/qwen3.8-27b`** with JSON Schema output for typed plan facts, planning, scenarios, comparison, critique, synthesis, and mitigation assessment. Each Qwen stage receives its schema contract and, if needed, one constrained regeneration plus one local repair pass before Zod decides whether the output is valid. When a small typed-output stage remains invalid, PreMortem visibly uses an evidence-preserving deterministic fallback rather than silently inventing facts. **Groq Compound Mini** remains limited to web-evidence retrieval because the research skill relies on its structured search-tool response. Each evidence branch prioritises maintained Tier-1 engineering sources before broader web research. The Groq key is server-only and must never be committed or exposed to the dashboard.

The mock action board deliberately **does not** write to Jira, GitHub, or another external project system. It is a safe demo of agent task execution with a human approval gate. A future integration should retain the approval record and add a separate, narrowly scoped connector for each external action.

The Next.js dashboard forwards requests through a narrow same-origin route using an HTTP-only access-token cookie. See the package-level READMEs for the required environment variables, PostgreSQL/Redis setup, JWT claim contract, migrations, and local run commands.

## Local development

Start the secure backend and queue worker first, then configure and run the dashboard in a second terminal. Each package includes its own `.env.example`, dependency lockfile, test suite, and detailed operating documentation.

Apply both backend migrations in order: `001_initial.sql`, then `002_agentic_mvp.sql`.

```bash
cd secure-backend
pnpm install && pnpm check && pnpm test

cd ../dashboard
pnpm install && pnpm check && pnpm test && pnpm build
```

> The dashboard’s example dossier is illustrative and clearly labeled. A live analysis requires a configured secure backend, a project UUID, and a trusted HTTP-only JWT cookie bridge.
