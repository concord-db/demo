#!/usr/bin/env python3
"""Record the MMDS cross-camera operators as browser-safe static assets.

This maintainer-only command executes inference offline. The generated website
only reads the resulting MP4/JSON files and never imports MMDS or contacts Gemini.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def dump(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def seconds(value: str) -> float:
    timestamp = value.replace("Z", "+00:00")
    return datetime.fromisoformat(timestamp).timestamp()


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def trajectory(value: dict[str, Any]) -> dict[str, Any]:
    nested = value.get("vehicles")
    item = nested if isinstance(nested, dict) else value
    return {
        "vehicleId": item.get("vehicle_id", "unknown"),
        "attributes": item.get("attributes", {}),
        "timeline": [
            {
                "cameraId": segment["camera_id"],
                "entered": float(segment["entered"]),
                "exited": float(segment["exited"]),
            }
            for segment in item.get("timeline", [])
        ],
        **(
            {"matchScore": float(item["match_score"])}
            if isinstance(item.get("match_score"), (int, float))
            else {}
        ),
    }


def transcode(source: Path, target: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error", "-ss", "0", "-t", "5",
            "-i", str(source), "-an", "-vf", "scale=960:-2",
            "-c:v", "libx264", "-crf", "25", "-preset", "medium",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target),
        ],
        check=True,
    )


def evaluate(rows: list[dict[str, Any]], references: list[dict[str, Any]], root: Path) -> dict[str, Any]:
    from mmds.join.eval_trajectories import evaluate_trajectories

    raw_rows = []
    for row in rows:
        raw_rows.append(
            {
                "vehicle_id": row["vehicleId"],
                "attributes": row["attributes"],
                "timeline": [
                    {
                        "camera_id": item["cameraId"],
                        "entered": item["entered"],
                        "exited": item["exited"],
                    }
                    for item in row["timeline"]
                ],
            }
        )
    report = evaluate_trajectories(raw_rows, references, min_score=0.70)
    return report.to_dict()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mmds", type=Path, default=Path.home() / "mmds")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "public/examples/cross-camera",
    )
    parser.add_argument("--skip-semantic", action="store_true")
    args = parser.parse_args()
    root = args.mmds.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(root), str(root / "src")]
    os.chdir(root)

    from mmds import GeminiPromptExecutor, execute
    from udfs.detection_ops import build_vehicle_frame_detections
    from udfs.join_ops import same_vehicle
    from udfs.reid_ops import appearance_match_score, attach_track_embedding
    from udfs.tracking_ops import (
        _assign_track_ids,
        project_track_summary_row,
        promote_track_summary_row,
        strongsort_track_frame_detections,
    )
    from udfs.trajectory_ops import join_match_to_trajectory

    source_rows = json.loads(
        (root / "data/i24v_traffic_highway2_highway3_5s_nmsed.json").read_text()
    )
    references = json.loads(
        (root / "data/i24v_traffic_highway2_highway3_5s_ground_truth.json").read_text()
    )

    transcode(root / "data/i24v_traffic/videos/highway2.mp4", output / "highway2.mp4")
    transcode(root / "data/i24v_traffic/videos/highway3.mp4", output / "highway3.mp4")

    detection_rows: list[dict[str, Any]] = []
    track_rows: list[dict[str, Any]] = []
    optimized_started = time.perf_counter()
    for source_row in source_rows:
        framed = {**source_row, **build_vehicle_frame_detections(source_row)}
        tagged = _assign_track_ids(framed["frame_detections"], track_prefix="veh")
        tracked = {**framed, **strongsort_track_frame_detections(framed)}
        allowed = {item["track_id"] for item in tracked["track_summaries"]}
        boxes_by_track: dict[str, list[dict[str, Any]]] = {}
        for item in tagged:
            if item["track_id"] in allowed:
                boxes_by_track.setdefault(item["track_id"], []).append(
                    {"frame": item["frame_id"], "bbox": item["bbox"]}
                )
        for item in framed["frame_detections"]:
            detection_rows.append(
                {
                    "frame": item["frame_id"],
                    "cameraId": item["camera_id"],
                    "bbox": item["bbox"],
                    "confidence": item["confidence"],
                    "vehicleClass": item["vehicle_class"],
                    "color": item["color"],
                    "subtype": item["subtype"],
                }
            )
        for summary in tracked["track_summaries"]:
            promoted = promote_track_summary_row({**tracked, "track_summaries": summary})
            embedded = attach_track_embedding(promoted)
            projected = project_track_summary_row(embedded)
            projected["_boxes"] = boxes_by_track.get(summary["track_id"], [])
            projected["_path"] = summary["centroid_path"]
            track_rows.append(projected)

    candidates: list[dict[str, Any]] = []
    raw_candidates: list[dict[str, Any]] = []
    for left in track_rows:
        for right in track_rows:
            if same_vehicle(left, right):
                score = float(appearance_match_score(left, right))
                if score >= 0.4:
                    raw_candidates.append({"left": left, "right": right, "match_score": score})
    raw_candidates.sort(key=lambda item: item["match_score"], reverse=True)
    used_left: set[tuple[str, str]] = set()
    used_right: set[tuple[str, str]] = set()
    resolved: list[dict[str, Any]] = []
    for item in raw_candidates:
        left_key = (item["left"]["camera_id"], item["left"]["track_id"])
        right_key = (item["right"]["camera_id"], item["right"]["track_id"])
        accepted = left_key not in used_left and right_key not in used_right
        candidates.append(
            {
                "leftTrackId": item["left"]["track_id"],
                "rightTrackId": item["right"]["track_id"],
                "score": item["match_score"],
                "accepted": accepted,
            }
        )
        if accepted:
            used_left.add(left_key)
            used_right.add(right_key)
            resolved.append(item)

    optimized = []
    for item in resolved:
        row = trajectory(join_match_to_trajectory(item))
        row["leftTrackId"] = item["left"]["track_id"]
        row["rightTrackId"] = item["right"]["track_id"]
        optimized.append(row)
    optimized_elapsed = time.perf_counter() - optimized_started

    tracks = [
        {
            "trackId": item["track_id"],
            "cameraId": item["camera_id"],
            "start": seconds(item["start_time"]),
            "end": seconds(item["end_time"]),
            "vehicleClass": item["vehicle_class"],
            "color": item["color"],
            "subtype": item["subtype"],
            "confidence": item["confidence"],
            "path": [
                {"frame": point["frame_id"], "x": point["x"], "y": point["y"]}
                for point in item["_path"]
            ],
            "boxes": item["_boxes"],
        }
        for item in track_rows
    ]

    semantic: list[dict[str, Any]] = []
    semantic_usage: dict[str, Any] = {}
    semantic_elapsed = 0.0
    model_name = "not-run"
    if not args.skip_semantic:
        module = load_module(root / "examples/semantic_join_cross_camera_vehicle.py")
        executor = GeminiPromptExecutor()
        model_name = executor.model
        started = time.perf_counter()
        semantic = [trajectory(row) for row in execute(module.output, prompt_executor=executor)]
        semantic_elapsed = time.perf_counter() - started
        semantic_usage = executor.usage_snapshot()

    ground_truth = [trajectory(item) for item in references]
    semantic_report = evaluate(semantic, references, root) if semantic else {}
    optimized_report = evaluate(optimized, references, root)
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()

    dump(output / "detections.json", detection_rows)
    dump(output / "tracks.json", tracks)
    dump(output / "candidates.json", candidates)
    dump(output / "semantic-trajectories.json", semantic)
    dump(output / "optimized-trajectories.json", optimized)
    dump(output / "ground-truth.json", ground_truth)

    manifest = {
        "schemaVersion": 1,
        "title": "Cross-camera vehicle association",
        "duration": 5,
        "source": {
            "repository": "https://github.com/chanwutk/mmds",
            "branch": "case_study_1_optimizations",
            "commit": commit,
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "dataset": "I-24 MOTION / I24V (Gloudemans et al., WACV 2024)",
        },
        "cameras": [
            {"id": "cam-i24v-highway2", "label": "Camera 02", "video": "examples/cross-camera/highway2.mp4", "width": 1920, "height": 1080, "fps": 29.97003},
            {"id": "cam-i24v-highway3", "label": "Camera 03", "video": "examples/cross-camera/highway3.mp4", "width": 1920, "height": 1080, "fps": 29.97003},
        ],
        "files": {
            "detections": "detections.json",
            "tracks": "tracks.json",
            "candidates": "candidates.json",
            "semanticTrajectories": "semantic-trajectories.json",
            "optimizedTrajectories": "optimized-trajectories.json",
            "groundTruth": "ground-truth.json",
        },
        "recordedRun": {
            "model": model_name,
            "semantic": {
                "predictions": len(semantic),
                "wallTimeSeconds": semantic_elapsed,
                "mllmCalls": semantic_usage.get("prompt_calls", 0),
                "mllmTokens": semantic_usage.get("total_tokens", 0),
                **({"f1": semantic_report.get("f1", 0)} if semantic_report else {}),
            },
            "optimized": {
                "predictions": len(optimized),
                "wallTimeSeconds": optimized_elapsed,
                "mllmCalls": 0,
                "mllmTokens": 0,
                "f1": optimized_report.get("f1", 0),
            },
        },
        "publishedMetrics": {
            "semantic": {"predictions": 4, "truePositives": 4, "falsePositives": 0, "falseNegatives": 14, "precision": 1.0, "recall": 0.222, "f1": 0.364, "timelineIoU": 0.576, "attributeExact": 0.583, "wallTimeSeconds": 52.724, "mllmCalls": 1, "mllmTokens": 1515},
            "optimized": {"predictions": 14, "truePositives": 13, "falsePositives": 1, "falseNegatives": 5, "precision": 0.929, "recall": 0.722, "f1": 0.813, "timelineIoU": 0.762, "attributeExact": 0.538, "wallTimeSeconds": 99.559, "mllmCalls": 0, "mllmTokens": 0},
        },
    }
    dump(output / "manifest.json", manifest)
    print(
        f"Exported {len(detection_rows)} detections, {len(tracks)} tracks, "
        f"{len(optimized)} optimized and {len(semantic)} semantic trajectories."
    )


if __name__ == "__main__":
    main()
