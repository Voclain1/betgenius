/**
 * Pure, source-aware football evidence comparison. Missing coverage means
 * UNKNOWN, never "fit squad", "no injuries" or a confirmed unchanged lineup.
 * A signal requests a critical reassessment; it is not proof of a winning pick.
 */
import type { MatchDigest, TeamDigest } from "@/lib/ai/digest";

export type EvidenceSignal = {
  code: string;
  severity: "MODERATE" | "CRITICAL";
  message: string;
  source: "fixture" | "availability" | "form" | "coach" | "lineup";
};

export type FixtureEvidence = { status: string; kickoff: Date; seenAt: Date; fixtureApiId: number };

export function reassessmentIntervalMinutes(now: Date, kickoff: Date): number {
  const minutes = (kickoff.getTime() - now.getTime()) / 60_000;
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  if (minutes <= 90) return 15;
  if (minutes <= 6 * 60) return 60;
  if (minutes <= 24 * 60) return 360;
  if (minutes <= 72 * 60) return 720;
  return 1440;
}

const IRREGULAR_STATUSES = new Set(["PST", "CANC", "ABD", "AWD", "WO", "SUSP"]);

/** Only trust provider fixture state updated recently, not an old schedule. */
export function fixtureSignals(originalKickoff: Date, fixture: FixtureEvidence | null, now: Date): EvidenceSignal[] {
  if (!fixture || fixture.seenAt.getTime() > now.getTime()
    || now.getTime() - fixture.seenAt.getTime() > 6 * 3_600_000) return [];
  const signals: EvidenceSignal[] = [];
  if (IRREGULAR_STATUSES.has(fixture.status)) {
    signals.push({
      code: "fixture-status-" + fixture.status,
      severity: "CRITICAL",
      message: "Provider reports the fixture as " + fixture.status + "; published selection requires withdrawal.",
      source: "fixture",
    });
  }
  const shift = Math.abs(fixture.kickoff.getTime() - originalKickoff.getTime());
  if (shift > 15 * 60_000) {
    signals.push({
      code: "fixture-kickoff-shift",
      severity: shift > 24 * 3_600_000 ? "CRITICAL" : "MODERATE",
      message: "Provider reports a kickoff change of " + Math.round(shift / 60_000) + " minutes.",
      source: "fixture",
    });
  }
  return signals;
}

function normalized(name: string): string { return name.trim().toLocaleLowerCase("en").replace(/\s+/g, " "); }

function unavailableSignals(side: string, oldTeam: TeamDigest, nextTeam: TeamDigest): EvidenceSignal[] {
  // A null availabilityAsOf is missing data, not an empty injury list.
  if (!oldTeam.availabilityAsOf || !nextTeam.availabilityAsOf) return [];
  // Only consider genuinely newer provider snapshots. Old injury data is
  // historically noisy and can list players who have already returned.
  if (nextTeam.availabilityAsOf <= oldTeam.availabilityAsOf) return [];
  const before = new Set(oldTeam.availability.map(p => normalized(p.player)));
  const fresh = nextTeam.availability.filter(p => !before.has(normalized(p.player)));
  const keyPlayers = new Set(nextTeam.keyPlayers.map(p => normalized(p.name)));
  return fresh.map((p) => ({
    code: "new-unavailable-" + side + "-" + normalized(p.player),
    severity: keyPlayers.has(normalized(p.player)) ? "CRITICAL" as const : "MODERATE" as const,
    message: side + ": " + p.player + " newly reported " + p.kind + " (" + p.reason.slice(0, 100) + ").",
    source: "availability" as const,
  }));
}

function formSignals(side: string, oldTeam: TeamDigest, nextTeam: TeamDigest): EvidenceSignal[] {
  if (!oldTeam.last5.length || !nextTeam.last5.length) return [];
  const oldEnd = oldTeam.last5.map(r => r.date).sort().at(-1) ?? "";
  const newEnd = nextTeam.last5.map(r => r.date).sort().at(-1) ?? "";
  if (newEnd <= oldEnd) return [];
  return [{
    code: "new-result-" + side + "-" + newEnd,
    severity: "MODERATE",
    message: side + " has played a new match since publication (" + newEnd + "); form needs reassessment.",
    source: "form",
  }];
}

export function compareFootballEvidence(before: MatchDigest | null, after: MatchDigest | null): EvidenceSignal[] {
  if (!before || !after) return [];
  const all: EvidenceSignal[] = [];
  for (const side of ["home", "away"] as const) {
    const oldTeam = before.teams[side], newTeam = after.teams[side];
    all.push(...unavailableSignals(side, oldTeam, newTeam));
    all.push(...formSignals(side, oldTeam, newTeam));
    if (oldTeam.coach?.name && newTeam.coach?.name
      && normalized(oldTeam.coach.name) !== normalized(newTeam.coach.name)) {
      all.push({ code: "coach-change-" + side, severity: "MODERATE",
        message: side + " has a different confirmed head coach.", source: "coach" });
    }
  }
  return all;
}

/** Confirmed starting XI is a strong pre-match signal, not a predicted XI. */
export function confirmedLineupSignals(
  lineupTeams: Array<{ teamId: number; starters: Array<{ id: number; name: string }> }> | null,
  prior: MatchDigest | null,
): EvidenceSignal[] {
  if (!prior || !lineupTeams || lineupTeams.length !== 2) return [];
  const absent: string[] = [];
  for (const [side, team] of [["home", prior.teams.home], ["away", prior.teams.away]] as const) {
    if (team.apiId == null) continue;
    const xi = lineupTeams.find(l => l.teamId === team.apiId);
    if (!xi || xi.starters.length !== 11) continue;
    const starters = new Set(xi.starters.map(x => normalized(x.name)));
    for (const key of team.keyPlayers) {
      if (!starters.has(normalized(key.name))) absent.push(side + ": " + key.name);
    }
  }
  return absent.length ? [{
    code: "confirmed-lineup-key-player-absence",
    severity: "CRITICAL",
    message: "Key players not in the confirmed starting XIs: " + absent.slice(0, 4).join(", "),
    source: "lineup",
  }] : [];
}
