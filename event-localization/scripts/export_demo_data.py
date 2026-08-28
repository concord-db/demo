#!/usr/bin/env python3
"""Export the frozen Concord lecture evaluation into a public demo artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


EXPERIMENT = "cross_modal_lecture_verified_3pair_v1"
LECTURE_ID = "mit_8_03sc_lecture_20"
QUERY_ID = "successful_large_soap_bubble"


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


def select_pair(rows: list[dict[str, Any]]) -> dict[str, Any]:
    matches = [
        row for row in rows
        if row.get("lecture_id") == LECTURE_ID and row.get("query_id") == QUERY_ID
    ]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {LECTURE_ID}/{QUERY_ID} row, found {len(matches)}")
    return matches[0]


def select_predictions(document: dict[str, Any]) -> list[dict[str, Any]]:
    predictions = document.get("predictions")
    if not isinstance(predictions, list):
        raise ValueError("Prediction document is missing a predictions array")
    selected = [
        prediction for prediction in predictions
        if prediction.get("lecture_id") == LECTURE_ID
        and prediction.get("query_id") == QUERY_ID
    ]
    return [
        {
            "startSeconds": prediction["start_seconds"],
            "endSeconds": prediction["end_seconds"],
            "confidence": prediction["confidence"],
            "evidence": prediction["evidence"],
            "startSegmentId": prediction.get("start_segment_id"),
            "endSegmentId": prediction.get("end_segment_id"),
        }
        for prediction in selected
    ]


def build_plan_content() -> dict[str, dict[str, Any]]:
    return {
        "baseline": {
            "label": "Video-only",
            "expression": "Unnest_E ( Map_localizeᴠ(v,p)→E ( R ) )",
            "stages": [
                {"title": "Input", "summary": "Complete lecture", "description": "Read one source-aligned lecture record containing the complete 82-minute video."},
                {"title": "Video localize", "summary": "Full-video MLLM", "description": "Apply the video event localizer to the complete lecture under the requested event description."},
                {"title": "Unnest", "summary": "Event intervals", "description": "Emit one source-time tuple for every event interval returned by the video localizer."},
            ],
        },
        "o1": {
            "label": "Transcript-only",
            "expression": "Unnest_E ( Map_localizeᵀ(t,p)→E ( R ) )",
            "stages": [
                {"title": "Input", "summary": "Materialized transcript", "description": "Read the source-aligned transcript as an already materialized representation of the lecture."},
                {"title": "Transcript localize", "summary": "Text-only MLLM", "description": "Substitute transcript localization for video localization while preserving the event output schema."},
                {"title": "Unnest", "summary": "One broad interval", "description": "Emit the transcript-derived source-time interval. Here, one 57-second semantic neighborhood contains both visible reference events."},
            ],
        },
        "o2": {
            "label": "Transcript → video",
            "expression": "Candidateᵀ → Window → Resolve → View → Localizeᴠ → Reconcile",
            "stages": [
                {"title": "Input", "summary": "Video + transcript", "description": "Read the lecture video together with its source-aligned, timestamped transcript."},
                {"title": "Candidate", "summary": "High-recall transcript search", "description": "Use a query-conditioned text MLLM to identify transcript-grounded source-time ranges that may contain the requested visible event."},
                {"title": "Window", "summary": "Add temporal context", "description": "Pad the transcript-grounded range with temporal context, producing source boundaries from 6:25.88 to 8:35.68."},
                {"title": "Resolve", "summary": "Coalesce overlaps", "description": "Merge overlapping candidate windows so the same source interval is not materialized or processed repeatedly."},
                {"title": "View", "summary": "Materialize 129.8 s", "description": "Materialize the retained source interval as a standalone video clip while preserving its source identifier and offset."},
                {"title": "Video localize", "summary": "Clip-level MLLM", "description": "Apply the video event localizer to the retained clip, distinguishing separate visible occurrences within the broad transcript neighborhood."},
                {"title": "Reconcile", "summary": "Return source-time events", "description": "Translate clip-relative predictions back to source time and return the event collection expected by the original query."},
            ],
        },
    }


def build_artifact(mmds_root: Path, media_path: Path) -> dict[str, Any]:
    experiment_root = mmds_root / "data/lecture_verified_eval/experiments" / EXPERIMENT
    transcript_path = mmds_root / "data/lecture_verified_eval/transcripts/mit_8_03sc_lecture_20.whisper.json"
    comparison_path = experiment_root / "comparison.json"
    ground_truth_path = experiment_root / "ground_truth.json"
    candidate_path = experiment_root / "runs/transcript_candidates/candidates.jsonl"
    clip_manifest_path = experiment_root / "runs/materialized_clips/manifest.json"

    comparison = load_json(comparison_path)
    ground_truth = load_json(ground_truth_path)
    candidate = select_pair(load_jsonl(candidate_path))
    clip_manifest = load_json(clip_manifest_path)
    transcript = load_json(transcript_path)

    pair = select_pair(ground_truth["pairs"])
    candidate_window = candidate["candidate_windows"][0]
    segment_range = candidate_window["segment_ranges"][0]
    transcript_segments = [
        {
            "segmentId": segment["segment_id"],
            "startSeconds": segment["start_seconds"],
            "endSeconds": segment["end_seconds"],
            "text": segment["text"],
        }
        for segment in transcript["segments"]
        if 112 <= segment["segment_id"] <= 138
    ]

    methods = comparison["methods"]
    plan_sources = {
        "baseline": ("naive", experiment_root / "runs/naive/predictions.json", 1.0),
        "o1": ("transcript_only", experiment_root / "runs/transcript_only/predictions.json", 0.0),
        "o2": ("transcript_video", experiment_root / "runs/transcript_video/predictions.json", methods["transcript_video"]["candidate_metrics"]["candidate_selectivity"]),
    }
    plans = build_plan_content()
    results: list[dict[str, Any]] = []

    for plan_id, (method_id, prediction_path, video_fraction) in plan_sources.items():
        method = methods[method_id]
        accuracy = method["primary_accuracy"]
        plans[plan_id]["videoFraction"] = video_fraction
        plans[plan_id]["predictions"] = select_predictions(load_json(prediction_path))
        results.append({
            "planId": plan_id,
            "label": plans[plan_id]["label"],
            "videoFraction": video_fraction,
            "precision": accuracy["precision"],
            "recall": accuracy["recall"],
            "f1": accuracy["f1"],
            "tokenCount": method["api_usage"]["total_token_count"],
            "costUsd": method["api_usage"]["estimated_cost_usd"],
            "timeSeconds": method["latency"]["end_to_end_seconds"],
        })

    o2_metrics = methods["transcript_video"]["candidate_metrics"]
    naive_cost = methods["naive"]["api_usage"]["estimated_cost_usd"]
    o2_cost = methods["transcript_video"]["api_usage"]["estimated_cost_usd"]
    clip_row = select_pair(clip_manifest["clips"])

    return {
        "schemaVersion": 1,
        "experiment": EXPERIMENT,
        "query": {"id": QUERY_ID, "text": candidate["query_text"]},
        "source": {
            "id": LECTURE_ID,
            "title": "MIT 8.03SC Lecture 20",
            "durationSeconds": pair["duration_seconds"],
            "sha256": candidate["video"]["sha256"],
        },
        "candidate": {
            "startSeconds": candidate_window["start_seconds"],
            "endSeconds": candidate_window["end_seconds"],
            "durationSeconds": candidate_window["duration_seconds"],
            "unpaddedStartSeconds": candidate_window["unpadded_start_seconds"],
            "unpaddedEndSeconds": candidate_window["unpadded_end_seconds"],
            "startSegmentId": segment_range["start_segment_id"],
            "endSegmentId": segment_range["end_segment_id"],
            "confidence": segment_range["confidence"],
            "evidence": segment_range["evidence"],
        },
        "media": {
            "url": "./media/soap-bubble-candidate-v1.mp4",
            "sourceStartSeconds": clip_row["source_start_seconds"],
            "sourceEndSeconds": clip_row["source_end_seconds"],
            "expectedDurationSeconds": clip_row["media"]["duration_seconds"],
            "sha256": sha256(media_path),
        },
        "referenceEvents": [
            {"startSeconds": event["start_seconds"], "endSeconds": event["end_seconds"]}
            for event in pair["events"]
        ],
        "transcriptSegments": transcript_segments,
        "plans": plans,
        "results": results,
        "summary": {
            "candidateRecall": o2_metrics["candidate_recall_at_any_coverage"],
            "candidateSelectivity": o2_metrics["candidate_selectivity"],
            "costReductionFraction": 1.0 - (o2_cost / naive_cost),
            "referenceEventCount": o2_metrics["ground_truth_event_count"],
        },
        "provenance": {
            "comparisonSha256": sha256(comparison_path),
            "groundTruthSha256": sha256(ground_truth_path),
            "candidateSha256": sha256(candidate_path),
            "clipManifestSha256": sha256(clip_manifest_path),
            "transcriptSha256": sha256(transcript_path),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mmds-root", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/event-localization-v1.json"))
    parser.add_argument("--media", type=Path, default=Path("media/soap-bubble-candidate-v1.mp4"))
    args = parser.parse_args()

    artifact = build_artifact(args.mmds_root.resolve(), args.media.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump(artifact, stream, indent=2, sort_keys=True)
        stream.write("\n")


if __name__ == "__main__":
    main()
