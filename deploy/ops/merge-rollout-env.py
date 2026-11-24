#!/usr/bin/env python3
"""Safely transfer only approved VPS activation flags across a deploy.

New app secrets/config still originate from PROD_ENV_FILE; only the
explicitly allowlisted runtime rollout flags come from the previous on-host
app.env. This prevents a future deployment from silently resetting a
controlled SHADOW test. No automatic promotion: missing previous flags
default OFF, even if the new incoming secret happens to say ON.

Usage: python3 merge-rollout-env.py /opt/betgenius/app.env /opt/betgenius/app.env.next
The incoming file is staged first and replaced atomically after validation.
"""
from __future__ import annotations

import os
from pathlib import Path
import sys

MODES = {
    "EARLY_FIXTURE_MODE": {"off", "shadow", "on"},
    "EARLY_FREE_PUBLICATION_MODE": {"off", "shadow", "on"},
    "PREDICTION_REASSESSMENT_MODE": {"off", "shadow", "on"},
    # PR #235 market-quality flags. "on" for MARKET_SELECTION_MODE switches
    # published markets, so it is only ever preserved from the VPS, never
    # promoted from the incoming secret; missing values default to off.
    "MARKET_SELECTION_MODE": {"off", "shadow", "on"},
    "MARKET_QUALITY_RANKING": {"off", "on"},
    "FREE_TIER_NEUTRAL_BANDS": {"off", "on"},
    # Pre-prediction match pages (issue #237): off | noindex | on. Defaults off
    # and is never promoted by the incoming secret.
    "MATCH_PREVIEW_MODE": {"off", "noindex", "on"},
}


def flag_values(content: str, source: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for line in content.splitlines():
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        if key not in MODES:
            continue
        if key in found:
            raise ValueError(f"Duplicate rollout flag in {source}: {key}")
        if value not in MODES[key]:
            raise ValueError(f"Invalid rollout flag in {source}: {key}")
        found[key] = value
    return found


def merge(previous: str, incoming: str) -> tuple[str, dict[str, str]]:
    previous_flags = flag_values(previous, "existing VPS configuration")
    flag_values(incoming, "incoming deployment configuration")

    # The VPS is the source of truth for flags that were explicitly activated.
    # A first-time installation (no previous app.env) fails safely OFF.
    chosen = {key: previous_flags.get(key, "off") for key in MODES}
    kept_lines = [
        line for line in incoming.splitlines()
        if line.partition("=")[0] not in MODES
    ]
    kept_lines.extend(f"{key}={value}" for key, value in chosen.items())
    return "\n".join(kept_lines) + "\n", chosen


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: merge-rollout-env.py CURRENT_APP_ENV STAGED_APP_ENV")
    current = Path(sys.argv[1])
    staged = Path(sys.argv[2])
    if not staged.is_file():
        raise SystemExit("Missing staged app.env — refusing deployment")
    previous = current.read_text(encoding="utf-8") if current.is_file() else ""
    incoming = staged.read_text(encoding="utf-8")
    try:
        merged, chosen = merge(previous, incoming)
    except ValueError as error:
        # Never log unrelated environment variables or secret values.
        raise SystemExit(f"Rollout flag validation failed: {error}") from None

    # Staged file is private and on the same filesystem as the destination.
    # os.replace is atomic: a validation failure never touches the live file.
    staged.write_text(merged, encoding="utf-8")
    staged.chmod(0o600)
    os.replace(staged, current)
    print("Preserved production rollout: " +
          ", ".join(f"{k}={v}" for k, v in chosen.items()))


if __name__ == "__main__":
    main()
