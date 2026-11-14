"""Multiclass temperature scaling.

One parameter, so it cannot overfit a modest calibration slice the way
per-class or isotonic maps can: probabilities are re-softmaxed from
log(P) / T. T > 1 softens over-confident forecasts, T < 1 sharpens timid ones.
The ranking of outcomes never changes, so accuracy is unaffected.
"""

from __future__ import annotations

import numpy as np
from scipy.optimize import minimize_scalar

from .metrics import logloss_rows


def apply_temperature(P: np.ndarray, T: float) -> np.ndarray:
    z = np.log(np.clip(np.asarray(P, dtype=np.float64), 1e-12, 1.0)) / T
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def fit_temperature(P: np.ndarray, y: np.ndarray) -> float:
    if len(y) == 0:
        return 1.0
    res = minimize_scalar(lambda lt: logloss_rows(apply_temperature(P, float(np.exp(lt))), y).mean(), bounds=(-2.0, 2.0), method="bounded", options={"xatol": 1e-6})
    return float(np.exp(res.x))
