import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { applyCategoryChanges, applyReviewAction, setPredictionCategories } from "@/lib/predictions";
import { HIDDEN_LEG_MESSAGE, isHiddenComboLeg } from "@/lib/comboLegs";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { z } from "zod";
import { DuplicateReviewRequired, MIN_OVERRIDE_REASON, duplicatePublishGuard, reviewFeaturedDuplicate, type DuplicateReview } from "@/lib/duplicatePublication";
import { curateBankerTips, curateGeniusTips } from "@/lib/geniusCuration";

/**
 * Apply one review action to several predictions at once.
 *
 * Exists because generation capacity and review capacity are decoupled: the
 * scheduler can produce up to 100 candidates a day and every one of them needs
 * a human decision, so approving them one request at a time is the actual
 * bottleneck. This changes only how many rows an action covers — never who
 * decides, and never the transition itself, which comes from the same
 * reviewTransition() the single-row route uses.
 *
 * Deliberately no auto-publish anywhere in this file: PUBLISH here is still an
 * explicit action a human took on a selection they made.
 */
export const maxDuration = 60;

/** Bounded so one request can't lock a large slice of the table. */
const MAX_BULK = 100;

const ids = z.array(z.string()).min(1).max(MAX_BULK);
const category = z.enum(PREDICTION_CATEGORIES);
const assignableCategory = z.enum(["FEATURED", "GENIUS", "BANKER", "VIP", "PREMIUM"]);
/**
 * Per-match decision for a duplicate FEATURED single. Skipping needs no entry:
 * a flagged row with no decision is simply not published. Publishing the
 * additional selection requires a written reason, recorded for audit.
 */
const duplicateDecisions = z.record(z.string(), z.object({
  choice: z.literal("PUBLISH_ADDITIONAL"),
  reason: z.string().trim().min(MIN_OVERRIDE_REASON).max(500),
})).optional();
const Body = z.union([
  z.object({ ids, action: z.enum(["APPROVE", "PUBLISH", "ARCHIVE"]), dryRun: z.boolean().optional(), duplicateDecisions }),
  z.object({ ids, action: z.literal("MANAGE_CATEGORIES"), add: z.array(assignableCategory), remove: z.array(category) }),
]).superRefine((value, ctx) => {
  if (value.action !== "MANAGE_CATEGORIES") return;
  if (value.add.length === 0 && value.remove.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one category to add or remove" });
  }
  if (value.add.some((c) => value.remove.includes(c))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A category cannot be both added and removed" });
  }
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { ids, action } = parsed.data;

  // Read first: PUBLISH's transition depends on whether each row was already
  // approved, so this cannot be a single updateMany.
  const rows = await prisma.prediction.findMany({
    where: { id: { in: ids } },
    include: { categories: true },
  });

  const publishing = action === "PUBLISH";
  const decisions = (parsed.data.action !== "MANAGE_CATEGORIES" ? parsed.data.duplicateDecisions : undefined) ?? {};

  // Pre-publication review: describe every clash BEFORE anything is written.
  if (publishing && parsed.data.action !== "MANAGE_CATEGORIES" && parsed.data.dryRun) {
    const reviews: DuplicateReview[] = [];
    for (const row of rows) {
      if (row.status === "PUBLISHED") continue;
      const review = await reviewFeaturedDuplicate(prisma, row);
      if (review) reviews.push(review);
    }
    const flagged = new Set(reviews.map((r) => r.predictionId));
    return NextResponse.json({ action, dryRun: true, reviews, clean: rows.filter((r) => r.status !== "PUBLISHED" && !flagged.has(r.id)).map((r) => r.id),
      missing: ids.filter((id) => !rows.some((r) => r.id === id)) });
  }

  const results: Array<{ id: string; ok: boolean; error?: string; review?: DuplicateReview; overridden?: boolean }> = [];
  for (const row of rows) {
    try {
      if (action === "MANAGE_CATEGORIES") {
        const current = row.categories.length ? row.categories.map((c) => c.category) : [row.category];
        // A hidden combo leg is refused outright, and said so, rather than
        // "succeeding" while setPredictionCategories quietly keeps it
        // SAME_GAME_DOUBLE-only. See src/lib/comboLegs.ts.
        if (isHiddenComboLeg(row.marketType, current)) {
          results.push({ id: row.id, ok: false, error: HIDDEN_LEG_MESSAGE });
          continue;
        }
        const next = applyCategoryChanges(current, parsed.data.add, parsed.data.remove);
        // The row already carries its market, so GOALS is derived without a re-read.
        await setPredictionCategories(row.id, next, row, undefined, { manual: true });
      } else {
        // Same transaction and events as the single-row route: a bulk publish
        // is how most tips go live, so it must notify followers too.
        // The duplicate review is re-run INSIDE the publish transaction (race
        // protection). Without a recorded decision a clash fails closed here:
        // nothing is published, deleted or rewritten.
        let overridden = false;
        await applyReviewAction(row, action, session!.user.id, duplicatePublishGuard({
          actorId: session!.user.id, predictionId: row.id, decision: decisions[row.id], onOverride: () => { overridden = true; },
        }));
        results.push({ id: row.id, ok: true, overridden });
        continue;
      }
      results.push({ id: row.id, ok: true });
    } catch (err: any) {
      if (err instanceof DuplicateReviewRequired) { results.push({ id: row.id, ok: false, review: err.review, error: "Needs duplicate review" }); continue; }
      results.push({ id: row.id, ok: false, error: err?.message ?? String(err) });
    }
  }

  // Bulk publish is how most tips go live: fill Genius and Banker from them straight away
  // (see the single-row route). Never fails the publish.
  if (action === "PUBLISH" && results.some((r) => r.ok)) {
    await curateGeniusTips().catch((err) => console.error("[genius] curation after publish failed", err));
    await curateBankerTips().catch((err) => console.error("[banker] curation after publish failed", err));
  }

  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  return NextResponse.json({
    action,
    updated: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok && !r.review),
    // Not published: the match already shows a FEATURED single. Needs a decision.
    needsReview: results.filter((r) => r.review).map((r) => r.review!),
    overridden: results.filter((r) => r.overridden).length,
    missing,
  });
}
