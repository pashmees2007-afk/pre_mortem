import { analysisSchema, type Analysis, type MitigationResponse } from "./contracts";

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
