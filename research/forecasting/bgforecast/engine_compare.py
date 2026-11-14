"""Comparison with the existing BetGenius engine, where it is valid.

WHAT IS COMPARABLE. The engine does not output a 1X2 distribution. Each
generation states picks (one outcome per market) with a 0–100 confidence. So
the only valid comparison is SELECTION-CONDITIONAL: on the engine's own picks,
score the engine's stated confidence and each model's probability FOR THAT
SAME OUTCOME as binary forecasts against the final score.

  MATCH_WINNER   HOME / DRAW / AWAY        -> P(that outcome)
  DOUBLE_CHANCE  HOME_OR_DRAW / …          -> sum of two outcomes
  OVER_UNDER     line 2.5 only             -> Poisson P(over) or 1 - P(over)
  BTTS           YES / NO                  -> Poisson P(btts) or 1 - P(btts)

Only rows from the fixture's SELECTED pre-kickoff job are used (the extractor
guarantees this), so engine and models share the same information moment.
Engine confidence is raw and uncalibrated; the production calibration
artifact (src/lib/calibration.ts) is not applied here. This comparison says
nothing about markets the engine did not pick, and it is not a betting result:
no publication-time prices are used.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .metrics import binary_brier_rows, binary_logloss_rows, bootstrap_mean, paired_difference

MIN_N = 30


def _engine_rows(test: pd.DataFrame, fixtures_by_id: dict, probs: dict[str, np.ndarray]) -> pd.DataFrame:
    pos = {fid: i for i, fid in enumerate(test["fixture_id"].to_numpy())}
    rows = []
    for fid, i in pos.items():
        f = fixtures_by_id[fid]
        hg, ag = f["home_goals"], f["away_goals"]
        res = "HOME" if hg > ag else "DRAW" if hg == ag else "AWAY"
        for e in f.get("engine_predictions", []):
            mt, sel = e["market_type"], e.get("selection") or {}
            outcome, comp = None, None
            if mt == "MATCH_WINNER" and sel.get("value") in ("HOME", "DRAW", "AWAY"):
                outcome = res == sel["value"]
                comp = {"HOME": [0], "DRAW": [1], "AWAY": [2]}[sel["value"]]
            elif mt == "DOUBLE_CHANCE" and sel.get("value") in ("HOME_OR_DRAW", "AWAY_OR_DRAW", "HOME_OR_AWAY"):
                comp = {"HOME_OR_DRAW": [0, 1], "AWAY_OR_DRAW": [2, 1], "HOME_OR_AWAY": [0, 2]}[sel["value"]]
                outcome = {"HOME": 0, "DRAW": 1, "AWAY": 2}[res] in comp
            elif mt == "OVER_UNDER" and sel.get("line") == 2.5 and sel.get("direction") in ("OVER", "UNDER"):
                over = hg + ag > 2.5
                outcome = over if sel["direction"] == "OVER" else not over
                comp = "over25" if sel["direction"] == "OVER" else "under25"
            elif mt == "BTTS" and sel.get("value") in ("YES", "NO"):
                b = hg > 0 and ag > 0
                outcome = b if sel["value"] == "YES" else not b
                comp = "btts" if sel["value"] == "YES" else "no_btts"
            if outcome is None:
                continue
            row = {"fixture_id": fid, "market": mt, "y": int(outcome), "p_engine": min(0.99, max(0.01, e["confidence"] / 100.0)), "provider": (e.get("provider") or "unknown").split(":")[0]}
            for name, P in probs.items():
                if isinstance(comp, list):
                    row[f"p_{name}"] = float(P[i, comp].sum()) if P.shape[1] >= 3 else np.nan
                else:
                    if P.shape[1] < 5:
                        row[f"p_{name}"] = np.nan
                        continue
                    col = 3 if comp in ("over25", "under25") else 4
                    p = float(P[i, col])
                    row[f"p_{name}"] = p if comp in ("over25", "btts") else 1 - p
            rows.append(row)
    return pd.DataFrame(rows)


def compare(test: pd.DataFrame, fixtures_by_id: dict, probs: dict[str, np.ndarray]) -> dict:
    """`probs` maps model name -> array aligned with `test`: 3 columns (1X2) or 5 (1X2 + over2.5 + btts)."""
    df = _engine_rows(test, fixtures_by_id, probs)
    out = {"rows": int(len(df)), "markets": {}}
    if df.empty:
        out["status"] = "unavailable: no comparable engine picks in the evaluation period"
        return out
    for mt, g in df.groupby("market"):
        y = g["y"].to_numpy()
        groups = g["fixture_id"].to_numpy()
        entry = {"n": int(len(g)), "fixtures": int(g["fixture_id"].nunique()), "engine_hit_rate": float(y.mean()), "engine_mean_confidence": float(g["p_engine"].mean())}
        if len(g) < MIN_N:
            entry["status"] = f"insufficient: fewer than {MIN_N} picks"
            out["markets"][mt] = entry
            continue
        e_ll, e_br = binary_logloss_rows(g["p_engine"].to_numpy(), y), binary_brier_rows(g["p_engine"].to_numpy(), y)
        entry["engine"] = {"log_loss": bootstrap_mean(e_ll, groups), "brier": bootstrap_mean(e_br, groups)}
        for name in probs:
            p = g[f"p_{name}"].to_numpy()
            if np.isnan(p).any():
                continue
            m_ll, m_br = binary_logloss_rows(p, y), binary_brier_rows(p, y)
            entry[name] = {
                "mean_p": float(p.mean()),
                "log_loss": bootstrap_mean(m_ll, groups),
                "brier": bootstrap_mean(m_br, groups),
                "log_loss_minus_engine": paired_difference(m_ll, e_ll, groups),
                "brier_minus_engine": paired_difference(m_br, e_br, groups),
            }
        out["markets"][mt] = entry
    out["status"] = "selection-conditional comparison on the engine's own picks; engine confidence uncalibrated"
    return out
