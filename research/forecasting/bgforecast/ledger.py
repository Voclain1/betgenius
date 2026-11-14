"""Point-in-time match ledger.

Every feature is computed from this ledger, and the ledger answers exactly one
question: which completed matches could have been known at time T?

SIGHTINGS -> MATCHES
  The extractor exports raw sightings (a stored last-5 entry, a stored h2h
  meeting, a settlement), each stamped with when it was recorded. Sightings of
  the same match are merged; if they disagree on the score the match is
  dropped entirely (``score_conflict``), never resolved by a guess.

WHEN A SIGHTING PROVES COMPLETION
  - ``settlement`` and ``context_h2h`` sightings assert a finished status (the
    h2h trimmer keeps finished, non-irregular fixtures only) and carry the exact
    kickoff. Completion is assumed by kickoff + 3h, and is certain by the time
    the sighting was recorded.
  - ``context_last5`` sightings carry a UTC date only and no status. A score on
    a date-only record proves completion only once that whole UTC day is over:
    the sighting must have been recorded at least 28h after the date's midnight
    (24h for the day, plus a 4h margin for a late kickoff). Earlier sightings —
    which includes every same-day entry — are dropped
    (``unverifiable_completion``). This is the rule that excludes same-day
    matches unless completion is independently verifiable.

WHEN A MATCH IS AVAILABLE AT T
  ``strict`` (default): the result must have been ON RECORD by T — the
  earliest valid sighting's recorded time is <= T (the selected context's own
  last-5 is recorded at exactly T, and was in hand when the engine ran). Nothing learnt later is
  back-filled into an earlier decision.
  ``completion``: the result must have been COMPLETED before T (kickoff + 3h,
  or date + 28h for date-only matches), even if BetGenius only recorded it
  later. Reported as a sensitivity analysis, never as the headline.

The target fixture itself is always excluded from its own history, by fixture
id and by (teams, UTC day), even though the availability rule already makes
that impossible — leakage guards are cheap and should overlap.
"""

from __future__ import annotations

import bisect
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import numpy as np

COMPLETION_BUFFER = timedelta(hours=3)
DATE_ONLY_BUFFER = timedelta(hours=28)
MODES = ("strict", "completion")


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)


def day_start(d: str) -> datetime:
    return datetime.fromisoformat(d).replace(tzinfo=timezone.utc)


@dataclass
class Match:
    key: tuple
    fixture_id: int | None
    date: str
    kickoff: datetime | None
    home_id: int
    away_id: int
    home_goals: int
    away_goals: int
    competition_id: int | None
    recorded_at: datetime
    completed_by: datetime
    sources: set = field(default_factory=set)

    def available_at(self, mode: str) -> datetime:
        return self.recorded_at if mode == "strict" else self.completed_by

    @property
    def day_ordinal(self) -> int:
        return datetime.fromisoformat(self.date).toordinal()


