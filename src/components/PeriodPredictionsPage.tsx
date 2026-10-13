import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import { categoryFeedWhere } from "@/lib/categoryPredictions";
import { orderForDisplay } from "@/lib/predictionOrdering";
import { lagosDateKey } from "@/lib/lagosDate";
import { JsonLd, breadcrumbJsonLd } from "@/lib/seo";
import { CategoryMasthead } from "@/components/CategoryMasthead";
import { CategoryPredictionsList } from "@/components/CategoryPredictionsList";
import { SectionHead } from "@/components/TeamProfile";
import {
  PERIODS,
  PERIOD_BANKER_FLOOR,
  PERIOD_MAX_BANKERS,
  PERIOD_MAX_GAMES,
  PERIOD_PICK_FLOOR,
  periodWindow,
  picksArriveFrom,
  selectPeriodList,
  type PeriodKind,
  type PeriodWindow,
} from "@/lib/periodPredictions";

/**
 * /predictions/weekend and /predictions/midweek. The rules (which days, which
 * Banker) are in src/lib/periodPredictions.ts; this reads and renders.
 *
 * The candidates are the Today feed's rows (hidden combo legs and paid-only
 * picks excluded) across the period's days; selectPeriodList keeps the strong
 * ones.
 */

const DAY_LABEL = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long" });
const SHORT_LABEL = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });
const WEEKDAY = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "long" });

/** One read per request, shared by generateMetadata and the page. */
const getPeriodRows = cache(async (kind: PeriodKind, startIso: string, endIso: string) => {
  void kind;
  const rows = await prisma.prediction.findMany({
    where: { ...categoryFeedWhere("TODAY"), kickoff: { gte: new Date(startIso), lt: new Date(endIso) } },
    orderBy: [{ kickoff: "asc" }, { id: "asc" }],
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
    take: 300,
  });
  return orderForDisplay(rows);
});

function rowsFor(window: PeriodWindow) {
  return getPeriodRows(window.kind, window.start.toISOString(), window.end.toISOString());
}

function periodLabel(window: PeriodWindow): string {
  const first = window.days[0].start;
  const last = window.days[window.days.length - 1].start;
  return `${SHORT_LABEL.format(first)} – ${SHORT_LABEL.format(last)} · West Africa Time`;
}

export async function periodMetadata(kind: PeriodKind): Promise<Metadata> {
  const period = PERIODS[kind];
  const window = periodWindow(kind);
  const { bankers, picks } = selectPeriodList(await rowsFor(window));
  const count = bankers.length + picks.length;
  if (count === 0) {
    return {
      title: period.title,
      description: `${period.name} are not published yet. Picks for each day are added up to two days before kickoff, and only those at ${PERIOD_PICK_FLOOR}% confidence or more are listed.`,
      robots: { index: false, follow: true },
      alternates: { canonical: period.path },
    };
  }
  return {
    title: period.title,
    description: `The ${count} strongest football predictions for ${periodLabel(window).replace(" · West Africa Time", "")}, each at ${PERIOD_PICK_FLOOR}% confidence or more, with the ${period.bankerTitle.toLowerCase()}.`,
    alternates: { canonical: period.path },
  };
}

