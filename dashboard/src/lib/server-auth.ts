import { NextResponse } from "next/server";

const accessCookie = process.env.PREMORTEM_ACCESS_COOKIE ?? "pm_access_token";

export function backendBase() {
  const base = process.env.PREMORTEM_API_URL;
  const localDevelopmentApi = process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base ?? "");
  if (!base || (!base.startsWith("https://") && !localDevelopmentApi)) return null;
  return base.replace(/\/$/, "");
}

export function applySessionCookie(response: NextResponse, token: string) {
  response.cookies.set(accessCookie, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(accessCookie, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
