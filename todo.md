# Approved Agentic MVP Checklist

- [x] Review repository contracts, database schema, routes, and dashboard API boundary.
- [x] Add an investigation-plan contract and planner prompt for dynamic risk-angle selection.
- [x] Record a safe, inspectable agent activity trace for each analysis run.
- [x] Surface the research query, source check, and evidence retention trace.
- [x] Add Critic findings for evidence gaps and meaningful branch disagreement.
- [x] Add a human approval gate before a mitigation can create a mock action.
- [x] Add mock action records with owner, due date, and status.
- [x] Add verification outcomes and a replan request when an action is not verified.
- [x] Add narrow server routes and dashboard API calls for the new controls.
- [x] Build the dashboard timeline, skill trace, approval panel, action board, and replan panel.
- [x] Add focused tests and update package documentation.
- [x] Run type checks, tests, and production builds for backend and dashboard.
- [x] Commit the approved implementation to the repository without exposing credentials.

## Local Runtime Checklist

- [x] Inspect required environment variables and local service prerequisites.
- [x] Start or configure PostgreSQL and Redis if available.
- [x] Apply the backend migrations in order.
- [x] Start the secure API and worker.
- [x] Start the dashboard and confirm the example dossier loads.
- [x] Identify any missing user-provided secret or local dependency.

## Styling Delivery Fix

- [x] Inspect the served stylesheet request and the dashboard runtime logs.
- [x] Identify and correct the stylesheet delivery failure.
- [x] Confirm that the dashboard renders with its intended typography, cards, colors, and layout.

## Free Model Provider Evaluation

- [x] Inspect the shared NVIDIA environment without changing account settings.
- [x] Verify current free-tier availability and API capabilities for structured output.
- [x] Compare candidate providers against the PreMortem agent workflow.
- [x] Recommend one practical provider and the required integration change.

## NVIDIA NIM Model Walkthrough

- [x] Verify the recommended NIM model’s current availability and structured-generation compatibility.
- [x] Prepare the key-generation and first-call steps.

## NVIDIA NIM Integration

- [ ] Validate the NVIDIA NIM key with the PreMortem plan-facts JSON schema.
- [ ] Add server-only NVIDIA provider configuration and a typed structured-output client.
- [ ] Preserve Groq only for evidence retrieval while moving typed reasoning to NIM.
- [ ] Run tests, test a live analysis, and commit the provider integration.

## Cerebras Provider Migration

- [x] Obtain a server-side Cerebras API key from the user.
- [ ] Activate the Cerebras Free Trial or credits after the supplied key returned HTTP 402.
- [ ] Validate `gpt-oss-120b` with the existing plan-facts schema using strict JSON output.
- [ ] Add the typed Cerebras structured-output client and hybrid provider wiring.
- [ ] Run tests, validate a live analysis, and commit the migration.

## Replacement Provider Evaluation

- [x] Verify Google Gemini free-tier API availability and structured JSON support.
- [x] Confirm a model that matches the PreMortem typed workflow.
- [x] Provide the exact key-generation and integration steps.

## Gemini Provider Integration

- [x] Validate the supplied Gemini key with the typed plan-facts schema.
- [x] Add Gemini server-only configuration and structured-output client support.
- [x] Route typed reasoning to Gemini while preserving Groq evidence retrieval.
- [x] Run backend checks, 21 tests, and production compilation after the provider migration.
- [x] Run dashboard checks, 4 tests, and production compilation after the provider migration.
- [x] Confirm a live run completes both independently staged Groq evidence branches and persists their inspectable trace.
- [ ] Complete one full live run after the Gemini free-tier request quota resets. The provider currently returns `RESOURCE_EXHAUSTED` after 20 requests for this model/project; the code now retries short quota windows, but it must not conceal a provider-enforced daily limit.

## Gemini Free-Tier Request Budget

- [x] Audit the full-analysis call count and identify any workflow retry that repeats completed work.
- [x] Keep a single full analysis under a documented 14-request Gemini budget below the provider cap.
- [x] Replace whole-job provider retries with a retry policy that preserves completed work.
- [x] Add tests and documentation for the request-budget safeguard, then commit the change.

## Post-Budget Live Retest

