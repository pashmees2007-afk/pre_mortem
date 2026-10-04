import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const ORIGINAL_ENV = { ...process.env };

function mockCookie(token: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (name === "pm_access_token" && token ? { value: token } : undefined) } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function params(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) };
}

describe("backend proxy allowlist", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "development", PREMORTEM_API_URL: "http://localhost:3000" };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("rejects a path that is not on the allowlist before any backend call is attempted", async () => {
    mockCookie("token-abc");
    const fetchSpy = vi.spyOn(global, "fetch");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/admin/users"), params("v1/admin/users"));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an allowlisted-looking path with the wrong shape (non-UUID id)", async () => {
    mockCookie("token-abc");
    const fetchSpy = vi.spyOn(global, "fetch");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/projects/not-a-uuid/analyses"), params("v1/projects/not-a-uuid/analyses"));
    expect(response.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires an access-token cookie even for an allowlisted path", async () => {
    mockCookie(undefined);
    const fetchSpy = vi.spyOn(global, "fetch");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/projects"), params("v1/projects"));
    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to forward when PREMORTEM_API_URL is not configured", async () => {
    process.env.PREMORTEM_API_URL = "";
    mockCookie("token-abc");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/projects"), params("v1/projects"));
    expect(response.status).toBe(503);
  });

  it("refuses a non-HTTPS backend URL outside development", async () => {
    process.env = { ...process.env, NODE_ENV: "production", PREMORTEM_API_URL: "http://localhost:3000" };
    mockCookie("token-abc");
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/projects"), params("v1/projects"));
    expect(response.status).toBe(503);
  });

  it("forwards an allowlisted path with the bearer token and relays the backend response, never exposing the token to the client body", async () => {
    mockCookie("secret-session-token");
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", name: "Demo Project" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    const { POST } = await import("./route");
    const request = new NextRequest("http://localhost/api/backend/v1/projects", { method: "POST", body: JSON.stringify({ name: "Demo Project" }) });
    const response = await POST(request, params("v1/projects"));
    expect(response.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string> }];
    expect(init.headers.authorization).toBe("Bearer secret-session-token");
    const body = await response.text();
    expect(body).not.toContain("secret-session-token");
  });

  it("allows a bare analysis id path (GET /v1/analyses/:id) but not an arbitrary sub-path under it", async () => {
    mockCookie("token-abc");
    const validId = "22222222-2222-2222-2222-222222222222";
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "queued" }), { status: 200, headers: { "content-type": "application/json" } }));
    const { GET } = await import("./route");
    const ok = await GET(new NextRequest(`http://localhost/api/backend/v1/analyses/${validId}`), params(`v1/analyses/${validId}`));
    expect(ok.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const rejected = await GET(new NextRequest(`http://localhost/api/backend/v1/analyses/${validId}/secret`), params(`v1/analyses/${validId}/secret`));
    expect(rejected.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // still 1 — the rejected path never reached fetch
  });
});
