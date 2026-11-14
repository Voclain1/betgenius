"""End-to-end research run: dataset -> ledger -> features -> splits -> models -> evaluation -> report.

Everything this writes goes under ``out_dir`` (gitignored by default). Nothing
is published, nothing touches a database, and the model artifact is marked
research_only.
"""

from __future__ import annotations

import json
import os
import platform
import resource
import time
from pathlib import Path

import numpy as np
import pandas as pd

from . import __version__
from .calibration import apply_temperature, fit_temperature
from .dataset import load_dataset
from .engine_compare import compare as engine_compare
from .features import FeatureConfig, build_feature_table, completeness, feature_columns
from .ledger import Ledger
from .metrics import (binary_brier_rows, binary_logloss_rows, brier_rows, logloss_rows, paired_difference, score_1x2,
                      score_binary)
from .poisson import predict_frame
from .splits import assert_partition_integrity, describe, final_split, split_at, walk_forward, _kickoff_quantile
from . import xgb_model

MIN_FIXTURES = 300          # below this, no models are trained at all
MIN_TEST = 300              # below this, the recommendation cannot be "proceed"
MIN_LEAGUE_N = 30
QUICK_GRID = [{"max_depth": 3, "learning_rate": 0.08, "min_child_weight": 5.0, "reg_lambda": 1.0},
              {"max_depth": 2, "learning_rate": 0.08, "min_child_weight": 20.0, "reg_lambda": 10.0}]

# Pre-registered decision rule (also in docs/research/XGBOOST_RESEARCH_ENGINE.md).
ECE_MAX = 0.05
COVERAGE_MIN = 70.0


def _base_rate(y: np.ndarray, n: int) -> np.ndarray:
    freq = np.bincount(y, minlength=3).astype(float) + 1.0  # add-one so no class is ever 0
    return np.tile(freq / freq.sum(), (n, 1))


def _poisson(df: pd.DataFrame) -> np.ndarray:
    return predict_frame(df["pois_lambda_home"].to_numpy(), df["pois_lambda_away"].to_numpy())


def _peak_rss_mib() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024.0  # Linux reports KiB


def recommend(r: dict) -> dict:
    """Apply the pre-registered rule to a results dict. Pure, so it is tested directly."""
    reasons = []
    if r.get("status") != "evaluated":
        return {"decision": "improve data", "reasons": [r.get("status", "not evaluated")]}
    t = r["test"]
    n = t["xgb_calibrated"]["n"]
    d_pois = t["paired"]["xgb_calibrated_minus_poisson"]["log_loss"]
    d_base = t["paired"]["xgb_calibrated_minus_base_rate"]["log_loss"]
    ece_ = t["xgb_calibrated"]["calibration"]["top_label_ece"]
    cov = r["coverage"]["features_all"].get("both_history_pct", 0.0)
    beats_pois = d_pois["hi"] < 0
    beats_base = d_base["hi"] < 0
    if n < MIN_TEST:
        reasons.append(f"test period holds {n} fixtures (< {MIN_TEST})")
    if cov < COVERAGE_MIN:
        reasons.append(f"only {cov:.1f}% of fixtures have history for both teams (< {COVERAGE_MIN:.0f}%)")
    if n >= MIN_TEST and beats_pois and beats_base and ece_ <= ECE_MAX:
        return {"decision": "proceed", "reasons": [
            "XGBoost beats both Poisson and the base rate on untouched test log loss (95% paired CI below zero)",
            f"top-label ECE {ece_:.3f} <= {ECE_MAX}",
            "proceed means a shadow-mode evaluation against live generation, never direct publication"]}
    if not beats_base and not reasons:
        return {"decision": "stop", "reasons": ["XGBoost does not beat the base rate on the test period with adequate data and coverage"]}
    if beats_base and not beats_pois:
        reasons.append("XGBoost beats the base rate but not the Poisson baseline: the gain is not attributable to XGBoost")
    if ece_ > ECE_MAX:
        reasons.append(f"top-label ECE {ece_:.3f} > {ECE_MAX}")
    return {"decision": "improve data", "reasons": reasons or ["evidence inconclusive"]}


def _score_suite(P: dict, y: np.ndarray) -> dict:
    return {name: score_1x2(p, y) for name, p in P.items()}


def _paired(P: dict, y: np.ndarray, a: str, b: str) -> dict:
    return {"log_loss": paired_difference(logloss_rows(P[a], y), logloss_rows(P[b], y)),
            "brier": paired_difference(brier_rows(P[a], y), brier_rows(P[b], y))}


