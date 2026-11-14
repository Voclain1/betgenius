"""Load and verify a dataset directory written by the extractor.

Verification is strict on purpose: an unknown schema version or a file whose
SHA-256 no longer matches the manifest is refused, so a report can always be
traced to exactly the bytes it was computed from.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from . import SUPPORTED_SCHEMA


class DatasetError(Exception):
    pass


@dataclass(frozen=True)
class Dataset:
    path: Path
    manifest: dict
    fixtures: list[dict]
    observations: list[dict]

    @property
    def source(self) -> str:
        return self.manifest.get("source", "unknown")

    @property
    def included(self) -> list[dict]:
        return [f for f in self.fixtures if f["status"] == "included"]


def _read_jsonl(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def load_dataset(path: str | Path) -> Dataset:
    p = Path(path)
    manifest_path = p / "manifest.json"
    if not manifest_path.exists():
        raise DatasetError(f"no manifest.json in {p}")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema_version") != SUPPORTED_SCHEMA:
        raise DatasetError(f"unsupported schema {manifest.get('schema_version')!r}; this package reads {SUPPORTED_SCHEMA!r}")
    texts = {}
    for name in ("fixtures.jsonl", "observations.jsonl"):
        f = p / name
        if not f.exists():
            raise DatasetError(f"missing {name}")
        raw = f.read_bytes()
        expected = manifest.get("files", {}).get(name, {}).get("sha256")
        actual = hashlib.sha256(raw).hexdigest()
        if expected != actual:
            raise DatasetError(f"{name} does not match the manifest hash (expected {expected}, got {actual})")
        texts[name] = raw.decode("utf-8")
    fixtures = _read_jsonl(texts["fixtures.jsonl"])
    ids = [f["fixture_id"] for f in fixtures]
    if len(ids) != len(set(ids)):
        raise DatasetError("fixtures.jsonl holds a fixture id more than once")
    for f in fixtures:
        if f["status"] == "included" and (f.get("generation") is None or f.get("home_goals") is None or f.get("away_goals") is None):
            raise DatasetError(f"included fixture {f['fixture_id']} lacks a generation context or a final score")
    return Dataset(path=p, manifest=manifest, fixtures=fixtures, observations=_read_jsonl(texts["observations.jsonl"]))


def write_dataset(path: str | Path, manifest: dict, fixtures: list[dict], observations: list[dict]) -> Path:
    """Write a dataset in the extractor's format. Used by the synthetic generator only."""
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    files = {}
    for name, rows in (("fixtures.jsonl", fixtures), ("observations.jsonl", observations)):
        text = "".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows)
        (p / name).write_text(text)
        files[name] = {"sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "rows": len(rows)}
    m = dict(manifest)
    m["files"] = files
    (p / "manifest.json").write_text(json.dumps(m, indent=2) + "\n")
    return p
