"use strict";

const PLAN_IDS = ["baseline", "o1", "o2"];
const EVIDENCE_TYPES = new Set([
  "sourceMedia", "transcriptAvailability", "transcript", "candidateRange",
  "windowTimeline", "resolvedTimeline", "materializedClip", "retainedFraction",
  "predictions", "outputRecords",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requireFraction(value, label) {
  requireFinite(value, label);
  if (value < 0 || value > 1) throw new Error(`${label} must be between zero and one`);
}

function validateInterval(interval, duration, label) {
  requireObject(interval, label);
  requireFinite(interval.startSeconds, `${label} start`);
  requireFinite(interval.endSeconds, `${label} end`);
  if (interval.startSeconds < 0 || interval.endSeconds <= interval.startSeconds || interval.endSeconds > duration) {
    throw new Error(`${label} lies outside the source timeline`);
  }
}

function validateEvent(event, duration, expectedKind, label) {
  requireObject(event, label);
  if (event.eventKind !== expectedKind) throw new Error(`${label} must be a ${expectedKind} event`);
  if (expectedKind === "point") {
    requireFinite(event.timeSeconds, `${label} time`);
    if (event.timeSeconds < 0 || event.timeSeconds > duration) throw new Error(`${label} lies outside the source timeline`);
  } else {
    validateInterval(event, duration, label);
  }
}

function eventBounds(event) {
  return event.eventKind === "point" ? [event.timeSeconds, event.timeSeconds] : [event.startSeconds, event.endSeconds];
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function validateMedia(source) {
  requireObject(source.media, "source media");
  if (source.media.kind === "youtube") {
    requireString(source.media.youtubeId, "source YouTube id");
    requireString(source.media.pageUrl, "source page URL");
    requireString(source.media.thumbnailUrl, "source thumbnail URL");
  } else if (source.media.kind === "unavailable") {
    requireString(source.media.reason, "source media unavailability reason");
  } else {
    throw new Error("Source media kind must be youtube or unavailable");
  }
}

export function validateArtifact(data) {
  requireObject(data, "artifact");
  if (data.schemaVersion !== 3) throw new Error("Unsupported artifact schema");

  requireObject(data.example, "example");
  for (const field of [
    "id", "selectorLabel", "title", "sourceArtifactTitle", "sourceTypeLabel",
    "traceScope", "resultsTitle", "resultsCaption", "primaryMetricLabel", "candidateCoverageLabel",
  ]) requireString(data.example[field], `example ${field}`);

  const { trace, publicationEvaluation } = data;
  requireObject(trace, "trace");
  requireObject(trace.query, "trace query");
  requireString(trace.query.text, "trace query text");
  requireObject(publicationEvaluation, "publicationEvaluation");
  if (!["point", "interval"].includes(trace.eventKind)) throw new Error("trace eventKind must be point or interval");
  requireObject(trace.source, "trace source");
  requireString(trace.source.id, "source id");
  requireString(trace.source.title, "source title");
  requireFinite(trace.source.durationSeconds, "source duration");
  if (trace.source.durationSeconds <= 0) throw new Error("Source duration must be positive");
  validateMedia(trace.source);

  if (!Array.isArray(trace.candidateWindows) || trace.candidateWindows.length === 0) {
    throw new Error("trace candidateWindows must be a non-empty array");
  }
  const windowIds = new Set();
  trace.candidateWindows.forEach((window, index) => {
    validateInterval(window, trace.source.durationSeconds, `candidate window ${index}`);
    requireString(window.windowId, `candidate window ${index} id`);
    if (windowIds.has(window.windowId)) throw new Error(`Duplicate candidate window id ${window.windowId}`);
    windowIds.add(window.windowId);
    validateInterval({ startSeconds: window.unpaddedStartSeconds, endSeconds: window.unpaddedEndSeconds }, trace.source.durationSeconds, `unpadded candidate ${index}`);
    if (window.unpaddedStartSeconds < window.startSeconds || window.unpaddedEndSeconds > window.endSeconds) {
      throw new Error(`Unpadded candidate ${index} must lie inside its padded window`);
    }
    requireFinite(window.durationSeconds, `candidate window ${index} duration`);
    if (Math.abs(window.durationSeconds - (window.endSeconds - window.startSeconds)) > 1e-6) {
      throw new Error(`Candidate window ${index} duration is inconsistent`);
    }
    requireString(window.evidence, `candidate window ${index} evidence`);
  });

  if (!Array.isArray(trace.materializedClips) || trace.materializedClips.length !== trace.candidateWindows.length) {
    throw new Error("trace materializedClips must contain one clip per candidate window");
  }
  const clipIds = new Set();
  const clipsById = new Map();
  trace.materializedClips.forEach((clip, index) => {
    requireObject(clip, `materialized clip ${index}`);
    requireString(clip.clipId, `materialized clip ${index} id`);
    requireString(clip.windowId, `materialized clip ${index} window id`);
    if (clipIds.has(clip.clipId)) throw new Error(`Duplicate materialized clip id ${clip.clipId}`);
    if (!windowIds.has(clip.windowId)) throw new Error(`Materialized clip ${clip.clipId} references an unknown window`);
    clipIds.add(clip.clipId);
    clipsById.set(clip.clipId, clip);
    validateInterval(
      { startSeconds: clip.sourceStartSeconds, endSeconds: clip.sourceEndSeconds },
      trace.source.durationSeconds,
      `materialized clip ${index}`,
    );
    requireFinite(clip.expectedDurationSeconds, `materialized clip ${index} expected duration`);
    if (clip.kind === "file") {
      requireString(clip.url, `materialized clip ${index} URL`);
      requireString(clip.sha256, `materialized clip ${index} digest`);
    } else if (clip.kind === "unavailable") {
      requireString(clip.reason, `materialized clip ${index} unavailability reason`);
    } else {
      throw new Error(`Materialized clip ${index} kind must be file or unavailable`);
    }
  });

  if (!Array.isArray(trace.referenceEvents)) throw new Error("trace referenceEvents must be an array");
  trace.referenceEvents.forEach((event, index) => validateEvent(event, trace.source.durationSeconds, trace.eventKind, `reference event ${index}`));
  if (!Array.isArray(trace.transcriptSegments)) throw new Error("trace transcriptSegments must be an array");
  requireObject(trace.plans, "trace plans");

  for (const planId of PLAN_IDS) {
    const plan = trace.plans[planId];
    requireObject(plan, `plan ${planId}`);
    requireString(plan.label, `plan ${planId} label`);
    requireString(plan.expression, `plan ${planId} expression`);
    requireFraction(plan.videoFraction, `plan ${planId} video fraction`);
    if (!Array.isArray(plan.stages) || plan.stages.length === 0) throw new Error(`Plan ${planId} has no stages`);
    if (!Array.isArray(plan.predictions)) throw new Error(`Plan ${planId} predictions must be an array`);
    const stageIds = new Set();
    plan.stages.forEach((stage, index) => {
      requireObject(stage, `plan ${planId} stage ${index}`);
      for (const field of ["id", "operator", "summary", "description"]) requireString(stage[field], `plan ${planId} stage ${index} ${field}`);
      if (stageIds.has(stage.id)) throw new Error(`Plan ${planId} has duplicate stage id ${stage.id}`);
      stageIds.add(stage.id);
      for (const field of ["consumes", "produces", "knownBefore", "knownAfter", "parameters", "evidence"]) {
        validateStringArray(stage[field], `plan ${planId} stage ${stage.id} ${field}`);
      }
      for (const evidence of stage.evidence) if (!EVIDENCE_TYPES.has(evidence)) throw new Error(`Unknown evidence type ${evidence}`);
    });
    plan.predictions.forEach((prediction, index) => {
      const label = `${planId} prediction ${index}`;
      validateEvent(prediction, trace.source.durationSeconds, trace.eventKind, label);
      requireString(prediction.evidence, `${label} evidence`);
      if (prediction.clipId !== undefined) {
        requireString(prediction.clipId, `${label} clip id`);
        const clip = clipsById.get(prediction.clipId);
        if (!clip) throw new Error(`${label} references unknown clip ${prediction.clipId}`);
        const [start, end] = eventBounds(prediction);
        if (start < clip.sourceStartSeconds || end > clip.sourceEndSeconds) throw new Error(`${label} lies outside its associated clip`);
      }
      if (planId === "o2" && prediction.clipId === undefined) throw new Error(`${label} must identify its materialized clip`);
    });
  }

  requireString(publicationEvaluation.scopeLabel, "publication evaluation scope");
  requireObject(publicationEvaluation.workload, "publication evaluation workload");
  requireObject(publicationEvaluation.candidateMetrics, "publication candidate metrics");
  requireFraction(publicationEvaluation.candidateMetrics.recall, "publication candidate recall");
  requireFraction(publicationEvaluation.candidateMetrics.selectivity, "publication candidate selectivity");
  if (!Array.isArray(publicationEvaluation.results) || publicationEvaluation.results.length !== PLAN_IDS.length) {
    throw new Error("Publication results must contain the three query alternatives");
  }
  const resultIds = publicationEvaluation.results.map((row) => row.planId);
  if (new Set(resultIds).size !== PLAN_IDS.length || PLAN_IDS.some((id) => !resultIds.includes(id))) {
    throw new Error("Publication results must identify baseline, o1, and o2 exactly once");
  }
  publicationEvaluation.results.forEach((row) => {
    for (const field of ["videoFraction", "precision", "recall", "f1"]) requireFraction(row[field], `${row.planId} ${field}`);
    for (const field of ["tokenCount", "costUsd", "timeSeconds"]) requireFinite(row[field], `${row.planId} ${field}`);
  });
  return data;
}
