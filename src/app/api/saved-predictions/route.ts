import { NextRequest } from "next/server";
import { z } from "zod";
import { json, readJson, requireAccount } from "@/lib/accountApi";
import { SaveRequest } from "@/lib/personalization";
import { SaveError, savePrediction, savedPredictionIds, unsavePrediction } from "@/lib/personalizationData";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";

export const dynamic = "force-dynamic";

/** The ids of the signed-in user's saved predictions — what the save buttons need. */
export async function GET(req: NextRequest) {
  const auth = await requireAccount(req, { write: false, scope: "saved" });
  if (!auth.ok) return auth.response!;
  return json({ predictionIds: await savedPredictionIds(auth.userId) });
}

export async function POST(req: NextRequest) {
  const auth = await requireAccount(req, { write: true, scope: "saved" });
  if (!auth.ok) return auth.response!;
  const parsed = SaveRequest.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid prediction id" }, 400);
  try {
    // Entitlement from the database, per request — the same resolver every
    // feed gate uses, never the session's display snapshot.
    const viewer = await getViewerEntitlement();
    const { saved, created } = await savePrediction(auth.userId, parsed.data.predictionId, viewer);
    return json({ saved: { id: saved.id, predictionId: saved.predictionId }, created }, created ? 201 : 200);
  } catch (e) {
    if (e instanceof SaveError) return json({ error: e.message }, e.status);
    console.error("[saved-predictions] save failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not save" }, 500);
  }
}

const Remove = z.union([
  z.object({ predictionId: z.string().regex(/^[a-z0-9]{8,40}$/i) }).strict(),
  z.object({ savedId: z.string().regex(/^[a-z0-9]{8,40}$/i) }).strict(),
]);

export async function DELETE(req: NextRequest) {
  const auth = await requireAccount(req, { write: true, scope: "saved" });
  if (!auth.ok) return auth.response!;
  const parsed = Remove.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid id" }, 400);
  // Owner-scoped delete: another user's id matches nothing and reports 0,
  // indistinguishable from an id that never existed.
  const removed = await unsavePrediction(auth.userId, parsed.data);
  return json({ removed });
}
