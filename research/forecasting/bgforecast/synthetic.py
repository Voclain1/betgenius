"""Synthetic datasets in the extractor's exact format — FOR TESTS ONLY.

Every id is fictional (leagues 99xx, teams 99xxx, fixtures 9xxxxxxx), every
manifest says source "synthetic", and every report built from one carries a
banner saying no real data was used. Nothing here resembles, or may be
presented as, a BetGenius fixture, result or performance figure.

The generator reproduces the awkward parts of real stored contexts on
purpose, so tests exercise the rules that handle them: same-day last-5
entries, unfinished matches with no score, missing opponent ids, contexts
created after kickoff, and fixtures with conflicting final scores.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import numpy as np

from . import SUPPORTED_SCHEMA
from .dataset import write_dataset

START = datetime(2025, 8, 1, tzinfo=timezone.utc)


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def generate(path, seed: int = 7, leagues: int = 3, teams_per_league: int = 16, coverage: float = 0.75, rounds: int = 2,
             signal: float = 0.3) -> dict:
    rng = np.random.default_rng(seed)
    matches = []  # every match played, covered or not
    fid = 90_000_000
    for li in range(leagues):
        league_id = 9901 + li
        teams = [99_000 + li * 100 + t for t in range(teams_per_league)]
        att = {t: rng.normal(0, signal) for t in teams}
        dfn = {t: rng.normal(0, signal) for t in teams}
        pairs = [(h, a) for h in teams for a in teams if h != a]
        rng.shuffle(pairs)
        # Round-robin-ish: spread `rounds` passes of all pairs over weekly slots.
        per_week = teams_per_league // 2
        schedule = []
        for r in range(rounds):
            remaining = list(pairs)
            week = r * (len(pairs) // per_week + 1)
            while remaining:
                used, slot = set(), []
                for p in list(remaining):
                    if p[0] not in used and p[1] not in used:
                        slot.append(p); used.update(p); remaining.remove(p)
                    if len(slot) == per_week:
                        break
                for h, a in slot:
                    day = START + timedelta(days=7 * week + int(rng.integers(0, 3)) + li)
                    ko = day.replace(hour=int(rng.integers(12, 21)), minute=int(rng.choice([0, 15, 30, 45])))
                    schedule.append((ko, h, a))
                week += 1
        for ko, h, a in schedule:
            lh = math.exp(math.log(1.35) + att[h] - dfn[a] + 0.12)
            la = math.exp(math.log(1.35) + att[a] - dfn[h] - 0.12)
            fid += 1
            matches.append({"fixture_id": fid, "league_id": league_id, "kickoff": ko, "home": h, "away": a,
                            "hg": int(rng.poisson(lh)), "ag": int(rng.poisson(la)), "lh": lh, "la": la})
    matches.sort(key=lambda m: (m["kickoff"], m["fixture_id"]))
    by_team: dict[int, list] = {}
    for m in matches:
        by_team.setdefault(m["home"], []).append(m)
        by_team.setdefault(m["away"], []).append(m)

    fixtures, observations = [], []
    for m in matches:
        if rng.random() > coverage:
            continue
        T = m["kickoff"] - timedelta(hours=float(rng.uniform(2, 40)))
        late = rng.random() < 0.03
        conflict = rng.random() < 0.01
        job_id = f"synjob{m['fixture_id']}"
        if late:
            T = m["kickoff"] + timedelta(minutes=30)
        audit = {"both_season_records": False, "both_recent_matches": True, "standings": False, "h2h": False, "availability": False,
                 "availability_future_dated": False, "last5_same_day": 0, "last5_future_dated": 0, "last5_missing_score": 0}
        # Context last-5 for both teams, as the provider would have returned it at T.
        for team in (m["home"], m["away"]):
            prior = [x for x in by_team[team] if x["kickoff"].date() <= T.date() and x["kickoff"] < m["kickoff"] and x is not m][-5:][::-1]
            for x in prior:
                finished = x["kickoff"] + timedelta(hours=2) <= T
                same_day = x["kickoff"].date() == T.date()
                audit["last5_same_day"] += int(same_day)
                audit["last5_missing_score"] += int(not finished)
                opp_known = rng.random() > 0.03
                observations.append({
                    "source": "context_last5", "source_ref": job_id, "observed_at": _iso(T), "fixture_id": None,
                    "date": x["kickoff"].date().isoformat(), "kickoff": None,
                    "home_id": x["home"] if (x["home"] == team or opp_known) else None,
                    "away_id": x["away"] if (x["away"] == team or opp_known) else None,
                    "home_goals": x["hg"] if finished else None, "away_goals": x["ag"] if finished else None,
                    "competition_id": x["league_id"]})
        meets = [x for x in by_team[m["home"]] if {x["home"], x["away"]} == {m["home"], m["away"]} and x["kickoff"] + timedelta(hours=2) <= T]
        audit["h2h"] = bool(meets)
        for x in meets[-5:]:
            observations.append({"source": "context_h2h", "source_ref": job_id, "observed_at": _iso(T), "fixture_id": x["fixture_id"],
                                 "date": x["kickoff"].date().isoformat(), "kickoff": _iso(x["kickoff"]), "home_id": x["home"], "away_id": x["away"],
                                 "home_goals": x["hg"], "away_goals": x["ag"], "competition_id": x["league_id"]})
        settled = m["kickoff"] + timedelta(hours=float(rng.uniform(2.2, 6)))
        reasons = []
        if late:
            reasons.append("no_valid_pre_kickoff_context")
        if conflict:
            reasons.append("final_score_conflict")
        if not conflict:
            observations.append({"source": "settlement", "source_ref": str(m["fixture_id"]), "observed_at": _iso(settled), "fixture_id": m["fixture_id"],
                                 "date": m["kickoff"].date().isoformat(), "kickoff": _iso(m["kickoff"]), "home_id": m["home"], "away_id": m["away"],
                                 "home_goals": m["hg"], "away_goals": m["ag"], "competition_id": m["league_id"]})
        # A noisy synthetic "engine": picks the likelier side with a confidence loosely tied to the true rates.
        pick = "HOME" if m["lh"] >= m["la"] else "AWAY"
        conf = int(np.clip(round(100 * (0.45 + abs(m["lh"] - m["la"]) * 0.18 + rng.normal(0, 0.06))), 35, 90))
        engine = [] if late else [
            {"prediction_id": f"synp{m['fixture_id']}a", "market_type": "MATCH_WINNER", "selection": {"value": pick}, "confidence": conf,
             "created_at": _iso(T), "provider": "synthetic:engine", "outcome": "PENDING"},
            {"prediction_id": f"synp{m['fixture_id']}b", "market_type": "OVER_UNDER", "selection": {"line": 2.5, "direction": "OVER" if m["lh"] + m["la"] > 2.6 else "UNDER"},
             "confidence": int(np.clip(round(55 + rng.normal(0, 8)), 35, 90)), "created_at": _iso(T), "provider": "synthetic:engine", "outcome": "PENDING"},
        ]
        fixtures.append({
            "fixture_id": m["fixture_id"], "status": "excluded" if reasons else "included", "exclusion_reasons": reasons, "warnings": [],
            "league_id": m["league_id"], "league_name": f"Synthetic League {m['league_id']}", "home_id": m["home"], "away_id": m["away"],
            "home_name": f"Synthetic Team {m['home']}", "away_name": f"Synthetic Team {m['away']}", "kickoff": _iso(m["kickoff"]),
            "home_goals": None if conflict else m["hg"], "away_goals": None if conflict else m["ag"], "settled_at": None if conflict else _iso(settled),
            "generation": None if late else {"job_id": job_id, "created_at": _iso(T), "context_version": 2, "provider": "synthetic:engine",
                                             "digest_kickoff": _iso(m["kickoff"]), "audit": audit},
            "candidate_jobs": [{"job_id": job_id, "created_at": _iso(T), "context_version": 2, "verdict": "context_at_or_after_kickoff" if late else "selected"}],
            "prediction_rows": 2, "engine_predictions": engine,
        })
    fixtures.sort(key=lambda f: f["fixture_id"])
    observations.sort(key=lambda o: (o["date"], o["source"], o["source_ref"], o["home_id"] or -1, o["away_id"] or -1, o["observed_at"]))
    included = [f for f in fixtures if f["status"] == "included"]
    manifest = {
        "schema_version": SUPPORTED_SCHEMA, "extractor_version": "synthetic", "source": "synthetic",
        "generated_at": _iso(START), "as_of": _iso(max(m["kickoff"] for m in matches) + timedelta(days=1)), "database": None,
        "source_timestamps": {}, "counts": {"distinct_fixture_ids": len(fixtures), "fixtures_included": len(included),
                                            "fixtures_excluded": len(fixtures) - len(included), "observations": len(observations),
                                            "synthetic_matches_played": len(matches)},
        "fixture_exclusions": {}, "job_verdicts": {}, "context_versions": {"v2": len(included)}, "audit": {},
        "notes": ["SYNTHETIC — generated for tests; not BetGenius data."],
    }
    for f in fixtures:
        for x in f["exclusion_reasons"]:
            manifest["fixture_exclusions"][x] = manifest["fixture_exclusions"].get(x, 0) + 1
    write_dataset(path, manifest, fixtures, observations)
    return manifest
