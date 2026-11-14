"""Model B — XGBoost three-class match outcome (home / draw / away).

  - Objective multi:softprob, histogram trees, explicit seed and thread count
    so a run is bit-for-bit reproducible on the same machine and versions.
  - Missing values stay NaN and are routed by XGBoost's learned default
    direction; every feature that can be missing also has an explicit 0/1
    indicator (features.py), so "missing" is visible to the model as a fact.
  - League and team ids are CATEGORICAL. Values seen fewer than `min_count`
    times in the TRAINING rows collapse into "other"; unseen values at
    prediction time map to "other". No id is ever a numeric magnitude.
  - Regularisation: shallow trees, min_child_weight, L2 (lambda), L1 (alpha),
    row and column subsampling. Tuning is a small fixed grid, scored on
    walk-forward folds; early stopping uses a chronological tail of each
    fold's own training rows, never the fold's evaluation rows.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import os
import platform
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from .calibration import apply_temperature
from .features import CATEGORICAL
from .metrics import logloss_rows

SEED = 20261114
# Default 2: safe on the shared VPS (BetGenius's app container is itself capped at 2 CPUs).
# Override with --threads or BGF_THREADS. Predictions are bit-identical for a
# fixed thread count; compare runs only at the same count (it is recorded in the artifact).
NTHREAD = max(1, int(os.environ.get("BGF_THREADS", "2")))
MAX_ROUNDS = 2000
EARLY_STOP = 100
ES_TAIL = 0.15

BASE_PARAMS = {
    "objective": "multi:softprob",
    "num_class": 3,
    "tree_method": "hist",
    "eval_metric": "mlogloss",
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.0,
    "max_cat_to_onehot": 1,
    "seed": SEED,
    "nthread": NTHREAD,
    "verbosity": 0,
}



def set_threads(n: int) -> None:
    """Set XGBoost's thread count for this process (training, prediction and DMatrix construction)."""
    global NTHREAD
    NTHREAD = max(1, int(n))
    BASE_PARAMS["nthread"] = NTHREAD


GRID = {
    "max_depth": [2, 3, 4],
    "learning_rate": [0.03, 0.08],
    "min_child_weight": [5.0, 20.0],
    "reg_lambda": [1.0, 10.0],
}


def grid() -> list[dict]:
    keys = list(GRID)
    return [dict(zip(keys, vals)) for vals in itertools.product(*(GRID[k] for k in keys))]


@dataclass
class CategoryEncoder:
    min_count: dict = field(default_factory=lambda: {"league_id": 20, "home_id": 10, "away_id": 10})
    categories: dict = field(default_factory=dict)

    def fit(self, df: pd.DataFrame) -> "CategoryEncoder":
        for c in CATEGORICAL:
            counts = df[c].astype(str).value_counts()
            # Team ids are pooled across home/away so one team has one category.
            if c in ("home_id", "away_id"):
                counts = pd.concat([df["home_id"], df["away_id"]]).astype(str).value_counts()
            keep = sorted(counts[counts >= self.min_count[c]].index)
            self.categories[c] = ["other"] + keep
        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()
        for c in CATEGORICAL:
            cats = self.categories[c]
            s = out[c].astype(str)
            out[c] = pd.Categorical(s.where(s.isin(cats), "other"), categories=cats)
        return out


def _matrix(df: pd.DataFrame, features: list[str], enc: CategoryEncoder, y: np.ndarray | None = None) -> xgb.DMatrix:
    X = enc.transform(df[features])
    return xgb.DMatrix(X, label=y, enable_categorical=True, missing=np.nan, nthread=NTHREAD)


