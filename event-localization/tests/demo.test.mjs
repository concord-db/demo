import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { validateArtifact } from "../artifact-schema.js";
import { canInspectStage, createExecutionState, executionReducer, stageStatus } from "../execution-state.js";

const demoRoot = new URL("../", import.meta.url);
const artifactPath = new URL("data/event-localization-v2.json", demoRoot);
const artifactText = await readFile(artifactPath, "utf8");
const artifact = JSON.parse(artifactText);
const trace = artifact.trace;
const publication = artifact.publicationEvaluation;

function result(planId) { return publication.results.find((row) => row.planId === planId); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test("schema-v2 artifact separates the trace from publication evaluation", () => {
  assert.equal(validateArtifact(artifact), artifact);
  assert.equal(artifact.schemaVersion, 2);
  assert.deepEqual(Object.keys(trace.plans), ["baseline", "o1", "o2"]);
  assert.equal(trace.referenceEvents.length, 2);
  assert.equal(publication.workload.referenceEventCount, 4);
  assert.match(publication.scopeLabel, /Three lectures/);
});

test("every operator stage has an explicit data and evidence contract", () => {
  assert.equal(trace.plans.baseline.stages.length, 3);
  assert.equal(trace.plans.o1.stages.length, 3);
  assert.equal(trace.plans.o2.stages.length, 7);
  for (const plan of Object.values(trace.plans)) {
    const ids = new Set();
    for (const stage of plan.stages) {
      assert.ok(stage.id);
      assert.equal(ids.has(stage.id), false);
      ids.add(stage.id);
      for (const field of ["consumes", "produces", "knownBefore", "knownAfter", "parameters", "evidence"]) assert.ok(Array.isArray(stage[field]));
    }
  }
});

test("retained-video evidence appears only at View or video localization", () => {
  const evidenceStages = Object.fromEntries(Object.entries(trace.plans).map(([planId, plan]) => [
    planId,
    plan.stages.filter((stage) => stage.evidence.includes("retainedFraction")).map((stage) => stage.id),
  ]));
  assert.deepEqual(evidenceStages, { baseline: ["video-localize"], o1: [], o2: ["view", "video-localize"] });
});

test("publication metrics remain exact", () => {
  assert.equal(result("baseline").f1, 0.5);
  assert.equal(result("baseline").tokenCount, 1285453);
  assert.equal(result("o1").f1, 0.28571428571428575);
  assert.equal(result("o1").tokenCount, 128412);
  assert.equal(result("o2").f1, 0.888888888888889);
  assert.equal(result("o2").precision, 0.8);
  assert.equal(result("o2").recall, 1.0);
  assert.equal(result("o2").tokenCount, 161479);
  assert.equal(publication.candidateMetrics.recall, 1.0);
  assert.ok(Math.abs(publication.candidateMetrics.selectivity - 0.024722584117069787) < 1e-15);
});

test("candidate and predictions use valid source-time coordinates", () => {
  const { candidate, source, referenceEvents } = trace;
  assert.ok(candidate.startSeconds >= 0);
  assert.ok(candidate.endSeconds <= source.durationSeconds);
  assert.ok(candidate.endSeconds > candidate.startSeconds);
  assert.ok(Math.abs((candidate.endSeconds - candidate.startSeconds) - candidate.durationSeconds) < 1e-9);
  assert.ok(candidate.unpaddedStartSeconds >= candidate.startSeconds);
  assert.ok(candidate.unpaddedEndSeconds <= candidate.endSeconds);
  for (const event of referenceEvents) {
    assert.ok(event.startSeconds >= candidate.startSeconds);
    assert.ok(event.endSeconds <= candidate.endSeconds);
  }
  for (const plan of Object.values(trace.plans)) {
    for (const prediction of plan.predictions) {
      assert.ok(prediction.startSeconds >= 0);
      assert.ok(prediction.endSeconds <= source.durationSeconds);
      assert.ok(prediction.endSeconds > prediction.startSeconds);
    }
  }
});

test("transcript-only returns one neighborhood covering both trace reference events", () => {
  assert.equal(trace.plans.o1.predictions.length, 1);
  const prediction = trace.plans.o1.predictions[0];
  for (const event of trace.referenceEvents) {
    assert.ok(prediction.startSeconds <= event.startSeconds);
    assert.ok(prediction.endSeconds >= event.endSeconds);
  }
});

test("O2 source times map deterministically to the materialized clip", () => {
  assert.equal(trace.plans.o2.predictions.length, 3);
  const clipOffsets = trace.plans.o2.predictions.map(
    (prediction) => Number((prediction.startSeconds - trace.materializedMedia.sourceStartSeconds).toFixed(1)),
  );
  assert.deepEqual(clipOffsets, [50.8, 73.5, 92.5]);
});

test("execution reducer prevents future-stage inspection and advances sequentially", () => {
  let state = createExecutionState("o2");
  assert.equal(stageStatus(state, 0), "ready");
  assert.equal(stageStatus(state, 1), "locked");
  assert.equal(canInspectStage(state, 0), true);
  assert.equal(canInspectStage(state, 1), false);
  assert.equal(executionReducer(state, { type: "select-stage", stageIndex: 3 }, 7), state);
  state = executionReducer(state, { type: "run-next" }, 7);
  assert.equal(state.completedStageIndex, 0);
  assert.equal(stageStatus(state, 0), "complete");
  assert.equal(stageStatus(state, 1), "ready");
  state = executionReducer(state, { type: "run-next" }, 7);
  assert.equal(state.completedStageIndex, 1);
  state = executionReducer(state, { type: "reset" }, 7);
  assert.deepEqual(state, createExecutionState("o2"));
  state = executionReducer(state, { type: "select-plan", planId: "o1" }, 7);
  assert.deepEqual(state, createExecutionState("o1"));
});

test("schema validation rejects unknown evidence and mixed trace data", () => {
  const unknownEvidence = clone(artifact);
  unknownEvidence.trace.plans.o2.stages[0].evidence.push("oracleLabels");
  assert.throws(() => validateArtifact(unknownEvidence), /Unknown evidence type/);
  const duplicateStage = clone(artifact);
  duplicateStage.trace.plans.o2.stages[1].id = duplicateStage.trace.plans.o2.stages[0].id;
  assert.throws(() => validateArtifact(duplicateStage), /duplicate stage id/);
  const missingScope = clone(artifact);
  delete missingScope.publicationEvaluation.scopeLabel;
  assert.throws(() => validateArtifact(missingScope), /scope/);
});

test("source and materialized media have distinct typed descriptors", () => {
  assert.equal(trace.source.media.kind, "youtube");
  assert.equal(trace.source.media.youtubeId, "VkbtIDSHfSc");
  assert.match(trace.source.media.pageUrl, /^https:\/\/ocw\.mit\.edu\//);
  assert.equal(trace.materializedMedia.kind, "file");
  assert.match(trace.materializedMedia.url, /^\.\/media\//);
});

test("public artifact contains no absolute local paths", () => {
  assert.equal(artifactText.includes("/Users/"), false);
});

test("web media is versioned, bounded, and matches its recorded digest", async () => {
  const mediaPath = new URL(trace.materializedMedia.url.replace("./", ""), demoRoot);
  const media = await readFile(mediaPath);
  const info = await stat(mediaPath);
  assert.ok(info.size > 0);
  assert.ok(info.size < 8 * 1024 * 1024);
  assert.match(mediaPath.pathname, /-v1\.mp4$/);
  assert.equal(createHash("sha256").update(media).digest("hex"), trace.materializedMedia.sha256);
});

test("page exposes accessible query tabs and execution controls", async () => {
  const html = await readFile(new URL("index.html", demoRoot), "utf8");
  const css = await readFile(new URL("styles.css", demoRoot), "utf8");
  const app = await readFile(new URL("app.js", demoRoot), "utf8");
  assert.match(html, /role="tablist"/);
  assert.match(html, /name="repository" content="concord-db\/demo"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /id="run-next-stage"/);
  assert.match(html, /id="reset-plan"/);
  assert.match(html, /id="operator-trace"/);
  assert.match(html, /styles\.css\?v=5/);
  assert.match(css, /\.artifact-heading > div\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*4px;/);
  assert.match(app, /youtube-nocookie\.com/);
  assert.match(app, /preload: "metadata"/);
  assert.equal(html.includes("soap-bubble-candidate-v1.mp4"), false);
  for (const color of ["#fffdf8", "#201e1a", "#746f66", "#ded8cb", "#df562d"]) assert.match(css, new RegExp(color));
  assert.match(css, /color-scheme:\s*light/);
});

test("light theme text colors preserve readable contrast", () => {
  const background = "fffdf8";
  for (const foreground of ["201e1a", "746f66", "397468", "bd4525"]) assert.ok(contrastRatio(background, foreground) >= 4.5);
  assert.ok(contrastRatio(background, "df562d") >= 3);
});
