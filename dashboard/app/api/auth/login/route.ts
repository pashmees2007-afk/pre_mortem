import { NextRequest, NextResponse } from "next/server";
import { applySessionCookie, backendBase } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const base = backendBase();
  if (!base) return NextResponse.json({ error: { message: "Secure backend is not configured" } }, { status: 503 });
  const upstream = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: await request.text(), cache: "no-store" });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok || !payload?.accessToken) return NextResponse.json(payload ?? { error: { message: "Sign-in failed" } }, { status: upstream.status || 502 });
  const response = NextResponse.json({ user: payload.user, organization: payload.organization });
  return applySessionCookie(response, payload.accessToken);
}
