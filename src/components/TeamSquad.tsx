import type { SquadPlayer } from "@/lib/enrichment";

/** Grouped in the order a team sheet reads, with anything unrecognised last. */
const POSITION_ORDER = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];

/**
 * The squad list for a team page: name, shirt number, position, photo.
 *
 * Deliberately not clickable and carrying no stats — listing the squad is the
 * scope, player profiles are explicitly out of it. Grouped by position rather
 * than shown as one long list, since 30-46 names in a flat grid is unreadable
 * on a phone.
 */
export function TeamSquad({ squad }: { squad: SquadPlayer[] }) {
  if (squad.length === 0) return null;

  const groups = [...POSITION_ORDER, "Other"]
    .map((position) => ({
      position,
      players: squad.filter((p) => (POSITION_ORDER.includes(p.position ?? "") ? p.position : "Other") === position),
    }))
    .filter((g) => g.players.length > 0);

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.position}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {g.position} <span className="text-gray-600">({g.players.length})</span>
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {g.players.map((p) => (
              <div key={p.id} className="flex items-center gap-2 rounded-lg border border-brand-border bg-brand-card p-2">
                {p.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-full bg-brand-bg" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-gray-200">{p.name}</div>
                  <div className="text-[10px] text-gray-500">
                    {p.number != null ? `#${p.number}` : "—"}
                    {p.age != null && ` · ${p.age}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
