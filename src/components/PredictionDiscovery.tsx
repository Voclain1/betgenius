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
} from "@/lib/categoryPredictions";
import type { PredictionCategory } from "@/lib/enums";
import { LEAGUE_CATALOGUE } from "@/lib/leagues";
import { SavePredictionButton } from "./SavePredictionButton";

const control =
  "min-h-11 w-full min-w-0 rounded-xl border border-brand-border bg-brand-bg px-3 py-2 text-sm text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
export function DiscoveryFilters({
  filter: f,
  basePath,
  category,
  signedIn,
  fallbackDay,
  publishedCompetitions = [],
}: {
  filter: DiscoveryFilter;
  basePath: string;
  category?: PredictionCategory;
  signedIn: boolean;
  fallbackDay?: string;
  publishedCompetitions?: Array<{ id: number; name: string }>;
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
  const active = [
    f.competition != null,
    !!f.market,
    f.window !== "all",
    f.odds,
    f.personal !== "all",
    !!f.category,
    f.state !== "upcoming",
  ].filter(Boolean).length;
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
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
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
          className="btn btn-primary col-span-2 min-h-11 self-end justify-center sm:col-span-1"
        >
          Find predictions
        </button>
      </div>
      <details className="rounded-xl border border-brand-border p-3">
        <summary className="cursor-pointer py-1 text-sm font-semibold text-gray-300">
          More filters{" "}
          <span className="font-normal text-gray-500">
            · {active ? `${active} active` : "competition, market & favourites"}
          </span>
        </summary>
        <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              <option value="live">Cached live status</option>
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
          <label className="flex min-h-11 items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              name="d_odds"
              value="quoted"
              defaultChecked={f.odds}
              className="h-5 w-5 accent-brand"
            />
            Only with usable named quotes
          </label>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-gray-500">
          {signedIn ? (
            <>
              Interests use your existing{" "}
              <Link
                href="/dashboard/preferences"
                className="text-brand underline"
              >
                preferences
              </Link>{" "}
              and{" "}
              <Link href="/dashboard/saved" className="text-brand underline">
                saved picks
              </Link>
              . Access is checked on every visit.
            </>
          ) : (
            <>
              Browsing is open to everyone.{" "}
              <Link href="/login" className="text-brand underline">
                Sign in
              </Link>{" "}
              to use your favourites, preferred markets and saved picks.
            </>
          )}
        </p>
      </details>
      <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
        <span>
          Filters are shareable; personal results depend on who is signed in.
        </span>
        <Link
          href={`${basePath}#discover`}
          className="inline-flex min-h-11 shrink-0 items-center text-brand underline"
        >
          Reset filters
        </Link>
      </div>
    </form>
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
  const stamp = (at: Date) =>
    at.toLocaleString("en-GB", {
      timeZone: f.zone,
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section
      id="discover"
      aria-labelledby="discovery-heading"
      className="min-w-0 scroll-mt-28 space-y-4"
    >
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
          Match finder
        </p>
        <h2
          id="discovery-heading"
          className="mt-1 text-xl font-bold text-gray-100"
        >
          {category
            ? "Refine this prediction feed"
            : "Find published predictions"}
        </h2>
        <p className="mt-1 text-sm text-gray-400">
          Choose a fixture, then compare its published markets and match
          evidence.
        </p>
      </div>
      <div className="card min-w-0">
        <DiscoveryFilters
          filter={f}
          basePath={basePath}
          category={category}
          signedIn={!!viewer.userId}
          fallbackDay={fallbackDay}
          publishedCompetitions={data?.items.flatMap((p) =>
            p.leagueApiId && p.league
              ? [{ id: p.leagueApiId, name: p.league }]
              : [],
          )}
        />
      </div>
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
                  <article key={p.id} className="card min-w-0 space-y-3 !p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brand">
                        {CATEGORY_CHIP_LABELS[p.category]}
                      </span>
                      <SavePredictionButton
                        predictionId={p.id}
                        source="card"
                        initiallySaved={
                          f.personal === "saved" ? true : undefined
                        }
                        className="!h-11 !w-11"
                      />
                    </div>
                    <div>
                      <p className="truncate text-xs text-gray-500">
                        {p.league ?? "Competition unavailable"}
                      </p>
                      <h3 className="mt-1 break-words font-bold text-gray-100">
                        <Link href={p.href} className="hover:text-brand">
                          {p.home}{" "}
                          <span className="font-normal text-gray-500">vs</span>{" "}
                          {p.away}
                        </Link>
                      </h3>
                      <p className="mt-1 text-xs text-gray-400">
                        {stamp(p.kickoff)} ·{" "}
                        {p.phase === "started"
                          ? "Started · status unavailable"
                          : p.phase === "live"
                            ? "Cached live status"
                            : p.phase === "unavailable"
                              ? "Schedule / status review"
                              : p.phase}
                        {!p.statusVerified && p.phase === "upcoming"
                          ? " · stored schedule"
                          : ""}
                      </p>
                    </div>
                    <div className="border-t border-brand-border pt-3">
                      <p className="text-[11px] text-gray-500">{p.market}</p>
                      <p className="break-words text-sm font-bold text-gray-100">
                        {p.pick}
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed text-gray-400">
                      {p.quote ? (
                        <>
                          {p.quote.decimal.toFixed(2)} · {p.quote.bookmaker} ·{" "}
                          {p.quote.kind === "archived"
                            ? "archived quote"
                            : "cached quote"}
                          <br />
                          {p.quote.timeBasis === "provider"
                            ? "Provider quote"
                            : "Cache fetched"}{" "}
                          {stamp(p.quote.at)} · {f.zone}
                        </>
                      ) : (
                        "No usable named quote for this selection."
                      )}
                    </p>
                    <Link
                      href={`${p.href}#evidence-guide`}
                      className="inline-flex min-h-11 items-center text-sm font-semibold text-brand"
                    >
                      Evidence & markets →
                    </Link>
                  </article>
                ))}
              </div>
            ) : (
              <div className="card text-sm text-gray-400">
                No accessible published predictions match these filters. Try
                another date or broaden the market, status or interests filters.
                A quiet feed does not lower the publication standard.
              </div>
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
