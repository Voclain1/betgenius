import { NextRequest } from "next/server";

// CSRF guard for cookie-authenticated mutations: the browser's Origin header
// must name this site.
//
// It cannot compare against req.nextUrl.origin. On the VPS the app is the
// standalone Next server (HOSTNAME=0.0.0.0, PORT=3000) behind Caddy, and Next
// builds nextUrl from those, so it reads http(s)://0.0.0.0:3000 and never
// matches https://www.betgenius.ng: every follow, push subscription and
// preference change failed with "Invalid origin". Instead the Origin's host is
// checked against the host the browser actually asked for (Caddy passes Host
// through and sets X-Forwarded-Host), plus the configured site URLs.
function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim().toLowerCase() || null;
}

function hostOf(url: string | undefined) {
  if (!url) return null;
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

export function allowedMutationHosts(req: NextRequest) {
  const hosts = new Set<string>();
  for (const h of [
    firstHeaderValue(req.headers.get("x-forwarded-host")),
    firstHeaderValue(req.headers.get("host")),
    hostOf(process.env.NEXTAUTH_URL),
    hostOf(req.nextUrl.origin),
  ]) {
    if (h) hosts.add(h);
  }
  return hosts;
}

export function hasValidMutationOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV === "test";
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  return allowedMutationHosts(req).has(parsed.host.toLowerCase());
}