- [x] Submit one realistic project task to the capped Gemini/Groq hybrid workflow.
- [x] Confirm that the exhausted Gemini daily quota stops the run after one provider failure, without retrying the full workflow.
- [ ] Inspect the agent trace, retained evidence, and ranked risks after the external Gemini daily quota resets.
- [ ] Exercise the approval, mock-action, verification, and replan path if the live run succeeds.

## Sustainable Provider Alternative

- [x] Research current free or low-cost provider limits suitable for repeated PreMortem testing.
- [x] Compare structured JSON support, model availability, and expected request capacity.
- [x] Validate `qwen/qwen3.8-27b` on the supplied Groq account with the strict PreMortem plan-facts JSON probe.
- [x] Recommend the most practical alternative and give the user the next setup step.

## Groq Qwen Structured-Reasoning Migration

- [x] Replace the Gemini structured client with `qwen/qwen3.8-27b` through the secure Groq client.
- [x] Preserve Groq Compound Mini solely for the web-evidence subskill.
- [x] Update tests, environment documentation, and provider-boundary documentation.
- [x] Run automated checks and a live PreMortem task, then commit and push the working migration.

## Fresh Provider-Limit Pipeline Check

- [x] Submit one new realistic project plan through the full Groq Qwen and Compound Mini pipeline.
- [x] Inspect the complete agent trace and the final evidence-linked risk output.
- [x] Confirm that the successful run returned no provider rate-limit or quota signal.

## Qwen Reliability and Tier-1 Evidence Hardening

- [x] Capture and classify the malformed Qwen output patterns in short typed stages.
- [x] Strengthen Qwen prompts and structured-output recovery without allowing invented claims or citations.
- [x] Make each evidence branch seek and retain Tier-1 engineering sources where available.
- [x] Update tests and the critic rule. The focused suite now has 25 passing tests.
- [ ] Repeat the final full pipeline check after the external Groq provider access block (`403 Forbidden`) clears. Earlier Tier-1-first live validation retained five Tier-1 sources, but the final repeat was blocked before plan processing.
- [ ] Commit and push the validated reliability improvements.

## New Groq Key Verification Runner

- [x] Create a local-only runner that verifies both Qwen reasoning and Compound Mini retrieval access without printing the API key.
- [x] Add a reusable full-pipeline submission and inspection mode using the configured local environment.
- [x] Document safe usage with `GROQ_API_KEY` supplied only through the local shell or ignored environment file.
- [x] Validate the runner and execute a full analysis with the working replacement key. Qwen typed output and Compound Mini retrieval both passed; the run completed with 12 sources, including 9 Tier-1 sources.

## Repository Security Audit

- [x] Scan tracked files and every reachable commit for credential-shaped strings without exposing their values.
- [x] Review ignore rules and reachable Git history for accidental secret tracking.
- [x] Run dependency vulnerability checks and review the server-side security boundary.
- [x] Remediate verified dashboard dependency issues, validate the fix, and document credential rotation plus GitHub alert coverage required.

## Replacement-Key End-to-End Test

- [x] Run one fresh full PreMortem pipeline using the verified replacement Groq key.
- [x] Inspect the full agent trace, retained evidence, and final risk register. The run retained 16 Tier-1 sources and generated three severity-5 operational-readiness risks.
- [x] Confirm that the provider returned no quota, rate-limit, or access error.

## Comparative Fintech Pre-Mortem

- [x] Submit a high-risk fintech startup scenario with a tight regulatory deadline.
- [x] Inspect the two independent research branches, their evidence quality, and the comparison result. The run retained 14 sources, but only branch B retained a Tier-1 source; the critic correctly flagged the gap in branch A.
- [x] Report the evidence-linked risk register and any trace-level fallback or provider issue.

## Short-Stage Qwen Reliability

- [x] Capture the malformed comparator, critic, and decision output patterns from completed live runs.
- [x] Tighten their schemas and prompts while preserving evidence-only inputs and transparent failures.
- [x] Add focused tests for valid model output and malformed-output recovery. The complete backend suite now has 29 passing tests.
- [ ] Run a fresh comparative pipeline and record which, if any, stages still require fallback. This requires a local non-production Groq credential; none is available in the current session.
- [ ] Commit and push the validated reliability improvement.
