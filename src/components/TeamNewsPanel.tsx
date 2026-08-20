import { teamNewsState, type TeamNewsState, type AvailabilityFreshness } from "@/lib/matchFacts";
import type { TeamDigest, AvailabilityEntry } from "@/lib/ai/digest";

/**
 * Injuries, suspensions and other absences for both sides.
 *
 * This panel exists to keep four states apart, and collapsing any two of them
 * would be a correctness bug rather than a tidier UI:
 *
 *   - "Team news unavailable"  — the feed never resolved for this side.
 *   - "No reported absences"   — the feed resolved and reported nobody out.
 *   - a confirmed absence      — injury, with the reported reason.
 *   - a suspension             — certain, and resolves itself by being served.
 *
 * The first two are the dangerous pair. An empty list from a failed fetch
 * rendered as "no reported absences" would assert a fully fit squad we have no
 * evidence for, which is exactly the claim readers act on. teamNewsState()
 * checks "did the feed resolve" BEFORE it looks at the list, so that reading is
 * unreachable from here.
 *
 * Nothing is AI-generated: every name and reason comes from api-football via
 * the cached TeamDigest. The AI may interpret this list in its reasoning, but
 * it does not produce it.
 */

const KIND_STYLES: Record<AvailabilityEntry["kind"], string> = {
  injury: "bg-red-500/20 text-red-300",
  suspension: "bg-orange-500/20 text-orange-300",
  unavailable: "bg-gray-500/20 text-gray-300",
};

const KIND_LABELS: Record<AvailabilityEntry["kind"], string> = {
  injury: "Injury",
  suspension: "Suspended",
  unavailable: "Unavailable",
};

/**
 * Staleness notice. Rendered ONLY past the threshold in matchFacts.ts — the app
 * deliberately removed always-on cache stamps, so this appears when it carries
 * information (the list is materially old) and stays silent otherwise.
 */
function Freshness({ freshness }: { freshness: AvailabilityFreshness }) {
  if (freshness.state !== "stale") return null;
  return (
    <p className="text-[11px] text-orange-300/80">
      Team news last updated {new Date(`${freshness.asOf}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
      {" "}({freshness.ageDays} days ago) — later changes may not be reflected.
    </p>
  );
}

function AbsenceList({ entries }: { entries: AvailabilityEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((e) => (
        <li key={`${e.kind}-${e.player}`} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-gray-300">{e.player}</span>
          <span className={`chip shrink-0 text-[10px] ${KIND_STYLES[e.kind]}`}>
            {/* The API's own reason where it is more specific than the bucket
                ("Knee Injury" beats "Injury"); the bucket label otherwise. */}
            {e.reason && e.reason.toLowerCase() !== "injury" ? e.reason : KIND_LABELS[e.kind]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TeamColumn({ name, state }: { name: string; state: TeamNewsState }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-300">{name}</h3>

      {state.kind === "unavailable" && (
        <p className="text-sm text-gray-500">Team news unavailable for this fixture.</p>
      )}

      {state.kind === "none-reported" && (
        <>
          <p className="text-sm text-emerald-300/80">No reported absences.</p>
          <Freshness freshness={state.freshness} />
        </>
      )}

      {state.kind === "absences" && (
        <>
          {state.injuries.length > 0 && <AbsenceList entries={state.injuries} />}
          {state.suspensions.length > 0 && <AbsenceList entries={state.suspensions} />}
          {state.other.length > 0 && <AbsenceList entries={state.other} />}
          <Freshness freshness={state.freshness} />
        </>
      )}
    </div>
  );
}

export function TeamNewsPanel({
  homeTeam,
  awayTeam,
  homeDigest,
  awayDigest,
}: {
  homeTeam: string;
  awayTeam: string;
  homeDigest: TeamDigest | null;
  awayDigest: TeamDigest | null;
}) {
  const home = teamNewsState(homeDigest);
  const away = teamNewsState(awayDigest);

  // Both feeds missing means there is nothing to say — hide the section rather
  // than printing "unavailable" twice, which tells the reader nothing they
  // couldn't infer from its absence.
  if (home.kind === "unavailable" && away.kind === "unavailable") return null;

  return (
    <section className="card space-y-3">
      <h2 className="section-heading">Team news</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamColumn name={homeTeam} state={home} />
        <TeamColumn name={awayTeam} state={away} />
      </div>
    </section>
  );
}