export async function PeriodPredictionsPage({ kind }: { kind: PeriodKind }) {
  const period = PERIODS[kind];
  const now = new Date();
  const window = periodWindow(kind, now);
  const rows = await rowsFor(window);
  const todayKey = lagosDateKey(now);

  const session = await getServerSession(authOptions);
  const viewer = await getViewerEntitlement();
  const canViewBanker = canViewCategory("BANKER", viewer.tier, viewer.status, viewer.role);
  const needsRegistration = !canViewBanker && !session?.user;

  // Outcomes only for days already over, as the feeds do for yesterday.
  const shape = (r: (typeof rows)[number], category: "TODAY" | "BANKER", locked: boolean) => {
    const settledDay = !!r.kickoff && lagosDateKey(r.kickoff) < todayKey;
    const base = { ...r, category, outcome: settledDay ? r.outcome : null };
    return locked
      ? {
          ...base,
          pick: "LOCKED",
          reasoning: needsRegistration ? "Sign up free to unlock this tip and full reasoning." : "Subscribe to unlock this tip and full reasoning.",
          matchPreview: null,
          confidence: null,
          odds: null,
          overUnder: null,
          locked: true,
        }
      : base;
  };

  const list = selectPeriodList(rows);
  const bankers = orderForDisplay(list.bankers).map((r) => shape(r, "BANKER", !canViewBanker));
  // The rest of the list, by day, in the feeds' display order. Banker matches
  // are listed once, in the Banker.
  const listed = new Set(list.picks.map((r) => r.id));
  const byDay = window.days.map((day) => ({
    day,
    rows: rows.filter((r) => listed.has(r.id) && r.kickoff && lagosDateKey(r.kickoff) === day.key).map((r) => shape(r, "TODAY", false)),
  }));
  const firstWithRows = byDay.findIndex((d) => d.rows.length > 0);

  const lead = window.state === "finished"
    ? `The last ${kind === "weekend" ? "weekend" : "midweek run"} and how it went. The next one opens here on ${WEEKDAY.format(picksArriveFrom({ ...window.days[0], start: new Date(window.days[0].start.getTime() + 7 * 24 * 3_600_000) }))}.`
    : "Picks for each day are added up to two days before kickoff, so the later days fill in as the period approaches.";

  return (
    <div className="space-y-8 sm:space-y-10">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Predictions", path: "/predictions" },
            { name: period.name, path: period.path },
          ]),
        ]}
      />
      <CategoryMasthead
        kicker={kind === "weekend" ? "Friday to Sunday" : "Tuesday to Thursday"}
        title={period.title}
        blurb={period.blurb}
        dateLabel={periodLabel(window)}
        stats={[]}
        actions={
          needsRegistration ? (
            <Link href="/register" className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-black text-on-brand transition hover:bg-brand-dark">
              Sign up free to see the {period.bankerTitle}
            </Link>
          ) : null
        }
      />

      <p className="max-w-3xl text-sm leading-7 text-gray-400">
        {lead} This is a short list, not the whole card: only picks at {PERIOD_PICK_FLOOR}% confidence or more, the strongest pick per match, and no more than {PERIOD_MAX_GAMES} matches. A thin period gets fewer picks, never weaker ones.
      </p>

      <section aria-labelledby={`${kind}-banker`}>
        <SectionHead kicker="Strongest calls" title={period.bankerTitle} id={`${kind}-banker`} />
        <p className="mb-4 max-w-3xl text-sm leading-6 text-gray-400">
          The strongest calls across the {kind === "weekend" ? "weekend" : "three days"}, from any competition: at least {PERIOD_BANKER_FLOOR}% confidence, one per match, up to {PERIOD_MAX_BANKERS}. It grows as each day&apos;s picks are published.
        </p>
        {bankers.length > 0 ? (
          <CategoryPredictionsList category="BANKER" rows={bankers as any} view="detailed" />
        ) : (
          <div className="card text-sm text-gray-400">No pick has cleared the {PERIOD_BANKER_FLOOR}% bar for this period yet.</div>
        )}
      </section>

      {byDay.map(({ day, rows: dayRows }, i) => {
        const label = DAY_LABEL.format(day.start);
        const notYet = dayRows.length === 0 && day.start.getTime() > now.getTime();
        return (
          <section key={day.key} aria-labelledby={`${kind}-${day.key}`} className="border-t border-brand-border pt-8">
            <SectionHead kicker={day.key === todayKey ? "Today" : WEEKDAY.format(day.start)} title={label} id={`${kind}-${day.key}`} />
            {dayRows.length > 0 ? (
              <CategoryPredictionsList category="TODAY" rows={dayRows as any} withAds={i === firstWithRows} />
            ) : (
              <div className="card text-sm text-gray-400">
                {notYet
                  ? `${WEEKDAY.format(day.start)}'s picks are added from ${WEEKDAY.format(picksArriveFrom(day))}, as matches come inside two days of kickoff.`
                  : `No other pick for this day cleared the ${PERIOD_PICK_FLOOR}% bar.`}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
