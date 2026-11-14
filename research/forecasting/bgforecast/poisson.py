"""Model A — independent-Poisson baseline.

Expected goals:
    lambda_home = mu_home * attack(home) * defence(away)
    lambda_away = mu_away * attack(away) * defence(home)

where mu_home / mu_away are the league's point-in-time home/away goals per
match (shrunk toward the all-league figure when the league is thin), attack is
a team's smoothed goals scored per match divided by the league's per-team
average, and defence is its smoothed goals conceded per match over the same
average. All inputs come from the point-in-time ledger via features.py, so the
model has no fitted parameters and nothing to leak: it is a fixed function of
pre-generation evidence.

The scoreline grid is truncated at MAX_GOALS per side and renormalised.

ASSUMPTIONS AND LIMITATIONS (stated, not hidden):
  - Home and away goals are independent Poisson. Real scorelines show a small
    dependence (draws, especially 0-0 and 1-1, are under-predicted); no
    Dixon–Coles correction is applied in this baseline.
  - Team strength is a recent-window average with shrinkage, not a jointly
    estimated rating; opponent strength in those recent matches is ignored.
  - Matches in other competitions (cups, Europe) count toward a team's form at
    face value.
  - No time decay within the window beyond the window itself.
"""

from __future__ import annotations

import numpy as np
from scipy.stats import poisson

MAX_GOALS = 10
LAMBDA_MIN, LAMBDA_MAX = 0.15, 5.0


def expected_goals(mu_home: float, mu_away: float, home_gf: float, home_ga: float, away_gf: float, away_ga: float) -> tuple[float, float]:
    per_team = (mu_home + mu_away) / 2.0
    att_h, def_h = home_gf / per_team, home_ga / per_team
    att_a, def_a = away_gf / per_team, away_ga / per_team
    lh = float(np.clip(mu_home * att_h * def_a, LAMBDA_MIN, LAMBDA_MAX))
    la = float(np.clip(mu_away * att_a * def_h, LAMBDA_MIN, LAMBDA_MAX))
    return lh, la


def score_matrix(lh: float, la: float) -> np.ndarray:
    g = np.arange(MAX_GOALS + 1)
    m = np.outer(poisson.pmf(g, lh), poisson.pmf(g, la))
    return m / m.sum()


def market_probabilities(lh: float, la: float) -> dict[str, float]:
    m = score_matrix(lh, la)
    g = np.arange(MAX_GOALS + 1)
    total = g[:, None] + g[None, :]
    return {
        "p_home": float(np.tril(m, -1).sum()),
        "p_draw": float(np.trace(m)),
        "p_away": float(np.triu(m, 1).sum()),
        "p_over25": float(m[total > 2.5].sum()),
        "p_btts": float(m[1:, 1:].sum()),
    }


def predict_frame(lh: np.ndarray, la: np.ndarray) -> np.ndarray:
    """Rows of [p_home, p_draw, p_away, p_over25, p_btts]."""
    return np.array([[v for v in market_probabilities(a, b).values()] for a, b in zip(lh, la)])
