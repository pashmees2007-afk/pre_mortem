import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendBase } from "@/lib/server-auth";

export async function GET() {
  const base = backendBase();
  const token = (await cookies()).get(process.env.PREMORTEM_ACCESS_COOKIE ?? "pm_access_token")?.value;
  if (!base || !token) return NextResponse.json({ error: { message: "Authentication is required" } }, { status: 401 });
  const upstream = await fetch(`${base}/v1/session`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await upstream.text();
  return new NextResponse(body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
