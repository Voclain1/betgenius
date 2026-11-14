import { Search, X } from "lucide-react";
import { OddsFigure } from "./OddsFigure";
import Link from "next/link";
import { getViewerEntitlement } from "@/lib/viewerEntitlement";
import {
  getPersonalization,
  savedPredictionIds,
} from "@/lib/personalizationData";
import { loadDiscovery } from "@/lib/predictionDiscoveryData";
import {
  parseDiscovery,
  discoveryHref,
  MARKET_LABELS,
  type DiscoveryParams,
  type DiscoveryFilter,
} from "@/lib/predictionDiscovery";
import {
  CATEGORY_TO_SLUG,
  CATEGORY_CHIP_LABELS,
  CATEGORY_SLUGS,
} from "@/lib/categoryPredictions";
import { activeFilters, emptyState, withoutFilter } from "@/lib/discoveryFilters";
import type { PredictionCategory } from "@/lib/enums";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { SavePredictionButton } from "./SavePredictionButton";

export function DiscoveryEntry() {
  return (
    <Link
      id="home-match-search"
      href="/predictions#discover"
      aria-label="Find a match"
      title="Find a match"
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 text-sm font-semibold text-gray-300 hover:text-brand"
    >
      <Search aria-hidden className="h-4 w-4" /><span className="hidden sm:inline">Find a match</span><span aria-hidden className="hidden sm:inline">→</span>
    </Link>
  );
}

const control =
  "min-h-11 w-full min-w-0 rounded-xl border border-brand-border bg-brand-bg px-3 py-2 text-sm text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
