"""Deterministic, point-in-time feature extraction.

One row per included fixture, computed ONLY from ledger matches available at
the fixture's generation time T (see ledger.py). Nothing from the target
fixture, its context's season aggregates, standings, availability or any odds
is used.

Smoothing. A rate from n recent matches is shrunk toward a prior with k pseudo
matches: (sum + k * prior) / (n + k). Team priors are the league's
point-in-time averages; league averages are themselves shrunk toward the
all-competition average with k = LEAGUE_K. Before the ledger holds
GLOBAL_MIN matches, the all-competition average falls back to conventional
football priors (CONVENTIONAL_PRIOR) — a prior, not data, and flagged per row.

Identifiers. League and team ids are carried as categorical columns
(``CATEGORICAL``); the model maps them to frequency-capped categories fitted on
training data. They are never used as numeric magnitudes.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass

import numpy as np
import pandas as pd

from .ledger import Ledger, parse_ts
from .poisson import expected_goals

CONVENTIONAL_PRIOR = {
    "home_goals": 1.45, "away_goals": 1.15, "home_win": 0.45, "draw": 0.26, "away_win": 0.29,
    "btts": 0.50, "over25": 0.50, "scored": 0.75, "clean_sheet": 0.27,
}
GLOBAL_MIN = 50


@dataclass(frozen=True)
class FeatureConfig:
    window: int = 10
    max_age_days: int = 365
    team_k: float = 4.0
    league_k: float = 30.0
    h2h_k: float = 3.0
    h2h_max_age_days: int = 1460
    rest_cap_days: int = 30


CATEGORICAL = ["league_id", "home_id", "away_id"]
TARGETS = ["y", "home_goals", "away_goals", "y_over25", "y_btts"]


def _shrink(total: float, n: int, prior: float, k: float) -> float:
    return (total + k * prior) / (n + k)


def _priors(ledger: Ledger, at, league_id, cfg: FeatureConfig) -> tuple[dict, dict]:
    g = ledger.aggregate(at, None, cfg.max_age_days)
    glob_from_data = g["n"] >= GLOBAL_MIN
    glob = {k: g[k] for k in CONVENTIONAL_PRIOR} if glob_from_data else dict(CONVENTIONAL_PRIOR)
    lg = ledger.aggregate(at, league_id, cfg.max_age_days)
    n = lg["n"]
    league = {k: (_shrink(lg[k] * n, n, glob[k], cfg.league_k) if n else glob[k]) for k in CONVENTIONAL_PRIOR}
    return league, {"global_n": g["n"], "global_prior_conventional": int(not glob_from_data), "league_n": n}


def _team_block(prefix: str, team_id: int, hist, league: dict, venue: str, kickoff, cfg: FeatureConfig) -> dict:
    n = len(hist)
    per_team_goals = (league["home_goals"] + league["away_goals"]) / 2
    win_prior = (league["home_win"] + league["away_win"]) / 2
    gf = ga = w = d = scored = clean = 0
    vn = vgf = vga = vw = 0
    for m in hist:
        home = m.home_id == team_id
        f, a = (m.home_goals, m.away_goals) if home else (m.away_goals, m.home_goals)
        gf += f; ga += a
        w += f > a; d += f == a
        scored += f > 0; clean += a == 0
        if (venue == "home") == home:
            vn += 1; vgf += f; vga += a; vw += f > a
    v_gf_prior = league["home_goals"] if venue == "home" else league["away_goals"]
    v_ga_prior = league["away_goals"] if venue == "home" else league["home_goals"]
    v_w_prior = league["home_win"] if venue == "home" else league["away_win"]
    k = cfg.team_k
    rest = np.nan
    if n:
        last = max(m.date for m in hist)
        rest = float(min(cfg.rest_cap_days, (kickoff.date() - pd.Timestamp(last).date()).days))
    return {
        f"{prefix}_n": n,
        f"{prefix}_venue_n": vn,
        f"{prefix}_no_history": int(n == 0),
        f"{prefix}_gf_pg": _shrink(gf, n, per_team_goals, k),
        f"{prefix}_ga_pg": _shrink(ga, n, per_team_goals, k),
        f"{prefix}_win_rate": _shrink(w, n, win_prior, k),
        f"{prefix}_draw_rate": _shrink(d, n, league["draw"], k),
        f"{prefix}_loss_rate": _shrink(n - w - d, n, win_prior, k),
        f"{prefix}_ppg": _shrink(3 * w + d, n, 3 * win_prior + league["draw"], k),
        f"{prefix}_scored_rate": _shrink(scored, n, league["scored"], k),
        f"{prefix}_clean_sheet_rate": _shrink(clean, n, league["clean_sheet"], k),
        f"{prefix}_venue_gf_pg": _shrink(vgf, vn, v_gf_prior, k),
        f"{prefix}_venue_ga_pg": _shrink(vga, vn, v_ga_prior, k),
        f"{prefix}_venue_win_rate": _shrink(vw, vn, v_w_prior, k),
        f"{prefix}_rest_days": rest,
        f"{prefix}_rest_missing": int(n == 0),
    }


def fixture_features(f: dict, ledger: Ledger, cfg: FeatureConfig) -> tuple[dict, dict]:
    """Return (feature row, leakage diagnostics) for one included fixture."""
    T = parse_ts(f["generation"]["created_at"])
    K = parse_ts(f["kickoff"])
    if T >= K:  # the extractor already guarantees this; refuse rather than trust
        raise ValueError(f"fixture {f['fixture_id']}: generation at/after kickoff")
    target = {"fixture_id": f["fixture_id"], "home_id": f["home_id"], "away_id": f["away_id"], "kickoff": f["kickoff"]}
    league, meta = _priors(ledger, T, f["league_id"], cfg)
    hh = ledger.team_history(f["home_id"], T, target, cfg.window, cfg.max_age_days)
    ah = ledger.team_history(f["away_id"], T, target, cfg.window, cfg.max_age_days)
    for m in hh + ah:  # belt and braces: nothing used may post-date generation (an explicit raise, not an assert, so -O cannot strip it)
        if m.available_at(ledger.mode) > T or Ledger._is_target(m, target):
            raise RuntimeError(f"fixture {f['fixture_id']}: a history match was not available at generation time")
    row = {
        "league_home_goals": league["home_goals"], "league_away_goals": league["away_goals"],
        "league_home_win": league["home_win"], "league_draw": league["draw"], "league_away_win": league["away_win"],
        "league_home_adv": league["home_goals"] - league["away_goals"],
        "league_btts": league["btts"], "league_over25": league["over25"],
        "league_n": meta["league_n"], "global_prior_conventional": meta["global_prior_conventional"],
        "hours_before_kickoff": (K - T).total_seconds() / 3600.0,
    }
    row.update(_team_block("home", f["home_id"], hh, league, "home", K, cfg))
    row.update(_team_block("away", f["away_id"], ah, league, "away", K, cfg))
    meets = ledger.h2h(f["home_id"], f["away_id"], T, target, cfg.h2h_max_age_days)
    gd = sum((m.home_goals - m.away_goals) if m.home_id == f["home_id"] else (m.away_goals - m.home_goals) for m in meets)
    row["h2h_n"] = len(meets)
    row["h2h_gd_pg"] = _shrink(gd, len(meets), 0.0, cfg.h2h_k)
    for k in ("gf_pg", "ga_pg", "ppg", "win_rate"):
        row[f"diff_{k}"] = row[f"home_{k}"] - row[f"away_{k}"]
    lh, la = expected_goals(league["home_goals"], league["away_goals"], row["home_gf_pg"], row["home_ga_pg"], row["away_gf_pg"], row["away_ga_pg"])
    row["pois_lambda_home"], row["pois_lambda_away"] = lh, la

    # Leakage diagnostics: matches the ledger KNOWS about that were withheld
    # because they were not available at T (completed after T, or completed
    # before T but only recorded later in strict mode).
    diag = Counter()
    for team in (f["home_id"], f["away_id"]):
        for i in ledger._by_team.get(team, []):
            m = ledger.matches[i]
            if Ledger._is_target(m, target):
                diag["target_fixture_present_in_ledger_withheld"] += 1
                continue
            if m.available_at(ledger.mode) <= T:
                continue
            if m.date > f["kickoff"][:10]:
                diag["withheld_after_kickoff_day"] += 1
            elif m.date == T.date().isoformat():
                diag["withheld_same_day_as_generation"] += 1
            elif m.completed_by <= T:
                diag["withheld_completed_but_recorded_after_generation"] += 1
            else:
                diag["withheld_completed_after_generation"] += 1
    return row, dict(diag)


def season_of(kickoff: str) -> str:
    """European-style season label from the kickoff date (Jul–Jun). Calendar-year leagues are labelled by the same rule; the label is for reporting only."""
    d = parse_ts(kickoff)
    y = d.year if d.month >= 7 else d.year - 1
    return f"{y}/{str(y + 1)[-2:]}"


def build_feature_table(fixtures: list[dict], ledger: Ledger, cfg: FeatureConfig = FeatureConfig()) -> tuple[pd.DataFrame, dict]:
    rows, leak = [], Counter()
    for f in sorted(fixtures, key=lambda x: (x["kickoff"], x["fixture_id"])):
        if f["status"] != "included":
            continue
        feats, diag = fixture_features(f, ledger, cfg)
        leak.update(diag)
        hg, ag = f["home_goals"], f["away_goals"]
        rows.append({
            "fixture_id": f["fixture_id"], "kickoff": f["kickoff"], "generated_at": f["generation"]["created_at"],
            "league_id": f["league_id"], "league_name": f.get("league_name"), "home_id": f["home_id"], "away_id": f["away_id"],
            "season": season_of(f["kickoff"]), "context_version": f["generation"]["context_version"],
            **feats,
            "y": 0 if hg > ag else 1 if hg == ag else 2,
            "home_goals": hg, "away_goals": ag, "y_over25": int(hg + ag > 2.5), "y_btts": int(hg > 0 and ag > 0),
        })
    df = pd.DataFrame(rows)
    if not df.empty:
        df["kickoff"] = pd.to_datetime(df["kickoff"], utc=True)
        df["generated_at"] = pd.to_datetime(df["generated_at"], utc=True)
    return df, {"config": asdict(cfg), "withheld": dict(sorted(leak.items()))}


META = ["fixture_id", "kickoff", "generated_at", "league_name", "season", "context_version"]


def feature_columns(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c not in META and c not in TARGETS]


def completeness(df: pd.DataFrame) -> dict:
    if df.empty:
        return {}
    n = len(df)
    pct = lambda s: round(100.0 * float(s) / n, 1)
    return {
        "fixtures": n,
        "home_history_pct": pct((df["home_n"] > 0).sum()),
        "away_history_pct": pct((df["away_n"] > 0).sum()),
        "both_history_pct": pct(((df["home_n"] > 0) & (df["away_n"] > 0)).sum()),
        "both_history_ge5_pct": pct(((df["home_n"] >= 5) & (df["away_n"] >= 5)).sum()),
        "median_home_n": float(df["home_n"].median()),
        "median_away_n": float(df["away_n"].median()),
        "rest_days_both_pct": pct((df["home_rest_missing"].eq(0) & df["away_rest_missing"].eq(0)).sum()),
        "h2h_any_pct": pct((df["h2h_n"] > 0).sum()),
        "league_prior_n_ge30_pct": pct((df["league_n"] >= 30).sum()),
        "conventional_global_prior_pct": pct(df["global_prior_conventional"].sum()),
    }

