CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'beta',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE projects (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  retention_policy TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX projects_organization_idx ON projects(organization_id);

CREATE TABLE analysis_runs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL,
  normalized_plan JSONB,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  idempotency_key UUID NOT NULL,
  policy_version TEXT NOT NULL,
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX analysis_runs_organization_created_idx ON analysis_runs(organization_id, created_at DESC);
CREATE INDEX analysis_runs_project_created_idx ON analysis_runs(project_id, created_at DESC);

CREATE TABLE evidence_sources (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  branch TEXT NOT NULL CHECK (branch IN ('A', 'B')),
  url TEXT NOT NULL,
  hostname TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  snippet TEXT NOT NULL,
  provider_rank DOUBLE PRECISION,
  source_tier SMALLINT NOT NULL CHECK (source_tier BETWEEN 1 AND 4),
  status TEXT NOT NULL CHECK (status IN ('retrieved', 'rejected', 'unresolved')),
  rejection_reason TEXT,
  retrieved_at TIMESTAMPTZ NOT NULL,
  UNIQUE (analysis_run_id, url)
);
CREATE INDEX evidence_sources_run_idx ON evidence_sources(analysis_run_id, branch);

CREATE TABLE branch_runs (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  branch TEXT NOT NULL CHECK (branch IN ('A', 'B')),
  primary_category TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  scenario_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (analysis_run_id, branch)
);

CREATE TABLE disagreement_records (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL UNIQUE REFERENCES analysis_runs(id) ON DELETE CASCADE,
  category_relation TEXT NOT NULL CHECK (category_relation IN ('same', 'related', 'different')),
  claim_relation TEXT NOT NULL CHECK (claim_relation IN ('corroborates', 'complements', 'contradicts', 'unresolved')),
  evidence_overlap DOUBLE PRECISION NOT NULL CHECK (evidence_overlap >= 0 AND evidence_overlap <= 1),
  display_status TEXT NOT NULL CHECK (display_status IN ('corroborated', 'meaningful_disagreement', 'insufficient_evidence')),
  explanation TEXT NOT NULL
);

CREATE TABLE risk_items (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
  likelihood SMALLINT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  mitigation TEXT NOT NULL,
  uncertainty TEXT NOT NULL CHECK (uncertainty IN ('low', 'moderate', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX risk_items_run_severity_idx ON risk_items(analysis_run_id, severity DESC);

CREATE TABLE risk_evidence (
  risk_item_id UUID NOT NULL REFERENCES risk_items(id) ON DELETE CASCADE,
  evidence_source_id UUID NOT NULL REFERENCES evidence_sources(id) ON DELETE RESTRICT,
  relation TEXT NOT NULL CHECK (relation IN ('supports', 'qualifies')),
  PRIMARY KEY (risk_item_id, evidence_source_id)
);

CREATE TABLE mitigation_assessments (
  id UUID PRIMARY KEY,
  risk_item_id UUID NOT NULL REFERENCES risk_items(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  answer TEXT NOT NULL,
  control_evidence TEXT NOT NULL CHECK (control_evidence IN ('verified', 'partial', 'unverified', 'absent')),
  rationale TEXT NOT NULL,
  gaps JSONB NOT NULL,
  severity_before SMALLINT NOT NULL CHECK (severity_before BETWEEN 1 AND 5),
  severity_after SMALLINT NOT NULL CHECK (severity_after BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_events_org_created_idx ON audit_events(organization_id, created_at DESC);
