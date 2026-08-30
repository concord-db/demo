"use strict";

const PLAN_IDS = ["baseline", "o1", "o2"];
const EVIDENCE_TYPES = new Set([
  "sourceMedia",
  "transcriptAvailability",
  "transcript",
  "candidateRange",
  "windowTimeline",
  "resolvedTimeline",
  "materializedClip",
  "retainedFraction",
  "predictions",
  "outputRecords",
]);

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateInterval(interval, duration, label) {
  requireObject(interval, label);
  requireFinite(interval.startSeconds, `${label} start`);
  requireFinite(interval.endSeconds, `${label} end`);
  if (interval.startSeconds < 0 || interval.endSeconds <= interval.startSeconds || interval.endSeconds > duration) {
    throw new Error(`${label} lies outside the source timeline`);
  }
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

export function validateArtifact(data) {
  requireObject(data, "artifact");
  if (data.schemaVersion !== 2) throw new Error("Unsupported artifact schema");

  const { trace, publicationEvaluation } = data;
  requireObject(trace, "trace");
  requireObject(publicationEvaluation, "publicationEvaluation");
  requireObject(trace.source, "trace source");
  requireFinite(trace.source.durationSeconds, "source duration");
  if (trace.source.durationSeconds <= 0) throw new Error("Source duration must be positive");
  requireObject(trace.source.media, "source media");
  if (trace.source.media.kind !== "youtube") throw new Error("Source media must be a YouTube descriptor");
  requireString(trace.source.media.youtubeId, "source YouTube id");
  requireString(trace.source.media.pageUrl, "source page URL");

  requireObject(trace.materializedMedia, "materialized media");
  if (trace.materializedMedia.kind !== "file") throw new Error("Materialized media must be a file descriptor");
  requireString(trace.materializedMedia.url, "materialized media URL");
  validateInterval(trace.candidate, trace.source.durationSeconds, "candidate");
  validateInterval(
    {
      startSeconds: trace.candidate.unpaddedStartSeconds,
      endSeconds: trace.candidate.unpaddedEndSeconds,
    },
    trace.source.durationSeconds,
    "unpadded candidate",
  );
  if (trace.candidate.unpaddedStartSeconds < trace.candidate.startSeconds
      || trace.candidate.unpaddedEndSeconds > trace.candidate.endSeconds) {
    throw new Error("Unpadded candidate must lie inside the padded candidate");
  }

  if (!Array.isArray(trace.referenceEvents)) throw new Error("trace referenceEvents must be an array");
  trace.referenceEvents.forEach((event, index) => validateInterval(event, trace.source.durationSeconds, `reference event ${index}`));
  if (!Array.isArray(trace.transcriptSegments)) throw new Error("trace transcriptSegments must be an array");
  requireObject(trace.plans, "trace plans");

  for (const planId of PLAN_IDS) {
    const plan = trace.plans[planId];
    requireObject(plan, `plan ${planId}`);
    requireString(plan.label, `plan ${planId} label`);
    requireString(plan.expression, `plan ${planId} expression`);
    if (!Array.isArray(plan.stages) || plan.stages.length === 0) throw new Error(`Plan ${planId} has no stages`);
    if (!Array.isArray(plan.predictions)) throw new Error(`Plan ${planId} predictions must be an array`);
    const stageIds = new Set();
    plan.stages.forEach((stage, index) => {
      requireObject(stage, `plan ${planId} stage ${index}`);
      for (const field of ["id", "operator", "summary", "description"]) {
        requireString(stage[field], `plan ${planId} stage ${index} ${field}`);
      }
      if (stageIds.has(stage.id)) throw new Error(`Plan ${planId} has duplicate stage id ${stage.id}`);
      stageIds.add(stage.id);
      for (const field of ["consumes", "produces", "knownBefore", "knownAfter", "parameters", "evidence"]) {
        validateStringArray(stage[field], `plan ${planId} stage ${stage.id} ${field}`);
      }
      for (const evidence of stage.evidence) {
        if (!EVIDENCE_TYPES.has(evidence)) throw new Error(`Unknown evidence type ${evidence}`);
      }
    });
    plan.predictions.forEach((prediction, index) => validateInterval(prediction, trace.source.durationSeconds, `${planId} prediction ${index}`));
  }

  requireString(publicationEvaluation.scopeLabel, "publication evaluation scope");
  requireObject(publicationEvaluation.workload, "publication evaluation workload");
  requireObject(publicationEvaluation.candidateMetrics, "publication candidate metrics");
  if (!Array.isArray(publicationEvaluation.results) || publicationEvaluation.results.length !== PLAN_IDS.length) {
    throw new Error("Publication results must contain the three query alternatives");
  }
  return data;
}

