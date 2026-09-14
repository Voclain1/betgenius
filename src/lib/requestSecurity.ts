import { NextRequest } from "next/server";

export function hasValidMutationOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return process.env.NODE_ENV === "test";
  try { return new URL(origin).origin === req.nextUrl.origin; } catch { return false; }
}