class Ledger:
    def __init__(self, observations: list[dict], mode: str = "strict"):
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.mode = mode
        self.sighting_rejections: Counter = Counter()
        self.match_rejections: Counter = Counter()
        self.matches: list[Match] = self._build(observations)
        self._index()

    # ── construction ───────────────────────────────────────────────────────
    def _accept(self, o: dict) -> tuple[datetime, datetime] | None:
        """Validate one sighting; return (recorded_at, completed_by) or None with a counted reason."""
        if o.get("home_id") is None or o.get("away_id") is None:
            self.sighting_rejections["team_unidentified"] += 1
            return None
        if o["home_id"] == o["away_id"]:
            self.sighting_rejections["team_identity_invalid"] += 1
            return None
        hg, ag = o.get("home_goals"), o.get("away_goals")
        if hg is None or ag is None:
            self.sighting_rejections["incomplete_result"] += 1
            return None
        if not (isinstance(hg, int) and isinstance(ag, int) and hg >= 0 and ag >= 0):
            self.sighting_rejections["invalid_score"] += 1
            return None
        recorded = parse_ts(o["observed_at"])
        if o.get("kickoff"):
            ko = parse_ts(o["kickoff"])
            if ko.date().isoformat() != o["date"]:
                self.sighting_rejections["date_kickoff_mismatch"] += 1
                return None
            if recorded <= ko:
                self.sighting_rejections["recorded_before_kickoff"] += 1
                return None
            completed = min(recorded, ko + COMPLETION_BUFFER)
        else:
            completed = day_start(o["date"]) + DATE_ONLY_BUFFER
            if recorded < completed:
                self.sighting_rejections["unverifiable_completion"] += 1
                return None
        return recorded, completed

    def _build(self, observations: list[dict]) -> list[Match]:
        groups: dict[tuple, list[tuple[dict, datetime, datetime]]] = defaultdict(list)
        id_by_triplet: dict[tuple, tuple] = {}
        accepted = []
        for o in observations:
            r = self._accept(o)
            if r is None:
                continue
            accepted.append((o, *r))
            if o.get("fixture_id") is not None:
                id_by_triplet[(o["date"], o["home_id"], o["away_id"])] = ("id", o["fixture_id"])
        for o, rec, comp in accepted:
            if o.get("fixture_id") is not None:
                key = ("id", o["fixture_id"])
            else:
                triplet = (o["date"], o["home_id"], o["away_id"])
                key = id_by_triplet.get(triplet, ("dt",) + triplet)
            groups[key].append((o, rec, comp))

        out = []
        for key in sorted(groups, key=repr):
            sightings = groups[key]
            identities = {(o["date"], o["home_id"], o["away_id"]) for o, _, _ in sightings}
            scores = {(o["home_goals"], o["away_goals"]) for o, _, _ in sightings}
            if len(identities) > 1:
                self.match_rejections["identity_conflict"] += 1
                continue
            if len(scores) > 1:
                self.match_rejections["score_conflict"] += 1
                continue
            o0 = sightings[0][0]
            kickoffs = sorted({o["kickoff"] for o, _, _ in sightings if o.get("kickoff")})
            comps = sorted({o["competition_id"] for o, _, _ in sightings if o.get("competition_id") is not None})
            out.append(Match(
                key=key,
                fixture_id=key[1] if key[0] == "id" else None,
                date=o0["date"],
                kickoff=parse_ts(kickoffs[0]) if kickoffs else None,
                home_id=o0["home_id"],
                away_id=o0["away_id"],
                home_goals=o0["home_goals"],
                away_goals=o0["away_goals"],
                competition_id=comps[0] if len(comps) == 1 else None,
                recorded_at=min(rec for _, rec, _ in sightings),
                completed_by=min(comp for _, _, comp in sightings),
                sources={o["source"] for o, _, _ in sightings},
            ))
            if len(comps) > 1:
                self.match_rejections["competition_ambiguous_kept_without_league"] += 1
        return out

    def _index(self) -> None:
        order = sorted(range(len(self.matches)), key=lambda i: (self.matches[i].available_at(self.mode), i))
        self._by_team: dict[int, list[int]] = defaultdict(list)
        self._by_league: dict[int, list[int]] = defaultdict(list)
        for i in order:
            m = self.matches[i]
            self._by_team[m.home_id].append(i)
            self._by_team[m.away_id].append(i)
            if m.competition_id is not None:
                self._by_league[m.competition_id].append(i)
        self._team_avail = {t: [self.matches[i].available_at(self.mode) for i in ix] for t, ix in self._by_team.items()}
        # Vectorised arrays for aggregate priors (league and global).
        self._all = np.array(order, dtype=np.int64)
        self._all_avail = [self.matches[i].available_at(self.mode) for i in order]
        self._arr_day = np.array([m.day_ordinal for m in self.matches], dtype=np.int64)
        self._arr_hg = np.array([m.home_goals for m in self.matches], dtype=np.float64)
        self._arr_ag = np.array([m.away_goals for m in self.matches], dtype=np.float64)
        self._league_avail = {l: [self.matches[i].available_at(self.mode) for i in ix] for l, ix in self._by_league.items()}

    # ── queries ────────────────────────────────────────────────────────────
    @staticmethod
    def _is_target(m: Match, target: dict) -> bool:
        if target.get("fixture_id") is not None and m.fixture_id == target["fixture_id"]:
            return True
        return {m.home_id, m.away_id} == {target["home_id"], target["away_id"]} and m.date == target["kickoff"][:10]

    def team_history(self, team_id: int, at: datetime, target: dict, window: int, max_age_days: int) -> list[Match]:
        """Most recent `window` matches of `team_id` available at or before `at`, newest first."""
        ix = self._by_team.get(team_id, [])
        cut = bisect.bisect_right(self._team_avail.get(team_id, []), at)
        min_day = at.date().toordinal() - max_age_days
        eligible = [self.matches[i] for i in ix[:cut]]
        eligible = [m for m in eligible if m.day_ordinal >= min_day and not self._is_target(m, target)]
        eligible.sort(key=lambda m: (m.date, m.kickoff or day_start(m.date)), reverse=True)
        return eligible[:window]

    def h2h(self, home_id: int, away_id: int, at: datetime, target: dict, max_age_days: int) -> list[Match]:
        ix = self._by_team.get(home_id, [])
        cut = bisect.bisect_right(self._team_avail.get(home_id, []), at)
        min_day = at.date().toordinal() - max_age_days
        return [self.matches[i] for i in ix[:cut]
                if {self.matches[i].home_id, self.matches[i].away_id} == {home_id, away_id}
                and self.matches[i].day_ordinal >= min_day and not self._is_target(self.matches[i], target)]

    def aggregate(self, at: datetime, league_id: int | None, max_age_days: int) -> dict:
        """Goals and result rates over matches available at or before `at` (one league, or all when league_id is None)."""
        if league_id is None:
            idx = self._all[: bisect.bisect_right(self._all_avail, at)]
        else:
            ix = self._by_league.get(league_id, [])
            idx = np.array(ix[: bisect.bisect_right(self._league_avail.get(league_id, []), at)], dtype=np.int64)
        if idx.size:
            idx = idx[self._arr_day[idx] >= at.date().toordinal() - max_age_days]
        n = int(idx.size)
        if n == 0:
            return {"n": 0}
        hg, ag = self._arr_hg[idx], self._arr_ag[idx]
        return {
            "n": n,
            "home_goals": float(hg.mean()),
            "away_goals": float(ag.mean()),
            "home_win": float((hg > ag).mean()),
            "draw": float((hg == ag).mean()),
            "away_win": float((hg < ag).mean()),
            "btts": float(((hg > 0) & (ag > 0)).mean()),
            "over25": float(((hg + ag) > 2.5).mean()),
            "scored": float(((hg > 0).sum() + (ag > 0).sum()) / (2 * n)),
            "clean_sheet": float(((ag == 0).sum() + (hg == 0).sum()) / (2 * n)),
        }

    def summary(self) -> dict:
        return {
            "mode": self.mode,
            "matches": len(self.matches),
            "sighting_rejections": dict(sorted(self.sighting_rejections.items())),
            "match_rejections": dict(sorted(self.match_rejections.items())),
            "matches_by_source": dict(sorted(Counter("+".join(sorted(m.sources)) for m in self.matches).items())),
        }
