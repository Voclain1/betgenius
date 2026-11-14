"""Scoring rules, calibration diagnostics and bootstrap confidence intervals.

All intervals are percentile bootstraps over FIXTURES (cluster bootstrap when a
fixture contributes several rows), with a fixed seed so a report is
reproducible. Differences between two models are always PAIRED: both are
scored on the same resampled fixtures.
"""

from __future__ import annotations

import numpy as np

EPS = 1e-12
B_DEFAULT = 2000
SEED = 20261114


def _clip(P: np.ndarray) -> np.ndarray:
    P = np.clip(np.asarray(P, dtype=np.float64), EPS, 1.0)
    return P / P.sum(axis=1, keepdims=True)


def logloss_rows(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    P = _clip(P)
    return -np.log(P[np.arange(len(y)), y])


def brier_rows(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Multiclass Brier: sum over classes of squared error (range 0–2)."""
    Y = np.eye(P.shape[1])[y]
    return ((np.asarray(P) - Y) ** 2).sum(axis=1)


def correct_rows(P: np.ndarray, y: np.ndarray) -> np.ndarray:
    return (np.asarray(P).argmax(axis=1) == y).astype(np.float64)


def binary_logloss_rows(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=np.float64), 1e-6, 1 - 1e-6)
    return -(y * np.log(p) + (1 - y) * np.log(1 - p))


def binary_brier_rows(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    return (np.asarray(p, dtype=np.float64) - y) ** 2


def ece(p: np.ndarray, y: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error of binary probabilities over equal-width bins."""
    p, y = np.asarray(p, dtype=np.float64), np.asarray(y, dtype=np.float64)
    if not len(p):
        return float("nan")
    b = np.minimum(bins - 1, (p * bins).astype(int))
    e = 0.0
    for k in range(bins):
        m = b == k
        if m.any():
            e += m.mean() * abs(p[m].mean() - y[m].mean())
    return float(e)


def reliability(p: np.ndarray, y: np.ndarray, bins: int = 10) -> list[dict]:
    p, y = np.asarray(p, dtype=np.float64), np.asarray(y, dtype=np.float64)
    b = np.minimum(bins - 1, (p * bins).astype(int))
    out = []
    for k in range(bins):
        m = b == k
        if m.any():
            out.append({"bin": f"{k / bins:.1f}-{(k + 1) / bins:.1f}", "n": int(m.sum()), "mean_p": float(p[m].mean()), "observed": float(y[m].mean())})
    return out


def multiclass_calibration(P: np.ndarray, y: np.ndarray) -> dict:
    P = np.asarray(P)
    top = P.max(axis=1)
    hit = (P.argmax(axis=1) == y).astype(float)
    classwise = [ece(P[:, c], (y == c).astype(float)) for c in range(P.shape[1])]
    return {
        "top_label_ece": ece(top, hit),
        "classwise_ece": classwise,
        "classwise_ece_mean": float(np.mean(classwise)),
        "mean_p": [float(v) for v in P.mean(axis=0)],
        "observed": [float((y == c).mean()) for c in range(P.shape[1])],
    }


def _groups(n: int, groups: np.ndarray | None):
    if groups is None:
        return np.arange(n), [np.array([i]) for i in range(n)]
    uniq, inv = np.unique(groups, return_inverse=True)
    members = [np.flatnonzero(inv == g) for g in range(len(uniq))]
    return uniq, members


def bootstrap_mean(values: np.ndarray, groups: np.ndarray | None = None, B: int = B_DEFAULT, seed: int = SEED, alpha: float = 0.05) -> dict:
    values = np.asarray(values, dtype=np.float64)
    n = len(values)
    if n == 0:
        return {"mean": float("nan"), "lo": float("nan"), "hi": float("nan"), "n": 0}
    _, members = _groups(n, groups)
    sums = np.array([values[m].sum() for m in members])
    counts = np.array([len(m) for m in members], dtype=np.float64)
    rng = np.random.default_rng(seed)
    G = len(members)
    draws = rng.integers(0, G, size=(B, G))
    sims = sums[draws].sum(axis=1) / counts[draws].sum(axis=1)
    return {"mean": float(values.mean()), "lo": float(np.quantile(sims, alpha / 2)), "hi": float(np.quantile(sims, 1 - alpha / 2)), "n": int(n)}


def paired_difference(a: np.ndarray, b: np.ndarray, groups: np.ndarray | None = None, **kw) -> dict:
    """Mean of (a - b) with a bootstrap CI. Negative favours `a` for loss metrics."""
    return bootstrap_mean(np.asarray(a) - np.asarray(b), groups, **kw)


def score_1x2(P: np.ndarray, y: np.ndarray, **kw) -> dict:
    return {
        "n": int(len(y)),
        "log_loss": bootstrap_mean(logloss_rows(P, y), **kw),
        "brier": bootstrap_mean(brier_rows(P, y), **kw),
        "accuracy": bootstrap_mean(correct_rows(P, y), **kw),
        "calibration": multiclass_calibration(P, y) if len(y) else {},
    }


def score_binary(p: np.ndarray, y: np.ndarray, **kw) -> dict:
    p, y = np.asarray(p, dtype=np.float64), np.asarray(y, dtype=np.float64)
    return {
        "n": int(len(y)),
        "log_loss": bootstrap_mean(binary_logloss_rows(p, y), **kw),
        "brier": bootstrap_mean(binary_brier_rows(p, y), **kw),
        "accuracy": bootstrap_mean(((p >= 0.5) == (y == 1)).astype(float), **kw),
        "ece": ece(p, y),
        "mean_p": float(p.mean()) if len(p) else float("nan"),
        "observed": float(y.mean()) if len(y) else float("nan"),
    }
