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
