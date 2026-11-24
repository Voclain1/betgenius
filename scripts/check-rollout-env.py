#!/usr/bin/env python3
"""Production settings regression: protects rollout state and all other secrets."""
from pathlib import Path
import subprocess
import sys
import tempfile

MERGER = Path("deploy/ops/merge-rollout-env.py")
FLAGS = ("EARLY_FIXTURE_MODE", "EARLY_FREE_PUBLICATION_MODE", "PREDICTION_REASSESSMENT_MODE")
MARKET_FLAGS = ("MARKET_SELECTION_MODE", "MARKET_QUALITY_RANKING", "FREE_TIER_NEUTRAL_BANDS", "MATCH_PREVIEW_MODE")


def run(previous: str | None, incoming: str):
    with tempfile.TemporaryDirectory() as d:
        home = Path(d) / "app.env"
        staged = Path(d) / "app.env.next"
        if previous is not None:
            home.write_text(previous, encoding="utf-8")
        staged.write_text(incoming, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(MERGER), str(home), str(staged)],
            capture_output=True, text=True, check=False,
        )
        return result, home.read_text(encoding="utf-8") if home.exists() else None, staged.exists(), home.stat().st_mode & 0o777 if home.exists() else None


def verify():
    existing = (
        "DATABASE_URL=old-private-db\n"
        "ANTHROPIC_API_KEY=old-secret\n"
        "EARLY_FIXTURE_MODE=on\n"
        "EARLY_FREE_PUBLICATION_MODE=shadow\n"
        "PREDICTION_REASSESSMENT_MODE=shadow\n"
    )
    incoming = (
        "# normal settings remain from the incoming secret\n"
        "DATABASE_URL=new-private-db\n"
        "ANTHROPIC_API_KEY=new-secret\n"
        "UNRELATED_FLAG=unchanged\n"
        "EARLY_FIXTURE_MODE=off\n"
        "EARLY_FREE_PUBLICATION_MODE=off\n"
        "PREDICTION_REASSESSMENT_MODE=off\n"
    )
    result, merged, next_exists, mode = run(existing, incoming)
    assert result.returncode == 0, result.stderr
    assert not next_exists, "staged file must not remain after atomic replacement"
    assert mode == 0o600, "sensitive app.env must be owner-only"
    assert "DATABASE_URL=new-private-db" in merged and "ANTHROPIC_API_KEY=new-secret" in merged
    assert "DATABASE_URL=old-private-db" not in merged and "old-secret" not in merged
    assert "UNRELATED_FLAG=unchanged" in merged
    assert result.stdout.count("EARLY_FIXTURE_MODE=on") == 1
    assert not any(word in result.stdout + result.stderr for word in ("secret", "private-db"))
    for key, value in (
        ("EARLY_FIXTURE_MODE", "on"),
        ("EARLY_FREE_PUBLICATION_MODE", "shadow"),
        ("PREDICTION_REASSESSMENT_MODE", "shadow"),
    ):
        assert merged.count(f"{key}=") == 1
        assert f"{key}={value}" in merged

    # Repeat the deploy with incoming defaults: rollout remains unchanged.
    second, merged_again, _, _ = run(merged, incoming)
    assert second.returncode == 0 and merged_again == merged

    # Fresh install / missing previous flags must never activate a public mode.
    first, first_contents, _, _ = run(None,
        "TOKEN=new-private-token\nEARLY_FIXTURE_MODE=on\n"
        "EARLY_FREE_PUBLICATION_MODE=on\nPREDICTION_REASSESSMENT_MODE=on\n")
    assert first.returncode == 0
    assert all(f"{key}=off" in first_contents for key in FLAGS)
    assert "TOKEN=new-private-token" in first_contents

    # Intentional ON in existing VPS state persists; not promoted by the
    # deployment secret. Operations can later deliberately promote on VPS.
    live, live_contents, _, _ = run(
        "EARLY_FIXTURE_MODE=on\nEARLY_FREE_PUBLICATION_MODE=on\nPREDICTION_REASSESSMENT_MODE=on\n",
        incoming,
    )
    assert live.returncode == 0
    assert all(f"{key}=on" in live_contents for key in FLAGS)

    # Corrupt existing or incoming activation config fails closed without
    # mutating the running file, and without disclosing secrets.
    for corrupt in (
        "EARLY_FIXTURE_MODE=enabled\n",
        "EARLY_FIXTURE_MODE=on\nEARLY_FIXTURE_MODE=off\n",
        "EARLY_FREE_PUBLICATION_MODE=true\n",
    ):
        bad, same, _, _ = run("DATABASE_URL=secret-value\n" + corrupt, incoming)
        assert bad.returncode != 0 and same == "DATABASE_URL=secret-value\n" + corrupt
        assert "secret-value" not in bad.stdout + bad.stderr
        bad_new, same_new, _, _ = run(existing, "TOKEN=secret-value\n" + corrupt)
        assert bad_new.returncode != 0 and same_new == existing
        assert "secret-value" not in bad_new.stdout + bad_new.stderr

    # Non-rollout env that happens to contain a flag word in its value survives.
    safe, contents, _, _ = run(existing,
        "# EARLY_FIXTURE_MODE=on (comment)\n"
        "BANNER=EARLY_FIXTURE_MODE=on\n"
        "EARLY_FIXTURE_MODE=off\n")
    assert safe.returncode == 0
    assert "# EARLY_FIXTURE_MODE=on (comment)" in contents
    assert "BANNER=EARLY_FIXTURE_MODE=on" in contents
    # PR #235 market flags: shadow persists, missing defaults off, never promoted
    # from the incoming secret, invalid values and duplicates rejected.
    shadow_prev = "DATABASE_URL=x\nMARKET_SELECTION_MODE=shadow\nMARKET_QUALITY_RANKING=off\nFREE_TIER_NEUTRAL_BANDS=off\nMATCH_PREVIEW_MODE=noindex\n"
    promote = "TOKEN=t\nMARKET_SELECTION_MODE=on\nMARKET_QUALITY_RANKING=on\nFREE_TIER_NEUTRAL_BANDS=on\nMATCH_PREVIEW_MODE=on\n"
    kept, kept_contents, _, _ = run(shadow_prev, promote)
    assert kept.returncode == 0
    for key, value in (("MARKET_SELECTION_MODE", "shadow"), ("MARKET_QUALITY_RANKING", "off"), ("FREE_TIER_NEUTRAL_BANDS", "off"), ("MATCH_PREVIEW_MODE", "noindex")):
        assert kept_contents.count(f"{key}=") == 1 and f"{key}={value}" in kept_contents
    fresh, fresh_contents, _, _ = run(None, promote)
    assert fresh.returncode == 0 and all(f"{key}=off" in fresh_contents for key in MARKET_FLAGS)
    legacy, legacy_contents, _, _ = run(existing, incoming)  # previous file predates the market flags
    assert legacy.returncode == 0 and all(f"{key}=off" in legacy_contents for key in MARKET_FLAGS)
    again, again_contents, _, _ = run(kept_contents, promote)
    assert again.returncode == 0 and again_contents == kept_contents
    for corrupt in ("MARKET_SELECTION_MODE=enabled\n", "MARKET_QUALITY_RANKING=shadow\n", "MATCH_PREVIEW_MODE=true\n",
                    "FREE_TIER_NEUTRAL_BANDS=on\nFREE_TIER_NEUTRAL_BANDS=off\n"):
        bad, same, _, _ = run("DATABASE_URL=secret-value\n" + corrupt, incoming)
        assert bad.returncode != 0 and same == "DATABASE_URL=secret-value\n" + corrupt
        assert "secret-value" not in bad.stdout + bad.stderr
        bad_new, same_new, _, _ = run(existing, "TOKEN=secret-value\n" + corrupt)
        assert bad_new.returncode != 0 and same_new == existing
        assert "secret-value" not in bad_new.stdout + bad_new.stderr
    print("PASS: rollout persistence, secrecy, idempotence and unsafe values")


if __name__ == "__main__":
    verify()
