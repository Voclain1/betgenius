import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { setPredictionCategories, reviewTransition } from "@/lib/predictions";
import { setBetOfTheDay } from "@/lib/betOfTheDay";
import { ADMIN_MARKET_TYPES, isValidSelection, deriveMarketAndPick, deriveOverUnderText } from "@/lib/markets";
import { z } from "zod";
import { normalizeLeagueName } from "@/lib/leagues";
import { recordPredictionEvents } from "@/lib/notifications";
import { broadcastTopPrediction } from "@/lib/topPredictions";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prediction = await prisma.prediction.findUnique({
    where: { id: params.id },
    include: {
      categories: true,
      fixture: { include: { homeTeam: true, awayTeam: true, league: true } },
      author: { select: { name: true, email: true } },
      settledBy: { select: { name: true, email: true } },
      rewriteRequestedBy: { select: { name: true, email: true } },
    },
  });
  if (!prediction) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ prediction });
}

const Patch = z.object({
  action: z.enum(["APPROVE", "PUBLISH", "ARCHIVE", "EDIT", "SETTLE", "PIN_BET_OF_THE_DAY", "NOTIFY_TOP_PREDICTION"]),
  patch: z
    .object({
      outcome: z.enum(["PENDING", "WON", "LOST", "VOID"]).optional(),
      finalHomeScore: z.number().int().min(0).nullable().optional(),
      finalAwayScore: z.number().int().min(0).nullable().optional(),
      confidence: z.number().min(0).max(100).optional(),
      reasoning: z.string().optional(),
      matchPreview: z.string().optional(),
      // BET_OF_THE_DAY is deliberately NOT settable here. The generic category
      // editor writes via setPredictionCategories, which replaces one row's
      // tags with no visibility of any other row — so allowing it would let two
      // predictions hold the single slot at once. It moves only through the
      // PIN_BET_OF_THE_DAY action below, which is transactional.
      categories: z.array(z.enum(["FEATURED", "GENIUS", "TODAY", "BANKER", "VIP", "PREMIUM"])).min(1).optional(),
      leagueApiId: z.number().nullable().optional(),
      leagueName: z.string().nullable().optional(),
      homeTeam: z.string().nullable().optional(),
      awayTeam: z.string().nullable().optional(),
      kickoff: z.coerce.date().nullable().optional(),
      marketType: z.enum(ADMIN_MARKET_TYPES).optional(),
      selection: z.any().optional(),
      otherMarket: z.string().optional(),
      otherPick: z.string().optional(),
      ouLine: z.number().positive().nullable().optional(),
      ouDirection: z.enum(["OVER", "UNDER"]).nullable().optional(),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action, patch } = parsed.data;
  const before = await prisma.prediction.findUnique({ where: { id: params.id }, include: { categories: true } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { categories, marketType, selection, otherMarket, otherPick, ouLine, ouDirection, outcome, finalHomeScore, finalAwayScore, ...rest } =
    patch ?? {};
  const data: any = { ...rest };
  if (rest.leagueName !== undefined) {
    const leagueName = rest.leagueName === null ? null : normalizeLeagueName(rest.leagueName);
    if (rest.leagueName !== null && !leagueName) {
      return NextResponse.json({ error: "leagueName must be a real competition name, not a placeholder" }, { status: 400 });
    }
    data.leagueName = leagueName;
  }

  if (marketType) {
    if (marketType === "OTHER") {
      if (!otherMarket || !otherPick) {
        return NextResponse.json({ error: "market and pick are required when market type is Other" }, { status: 400 });
      }
      data.marketType = marketType;
      data.selection = Prisma.DbNull;
      data.manualSettlementOnly = true;
      data.market = otherMarket;
      data.pick = otherPick;
    } else if (!isValidSelection(marketType, selection)) {
      return NextResponse.json({ error: `Selection is incomplete for market type ${marketType}` }, { status: 400 });
    } else {
      const { market, pick } = deriveMarketAndPick(marketType, selection, rest.homeTeam ?? undefined, rest.awayTeam ?? undefined);
      data.marketType = marketType;
      data.selection = selection;
      data.manualSettlementOnly = false;
      data.market = market;
      data.pick = pick;
    }
  }

  if (ouLine !== undefined || ouDirection !== undefined) {
    data.ouLine = ouLine ?? null;
    data.ouDirection = ouDirection ?? null;
    data.overUnder = deriveOverUnderText(data.ouLine, data.ouDirection);
  }

  if (action === "NOTIFY_TOP_PREDICTION") {
    // Returned early for the same reason as the pin below: this is not a field
    // patch, and falling through would write `data` as well.
    //
    // The route ENQUEUES AN EVENT and nothing else. It does not import web-push,
    // does not load subscriptions and does not know who the recipients are -
    // all of that is the dispatcher's job, reached on its own schedule. An
    // admin page that sent pushes directly would be a second delivery system
    // with none of the pipeline's preference checks, caps or retries.
    //
    // The source is derived from the tags the row already holds rather than
    // asked for, so one button covers every editorial case and an admin cannot
    // mislabel a broadcast.
    const source = before.categories.some((c) => c.category === "BET_OF_THE_DAY")
      ? "BET_OF_THE_DAY"
      : before.categories.some((c) => c.category === "BANKER")
        ? "BANKER"
        : "ADMIN_PINNED";
    const result = await broadcastTopPrediction(params.id, source);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason === "not-found" ? "Not found" : "Only a PUBLISHED, unsettled prediction can be featured as a notification" },
        { status: result.reason === "not-found" ? 404 : 400 },
      );
    }
    // Idempotent: a repeat press finds the same eventKey and reports it rather
    // than broadcasting again. See broadcastTopPrediction.
    return NextResponse.json({ ok: true, source, alreadyBroadcast: result.alreadyBroadcast });
  }

  if (action === "PIN_BET_OF_THE_DAY") {
    // Handled entirely by setBetOfTheDay's transaction and returned early:
    // moving the tag is not a field patch, and letting it fall through to the
    // generic update below would write `data` a second time.
    const target = await prisma.prediction.findUnique({ where: { id: params.id }, select: { status: true } });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (target.status !== "PUBLISHED") {
      return NextResponse.json({ error: "Only a PUBLISHED prediction can be pinned as Bet of the Day" }, { status: 400 });
    }
    const pinned = await setBetOfTheDay(params.id, session!.user.id);
    return NextResponse.json({ prediction: pinned, pinned: true });
  }

  if (action === "APPROVE" || action === "PUBLISH" || action === "ARCHIVE") {
    // Shared with the bulk endpoint so the two can't drift — see
    // reviewTransition in src/lib/predictions.ts.
    const existing = await prisma.prediction.findUnique({ where: { id: params.id }, select: { approvedById: true } });
    Object.assign(data, reviewTransition(action, session!.user.id, { approvedById: data.approvedById ?? existing?.approvedById ?? null }));
  } else if (action === "SETTLE") {
    if (!outcome) return NextResponse.json({ error: "outcome is required to settle a prediction" }, { status: 400 });
    data.outcome = outcome;
    data.settledById = session!.user.id;
    data.settledAt = new Date();
    data.settlementNote = null;
    if (finalHomeScore !== undefined) data.finalHomeScore = finalHomeScore;
    if (finalAwayScore !== undefined) data.finalAwayScore = finalAwayScore;
  }

  if (categories) {
    // The editor cannot see or send BET_OF_THE_DAY (it is not one of its
    // checkboxes), so a plain replace would silently strip the slot off this
    // row the next time anyone saved an unrelated field. Carry the tag through
    // if the row already holds it — only the pin action moves it.
    const held = await prisma.predictionCategoryLink.findFirst({
      where: { predictionId: params.id, category: "BET_OF_THE_DAY" },
      select: { id: true },
    });
    await setPredictionCategories(params.id, held ? [...categories, "BET_OF_THE_DAY"] : categories);
  }
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.prediction.update({ where: { id: params.id }, data, include: { categories: true } });
    await recordPredictionEvents(tx, before, row, action);
    return row;
  });
  return NextResponse.json({ prediction: updated });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.prediction.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
