CREATE TABLE investigation_plans (
  analysis_run_id UUID PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  plan_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE critic_records (
  analysis_run_id UUID PRIMARY KEY REFERENCES analysis_runs(id) ON DELETE CASCADE,
  finding TEXT NOT NULL,
  evidence_gaps JSONB NOT NULL,
  next_check TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_trace_events (
  id UUID PRIMARY KEY,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'attention', 'approved', 'verified', 'failed', 'replan')),
  detail TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX agent_trace_events_run_created_idx ON agent_trace_events(analysis_run_id, created_at ASC);

CREATE TABLE mock_actions (
  id UUID PRIMARY KEY,
  risk_item_id UUID NOT NULL REFERENCES risk_items(id) ON DELETE CASCADE,
  analysis_run_id UUID NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  approved_by UUID NOT NULL REFERENCES users(id),
  owner TEXT NOT NULL,
  due_date DATE NOT NULL,
  approval_note TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved', 'verified', 'replan_required')),
  verification_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX mock_actions_run_created_idx ON mock_actions(analysis_run_id, created_at DESC);
