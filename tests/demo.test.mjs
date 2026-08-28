import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const demoRoot = new URL("../", import.meta.url);
const artifactPath = new URL("data/event-localization-v1.json", demoRoot);
const artifactText = await readFile(artifactPath, "utf8");
const artifact = JSON.parse(artifactText);

function result(planId) {
  return artifact.results.find((row) => row.planId === planId);
}

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

test("artifact contains the three evaluated query alternatives", () => {
  assert.equal(artifact.schemaVersion, 1);
  assert.deepEqual(Object.keys(artifact.plans), ["baseline", "o1", "o2"]);
  assert.deepEqual(artifact.results.map((row) => row.planId), ["baseline", "o1", "o2"]);
  assert.equal(artifact.plans.baseline.stages.length, 3);
  assert.equal(artifact.plans.o1.stages.length, 3);
  assert.equal(artifact.plans.o2.stages.length, 7);
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
  assert.equal(artifact.summary.candidateRecall, 1.0);
  assert.ok(Math.abs(artifact.summary.candidateSelectivity - 0.024722584117069787) < 1e-15);
});

test("candidate and predictions use valid source-time coordinates", () => {
  const { candidate, source, referenceEvents } = artifact;
  assert.ok(candidate.startSeconds >= 0);
  assert.ok(candidate.endSeconds <= source.durationSeconds);
  assert.ok(candidate.endSeconds > candidate.startSeconds);
  assert.ok(Math.abs((candidate.endSeconds - candidate.startSeconds) - candidate.durationSeconds) < 1e-9);

  for (const event of referenceEvents) {
    assert.ok(event.startSeconds >= candidate.startSeconds);
    assert.ok(event.endSeconds <= candidate.endSeconds);
  }
  for (const plan of Object.values(artifact.plans)) {
    for (const prediction of plan.predictions) {
      assert.ok(prediction.startSeconds >= 0);
      assert.ok(prediction.endSeconds <= source.durationSeconds);
      assert.ok(prediction.endSeconds > prediction.startSeconds);
    }
  }
});

test("transcript-only returns one neighborhood covering both reference events", () => {
  assert.equal(artifact.plans.o1.predictions.length, 1);
  const prediction = artifact.plans.o1.predictions[0];
  for (const event of artifact.referenceEvents) {
    assert.ok(prediction.startSeconds <= event.startSeconds);
    assert.ok(prediction.endSeconds >= event.endSeconds);
  }
});

test("O2 source times map deterministically to the materialized clip", () => {
  assert.equal(artifact.plans.o2.predictions.length, 3);
  const clipOffsets = artifact.plans.o2.predictions.map(
    (prediction) => Number((prediction.startSeconds - artifact.media.sourceStartSeconds).toFixed(1)),
  );
  assert.deepEqual(clipOffsets, [50.8, 73.5, 92.5]);
});

test("public artifact contains no absolute local paths", () => {
  assert.equal(artifactText.includes("/Users/"), false);
  assert.match(artifact.media.url, /^\.\/media\//);
});

test("web media is versioned, bounded, and matches its recorded digest", async () => {
  const mediaPath = new URL(artifact.media.url.replace("./", ""), demoRoot);
  const media = await readFile(mediaPath);
  const info = await stat(mediaPath);
  assert.ok(info.size > 0);
  assert.ok(info.size < 8 * 1024 * 1024);
  assert.match(mediaPath.pathname, /-v1\.mp4$/);
  assert.equal(createHash("sha256").update(media).digest("hex"), artifact.media.sha256);
});

test("page exposes accessible tabs, controls, and lazy media", async () => {
  const html = await readFile(new URL("index.html", demoRoot), "utf8");
  const css = await readFile(new URL("styles.css", demoRoot), "utf8");
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 3);
  assert.match(html, /id="previous-stage"/);
  assert.match(html, /id="next-stage"/);
  assert.match(html, /preload="metadata"/);
  assert.match(html, /id="media-fallback"/);
  assert.match(html, /styles\.css\?v=3/);
  assert.match(css, /\.media-fallback\[hidden\]\s*\{\s*display:\s*none;/);
  for (const color of ["#fffdf8", "#201e1a", "#746f66", "#ded8cb", "#df562d"]) {
    assert.match(css, new RegExp(color));
  }
  assert.match(css, /color-scheme:\s*light/);
});

test("light theme text colors preserve readable contrast", () => {
  const background = "fffdf8";
  for (const foreground of ["201e1a", "746f66", "397468", "bd4525"]) {
    assert.ok(contrastRatio(background, foreground) >= 4.5);
  }
  assert.ok(contrastRatio(background, "df562d") >= 3);
});
