import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const allowed = [
  /^v1\/analyses(?:\/[0-9a-f-]{36})?$/i,
  /^v1\/risks\/[0-9a-f-]{36}\/mitigations$/i,
  /^v1\/risks\/[0-9a-f-]{36}\/actions$/i,
  /^v1\/actions\/[0-9a-f-]{36}\/verification$/i,
];

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const backendPath = path.join("/");
  if (!allowed.some((expression) => expression.test(backendPath))) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, { status: 404 });
  }
  const base = process.env.PREMORTEM_API_URL;
  if (!base?.startsWith("https://")) {
    return NextResponse.json({ error: { code: "BACKEND_NOT_CONFIGURED", message: "Secure backend is not configured" } }, { status: 503 });
  }
  const accessCookie = process.env.PREMORTEM_ACCESS_COOKIE ?? "pm_access_token";
  const token = (await cookies()).get(accessCookie)?.value;
  if (!token) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to access the secure analysis service" } }, { status: 401 });

  const upstream = await fetch(new URL(backendPath, `${base.replace(/\/$/, "")}/`), {
    method: request.method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": request.headers.get("x-request-id")?.slice(0, 128) ?? crypto.randomUUID() },
    body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.text(),
    cache: "no-store",
  });
  const body = await upstream.text();
  return new NextResponse(body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}

export const GET = forward;
export const POST = forward;
