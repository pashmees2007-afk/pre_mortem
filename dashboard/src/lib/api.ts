import { analysisSchema, analysisSummarySchema, projectSchema, sessionSchema, type Analysis, type AnalysisSummary, type MitigationResponse, type MockAction, type ProductSession, type Project } from "./contracts";

async function request<T>(path: string, init?: RequestInit, schema?: { parse: (input: unknown) => T }): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "The secure analysis service is unavailable.");
  return schema ? schema.parse(payload) : payload as T;
}

export async function createAnalysis(input: { projectId: string; plan: string; idempotencyKey: string }) {
  return request<{ id: string; status: string }>("/v1/analyses", { method: "POST", body: JSON.stringify(input) });
}

export async function getAnalysis(id: string): Promise<Analysis> {
  return request(`/v1/analyses/${encodeURIComponent(id)}`, undefined, analysisSchema);
}

export async function submitMitigation(riskId: string, answer: string): Promise<MitigationResponse> {
  return request(`/v1/risks/${encodeURIComponent(riskId)}/mitigations`, { method: "POST", body: JSON.stringify({ answer }) });
}

export async function approveMockAction(riskId: string, input: { owner: string; dueDate: string; approvalNote: string }): Promise<MockAction> {
  return request(`/v1/risks/${encodeURIComponent(riskId)}/actions`, { method: "POST", body: JSON.stringify(input) });
}

export async function verifyMockAction(actionId: string, input: { outcome: "verified" | "failed"; note: string }): Promise<{ id: string; status: "verified" | "replan_required"; outcome: "verified" | "failed" }> {
  return request(`/v1/actions/${encodeURIComponent(actionId)}/verification`, { method: "POST", body: JSON.stringify(input) });
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/auth/${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? "Authentication request failed.");
  return payload as T;
}

export function getSession(): Promise<ProductSession> { return authRequest("session").then((value) => sessionSchema.parse(value)); }
export function signIn(input: { email: string; password: string }): Promise<Pick<ProductSession, "user" | "organization">> { return authRequest("login", { method: "POST", body: JSON.stringify(input) }); }
export function register(input: { organizationName: string; displayName: string; email: string; password: string }): Promise<Pick<ProductSession, "user" | "organization">> { return authRequest("register", { method: "POST", body: JSON.stringify(input) }); }
export function signOut(): Promise<{ ok: true }> { return authRequest("logout", { method: "POST" }); }
export async function listProjects(): Promise<Project[]> { const value = await request<{ projects: unknown[] }>("/v1/projects"); return value.projects.map((project) => projectSchema.parse(project)); }
export function createProject(input: { name: string; retentionPolicy?: "standard" | "restricted" }): Promise<Project> { return request("/v1/projects", { method: "POST", body: JSON.stringify(input) }, projectSchema); }
export function renameProject(projectId: string, name: string): Promise<Project> { return request(`/v1/projects/${encodeURIComponent(projectId)}`, { method: "PATCH", body: JSON.stringify({ name }) }, projectSchema); }
export async function listProjectAnalyses(projectId: string): Promise<AnalysisSummary[]> { const value = await request<{ analyses: unknown[] }>(`/v1/projects/${encodeURIComponent(projectId)}/analyses`); return value.analyses.map((analysis) => analysisSummarySchema.parse(analysis)); }