def run(dataset_dir: str | Path, out_dir: str | Path, *, mode: str = "strict", test_fraction: float = 0.2, n_folds: int = 4,
        cal_fraction: float = 0.2, quick: bool = False, sensitivity: bool = False, feature_config: FeatureConfig = FeatureConfig()) -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    def lap(name: str, since: float) -> float:
        now = time.perf_counter()
        timings[name] = round(now - since, 3)
        return now

    ds = load_dataset(dataset_dir)
    ledger = Ledger(ds.observations, mode=mode)
    t = lap("load_and_ledger", t0)
    df, featmeta = build_feature_table(ds.fixtures, ledger, feature_config)
    t = lap("features", t)

    r: dict = {
        "engine_version": __version__,
        "dataset": {"path": str(ds.path), "source": ds.source, "schema_version": ds.manifest["schema_version"], "as_of": ds.manifest.get("as_of"),
                    "generated_at": ds.manifest.get("generated_at"), "files": ds.manifest.get("files"), "counts": ds.manifest.get("counts"),
                    "fixture_exclusions": ds.manifest.get("fixture_exclusions"), "job_verdicts": ds.manifest.get("job_verdicts"),
                    "context_versions": ds.manifest.get("context_versions"), "audit": ds.manifest.get("audit"),
                    "source_timestamps": ds.manifest.get("source_timestamps")},
        "ledger": ledger.summary(),
        "features": {**featmeta, "columns": feature_columns(df) if not df.empty else []},
        "coverage": {"features_all": completeness(df)},
        "distribution": {},
    }
    if not df.empty:
        r["distribution"] = {
            "by_league": df.groupby(["league_id", "league_name"], dropna=False).size().sort_values(ascending=False).head(30)
                           .reset_index().rename(columns={0: "n"}).to_dict(orient="records"),
            "by_season": df.groupby("season").size().to_dict(),
            "by_month": df.groupby(df["kickoff"].dt.strftime("%Y-%m")).size().to_dict(),
            "outcomes": {"home": int((df["y"] == 0).sum()), "draw": int((df["y"] == 1).sum()), "away": int((df["y"] == 2).sum())},
        }

    if len(df) < MIN_FIXTURES:
        r["status"] = f"insufficient data: {len(df)} usable fixtures (< {MIN_FIXTURES}); no model trained"
        r["recommendation"] = recommend(r)
        return _finish(r, out, timings, t0)

    # ── partitions ─────────────────────────────────────────────────────────
    final = final_split(df, test_fraction)
    assert_partition_integrity(df, final)
    dev = df.iloc[final.train].reset_index(drop=True)
    test = df.iloc[final.eval].reset_index(drop=True)
    folds = walk_forward(dev, n_folds)
    for f in folds:
        assert_partition_integrity(dev, f)
    cal = split_at(dev, _kickoff_quantile(dev, 1 - cal_fraction))
    assert_partition_integrity(dev, cal)
    dev_fit, dev_cal = dev.iloc[cal.train], dev.iloc[cal.eval]
    r["splits"] = {"final": describe(df, final), "folds": [describe(dev, f) for f in folds], "calibration": describe(dev, cal)}
    r["coverage"]["features_test"] = completeness(test)
    features = feature_columns(df)
    t = lap("splits", t)

    # ── tuning on walk-forward folds (development period only) ────────────
    tuned = xgb_model.tune(dev, folds, features, QUICK_GRID if quick else None)
    params, rounds = tuned["best_params"], max(10, tuned["rounds"])
    t = lap("tuning", t)

    wf = []
    for i, f in enumerate(folds):
        tr, ev = dev.iloc[f.train], dev.iloc[f.eval]
        b, enc, best = xgb_model.train_with_early_stopping(tr, features, params)
        y = ev["y"].to_numpy()
        P = {"base_rate": _base_rate(tr["y"].to_numpy(), len(ev)), "poisson": _poisson(ev)[:, :3], "xgb": xgb_model.predict(b, enc, ev, features, best)}
        wf.append({"fold": i, "n_train": int(len(tr)), "n_eval": int(len(ev)),
                   **{k: float(logloss_rows(v, y).mean()) for k, v in P.items()}})
    r["walk_forward"] = {"folds": wf, "note": "XGBoost fold scores use the config selected on these same folds, so they are optimistic; the test period is the unbiased estimate.",
                         "tuning": {"best_params": params, "rounds": rounds, "grid_size": len(tuned["results"]), "results": tuned["results"]}}
    t = lap("walk_forward", t)

    # ── final model: fit on dev_fit, temperature on dev_cal, score on test ─
    booster, enc = xgb_model.train_fixed(dev_fit, features, params, rounds)
    P_cal_raw = xgb_model.predict(booster, enc, dev_cal, features)
    T = fit_temperature(P_cal_raw, dev_cal["y"].to_numpy())
    t = lap("final_fit", t)

    y = test["y"].to_numpy()
    pois_test = _poisson(test)
    xgb_raw = xgb_model.predict(booster, enc, test, features)
    P = {"base_rate": _base_rate(dev["y"].to_numpy(), len(test)), "poisson": pois_test[:, :3], "xgb_raw": xgb_raw, "xgb_calibrated": apply_temperature(xgb_raw, T)}
    r["test"] = _score_suite(P, y)
    r["test"]["temperature"] = T
    r["test"]["paired"] = {
        "xgb_calibrated_minus_poisson": _paired(P, y, "xgb_calibrated", "poisson"),
        "xgb_calibrated_minus_base_rate": _paired(P, y, "xgb_calibrated", "base_rate"),
        "poisson_minus_base_rate": _paired(P, y, "poisson", "base_rate"),
        "xgb_calibrated_minus_xgb_raw": _paired(P, y, "xgb_calibrated", "xgb_raw"),
    }

    leagues = []
    for (lid, lname), g in test.groupby(["league_id", "league_name"], dropna=False):
        if len(g) < MIN_LEAGUE_N:
            continue
        ix, yy = g.index.to_numpy(), g["y"].to_numpy()
        leagues.append({"league_id": int(lid), "league_name": lname, "n": int(len(g)),
                        **{k: float(logloss_rows(v[ix], yy).mean()) for k, v in P.items()},
                        "xgb_minus_poisson": paired_difference(logloss_rows(P["xgb_calibrated"][ix], yy), logloss_rows(P["poisson"][ix], yy))})
    r["test"]["by_league"] = sorted(leagues, key=lambda x: -x["n"])

    goals = {}
    for name, col, target in (("over_2_5", 3, "y_over25"), ("btts", 4, "y_btts")):
        yy = test[target].to_numpy()
        base = np.full(len(test), (dev[target].sum() + 1) / (len(dev) + 2))
        goals[name] = {"poisson": score_binary(pois_test[:, col], yy), "base_rate": score_binary(base, yy),
                       "poisson_minus_base_rate": {"log_loss": paired_difference(binary_logloss_rows(pois_test[:, col], yy), binary_logloss_rows(base, yy)),
                                                   "brier": paired_difference(binary_brier_rows(pois_test[:, col], yy), binary_brier_rows(base, yy))}}
    r["test"]["goals_markets"] = goals

    fixtures_by_id = {f["fixture_id"]: f for f in ds.included}
    r["engine_comparison"] = engine_compare(test, fixtures_by_id, {"xgb": P["xgb_calibrated"], "poisson": pois_test})
    t = lap("evaluation", t)

    meta = xgb_model.save_artifact(out / "model", booster, enc, features, params, rounds, T, ds.manifest,
                                   {"feature_config": featmeta["config"], "ledger_mode": mode, "train_rows": int(len(dev_fit)), "calibration_rows": int(len(dev_cal))})
    r["artifact"] = {"path": str(out / "model"), "version": meta["version"], "model_sha256": meta["model_sha256"]}
    preds = test[["fixture_id", "kickoff", "league_id", "y"]].copy()
    for k, v in P.items():
        for c, lab in enumerate(("home", "draw", "away")):
            preds[f"{k}_{lab}"] = v[:, c]
    preds.to_csv(out / "test_predictions.csv", index=False)
    t = lap("artifacts", t)

    if sensitivity:
        r["sensitivity"] = _sensitivity(ds, df, mode, feature_config, params, rounds, test_fraction, cal_fraction)
        t = lap("sensitivity", t)

    r["status"] = "evaluated"
    r["recommendation"] = recommend(r)
    return _finish(r, out, timings, t0)


