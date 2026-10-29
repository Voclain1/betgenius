/** Provider-reported starting XIs, never predictions or top-scorer lists. */
export type LineupPlayer = { id: number; name: string; number: number | null; position: string | null };
export type ConfirmedTeamLineup = { teamId: number; teamName: string; formation: string | null; starters: LineupPlayer[]; substitutes: LineupPlayer[] };
export type LineupSnapshot = { attemptedAt: string; fetchedAt?: string; fixtureApiId: number; teams?: ConfirmedTeamLineup[]; status: 'confirmed' | 'not-reported' | 'unavailable' };
export type ProviderLineup = { team: {id:number;name:string}; formation?: string | null; startXI?: {player:{id:number;name:string;number?:number|null;pos?:string|null}}[]; substitutes?: {player:{id:number;name:string;number?:number|null;pos?:string|null}}[] };

export function trimConfirmedLineups(raw: ProviderLineup[] | null, homeId: number, awayId: number): ConfirmedTeamLineup[] | null {
  if (!Array.isArray(raw) || homeId === awayId) return null;
  const teams: ConfirmedTeamLineup[] = [];
  for (const id of [homeId,awayId]) {
    const row = raw.find(r=>r?.team?.id===id);
    if (!row || row.startXI?.length !== 11) return null;
    const players=(entries: ProviderLineup['startXI']): LineupPlayer[] => (entries??[]).filter(x=>Number.isInteger(x?.player?.id)&&x.player.id>0&&typeof x.player.name==='string'&&x.player.name.trim()).map(({player:p})=>({id:p.id,name:p.name,number:p.number??null,position:p.pos??null}));
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
