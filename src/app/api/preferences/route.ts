import { NextRequest } from "next/server";
import { json, readJson, requireAccount } from "@/lib/accountApi";
import { PreferencesUpdate } from "@/lib/personalization";
import { PreferenceError, readPersonalizationFresh, resetPreferences, updatePreferences } from "@/lib/personalizationData";

// Per-user data: never statically rendered or cached.
export const dynamic = "force-dynamic";

/** The signed-in user's preferences and favourite teams/competitions. */
export async function GET(req: NextRequest) {
  const auth = await requireAccount(req, { write: false, scope: "preferences" });
  if (!auth.ok) return auth.response!;
  return json({ preferences: await readPersonalizationFresh(auth.userId) });
}

/** Partial update. Lists (teamIds, leagueIds, preferredMarkets) replace the current selection. */
export async function PUT(req: NextRequest) {
  const auth = await requireAccount(req, { write: true, scope: "preferences" });
  if (!auth.ok) return auth.response!;
  const parsed = PreferencesUpdate.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid preferences" }, 400);
  try {
    return json({ preferences: await updatePreferences(auth.userId, parsed.data) });
  } catch (e) {
    if (e instanceof PreferenceError) return json({ error: e.message }, e.status);
    console.error("[preferences] update failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not save preferences" }, 500);
  }
}

/** Reset favourites, markets and timezone to defaults. */
export async function DELETE(req: NextRequest) {
  const auth = await requireAccount(req, { write: true, scope: "preferences" });
  if (!auth.ok) return auth.response!;
  return json({ preferences: await resetPreferences(auth.userId) });
}
