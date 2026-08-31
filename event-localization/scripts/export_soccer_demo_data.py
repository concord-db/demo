#!/usr/bin/env python3
"""Export the frozen materialized SoccerNet evaluation into a public demo artifact."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from artifact_helpers import load_json, load_jsonl, sha256, stage, write_artifact


EXPERIMENT = "goal_pushdown_3_games_v4_materialized"
GAME_ID = "england_epl/2015-2016/2015-09-12 - 14-45 Everton 3 - 1 Chelsea"
HALF = 1
QUERY_TEXT = "Find every source-time timestamp at which a goal is scored in the match half."


def select_row(rows: list[dict[str, Any]], label: str) -> dict[str, Any]:
    matches = [row for row in rows if row.get("game_id") == GAME_ID and row.get("half") == HALF]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {label} row for {GAME_ID}/half {HALF}, found {len(matches)}")
    return matches[0]


def select_predictions(document: dict[str, Any], *, clips: bool) -> list[dict[str, Any]]:
    rows = document.get("predictions")
    if not isinstance(rows, list):
        raise ValueError("Prediction document is missing a predictions array")
    selected = [row for row in rows if row.get("game_id") == GAME_ID and row.get("half") == HALF]
    predictions = []
    for row in selected:
        prediction = {
            "eventKind": "point",
            "timeSeconds": row["time_seconds"],
            "confidence": row["confidence"],
            "evidence": row["evidence"],
        }
        if clips:
            prediction["clipId"] = f"soccer-clip-{row['window_id']}"
        predictions.append(prediction)
    return predictions


def plan_content(trace_fraction: float) -> dict[str, dict[str, Any]]:
    return {
        "baseline": {
            "label": "Video-only",
            "expression": "Unnest_E ( Map_localizeᴠ(v,p)→E ( R ) )",
            "videoFraction": 1.0,
            "stages": [
                stage(
                    "input", "Input", "Read the complete match half",
                    "Construct one input tuple containing the complete match-half video and the goal description.",
                    consumes=["stored match-half record", "event description p"],
                    produces=["R(source_id, v, p)"],
                    known_before=["Match-half identifier", "goal description"],
                    known_after=["Complete 45-minute source video v"],
                    evidence=["sourceMedia"],
                ),
                stage(
                    "video-localize", "Video localize", "Run the MLLM over the full match half",
                    "Apply the video goal localizer to the complete match-half video.",
                    consumes=["complete video v", "event description p"],
                    produces=["goal timestamp collection E"],
                    known_before=["Full source video", "requested goal event"],
                    known_after=["Predicted goal timestamps in source time"],
                    evidence=["sourceMedia", "retainedFraction", "predictions"],
                    parameters=["video extent: 100%", "semantic function: localizeᴠ"],
                ),
                stage(
                    "unnest", "Unnest", "Emit one tuple per goal",
                    "Expand the collection into one source-time output tuple for each localized goal.",
                    consumes=["goal timestamp collection E"], produces=["one tuple per goal"],
                    known_before=["Collection-valued event field E"], known_after=["Final goal relation"],
                    evidence=["outputRecords"],
                ),
            ],
        },
        "o1": {
            "label": "Transcript-only",
            "expression": "Unnest_E ( Map_localizeᵀ(t,p)→E ( R ) )",
            "videoFraction": 0.0,
            "stages": [
                stage(
                    "input", "Input", "Read the materialized transcript",
                    "Construct one input tuple containing the source-aligned commentary transcript and the goal description.",
                    consumes=["stored match-half record", "event description p"],
                    produces=["R(source_id, t, p)"],
                    known_before=["Match-half identifier", "goal description"],
                    known_after=["Timestamped commentary transcript t"], evidence=["transcript"],
                ),
                stage(
                    "transcript-localize", "Transcript localize", "Run a text-only MLLM",
                    "Substitute commentary-transcript localization for video localization while preserving the timestamp output schema.",
                    consumes=["timestamped transcript t", "event description p"],
                    produces=["goal timestamp collection E"],
                    known_before=["Commentary text and source-time segments"],
                    known_after=["Three transcript-derived goal timestamps"],
                    evidence=["transcript", "predictions"],
                    parameters=["semantic function: localizeᵀ", "video input: none"],
                ),
                stage(
                    "unnest", "Unnest", "Emit transcript-derived timestamps",
                    "Expand the collection into one output tuple per predicted goal.",
                    consumes=["goal timestamp collection E"], produces=["one tuple per goal"],
                    known_before=["Collection-valued event field E"], known_after=["Final goal relation"],
                    evidence=["outputRecords"],
                ),
            ],
        },
        "o2": {
            "label": "Transcript → video",
            "expression": "Candidateᵀ → Window → Resolve → View → Localizeᴠ → Reconcile",
            "videoFraction": trace_fraction,
            "stages": [
                stage(
                    "input", "Input", "Read video and aligned transcript",
                    "Construct one input tuple containing the match-half video, its source-aligned commentary transcript, and the goal description.",
                    consumes=["stored match-half record", "event description p"],
                    produces=["R(source_id, v, t, p)"],
                    known_before=["Match-half identifier", "goal description"],
                    known_after=["Complete video v", "timestamped transcript t"],
                    evidence=["sourceMedia", "transcriptAvailability"],
                ),
                stage(
                    "candidate", "Candidate", "Find high-recall commentary moments",
                    "Use a query-conditioned text MLLM to identify source-time commentary moments that may indicate goals.",
                    consumes=["timestamped transcript t", "event description p"], produces=["candidate moments C"],
                    known_before=["Commentary text and source-time segments"],
                    known_after=["Three transcript-grounded candidate moments"],
                    evidence=["transcript", "candidateRange"], parameters=["objective: high recall", "modality: text"],
                ),
                stage(
                    "window", "Window", "Add temporal context",
                    "Add 30 seconds of source-video context before and after each transcript-derived candidate moment.",
                    consumes=["candidate moments C"], produces=["padded intervals (s, e)"],
                    known_before=["Three unpadded source-time candidates"],
                    known_after=["Three 60-second source-time windows"], evidence=["windowTimeline"],
                    parameters=["padding: 30 s before and after"],
                ),
                stage(
                    "resolve", "Resolve", "Coalesce overlapping windows",
                    "Merge overlapping windows so a source interval is not materialized or processed repeatedly.",
                    consumes=["padded candidate windows"], produces=["disjoint retained windows"],
                    known_before=["Three padded windows"], known_after=["Three disjoint retained windows"],
                    evidence=["resolvedTimeline"], parameters=["equivalence: temporal overlap"],
                ),
                stage(
                    "view", "View", "Materialize the retained intervals",
                    "Materialize each retained source interval as a standalone clip while preserving its source offset.",
                    consumes=["video v", "source boundaries (s, e)"], produces=["materialized clips v_c"],
                    known_before=["Three retained source-time windows"],
                    known_after=["Three 60-second clips with source offsets"],
                    evidence=["materializedClip", "retainedFraction"],
                    parameters=[f"retained video: {trace_fraction:.2%}"],
                ),
                stage(
                    "video-localize", "Video localize", "Run the MLLM on each clip",
                    "Apply the same video goal localizer used by the baseline independently to each materialized clip.",
                    consumes=["materialized clips v_c", "event description p"],
                    produces=["clip-relative goal timestamps E_c"],
                    known_before=["Three candidate clips", "goal description"],
                    known_after=["Three clip-level predicted goals"],
                    evidence=["materializedClip", "retainedFraction", "predictions"],
                    parameters=["semantic function: localizeᴠ", f"video extent: {trace_fraction:.2%}"],
                ),
                stage(
                    "reconcile", "Reconcile", "Return source-time goals",
                    "Translate each clip-relative prediction back to its match-half source time and combine the results.",
                    consumes=["clip-relative goals E_c", "clip source offsets"],
                    produces=["source-time goal collection E"],
                    known_before=["Clip-relative predictions", "three source offsets"],
                    known_after=["Final goal relation in source time"], evidence=["outputRecords"],
                    parameters=["mapping: source time = clip time + associated offset"],
                ),
            ],
        },
    }


def build_artifact(mmds_root: Path) -> dict[str, Any]:
    root = mmds_root / "data/soccernet/experiments" / EXPERIMENT
    input_path = root / "input.jsonl"
    comparison_path = root / "comparison.json"
    ground_truth_path = root / "ground_truth.json"
    candidate_path = root / "runs/transcript_candidates/candidates.jsonl"
    manifest_path = root / "runs/materialized_clips/manifest.json"

    input_row = select_row(load_jsonl(input_path), "input")
    candidate_row = select_row(load_jsonl(candidate_path), "candidate")
    comparison = load_json(comparison_path)
    ground_truth = load_json(ground_truth_path)
    manifest = load_json(manifest_path)
    duration = input_row["duration_seconds"]
    windows = candidate_row["candidate_windows"]
    trace_fraction = sum(window["duration_seconds"] for window in windows) / duration

    indexed_segments = [
        {"segmentId": index, "startSeconds": row["start"], "endSeconds": row["end"], "text": row["text"]}
        for index, row in enumerate(input_row["transcript_segments"])
    ]
    transcript_segments = [
        segment for segment in indexed_segments
        if any(segment["endSeconds"] >= window["start_seconds"] and segment["startSeconds"] <= window["end_seconds"] for window in windows)
    ]

    candidate_windows = []
    for window in windows:
        moment = window["candidate_times_seconds"][0]
        matching = [segment for segment in indexed_segments if segment["startSeconds"] <= moment < segment["endSeconds"]]
        if not matching:
            raise ValueError(f"No transcript segment contains candidate moment {moment}")
        segment = matching[0]
        candidate_windows.append({
            "windowId": f"soccer-window-{window['window_id']}",
            "startSeconds": window["start_seconds"], "endSeconds": window["end_seconds"],
            "durationSeconds": window["duration_seconds"],
            "unpaddedStartSeconds": segment["startSeconds"], "unpaddedEndSeconds": segment["endSeconds"],
            "startSegmentId": segment["segmentId"], "endSegmentId": segment["segmentId"],
            "confidence": 1.0, "evidence": window["evidence"][0],
        })

    clip_rows = [row for row in manifest["clips"] if row["game_id"] == GAME_ID and row["half"] == HALF]
    materialized_clips = [{
        "clipId": f"soccer-clip-{row['window_id']}",
        "windowId": f"soccer-window-{row['window_id']}",
        "kind": "unavailable",
        "sourceStartSeconds": row["source_start_seconds"],
        "sourceEndSeconds": row["source_end_seconds"],
        "expectedDurationSeconds": row["media"]["duration_seconds"],
        "sha256": row["sha256"], "sizeBytes": row["size_bytes"],
        "reason": "SoccerNet broadcast media is not redistributed in this public demo.",
    } for row in clip_rows]

    truth_game = next(game for game in ground_truth["games"] if game["game_id"] == GAME_ID)
    plans = plan_content(trace_fraction)
    plan_sources = {
        "baseline": ("naive", root / "runs/naive/predictions.json", False),
        "o1": ("transcript_only", root / "runs/transcript_only/predictions.json", False),
        "o2": ("transcript_video", root / "runs/transcript_video/predictions.json", True),
    }
    results = []
    for plan_id, (method_id, prediction_path, clips) in plan_sources.items():
        method = comparison["methods"][method_id]
        plans[plan_id]["predictions"] = select_predictions(load_json(prediction_path), clips=clips)
        accuracy = method["primary_accuracy"]
        results.append({
            "planId": plan_id, "label": plans[plan_id]["label"],
            "videoFraction": {"baseline": 1.0, "o1": 0.0, "o2": comparison["methods"]["transcript_video"]["candidate_metrics"]["selectivity"]}[plan_id],
            "precision": accuracy["precision"], "recall": accuracy["recall"], "f1": accuracy["f1"],
            "tokenCount": method["api_usage"]["total_token_count"],
            "costUsd": method["api_usage"]["estimated_cost_usd"],
            "timeSeconds": method["latency"]["end_to_end_seconds"],
        })

    candidate_metrics = comparison["methods"]["transcript_video"]["candidate_metrics"]
    naive_cost = comparison["methods"]["naive"]["api_usage"]["estimated_cost_usd"]
    o2_cost = comparison["methods"]["transcript_video"]["api_usage"]["estimated_cost_usd"]
    return {
        "schemaVersion": 3,
        "example": {
            "id": "soccer", "selectorLabel": "Soccer", "title": "Soccer goal localization",
            "sourceArtifactTitle": "Complete match-half video",
            "sourceTypeLabel": "match half", "traceScope": "the Everton–Chelsea first-half trace above",
            "resultsTitle": "Less video, precise goal timestamps",
            "resultsCaption": "Soccer goal-localization results at the primary ±30-second tolerance.",
            "primaryMetricLabel": "at ±30 s tolerance", "candidateCoverageLabel": "10 of 10 goals covered",
        },
        "trace": {
            "experiment": EXPERIMENT, "eventKind": "point",
            "query": {"id": "goal_scored", "text": QUERY_TEXT},
            "source": {
                "id": f"{GAME_ID}::half_{HALF}", "title": "Everton 3–1 Chelsea · first half",
                "durationSeconds": duration, "sha256": input_row["video"]["sha256"],
                "media": {"kind": "unavailable", "reason": "SoccerNet broadcast media is not redistributed in this public demo."},
            },
            "candidateWindows": candidate_windows, "materializedClips": materialized_clips,
            "referenceEvents": [{"eventKind": "point", "timeSeconds": event["time_seconds"]} for event in truth_game["halves"][str(HALF)]],
            "transcriptSegments": transcript_segments, "plans": plans,
        },
        "publicationEvaluation": {
            "scopeLabel": "Three SoccerNet games (six match halves)",
            "workload": {"gameCount": 3, "sourceVideoCount": 6, "referenceEventCount": candidate_metrics["goal_count"], "primaryToleranceSeconds": 30.0},
            "results": results,
            "candidateMetrics": {"recall": candidate_metrics["candidate_recall"], "selectivity": candidate_metrics["selectivity"]},
            "summary": {"costReductionFraction": 1.0 - (o2_cost / naive_cost)},
            "provenance": {
                "comparisonSha256": sha256(comparison_path), "groundTruthSha256": sha256(ground_truth_path),
                "candidateSha256": sha256(candidate_path), "clipManifestSha256": sha256(manifest_path),
                "inputSha256": sha256(input_path),
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mmds-root", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/soccer-event-localization-v3.json"))
    parser.add_argument("--check", action="store_true", help="Fail unless the committed artifact is current")
    args = parser.parse_args()
    write_artifact(build_artifact(args.mmds_root.resolve()), args.output, check=args.check)


if __name__ == "__main__":
    main()
