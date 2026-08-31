import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { validateArtifact } from "../artifact-schema.js";
import { canInspectStage, createExecutionState, executionReducer, stageStatus } from "../execution-state.js";

const demoRoot = new URL("../", import.meta.url);
const artifactPaths = {
  lecture: new URL("data/lecture-event-localization-v3.json", demoRoot),
  soccer: new URL("data/soccer-event-localization-v3.json", demoRoot),
};
const artifactTexts = Object.fromEntries(await Promise.all(Object.entries(artifactPaths).map(async ([id, path]) => [id, await readFile(path, "utf8")])));
const artifacts = Object.fromEntries(Object.entries(artifactTexts).map(([id, text]) => [id, JSON.parse(text)]));
const { lecture, soccer } = artifacts;

function result(artifact, planId) { return artifact.publicationEvaluation.results.find((row) => row.planId === planId); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((channel) => parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

test("both examples satisfy the shared schema and three-plan contract", () => {
  for (const [exampleId, artifact] of Object.entries(artifacts)) {
    assert.equal(validateArtifact(artifact), artifact);
    assert.equal(artifact.schemaVersion, 3);
    assert.equal(artifact.example.id, exampleId);
    assert.deepEqual(Object.keys(artifact.trace.plans), ["baseline", "o1", "o2"]);
    assert.equal(artifact.trace.plans.baseline.stages.length, 3);
    assert.equal(artifact.trace.plans.o1.stages.length, 3);
    assert.equal(artifact.trace.plans.o2.stages.length, 7);
  }
});

test("every operator stage has an explicit data and evidence contract", () => {
  for (const artifact of Object.values(artifacts)) {
    for (const plan of Object.values(artifact.trace.plans)) {
      const ids = new Set();
      for (const stage of plan.stages) {
        assert.ok(stage.id);
        assert.equal(ids.has(stage.id), false);
        ids.add(stage.id);
        for (const field of ["consumes", "produces", "knownBefore", "knownAfter", "parameters", "evidence"]) assert.ok(Array.isArray(stage[field]));
      }
    }
  }
});

test("retained-video evidence appears only at View or video localization", () => {
  for (const artifact of Object.values(artifacts)) {
    const evidenceStages = Object.fromEntries(Object.entries(artifact.trace.plans).map(([planId, plan]) => [
      planId,
      plan.stages.filter((stage) => stage.evidence.includes("retainedFraction")).map((stage) => stage.id),
    ]));
    assert.deepEqual(evidenceStages, { baseline: ["video-localize"], o1: [], o2: ["view", "video-localize"] });
    const traceDuration = artifact.trace.candidateWindows.reduce((sum, window) => sum + window.durationSeconds, 0);
    assert.ok(Math.abs(artifact.trace.plans.o2.videoFraction - traceDuration / artifact.trace.source.durationSeconds) < 1e-12);
    assert.notEqual(artifact.trace.plans.o2.videoFraction, result(artifact, "o2").videoFraction);
  }
});

test("lecture publication metrics remain exact", () => {
  assert.equal(result(lecture, "baseline").f1, 0.5);
  assert.equal(result(lecture, "baseline").tokenCount, 1285453);
  assert.equal(result(lecture, "o1").f1, 0.28571428571428575);
  assert.equal(result(lecture, "o1").tokenCount, 128412);
  assert.equal(result(lecture, "o2").f1, 0.888888888888889);
  assert.equal(result(lecture, "o2").precision, 0.8);
  assert.equal(result(lecture, "o2").recall, 1.0);
  assert.equal(result(lecture, "o2").tokenCount, 161479);
  assert.equal(lecture.publicationEvaluation.candidateMetrics.recall, 1.0);
  assert.ok(Math.abs(lecture.publicationEvaluation.candidateMetrics.selectivity - 0.024722584117069787) < 1e-15);
});

test("soccer publication metrics remain exact", () => {
  assert.equal(result(soccer, "baseline").f1, 0.8181818181818182);
  assert.equal(result(soccer, "baseline").tokenCount, 1506097);
  assert.equal(result(soccer, "o1").f1, 0.9523809523809523);
  assert.equal(result(soccer, "o1").tokenCount, 132370);
  assert.equal(result(soccer, "o2").f1, 0.9523809523809523);
  assert.equal(result(soccer, "o2").precision, 0.9090909090909091);
  assert.equal(result(soccer, "o2").recall, 1.0);
  assert.equal(result(soccer, "o2").tokenCount, 216986);
  assert.equal(soccer.publicationEvaluation.candidateMetrics.recall, 1.0);
  assert.ok(Math.abs(soccer.publicationEvaluation.candidateMetrics.selectivity - 0.0532017335896862) < 1e-15);
});

test("lecture uses interval events and soccer uses point events without coercion", () => {
  assert.equal(lecture.trace.eventKind, "interval");
  assert.ok(lecture.trace.referenceEvents.every((event) => event.eventKind === "interval" && event.endSeconds > event.startSeconds));
  assert.equal(soccer.trace.eventKind, "point");
  assert.deepEqual(soccer.trace.referenceEvents.map((event) => event.timeSeconds), [977.76, 1280.902, 2110.559]);
  assert.ok(soccer.trace.referenceEvents.every((event) => event.startSeconds === undefined && event.endSeconds === undefined));
});

test("soccer preserves all three windows and explicit clip associations", () => {
  assert.deepEqual(soccer.trace.candidateWindows.map((window) => [window.startSeconds, window.endSeconds]), [[948, 1008], [1249, 1309], [2082, 2142]]);
  assert.equal(soccer.trace.materializedClips.length, 3);
  assert.ok(soccer.trace.materializedClips.every((clip) => clip.kind === "unavailable"));
  assert.deepEqual(soccer.trace.plans.o2.predictions.map((prediction) => prediction.clipId), ["soccer-clip-0", "soccer-clip-1", "soccer-clip-2"]);
  assert.deepEqual(soccer.trace.plans.o2.predictions.map((prediction) => prediction.timeSeconds), [977.5, 1280.8, 2110.5]);
});

test("schema rejects invalid event types and clip associations", () => {
  const zeroLengthSoccer = clone(soccer);
  zeroLengthSoccer.trace.referenceEvents[0] = { eventKind: "interval", startSeconds: 977.76, endSeconds: 977.76 };
  assert.throws(() => validateArtifact(zeroLengthSoccer), /must be a point event/);

  const missingClip = clone(soccer);
  missingClip.trace.plans.o2.predictions[0].clipId = "missing";
  assert.throws(() => validateArtifact(missingClip), /unknown clip/);

  const outsideClip = clone(soccer);
  outsideClip.trace.plans.o2.predictions[0].timeSeconds = 1200;
  assert.throws(() => validateArtifact(outsideClip), /outside its associated clip/);

  const duplicateWindow = clone(soccer);
  duplicateWindow.trace.candidateWindows[1].windowId = duplicateWindow.trace.candidateWindows[0].windowId;
  assert.throws(() => validateArtifact(duplicateWindow), /Duplicate candidate window/);
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
  state = executionReducer(state, { type: "run-next" }, 7);
  assert.equal(state.completedStageIndex, 1);
  state = executionReducer(state, { type: "reset" }, 7);
  assert.deepEqual(state, createExecutionState("o2"));
  state = executionReducer(state, { type: "select-plan", planId: "o1" }, 7);
  assert.deepEqual(state, createExecutionState("o1"));
});

test("schema validation rejects unknown evidence and duplicate stages", () => {
  const unknownEvidence = clone(lecture);
  unknownEvidence.trace.plans.o2.stages[0].evidence.push("oracleLabels");
  assert.throws(() => validateArtifact(unknownEvidence), /Unknown evidence type/);
  const duplicateStage = clone(lecture);
  duplicateStage.trace.plans.o2.stages[1].id = duplicateStage.trace.plans.o2.stages[0].id;
  assert.throws(() => validateArtifact(duplicateStage), /duplicate stage id/);
});

test("public artifacts contain no absolute local paths", () => {
  for (const text of Object.values(artifactTexts)) assert.equal(text.includes("/Users/"), false);
});

test("lecture web media is versioned, bounded, and matches its recorded digest", async () => {
  const clip = lecture.trace.materializedClips[0];
  const mediaPath = new URL(clip.url.replace("./", ""), demoRoot);
  const media = await readFile(mediaPath);
  const info = await stat(mediaPath);
  assert.ok(info.size > 0);
  assert.ok(info.size < 8 * 1024 * 1024);
  assert.match(mediaPath.pathname, /-v1\.mp4$/);
  assert.equal(createHash("sha256").update(media).digest("hex"), clip.sha256);
});

test("page exposes accessible example and query controls", async () => {
  const html = await readFile(new URL("index.html", demoRoot), "utf8");
  const css = await readFile(new URL("styles.css", demoRoot), "utf8");
  const app = await readFile(new URL("app.js", demoRoot), "utf8");
  assert.match(html, /aria-label="Localization example"/);
  assert.equal((html.match(/data-example=/g) || []).length, 2);
  assert.equal((html.match(/data-plan=/g) || []).length, 3);
  assert.match(html, /name="repository" content="concord-db\/demo"/);
  assert.match(html, /id="run-next-stage"/);
  assert.match(html, /id="operator-trace"/);
  assert.match(html, /styles\.css\?v=7/);
  assert.match(html, /app\.js\?v=6/);
  assert.match(app, /youtube-nocookie\.com/);
  assert.match(app, /preload: "metadata"/);
  assert.equal(html.includes("soap-bubble-candidate-v1.mp4"), false);
  for (const color of ["#fffdf8", "#201e1a", "#746f66", "#ded8cb", "#df562d"]) assert.match(css, new RegExp(color));
});

test("light theme text colors preserve readable contrast", () => {
  const background = "fffdf8";
  for (const foreground of ["201e1a", "746f66", "397468", "bd4525"]) assert.ok(contrastRatio(background, foreground) >= 4.5);
  assert.ok(contrastRatio(background, "df562d") >= 3);
});