def _sensitivity(ds, df, mode, cfg, params, rounds, test_fraction, cal_fraction) -> dict:
    """Same params, the other ledger mode: how much does strict point-in-time availability cost?"""
    other = "completion" if mode == "strict" else "strict"
    df2, _ = build_feature_table(ds.fixtures, Ledger(ds.observations, mode=other), cfg)
    s = final_split(df2, test_fraction)
    dev, test = df2.iloc[s.train].reset_index(drop=True), df2.iloc[s.eval].reset_index(drop=True)
    c = split_at(dev, _kickoff_quantile(dev, 1 - cal_fraction))
    feats = feature_columns(df2)
    b, enc = xgb_model.train_fixed(dev.iloc[c.train], feats, params, rounds)
    T = fit_temperature(xgb_model.predict(b, enc, dev.iloc[c.eval], feats), dev.iloc[c.eval]["y"].to_numpy())
    y = test["y"].to_numpy()
    return {"mode": other, "n_test": int(len(test)), "both_history_pct": completeness(df2).get("both_history_pct"),
            "poisson_log_loss": float(logloss_rows(_poisson(test)[:, :3], y).mean()),
            "xgb_calibrated_log_loss": float(logloss_rows(apply_temperature(xgb_model.predict(b, enc, test, feats), T), y).mean()),
            "note": "Completion mode lets a fixture see results BetGenius only recorded after generation. It is an upper bound on what better data capture could buy, not a valid backtest."}


def _finish(r: dict, out: Path, timings: dict, t0: float) -> dict:
    timings["total"] = round(time.perf_counter() - t0, 3)
    r["resources"] = {"timings_s": timings, "peak_rss_mib": round(_peak_rss_mib(), 1), "cpu_count": os.cpu_count(),
                      "xgboost_nthread": xgb_model.NTHREAD, "python": platform.python_version(), "platform": platform.platform()}
    (out / "results.json").write_text(json.dumps(r, indent=2, default=_json_default) + "\n")
    from .report import render
    (out / "report.md").write_text(render(r))
    return r


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (pd.Timestamp,)):
        return o.isoformat()
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)