export function DiscoveryFilters({
  filter: f,
  basePath,
  category,
  signedIn,
  fallbackDay,
  publishedCompetitions = [],
  params = {},
}: {
  filter: DiscoveryFilter;
  basePath: string;
  category?: PredictionCategory;
  signedIn: boolean;
  fallbackDay?: string;
  publishedCompetitions?: Array<{ id: number; name: string }>;
  params?: DiscoveryParams;
}) {
  const competitions = new Map<number, { id: number; name: string }>(
    LEAGUE_CATALOGUE.map((l) => [l.id, { id: l.id, name: l.name }]),
  );
  for (const l of publishedCompetitions)
    if (!competitions.has(l.id)) competitions.set(l.id, l);
  if (f.competition && !competitions.has(f.competition))
    competitions.set(f.competition, {
      id: f.competition,
      name: `Competition #${f.competition}`,
    });
  // What differs from the unfiltered page, each one removable in a single tap.
  const active = activeFilters(f, {
    competition: f.competition != null ? competitions.get(f.competition)?.name : undefined,
    category: f.category && CATEGORY_SLUGS[f.category] ? CATEGORY_CHIP_LABELS[CATEGORY_SLUGS[f.category]] : undefined,
  });
  return (
    <form
      method="get"
      action={`${basePath}#discover`}
      className="space-y-3"
      aria-label="Filter published predictions"
    >
      {fallbackDay && fallbackDay !== "today" && (
        <input type="hidden" name="date" value={fallbackDay} />
      )}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
        <label className="min-w-0 text-xs text-gray-400">
          Team
          <input
            type="search"
            name="d_team"
            defaultValue={f.team}
            maxLength={80}
            placeholder="Search either team"
            className={`${control} mt-1`}
          />
        </label>
        <button
          type="submit"
          aria-label="Find predictions"
          className="btn btn-primary min-h-11 self-end justify-center"
        >
          Search
        </button>
      </div>
      {active.length > 0 && (
        <nav aria-label="Active filters">
          <ul className="flex flex-wrap gap-2">
            {active.map((a) => (
              <li key={a.key}>
                <Link
                  href={withoutFilter(basePath, params, a.key)}
                  aria-label={`Remove filter: ${a.label}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-brand-border px-2.5 text-xs font-semibold text-gray-200 hover:border-brand hover:text-brand"
                >
                  {a.label}
                  <X aria-hidden className="h-3 w-3 text-gray-500" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <details className="border-t border-brand-border pt-2">
        <summary className="cursor-pointer py-1 text-sm font-semibold text-gray-300">
          Filters{" "}
          <span className="font-normal text-gray-500">
            · {active.length ? `${active.length} active` : "date, competition, market & more"}
          </span>
        </summary>
        <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {" "}
          <label className="min-w-0 text-xs text-gray-400">
            Date · {f.zone}
            <input
              type="date"
              name="d_date"
              defaultValue={f.date}
              className={`${control} mt-1`}
            />
          </label>
          <label className="min-w-0 text-xs text-gray-400">
            Competition
            <select
              name="d_competition"
              defaultValue={f.competition ?? ""}
              className={`${control} mt-1`}
            >
              <option value="">All competitions</option>
              {[...competitions.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Market
            <select
              name="d_market"
              defaultValue={f.market}
              className={`${control} mt-1`}
            >
              <option value="">All markets</option>
              {Object.entries(MARKET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Match status
            <select
              name="d_state"
              defaultValue={f.state}
              className={`${control} mt-1`}
            >
              <option value="upcoming">Upcoming only</option>
              <option value="live">Started / awaiting result</option>
              <option value="finished">Finished</option>
              <option value="all">All statuses</option>
            </select>
          </label>
          <label className="text-xs text-gray-400">
            Kickoff window · {f.zone}
            <select
              name="d_window"
              defaultValue={f.window}
              className={`${control} mt-1`}
            >
              <option value="all">Any time</option>
              <option value="morning">Before 12:00</option>
              <option value="afternoon">12:00–18:00</option>
              <option value="evening">From 18:00</option>
              <option value="next6">Next 6 hours</option>
            </select>
          </label>
          {!category && (
            <label className="text-xs text-gray-400">
              Published category
              <select
                name="d_category"
                defaultValue={f.category}
                className={`${control} mt-1`}
              >
                <option value="">All accessible categories</option>
                {Object.entries(CATEGORY_TO_SLUG)
                  .filter(([c]) => c !== "TODAY")
                  .map(([c, s]) => (
                    <option key={c} value={s}>
                      {CATEGORY_CHIP_LABELS[c as PredictionCategory]}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {signedIn && (
            <label className="text-xs text-gray-400">
              Your interests
              <select
                name="d_personal"
                defaultValue={f.personal}
                className={`${control} mt-1`}
              >
                <option value="all">Browse everything</option>
                <option value="favourites">Followed teams & competitions</option>
                <option value="markets">Preferred markets</option>
                <option value="saved">Saved predictions</option>
              </select>
            </label>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              name="d_odds"
              value="quoted"
              defaultChecked={f.odds}
              className="h-5 w-5 accent-brand"
            />
            Only with a bookmaker quote
          </label>
        </div>
        {!signedIn && (
          <p className="mt-3 text-xs text-gray-500">
            <Link href="/login" className="text-brand underline">
              Sign in
            </Link>{" "}
            to filter by your followed teams, preferred markets and saved picks.
          </p>
        )}
        <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
          <Link
            href={`${basePath}#discover`}
            className="inline-flex min-h-11 shrink-0 items-center text-brand underline"
          >
            Reset filters
          </Link>
        </div>{" "}
      </details>
    </form>
  );
}

type ResultItem = Awaited<ReturnType<typeof loadDiscovery>>["items"][number];

const stampIn = (at: Date, zone: string) =>
  at.toLocaleString("en-GB", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * One match in the results. The whole card opens the match through the title
 * link (a stretched link, as the tip table rows do), so there is one link per
 * card instead of two to the same page; the save button sits above it. A
 * bookmaker quote is shown when there is one; the absence of one is not
 * repeated on every card (the "with a bookmaker quote" filter says it once).
 */
export function DiscoveryResultCard({ item: p, zone, savedFilter = false }: { item: ResultItem; zone: string; savedFilter?: boolean }) {
  return (
    <article className="card relative min-w-0 space-y-2 !p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-brand">{CATEGORY_CHIP_LABELS[p.category]}</span>
        <SavePredictionButton predictionId={p.id} source="card" initiallySaved={savedFilter ? true : undefined} className="relative z-10 !h-11 !w-11" />
      </div>
      <div>
        <p className="truncate text-xs text-gray-500">{p.league ?? "Competition unavailable"}</p>
        <h3 className="mt-1 break-words font-bold text-gray-100">
          <Link href={p.href} className="after:absolute after:inset-0 hover:text-brand">
            {p.home} <span className="font-normal text-gray-500">vs</span> {p.away}
          </Link>
        </h3>
        <p className="mt-1 text-xs text-gray-400">
          {stampIn(p.kickoff, zone)} ·{" "}
          {p.phase === "started"
            ? (p.statusLabel ?? "Started · result unconfirmed")
            : p.phase === "live"
              ? "Started / awaiting result"
              : p.phase === "unavailable"
                ? "Schedule / status review"
                : p.phase}
          {!p.statusVerified && p.phase === "upcoming" ? " · stored schedule" : ""}
        </p>
      </div>
      <div className="border-t border-brand-border pt-3">
        <p className="text-[11px] text-gray-500">{p.market}</p>
        <p className="break-words text-sm font-bold text-gray-100">{p.pick}</p>
      </div>
      {p.quote && (
        <p className="text-xs leading-relaxed text-gray-400">
          <OddsFigure value={p.quote.decimal} /> · {p.quote.bookmaker} · {p.quote.kind === "archived" ? "archived quote" : "cached quote"}
          <span className="block text-[11px]">
            {p.quote.timeBasis === "provider" ? "Provider quote" : "Cache fetched"} {stampIn(p.quote.at, zone)} · {zone}
          </span>
        </p>
      )}
    </article>
  );
}

/** No results: what the search was limited by, and the links that most often fix it. */
export function DiscoveryEmpty({ state }: { state: ReturnType<typeof emptyState> }) {
  return (
    <div className="card space-y-2 text-sm text-gray-400" role="status">
      <p>{state.text}</p>
      {state.actions.length > 0 && (
        <p className="flex flex-wrap gap-x-4">
          {state.actions.map((a) => (
            <Link key={a.label} href={a.href} className="inline-flex min-h-11 items-center font-semibold text-brand underline">
              {a.label}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

export async function PredictionDiscovery({
  params = {},
  basePath = "/predictions",
  category,
  results = true,
  fallbackDay = "today",
}: {
  params?: DiscoveryParams;
  basePath?: string;
  category?: PredictionCategory;
  results?: boolean;
  fallbackDay?: string;
}) {
  const viewer = await getViewerEntitlement();
  const state = viewer.userId ? await getPersonalization(viewer.userId) : null;
  const f = parseDiscovery(params, state?.timezone, new Date(), fallbackDay);
  if (!viewer.userId && f.personal !== "all") {
    f.personal = "all";
    f.notices.push(
      "Sign in to filter by your interests. Showing accessible published predictions instead.",
    );
  }
  const interests = {
    teams: state?.teams.map((t) => t.id) ?? [],
    leagues: state?.leagues.map((l) => l.id) ?? [],
    markets: state?.preferredMarkets ?? [],
    saved:
      viewer.userId && f.personal === "saved"
        ? await savedPredictionIds(viewer.userId)
        : [],
  };
  const data = results
    ? await loadDiscovery(f, viewer, category, interests)
    : null;
  return (
    <section
      id="discover"
      aria-labelledby="discovery-heading"
      className="min-w-0 scroll-mt-28 space-y-4"
    >
      <h2 id="discovery-heading" className="sr-only">
        Match finder
      </h2>
      {category ? (
        <details className="group border-y border-brand-border py-1">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm font-semibold text-gray-300">
            Filter predictions{" "}
            <span aria-hidden className="text-brand">
              +
            </span>
          </summary>
          <div className="pb-3">
            {" "}
            <DiscoveryFilters
              filter={f}
              basePath={basePath}
              category={category}
              signedIn={!!viewer.userId}
              fallbackDay={fallbackDay}
              params={params}
              publishedCompetitions={data?.items.flatMap((p) =>
                p.leagueApiId && p.league
                  ? [{ id: p.leagueApiId, name: p.league }]
                  : [],
              )}
            />
          </div>
        </details>
      ) : (
        <div className="border-y border-brand-border py-4">
          {" "}
          <DiscoveryFilters
            filter={f}
            basePath={basePath}
            category={category}
            signedIn={!!viewer.userId}
            fallbackDay={fallbackDay}
            params={params}
            publishedCompetitions={data?.items.flatMap((p) =>
              p.leagueApiId && p.league
                ? [{ id: p.leagueApiId, name: p.league }]
                : [],
            )}
          />
        </div>
      )}
      {f.notices.map((n) => (
        <p role="status" key={n} className="text-sm text-gray-400">
          {n}
        </p>
      ))}
      {data?.locked ? (
        <div className="card text-sm text-gray-400">
          This category requires access.{" "}
          <Link
            href={
              category === "BANKER" || f.category === "banker"
                ? "/login"
                : "/pricing"
            }
            className="text-brand underline"
          >
            View access options
          </Link>
          .
        </div>
      ) : (
        data && (
          <>
            <p className="text-sm text-gray-400" aria-live="polite">
              {data.matched} matching published{" "}
              {data.matched === 1 ? "prediction" : "predictions"} · {f.date} ·{" "}
              {f.zone}.{" "}
              {data.truncated &&
                "Results are limited to the first 300 candidates; narrow your filters to explore more."}
            </p>
            {data.items.length ? (
              <div className="grid min-w-0 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {data.items.map((p) => (
                  <DiscoveryResultCard
                    key={p.id}
                    item={p}
                    zone={f.zone}
                    savedFilter={f.personal === "saved"}
                  />
                ))}
              </div>
            ) : (
              <DiscoveryEmpty
                state={emptyState(f, basePath, params, {
                  competition: f.competition != null ? data.items.find((p) => p.leagueApiId === f.competition)?.league ?? LEAGUE_CATALOGUE.find((l) => l.id === f.competition)?.name : undefined,
                })}
              />
            )}
            {data.pages > 1 && (
              <nav
                aria-label="Discovery pagination"
                className="flex items-center justify-between gap-3 text-sm"
              >
                {data.page > 1 ? (
                  <Link
                    className="btn min-h-11"
                    href={discoveryHref(basePath, params, data.page - 1)}
                  >
                    Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-gray-400">
                  Page {data.page} of {data.pages}
                </span>
                {data.page < data.pages ? (
                  <Link
                    className="btn min-h-11"
                    href={discoveryHref(basePath, params, data.page + 1)}
                  >
                    Next
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </>
        )
      )}
    </section>
  );
}
