/** Provider-reported starting XIs, never predictions or top-scorer lists. */
export type LineupPlayer = {
  id: number; name: string; number: number | null; position: string | null;
  /** Provider pitch slot, "row:col" (row 1 = goalkeeper). Absent on snapshots stored before it was kept. */
  grid?: string | null;
};
export type ConfirmedTeamLineup = { teamId: number; teamName: string; formation: string | null; starters: LineupPlayer[]; substitutes: LineupPlayer[] };
export type LineupSnapshot = { attemptedAt: string; fetchedAt?: string; fixtureApiId: number; teams?: ConfirmedTeamLineup[]; status: 'confirmed' | 'not-reported' | 'unavailable' };
export type ProviderLineup = { team: {id:number;name:string}; formation?: string | null; startXI?: {player:{id:number;name:string;number?:number|null;pos?:string|null;grid?:string|null}}[]; substitutes?: {player:{id:number;name:string;number?:number|null;pos?:string|null}}[] };

export function trimConfirmedLineups(raw: ProviderLineup[] | null, homeId: number, awayId: number): ConfirmedTeamLineup[] | null {
  if (!Array.isArray(raw) || homeId === awayId) return null;
  const teams: ConfirmedTeamLineup[] = [];
  for (const id of [homeId,awayId]) {
    const row = raw.find(r=>r?.team?.id===id);
    if (!row || row.startXI?.length !== 11) return null;
    const players=(entries: ProviderLineup['startXI']): LineupPlayer[] => (entries??[]).filter(x=>Number.isInteger(x?.player?.id)&&x.player.id>0&&typeof x.player.name==='string'&&x.player.name.trim()).map(({player:p})=>({id:p.id,name:p.name,number:p.number??null,position:p.pos??null,...(typeof p.grid==='string'&&/^\d+:\d+$/.test(p.grid)?{grid:p.grid}:{})}));
    const starters=players(row.startXI);
    if (starters.length!==11 || new Set(starters.map(p=>p.id)).size!==11) return null;
    teams.push({teamId:id,teamName:row.team.name,formation:row.formation??null,starters,substitutes:[...new Map(players(row.substitutes).filter(p=>!starters.some(s=>s.id===p.id)).map(p=>[p.id,p])).values()]});
  }
  if (new Set(teams.flatMap(t=>t.starters.map(p=>p.id))).size !== 22) return null;
  return teams;
}

export function lineupRefreshDue(kickoff: Date, snapshot: LineupSnapshot | null, now = new Date()): boolean {
  const until=kickoff.getTime()-now.getTime();
  if (!Number.isFinite(until) || until>90*60_000 || until < -15*60_000) return false;
  const attempted=Date.parse(snapshot?.attemptedAt??'');
  return !Number.isFinite(attempted) || now.getTime()-attempted>=15*60_000;
}

export function readLineupSnapshot(raw: unknown): LineupSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const s=raw as LineupSnapshot;
  if (!Number.isInteger(s.fixtureApiId) || !['confirmed','not-reported','unavailable'].includes(s.status) || !Number.isFinite(Date.parse(s.attemptedAt))) return null;
  if (s.status==='confirmed') {
    if (!Array.isArray(s.teams) || s.teams.length!==2 || !s.fetchedAt || !Number.isFinite(Date.parse(s.fetchedAt))) return null;
    for (const t of s.teams) if (!Number.isInteger(t.teamId) || !Array.isArray(t.starters) || t.starters.length!==11 || new Set(t.starters.map(p=>p.id)).size!==11 || t.starters.some(p=>!Number.isInteger(p.id)||typeof p.name!=='string') || !Array.isArray(t.substitutes) || t.substitutes.some(p=>!Number.isInteger(p.id)||typeof p.name!=='string')) return null;
    if (s.teams[0].teamId===s.teams[1].teamId || new Set(s.teams.flatMap(t=>t.starters.map(p=>p.id))).size!==22) return null;
  }
  return s;
}

/**
 * The starting XI as pitch rows, goalkeeper first, for the formation view.
 *
 * Prefers the provider's own "row:col" slots. Snapshots stored before those
 * were kept fall back to the formation string: API-Football lists a starting
 * XI goalkeeper first and then line by line, in the formation's order, so
 * "4-3-3" over that list gives the same rows. Returns null rather than guess
 * when neither fits exactly (no formation, lines not summing to ten, a
 * goalkeeper not first), and the panel then shows the plain list.
 */
export function formationRows(team: ConfirmedTeamLineup): LineupPlayer[][] | null {
  const xi = team.starters;
  if (xi.length !== 11) return null;
  if (xi.every(p => p.grid)) {
    const rows = new Map<number, { col: number; p: LineupPlayer }[]>();
    for (const p of xi) {
      const [r, c] = p.grid!.split(':').map(Number);
      rows.set(r, [...(rows.get(r) ?? []), { col: c, p }]);
    }
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.sort((a, b) => a.col - b.col).map(x => x.p));
    if (ordered[0]?.length === 1) return ordered;
  }
  const lines = (team.formation ?? '').split('-').map(Number);
  if (!lines.length || lines.some(n => !Number.isInteger(n) || n < 1) || lines.reduce((a, b) => a + b, 0) !== 10) return null;
  if (xi[0].position && xi[0].position !== 'G') return null;
  const rows: LineupPlayer[][] = [[xi[0]]];
  let i = 1;
  for (const n of lines) { rows.push(xi.slice(i, i + n)); i += n; }
  return rows;
}

/** "D. Léon" → "Léon", "Mohammed Al Dossary" → "Al Dossary", "Danilo Pereira" → "Pereira": what fits under a shirt. */
export function shirtName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length > 1 && /^\p{L}\.$/u.test(words[0])) return words.slice(1).join(' ');
  if (words.length <= 1) return name.trim();
  const rest = words.slice(1);
  return rest.length > 1 && /^(al|el|de|da|van|von|dos|di|le|la|ben|bin)$/i.test(rest[0]) ? rest.join(' ') : rest[rest.length - 1];
}
