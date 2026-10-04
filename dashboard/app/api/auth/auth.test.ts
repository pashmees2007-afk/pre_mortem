import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const ORIGINAL_ENV = { ...process.env };

function mockCookie(token: string | undefined) {
  vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (name === "pm_access_token" && token ? { value: token } : undefined) } as unknown as Awaited<ReturnType<typeof cookies>>);
}

function setCookieHeader(response: Response) {
  return response.headers.get("set-cookie") ?? "";
}

describe("dashboard auth routes (server-owned session boundary)", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "development", PREMORTEM_API_URL: "http://localhost:3000" };
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  describe("POST /api/auth/login", () => {
    it("never exposes the backend access token in the response body, only as an HTTP-only cookie", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ accessToken: "super-secret-jwt", user: { id: "u1", email: "a@b.com" }, organization: { id: "o1", name: "Acme" } }), { status: 200 }),
      );
      const { POST } = await import("./login/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.com", password: "whatever12" }) }));
      const bodyText = await response.text();
      expect(bodyText).not.toContain("super-secret-jwt");
      expect(JSON.parse(bodyText)).toEqual({ user: { id: "u1", email: "a@b.com" }, organization: { id: "o1", name: "Acme" } });
      const cookie = setCookieHeader(response);
      expect(cookie).toContain("pm_access_token=super-secret-jwt");
      expect(cookie.toLowerCase()).toContain("httponly");
    });

    it("passes through a backend failure without setting a session cookie", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }), { status: 401 }));
      const { POST } = await import("./login/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.com", password: "wrong" }) }));
      expect(response.status).toBe(401);
      expect(setCookieHeader(response)).toBe("");
    });

    it("refuses to proceed when the backend is not configured, without calling fetch", async () => {
      process.env.PREMORTEM_API_URL = "";
      const fetchSpy = vi.spyOn(global, "fetch");
      const { POST } = await import("./login/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/login", { method: "POST", body: "{}" }));
      expect(response.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/register", () => {
    it("never exposes the access token and sets the session cookie on success", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ accessToken: "fresh-jwt", user: { id: "u2", email: "new@b.com" }, organization: { id: "o2", name: "New Org" } }), { status: 201 }),
      );
      const { POST } = await import("./register/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/register", { method: "POST", body: JSON.stringify({ organizationName: "New Org", displayName: "New", email: "new@b.com", password: "SufficientPass1" }) }));
      expect(response.status).toBe(201);
      const bodyText = await response.text();
      expect(bodyText).not.toContain("fresh-jwt");
      expect(setCookieHeader(response)).toContain("pm_access_token=fresh-jwt");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the session cookie", async () => {
      const { POST } = await import("./logout/route");
      const response = await POST();
      const cookie = setCookieHeader(response);
      expect(cookie).toContain("pm_access_token=;");
      expect(cookie).toMatch(/max-age=0/i);
    });
  });

  describe("GET /api/auth/session", () => {
    it("returns 401 without ever calling the backend when there is no session cookie", async () => {
      mockCookie(undefined);
      const fetchSpy = vi.spyOn(global, "fetch");
      const { GET } = await import("./session/route");
      const response = await GET();
      expect(response.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("forwards the cookie's token to the backend as a bearer header", async () => {
      mockCookie("session-token-xyz");
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ actor: { sub: "u1" } }), { status: 200, headers: { "content-type": "application/json" } }));
      const { GET } = await import("./session/route");
      const response = await GET();
      expect(response.status).toBe(200);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
      expect(init.headers.authorization).toBe("Bearer session-token-xyz");
    });
  });

  describe("POST /api/auth/password-reset/request", () => {
    it("always relays the backend's enumeration-safe 202 response regardless of whether the account exists", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
      const { POST } = await import("./password-reset/request/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/password-reset/request", { method: "POST", body: JSON.stringify({ email: "nobody@nowhere.com" }) }));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ ok: true });
    });
  });

  describe("POST /api/auth/password-reset/confirm", () => {
    it("passes through an invalid/expired token error from the backend", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "Invalid or expired token" } }), { status: 400 }));
      const { POST } = await import("./password-reset/confirm/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token: "bad", password: "NewPassword123" }) }));
      expect(response.status).toBe(400);
    });

    it("relays a successful reset confirmation", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const { POST } = await import("./password-reset/confirm/route");
      const response = await POST(new NextRequest("http://localhost/api/auth/password-reset/confirm", { method: "POST", body: JSON.stringify({ token: "good-token", password: "NewPassword123" }) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });
  });
});
