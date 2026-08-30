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


def build_plan_content(trace_video_fraction: float) -> dict[str, dict[str, Any]]:
    return {
        "baseline": {
            "label": "Video-only",
            "expression": "Unnest_E ( Map_localizeᴠ(v,p)→E ( R ) )",
            "stages": [
                stage(
                    "input", "Input", "Read the complete lecture",
                    "Construct one input tuple containing the complete lecture video and the event description.",
                    consumes=["stored lecture record", "event description p"],
                    produces=["R(source_id, v, p)"],
                    known_before=["Lecture identifier", "event description"],
                    known_after=["Complete 82-minute source video v"],
                    evidence=["sourceMedia"],
                ),
                stage(
                    "video-localize", "Video localize", "Run the MLLM over the full video",
                    "Apply the video event localizer to the complete lecture under the requested event description.",
                    consumes=["complete video v", "event description p"],
                    produces=["event collection E"],
                    known_before=["Full source video", "requested audiovisual event"],
                    known_after=["Predicted event intervals in source time"],
                    evidence=["sourceMedia", "retainedFraction", "predictions"],
                    parameters=["video extent: 100%", "semantic function: localizeᴠ"],
                ),
                stage(
                    "unnest", "Unnest", "Emit one tuple per event",
                    "Expand the event collection into one source-time output tuple for each localized occurrence.",
                    consumes=["event collection E"],
                    produces=["one tuple per event"],
                    known_before=["Collection-valued event field E"],
                    known_after=["Final event relation"],
                    evidence=["outputRecords"],
                ),
            ],
        },
        "o1": {
            "label": "Transcript-only",
            "expression": "Unnest_E ( Map_localizeᵀ(t,p)→E ( R ) )",
            "stages": [
                stage(
                    "input", "Input", "Read the materialized transcript",
                    "Construct one input tuple containing the source-aligned transcript and the event description.",
                    consumes=["stored lecture record", "event description p"],
                    produces=["R(source_id, t, p)"],
                    known_before=["Lecture identifier", "event description"],
                    known_after=["Timestamped transcript t"],
                    evidence=["transcript"],
                ),
                stage(
                    "transcript-localize", "Transcript localize", "Run a text-only MLLM",
                    "Substitute transcript localization for video localization while preserving the event output schema.",
                    consumes=["timestamped transcript t", "event description p"],
                    produces=["event collection E"],
                    known_before=["Transcript text and source-time segments"],
                    known_after=["One broad transcript-derived event interval"],
                    evidence=["transcript", "predictions"],
                    parameters=["semantic function: localizeᵀ", "video input: none"],
                ),
                stage(
                    "unnest", "Unnest", "Emit the transcript-derived interval",
                    "Expand the event collection into output tuples. Here, one 57-second semantic neighborhood contains both visible reference events.",
                    consumes=["event collection E"],
                    produces=["one tuple per event"],
                    known_before=["Collection-valued event field E"],
                    known_after=["Final event relation"],
                    evidence=["outputRecords"],
                ),
            ],
        },
        "o2": {
            "label": "Transcript → video",
            "expression": "Candidateᵀ → Window → Resolve → View → Localizeᴠ → Reconcile",
            "stages": [
                stage(
                    "input", "Input", "Read video and aligned transcript",
                    "Construct one input tuple containing the lecture video, its source-aligned transcript, and the event description.",
                    consumes=["stored lecture record", "event description p"],
                    produces=["R(source_id, v, t, p)"],
                    known_before=["Lecture identifier", "event description"],
                    known_after=["Complete video v", "timestamped transcript t"],
                    evidence=["sourceMedia", "transcriptAvailability"],
                ),
                stage(
                    "candidate", "Candidate", "Find a high-recall transcript range",
                    "Use a query-conditioned text MLLM to identify transcript-grounded source-time ranges that may contain the requested visible event.",
                    consumes=["timestamped transcript t", "event description p"],
                    produces=["candidate range c"],
                    known_before=["Transcript text and source-time segments"],
                    known_after=["Unpadded candidate: 6:55.88–8:05.68"],
                    evidence=["transcript", "candidateRange"],
                    parameters=["objective: high recall", "modality: text"],
                ),
                stage(
                    "window", "Window", "Add temporal context",
                    "Expand the transcript-derived candidate with temporal context to cover possible speech–video misalignment.",
                    consumes=["candidate range c"],
                    produces=["padded interval (s, e)"],
                    known_before=["Unpadded source-time candidate"],
                    known_after=["Padded window: 6:25.88–8:35.68"],
                    evidence=["windowTimeline"],
                    parameters=["padding: 30 s before and after"],
                ),
                stage(
                    "resolve", "Resolve", "Coalesce overlapping windows",
                    "Merge overlapping windows so the same source interval is not materialized or processed repeatedly.",
                    consumes=["padded candidate windows"],
                    produces=["disjoint retained windows"],
                    known_before=["One padded window in this trace"],
                    known_after=["One disjoint 129.8-second window"],
                    evidence=["resolvedTimeline"],
                    parameters=["equivalence: temporal overlap"],
                ),
                stage(
                    "view", "View", "Materialize the retained interval",
                    "Materialize the retained source interval as a standalone clip while preserving its source identifier and offset.",
                    consumes=["video v", "source boundaries (s, e)"],
                    produces=["materialized clip v_c"],
                    known_before=["One retained source-time window"],
                    known_after=["129.8-second clip with source offset 6:25.88"],
                    evidence=["materializedClip", "retainedFraction"],
                    parameters=[f"retained video: {trace_video_fraction:.2%}"],
                ),
                stage(
                    "video-localize", "Video localize", "Run the MLLM on the clip",
                    "Apply the video event localizer to the retained clip, distinguishing separate visible occurrences within the broad transcript neighborhood.",
                    consumes=["materialized clip v_c", "event description p"],
                    produces=["clip-relative event collection E_c"],
                    known_before=["Candidate clip and event description"],
                    known_after=["Three clip-level predicted occurrences"],
                    evidence=["materializedClip", "retainedFraction", "predictions"],
                    parameters=["semantic function: localizeᴠ", f"video extent: {trace_video_fraction:.2%}"],
                ),
                stage(
                    "reconcile", "Reconcile", "Return source-time events",
                    "Translate clip-relative predictions back to source time and return the event collection expected by the original query.",
                    consumes=["clip-relative events E_c", "clip source offset"],
                    produces=["source-time event collection E"],
                    known_before=["Clip-relative predictions", "source offset 6:25.88"],
                    known_after=["Final event relation in source time"],
                    evidence=["outputRecords"],
                    parameters=["mapping: source time = clip time + offset"],
                ),
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
    trace_video_fraction = candidate_window["duration_seconds"] / pair["duration_seconds"]
    plan_sources = {
        "baseline": ("naive", experiment_root / "runs/naive/predictions.json"),
        "o1": ("transcript_only", experiment_root / "runs/transcript_only/predictions.json"),
        "o2": ("transcript_video", experiment_root / "runs/transcript_video/predictions.json"),
    }
    trace_video_fractions = {"baseline": 1.0, "o1": 0.0, "o2": trace_video_fraction}
    publication_video_fractions = {
        "baseline": 1.0,
        "o1": 0.0,
        "o2": methods["transcript_video"]["candidate_metrics"]["candidate_selectivity"],
    }
    plans = build_plan_content(trace_video_fraction)
    results: list[dict[str, Any]] = []

    for plan_id, (method_id, prediction_path) in plan_sources.items():
        method = methods[method_id]
        accuracy = method["primary_accuracy"]
        plans[plan_id]["videoFraction"] = trace_video_fractions[plan_id]
        plans[plan_id]["predictions"] = select_predictions(load_json(prediction_path))
        results.append({
            "planId": plan_id,
            "label": plans[plan_id]["label"],
            "videoFraction": publication_video_fractions[plan_id],
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

    trace = {
        "experiment": EXPERIMENT,
        "query": {"id": QUERY_ID, "text": candidate["query_text"]},
        "source": {
            "id": LECTURE_ID,
            "title": "MIT 8.03SC Lecture 20: Interference, Soap Bubble",
            "durationSeconds": pair["duration_seconds"],
            "sha256": candidate["video"]["sha256"],
            "media": {
                "kind": "youtube",
                "youtubeId": "VkbtIDSHfSc",
                "pageUrl": "https://ocw.mit.edu/courses/8-03sc-physics-iii-vibrations-and-waves-fall-2016/resources/copy2_of_lecture-20-video/",
                "thumbnailUrl": "https://i.ytimg.com/vi/VkbtIDSHfSc/hqdefault.jpg",
            },
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
        "materializedMedia": {
            "kind": "file",
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
    }
    publication_evaluation = {
        "scopeLabel": "Three lectures and three event-localization queries",
        "workload": {
            "lectureCount": 3,
            "referenceEventCount": o2_metrics["ground_truth_event_count"],
            "primaryTiouThreshold": 0.3,
        },
        "results": results,
        "candidateMetrics": {
            "recall": o2_metrics["candidate_recall_at_any_coverage"],
            "selectivity": o2_metrics["candidate_selectivity"],
        },
        "summary": {
            "costReductionFraction": 1.0 - (o2_cost / naive_cost),
        },
        "provenance": {
            "comparisonSha256": sha256(comparison_path),
            "groundTruthSha256": sha256(ground_truth_path),
            "candidateSha256": sha256(candidate_path),
            "clipManifestSha256": sha256(clip_manifest_path),
            "transcriptSha256": sha256(transcript_path),
        },
    }
    return {
        "schemaVersion": 2,
        "trace": trace,
        "publicationEvaluation": publication_evaluation,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mmds-root", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=Path("data/event-localization-v2.json"))
    parser.add_argument("--media", type=Path, default=Path("media/soap-bubble-candidate-v1.mp4"))
    args = parser.parse_args()

    artifact = build_artifact(args.mmds_root.resolve(), args.media.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as stream:
        json.dump(artifact, stream, indent=2, sort_keys=True)
        stream.write("\n")


if __name__ == "__main__":
    main()
