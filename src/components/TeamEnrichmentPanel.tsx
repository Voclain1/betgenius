import { getTeamEnrichment } from "@/lib/predictionScope";
import { computeFormRating, MIN_FORM_SAMPLE } from "@/lib/form";
import { FormRatingBadge } from "@/components/FormRatingBadge";
import type { TeamStatsSummary, TeamFixtureSummary, TeamCoach } from "@/lib/enrichment";

const resultStyles: Record<string, string> = {
  W: "bg-emerald-500/20 text-emerald-300",
  D: "bg-gray-500/20 text-gray-300",
  L: "bg-red-500/20 text-red-300",
  "?": "bg-gray-500/10 text-gray-500",
};

/**
 * Crest/form/stats for a team page. Renders nothing at all (not an empty
 * card) when no successful cache refresh has landed yet — see
 * getTeamEnrichment in predictionScope.ts for what "no successful refresh"
 * covers (never attempted, or attempted and failed, e.g. today's free-plan
 * rejection — both look the same to this component).
 */
export async function TeamEnrichmentPanel({ teamApiId }: { teamApiId: number | null }) {
  const row = await getTeamEnrichment(teamApiId);
  if (!row) return null;

  const stats = (row.statsJson as unknown as TeamStatsSummary | null) ?? null;
  const fixtures = (row.lastFixtures as unknown as TeamFixtureSummary[] | null) ?? null;
  const rating = computeFormRating(fixtures);
  const coach = (row.coachJson as unknown as TeamCoach | null) ?? null;
  const hasStatTiles = stats && (stats.played != null || stats.goalsFor != null);

  if (!row.crestUrl && !row.form && !hasStatTiles && !fixtures?.length && !row.venueName && !row.squadFetchedAt) return null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {row.crestUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.crestUrl}
              alt=""
              width={28}
              height={28}
              className="shrink-0 rounded-sm object-contain"
            />
          )}
          <span className="text-sm font-medium text-gray-300">Team form</span>
        </div>
      </div>

      {/* Venue: nothing at all when the cache has no stadium for this club,
          rather than a placeholder row. Capacity and city each degrade
          independently, so a club with a named ground but no capacity still
          shows the ground. */}
      {row.venueName && (
        <div className="text-sm text-gray-300">
          <span className="font-medium">{row.venueName}</span>
          {row.venueCity && <span className="text-gray-500"> · {row.venueCity}</span>}
          {row.venueCapacity != null && (
            <span className="text-gray-500"> · {row.venueCapacity.toLocaleString("en-GB")} capacity</span>
          )}
        </div>
      )}

      {/* Coach sits with the venue as club facts rather than form. Shown only
          once a squad refresh has run: before that we have no basis to say
          anything, whereas after it a null coach genuinely means the records
          carry no current one (Bologna, Cagliari). The tenure date is omitted
          when resolveCurrentCoach judged it unassertable. */}
      {row.squadFetchedAt && (
        <div className="text-sm">
          {coach ? (
            <>
              <span className="text-gray-500">Coach: </span>
              <span className="font-medium text-gray-300">{coach.name}</span>
              {coach.nationality && <span className="text-gray-500"> · {coach.nationality}</span>}
              {coach.since && (
                <span className="text-gray-500">
                  {" "}
                  · since{" "}
                  {new Date(coach.since).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-500">No current coach on record</span>
          )}
        </div>
      )}

      {/* Rating sits above the W/D/L run it's computed from, so the reader
          sees the number and its evidence together. Withheld below
          MIN_FORM_SAMPLE rather than shown with a hedge — see form.ts. */}
      {rating ? (
        <FormRatingBadge rating={rating} label="Form rating" />
      ) : (
        fixtures &&
        fixtures.length > 0 && (
          <p className="text-xs text-gray-500">
            Not enough recent matches to rate form yet — {MIN_FORM_SAMPLE} needed.
          </p>
        )
      )}

      {fixtures && fixtures.length > 0 && (
        <div className="flex items-center gap-1.5">
          {fixtures.map((f, i) => (
            <span
              key={i}
              title={`vs ${f.opponent} (${f.venue}) — ${f.result}`}
              className={`flex h-6 w-6 items-center justify-center rounded text-[11px] font-semibold ${resultStyles[f.result] ?? resultStyles["?"]}`}
            >
              {f.result}
            </span>
          ))}
        </div>
      )}

      {hasStatTiles && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-brand-bg p-2">
            <div className="text-[10px] uppercase text-gray-500">Played</div>
            <div className="text-sm font-medium">{stats!.played ?? "—"}</div>
          </div>
          <div className="rounded-md bg-brand-bg p-2">
            <div className="text-[10px] uppercase text-gray-500">W-D-L</div>
            <div className="text-sm font-medium">{stats!.win ?? "—"}-{stats!.draw ?? "—"}-{stats!.loss ?? "—"}</div>
          </div>
          <div className="rounded-md bg-brand-bg p-2">
            <div className="text-[10px] uppercase text-gray-500">Goals</div>
            <div className="text-sm font-medium">{stats!.goalsFor ?? "—"}:{stats!.goalsAgainst ?? "—"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
