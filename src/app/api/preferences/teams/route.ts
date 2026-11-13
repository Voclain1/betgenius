import { NextRequest } from "next/server";
import { json, requireAccount } from "@/lib/accountApi";
import { SEARCH_LIMIT, rateLimit } from "@/lib/rateLimit";
import { popularTeams, searchTeams } from "@/lib/personalizationData";

export const dynamic = "force-dynamic";

/**
 * Team picker search: teams the site has published predictions for, by
 * provider id. Signed-in only (it serves the preferences screens) and rate
 * limited, because it is one query per keystroke. An empty query returns the
 * most-covered teams.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAccount(req, { write: false, scope: "team-search" });
  if (!auth.ok) return auth.response!;
  const limited = rateLimit(`team-search:${auth.userId}`, SEARCH_LIMIT.limit, SEARCH_LIMIT.windowMs);
  if (!limited.ok) return json({ error: "Too many searches" }, 429, { "retry-after": String(limited.retryAfterSeconds) });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const teams = q.length >= 2 ? await searchTeams(q) : await popularTeams();
  return json({ teams });
}