def _es_split(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(df["kickoff"].to_numpy(), kind="stable")
    cut = int(len(order) * (1 - ES_TAIL))
    return order[:cut], order[cut:]


def train_with_early_stopping(df: pd.DataFrame, features: list[str], params: dict) -> tuple[xgb.Booster, CategoryEncoder, int]:
    fit_ix, es_ix = _es_split(df)
    enc = CategoryEncoder().fit(df.iloc[fit_ix])
    y = df["y"].to_numpy()
    dfit = _matrix(df.iloc[fit_ix], features, enc, y[fit_ix])
    des = _matrix(df.iloc[es_ix], features, enc, y[es_ix])
    booster = xgb.train({**BASE_PARAMS, **params}, dfit, num_boost_round=MAX_ROUNDS, evals=[(des, "es")], early_stopping_rounds=EARLY_STOP, verbose_eval=False)
    return booster, enc, int(booster.best_iteration) + 1


def train_fixed(df: pd.DataFrame, features: list[str], params: dict, rounds: int) -> tuple[xgb.Booster, CategoryEncoder]:
    enc = CategoryEncoder().fit(df)
    d = _matrix(df, features, enc, df["y"].to_numpy())
    return xgb.train({**BASE_PARAMS, **params}, d, num_boost_round=rounds, verbose_eval=False), enc


def predict(booster: xgb.Booster, enc: CategoryEncoder, df: pd.DataFrame, features: list[str], rounds: int | None = None) -> np.ndarray:
    d = _matrix(df, features, enc)
    kw = {"iteration_range": (0, rounds)} if rounds else {}
    return booster.predict(d, **kw)


def tune(dev: pd.DataFrame, folds, features: list[str], configs: list[dict] | None = None) -> dict:
    """Score every config on every walk-forward fold; choose the lowest mean fold log loss."""
    configs = configs or grid()
    results = []
    for cfg in configs:
        losses, rounds = [], []
        for f in folds:
            tr, ev = dev.iloc[f.train], dev.iloc[f.eval]
            booster, enc, best = train_with_early_stopping(tr, features, cfg)
            P = predict(booster, enc, ev, features, best)
            losses.append(float(logloss_rows(P, ev["y"].to_numpy()).mean()))
            rounds.append(best)
        results.append({"params": cfg, "fold_log_loss": losses, "mean_log_loss": float(np.mean(losses)), "best_rounds": rounds})
    results.sort(key=lambda r: (r["mean_log_loss"], json.dumps(r["params"], sort_keys=True)))
    best = results[0]
    return {"best_params": best["params"], "rounds": int(np.median(best["best_rounds"])), "results": results}


def save_artifact(path: Path, booster: xgb.Booster, enc: CategoryEncoder, features: list[str], params: dict, rounds: int,
                  temperature: float, dataset_manifest: dict, extra: dict) -> dict:
    path.mkdir(parents=True, exist_ok=True)
    model_file = path / "model.json"
    booster.save_model(model_file)
    model_hash = hashlib.sha256(model_file.read_bytes()).hexdigest()
    meta = {
        "artifact": "bg-xgb-1x2",
        "version": f"xgb-1x2-{model_hash[:12]}",
        "model_sha256": model_hash,
        "features": features,
        "categorical": CATEGORICAL,
        "categories": enc.categories,
        "params": {**BASE_PARAMS, **params},
        "rounds": rounds,
        "temperature": temperature,
        "class_order": ["home", "draw", "away"],
        "dataset": {"schema_version": dataset_manifest.get("schema_version"), "source": dataset_manifest.get("source"),
                    "as_of": dataset_manifest.get("as_of"), "files": dataset_manifest.get("files")},
        "runtime": {"python": platform.python_version(), "xgboost": xgb.__version__, "numpy": np.__version__, "pandas": pd.__version__},
        "research_only": True,
        **extra,
    }
    (path / "meta.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")
    return meta


def load_artifact(path: Path) -> tuple[xgb.Booster, CategoryEncoder, dict]:
    meta = json.loads((path / "meta.json").read_text())
    if hashlib.sha256((path / "model.json").read_bytes()).hexdigest() != meta["model_sha256"]:
        raise ValueError("model.json does not match meta.json hash")
    booster = xgb.Booster()
    booster.load_model(path / "model.json")
    booster.set_param({"nthread": NTHREAD})
    return booster, CategoryEncoder(categories=meta["categories"]), meta


def predict_calibrated(path: Path, df: pd.DataFrame) -> np.ndarray:
    booster, enc, meta = load_artifact(path)
    return apply_temperature(predict(booster, enc, df, meta["features"]), meta["temperature"])
