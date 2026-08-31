"""Shared helpers for deterministic public-demo artifact exporters."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream)
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object in {path}")
    return value


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"Expected an object at {path}:{line_number}")
            rows.append(value)
    return rows


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stage(
    stage_id: str,
    operator: str,
    summary: str,
    description: str,
    *,
    consumes: list[str],
    produces: list[str],
    known_before: list[str],
    known_after: list[str],
    evidence: list[str],
    parameters: list[str] | None = None,
) -> dict[str, Any]:
    """Build one explicit, renderer-independent operator-stage contract."""
    return {
        "id": stage_id,
        "operator": operator,
        "summary": summary,
        "description": description,
        "consumes": consumes,
        "produces": produces,
        "knownBefore": known_before,
        "knownAfter": known_after,
        "evidence": evidence,
        "parameters": parameters or [],
    }


def write_artifact(artifact: dict[str, Any], output: Path, *, check: bool) -> None:
    serialized = json.dumps(artifact, indent=2, sort_keys=True) + "\n"
    if check:
        if not output.exists() or output.read_text(encoding="utf-8") != serialized:
            raise SystemExit(f"{output} is not synchronized with its frozen experiment artifacts")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(serialized, encoding="utf-8")
