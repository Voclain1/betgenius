"""CLI.

  python -m bgforecast run   --dataset DIR --out DIR [--mode strict|completion] [--test-fraction 0.2] [--folds 4] [--quick] [--sensitivity]
  python -m bgforecast synth --out DIR [--seed 7] [--teams 16] [--leagues 3]

Run from research/forecasting (or with it on PYTHONPATH).
"""

from __future__ import annotations

import argparse
import json
import sys

from .pipeline import run
from .synthetic import generate


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="bgforecast")
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--dataset", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--mode", default="strict", choices=["strict", "completion"])
    r.add_argument("--test-fraction", type=float, default=0.2)
    r.add_argument("--folds", type=int, default=4)
    r.add_argument("--quick", action="store_true", help="two-config grid instead of the full grid (CI / smoke tests)")
    r.add_argument("--sensitivity", action="store_true", help="also score the other ledger mode")
    r.add_argument("--no-boundary-sensitivity", action="store_true", help="skip re-running the protocol at alternative test boundaries (reporting only)")
    r.add_argument("--threads", type=int, default=None, help="XGBoost threads (default BGF_THREADS or 2; see docs for shared-VPS limits)")
    s = sub.add_parser("synth")
    s.add_argument("--out", required=True)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--teams", type=int, default=16)
    s.add_argument("--leagues", type=int, default=3)
    a = p.parse_args(argv)
    if a.cmd == "synth":
        m = generate(a.out, seed=a.seed, teams_per_league=a.teams, leagues=a.leagues)
        print(json.dumps(m["counts"], indent=2))
        return 0
    res = run(a.dataset, a.out, mode=a.mode, test_fraction=a.test_fraction, n_folds=a.folds, quick=a.quick, sensitivity=a.sensitivity,
              boundary_sensitivity=not a.no_boundary_sensitivity, threads=a.threads)
    print(f"status: {res['status']}")
    print(f"recommendation: {res['recommendation']['decision']} — {'; '.join(res['recommendation']['reasons'])}")
    print(f"report: {a.out}/report.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
