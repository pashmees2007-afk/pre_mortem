import { NextRequest, NextResponse } from "next/server";
import { backendBase } from "@/lib/server-auth";

export async function POST(request: NextRequest) {
  const base = backendBase();
  if (!base) return NextResponse.json({ error: { message: "Secure backend is not configured" } }, { status: 503 });
  const upstream = await fetch(`${base}/v1/auth/password-reset/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: await request.text(), cache: "no-store" });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) return NextResponse.json(payload ?? { error: { message: "Password reset failed" } }, { status: upstream.status || 502 });
  return NextResponse.json(payload ?? { ok: true });
}
