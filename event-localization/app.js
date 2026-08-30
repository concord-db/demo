"use strict";

import { canInspectStage, createExecutionState, executionReducer, stageStatus } from "./execution-state.js";
import { validateArtifact } from "./artifact-schema.js";

const DATA_URL = "./data/event-localization-v2.json";
let state = createExecutionState("o2");
let data = null;

const mediaCache = { sourcePlayer: null, candidateVideo: null };
const elements = {
  tabs: [...document.querySelectorAll("[data-plan]")],
  panel: document.querySelector("#plan-panel"),
  expression: document.querySelector("#plan-expression"),
  trace: document.querySelector("#operator-trace"),
  executionStatus: document.querySelector("#execution-status"),
  runNext: document.querySelector("#run-next-stage"),
  reset: document.querySelector("#reset-plan"),
  resultsBody: document.querySelector("#results-body"),
  evaluationScope: document.querySelector("#evaluation-scope"),
  summaryVideo: document.querySelector("#summary-baseline-video"),
  summaryO1: document.querySelector("#summary-o1-video"),
  summaryO2: document.querySelector("#summary-o2-video"),
  metricVideo: document.querySelector("#metric-video"),
  metricRecall: document.querySelector("#metric-recall"),
  metricCost: document.querySelector("#metric-cost"),
  metricF1: document.querySelector("#metric-f1"),
};

function node(tagName, options = {}) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes || {})) element.setAttribute(name, value);
  return element;
}

function currentPlan() { return data.trace.plans[state.planId]; }
function percent(value, total) { return `${Math.max(0, Math.min(100, (value / total) * 100))}%`; }
function formatFraction(value, digits = 3) { return value.toFixed(digits).replace(/^0/, ""); }
function formatVideoFraction(value) { return `${(value * 100).toFixed(2)}%`; }
function formatTokens(value) { return `${(value / 1_000_000).toFixed(3)}M`; }

function formatClock(seconds, fractional = false) {
  const rounded = fractional ? seconds : Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  const secondText = fractional ? remainder.toFixed(1).padStart(4, "0") : String(remainder).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${secondText}`
    : `${minutes}:${secondText}`;
}

function list(items) {
  const result = node("ul");
  for (const item of items) result.append(node("li", { text: item }));
  return result;
}

function contractCard(label, items, pending = false) {
  const card = node("section", { className: "contract-card" });
  card.append(node("span", { text: label }));
  card.append(pending
    ? node("p", { className: "artifact-note", text: "Available after this operator executes." })
    : list(items));
  return card;
}

function artifactPanel(kicker, title, wide = false) {
  const panel = node("section", { className: `artifact-panel${wide ? " is-wide" : ""}` });
  const heading = node("div", { className: "artifact-heading" });
  const copy = node("div");
  copy.append(node("span", { text: kicker }), node("strong", { text: title }));
  heading.append(copy);
  panel.append(heading);
  return panel;
}

function createSourcePlayer() {
  if (mediaCache.sourcePlayer) return mediaCache.sourcePlayer;
  const { source } = data.trace;
  const player = node("div", { className: "source-player", attributes: { "data-media-kind": "youtube" } });
  const facade = node("div", { className: "source-facade" });
  facade.style.backgroundImage = `url("${source.media.thumbnailUrl}")`;
  const copy = node("div");
  copy.append(
    node("span", { text: "Complete source lecture · 82:25" }),
    node("strong", { text: source.title }),
  );
  const load = node("button", { className: "button", text: "Load full lecture", attributes: { type: "button" } });
  load.addEventListener("click", () => {
    const iframe = node("iframe", {
      attributes: {
        src: `https://www.youtube-nocookie.com/embed/${source.media.youtubeId}?rel=0`,
        title: `Full source video: ${source.title}`,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
        allowfullscreen: "",
        referrerpolicy: "strict-origin-when-cross-origin",
      },
    });
    player.replaceChildren(iframe);
  });
  copy.append(load);
  facade.append(copy);
  player.append(facade);
  mediaCache.sourcePlayer = player;
  return player;
}

function renderSourceMedia() {
  const panel = artifactPanel("Input media", "Complete lecture video", true);
  panel.append(createSourcePlayer());
  const note = node("p", { className: "media-credit" });
  note.append("Official MIT OpenCourseWare lecture. This is the complete input—not a candidate excerpt. ");
  note.append(node("a", {
    text: "Open the MIT OCW source ↗",
    attributes: { href: data.trace.source.media.pageUrl, target: "_blank", rel: "noreferrer" },
  }));
  panel.append(note);
  return panel;
}

function renderTranscriptAvailability() {
  const panel = artifactPanel("Input relation", "Source-aligned transcript");
  panel.append(node("p", {
    className: "artifact-note",
    text: `${data.trace.transcriptSegments.length} timestamped segments are shown in this recorded neighborhood. The transcript was materialized before query execution.`,
  }));
  return panel;
}

function renderTranscript(stageId) {
  const { candidate, transcriptSegments } = data.trace;
  const panel = artifactPanel("Source-aligned representation", "Transcript evidence", true);
  const rationale = node("div", { className: "candidate-rationale" });
  const showCandidate = stageId === "candidate";
  rationale.textContent = showCandidate
    ? `Candidate evidence: “${candidate.evidence}”`
    : "Each segment carries start and end timestamps on the source-video timeline.";
  panel.append(rationale);
  const scroll = node("div", { className: "transcript-scroll" });
  const o1Prediction = data.trace.plans.o1.predictions[0];
  for (const segment of transcriptSegments) {
    const row = node("div", { className: "transcript-segment" });
    if (showCandidate && segment.segmentId >= candidate.startSegmentId && segment.segmentId <= candidate.endSegmentId) row.classList.add("candidate");
    if (state.planId === "o1" && stageId === "transcript-localize"
        && segment.segmentId >= o1Prediction.startSegmentId && segment.segmentId <= o1Prediction.endSegmentId) row.classList.add("prediction");
    row.append(node("time", { text: formatClock(segment.startSeconds) }), node("span", { text: segment.text }));
    scroll.append(row);
  }
  panel.append(scroll);
  return panel;
}

function renderTimeline(kind) {
  const { source, candidate } = data.trace;
  const unpadded = kind === "candidateRange";
  const start = unpadded ? candidate.unpaddedStartSeconds : candidate.startSeconds;
  const end = unpadded ? candidate.unpaddedEndSeconds : candidate.endSeconds;
  const title = unpadded ? "Transcript-derived candidate" : kind === "resolvedTimeline" ? "Resolved retained window" : "Padded source window";
  const panel = artifactPanel("Source-time range", title, true);
  const sourceView = node("div", { className: "source-view" });
  const header = node("div", { className: "source-view-header" });
  const copy = node("div");
  copy.append(node("span", { text: "Complete source timeline" }), node("strong", { text: source.title }));
  header.append(copy, node("strong", { text: `${formatClock(start, true)}–${formatClock(end, true)}` }));
  const labels = node("div", { className: "timeline-labels" });
  labels.append(node("span", { text: "0:00" }), node("span", { text: formatClock(source.durationSeconds) }));
  const timeline = node("div", { className: "timeline", attributes: { "aria-label": title } });
  timeline.append(node("div", { className: "timeline-track" }));
  const window = node("div", { className: `timeline-window${unpadded ? " unpadded" : ""}` });
  window.style.left = percent(start, source.durationSeconds);
  window.style.width = percent(end - start, source.durationSeconds);
  timeline.append(window);
  const legend = node("div", { className: "timeline-legend" });
  const legendItem = node("span");
  legendItem.append(node("i", { className: "legend-window" }), title);
  legend.append(legendItem);
  sourceView.append(header, labels, timeline, legend);
  panel.append(sourceView);
  return panel;
}

function renderRetainedFraction() {
  const fraction = currentPlan().videoFraction;
  const { source, materializedMedia } = data.trace;
  const startSeconds = state.planId === "baseline" ? 0 : materializedMedia.sourceStartSeconds;
  const endSeconds = state.planId === "baseline" ? source.durationSeconds : materializedMedia.sourceEndSeconds;
  const panel = artifactPanel("Video extent presented to the MLLM", `${formatVideoFraction(fraction)} of source video`, true);
  const meter = node("div", { className: "retained-meter" });
  const header = node("div", { className: "retained-meter-header" });
  header.append(
    node("span", { text: `${state.planId === "baseline" ? "Complete lecture" : "Materialized candidate window"} · ${formatClock(startSeconds, true)}–${formatClock(endSeconds, true)}` }),
    node("strong", { text: formatVideoFraction(fraction) }),
  );
  const track = node("div", { className: "retained-meter-track" });
  const fill = node("div", { className: "retained-meter-fill" });
  fill.style.left = percent(startSeconds, source.durationSeconds);
  fill.style.width = formatVideoFraction(fraction);
  track.append(fill);
  const axis = node("div", { className: "retained-meter-axis" });
  axis.append(node("span", { text: "0:00" }), node("span", { text: formatClock(source.durationSeconds) }));
  meter.append(header, track, axis);
  panel.append(meter);
  return panel;
}

function candidateVideo() {
  if (mediaCache.candidateVideo) return mediaCache.candidateVideo;
  const video = node("video", {
    attributes: { controls: "", preload: "metadata", src: data.trace.materializedMedia.url },
  });
  video.textContent = "Your browser does not support HTML video.";
  mediaCache.candidateVideo = video;
  return video;
}

function seekToPrediction(sourceSeconds) {
  const video = candidateVideo();
  const clipTime = Math.max(0, sourceSeconds - data.trace.materializedMedia.sourceStartSeconds);
  video.currentTime = Math.min(clipTime, video.duration || clipTime);
  video.play().catch(() => {});
}

function renderPredictionTimeline() {
  const { candidate } = data.trace;
  const timeline = node("div", { className: "detail-timeline", attributes: { "aria-label": "Clip-level prediction timeline" } });
  currentPlan().predictions.forEach((prediction, index) => {
    const marker = node("button", {
      className: "detail-marker prediction",
      attributes: { type: "button", "aria-label": `Seek to prediction ${index + 1}`, title: `Prediction ${index + 1}` },
    });
    marker.style.left = percent(prediction.startSeconds - candidate.startSeconds, candidate.durationSeconds);
    marker.style.width = percent(prediction.endSeconds - prediction.startSeconds, candidate.durationSeconds);
    marker.addEventListener("click", () => seekToPrediction(prediction.startSeconds));
    timeline.append(marker);
  });
  return timeline;
}

function renderMaterializedClip(showPredictions) {
  const media = data.trace.materializedMedia;
  const panel = artifactPanel("Materialized View", "Candidate clip", true);
  panel.querySelector(".artifact-heading").append(node("strong", {
    text: `${formatClock(media.sourceStartSeconds, true)}–${formatClock(media.sourceEndSeconds, true)}`,
  }));
  const frame = node("div", { className: "video-frame" });
  const fallback = node("div", {
    className: "media-fallback",
    text: "The materialized clip could not be loaded. The recorded operator outputs remain available.",
    attributes: { hidden: "" },
  });
  const video = candidateVideo();
  video.addEventListener("error", () => { fallback.hidden = false; }, { once: true });
  video.addEventListener("loadedmetadata", () => { fallback.hidden = true; }, { once: true });
  frame.append(video, fallback);
  panel.append(frame);
  if (showPredictions) panel.append(renderPredictionTimeline());
  panel.append(node("p", {
    className: "media-credit",
    text: "Materialized from the retained source-time window; clip-relative outputs are mapped back to the original lecture timeline.",
  }));
  return panel;
}

function predictionCards({ output = false } = {}) {
  const panel = artifactPanel(output ? "Query output" : "Semantic-function output", output ? "Source-time event records" : "Localized occurrences", true);
  const cards = node("div", { className: "prediction-list" });
  currentPlan().predictions.forEach((prediction, index) => {
    const card = node("article", { className: "prediction-card" });
    const isClipRelative = state.planId === "o2" && !output;
    const isSeekable = isClipRelative;
    const content = isSeekable
      ? node("button", { className: "prediction-card-content", attributes: { type: "button", "aria-label": `Play event ${index + 1} in the visible candidate clip` } })
      : node("div", { className: "prediction-card-content" });
    const offset = isClipRelative ? data.trace.materializedMedia.sourceStartSeconds : 0;
    content.append(
      node("span", { text: output ? `Output tuple ${String(index + 1).padStart(2, "0")}` : `Event ${String(index + 1).padStart(2, "0")}` }),
      node("strong", { text: `${formatClock(prediction.startSeconds - offset, true)}–${formatClock(prediction.endSeconds - offset, true)}${isClipRelative ? " clip time" : " source time"}` }),
      node("p", { text: prediction.evidence }),
    );
    if (isSeekable) content.addEventListener("click", () => seekToPrediction(prediction.startSeconds));
    card.append(content);
    cards.append(card);
  });
  panel.append(cards);
  return panel;
}

function renderArtifacts(stage) {
  const artifacts = node("div", { className: "artifact-grid" });
  for (const evidence of stage.evidence) {
    if (evidence === "sourceMedia") artifacts.append(renderSourceMedia());
    else if (evidence === "transcriptAvailability") artifacts.append(renderTranscriptAvailability());
    else if (evidence === "transcript") artifacts.append(renderTranscript(stage.id));
    else if (["candidateRange", "windowTimeline", "resolvedTimeline"].includes(evidence)) artifacts.append(renderTimeline(evidence));
    else if (evidence === "retainedFraction") artifacts.append(renderRetainedFraction());
    else if (evidence === "materializedClip") artifacts.append(renderMaterializedClip(stage.evidence.includes("predictions")));
    else if (evidence === "predictions") artifacts.append(predictionCards());
    else if (evidence === "outputRecords") artifacts.append(predictionCards({ output: true }));
  }
  return artifacts;
}

function renderStageBody(stage, status) {
  const body = node("div", { className: "step-body" });
  body.append(node("p", { className: "step-description", text: stage.description }));
  const flow = node("div", { className: "dataflow" });
  const consumes = node("div");
  consumes.append(node("span", { text: "Consumes" }), node("code", { text: stage.consumes.join(" · ") }));
  const produces = node("div");
  produces.append(node("span", { text: "Produces" }), node("code", { text: stage.produces.join(" · ") }));
  flow.append(consumes, node("span", { className: "dataflow-arrow", text: "→" }), produces);
  body.append(flow);
  const contracts = node("div", { className: "contract-grid" });
  contracts.append(contractCard("Known before", stage.knownBefore), contractCard("Known after", stage.knownAfter, status !== "complete"));
  body.append(contracts);
  if (stage.parameters.length) {
    const parameters = node("ul", { className: "parameter-list" });
    for (const parameter of stage.parameters) parameters.append(node("li", { text: parameter }));
    body.append(parameters);
  }
  body.append(status === "complete"
    ? renderArtifacts(stage)
    : node("div", { className: "empty-artifact", text: `Run ${stage.operator} to reveal this operator’s recorded output.` }));
  return body;
}

function renderTrace() {
  const plan = currentPlan();
  elements.trace.replaceChildren();
  plan.stages.forEach((stage, index) => {
    const status = stageStatus(state, index);
    const item = node("li", {
      className: `operator-step${index === state.selectedStageIndex ? " is-selected" : ""}`,
      attributes: { "data-stage-id": stage.id, "data-status": status },
    });
    const trigger = node("button", {
      className: "step-trigger",
      attributes: { type: "button", "aria-expanded": String(index === state.selectedStageIndex), "aria-label": `${stage.operator}: ${stage.summary}. ${status}.` },
    });
    trigger.disabled = !canInspectStage(state, index);
    const operator = node("span", { className: "step-operator" });
    operator.append(node("strong", { text: stage.operator }), node("span", { text: stage.id }));
    trigger.append(
      node("span", { className: "step-number", text: status === "complete" ? "✓" : String(index + 1).padStart(2, "0") }),
      operator,
      node("span", { className: "step-summary", text: stage.summary }),
      node("span", { className: "step-status", text: status }),
    );
    trigger.addEventListener("click", () => {
      state = executionReducer(state, { type: "select-stage", stageIndex: index }, plan.stages.length);
      renderPlan();
    });
    item.append(trigger);
    if (index === state.selectedStageIndex) item.append(renderStageBody(stage, status));
    elements.trace.append(item);
  });
}

function renderExecutionControls() {
  const stages = currentPlan().stages;
  const completed = state.completedStageIndex + 1;
  const done = completed === stages.length;
  elements.executionStatus.textContent = done ? `Execution complete · ${stages.length} operators` : `${completed} of ${stages.length} operators complete`;
  elements.runNext.disabled = done;
  elements.runNext.textContent = done ? "Execution complete" : `Run ${stages[completed].operator}`;
}

function renderPlan() {
  const plan = currentPlan();
  elements.expression.textContent = plan.expression;
  elements.panel.setAttribute("aria-labelledby", `tab-${state.planId}`);
  elements.tabs.forEach((tab) => {
    const selected = tab.dataset.plan === state.planId;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  renderExecutionControls();
  renderTrace();
}

function renderResults() {
  const publication = data.publicationEvaluation;
  const bestF1 = Math.max(...publication.results.map((result) => result.f1));
  const bestRecall = Math.max(...publication.results.map((result) => result.recall));
  const fragment = document.createDocumentFragment();
  publication.results.forEach((result) => {
    const row = node("tr");
    if (result.planId === "o2") row.classList.add("highlight");
    const values = [result.label, formatVideoFraction(result.videoFraction), formatFraction(result.precision), formatFraction(result.recall), formatFraction(result.f1), formatTokens(result.tokenCount), `$${result.costUsd.toFixed(3)}`, `${result.timeSeconds.toFixed(1)}s`];
    values.forEach((value, index) => {
      const cell = node("td", { text: value });
      if ((index === 3 && result.recall === bestRecall) || (index === 4 && result.f1 === bestF1)) cell.classList.add("best");
      row.append(cell);
    });
    fragment.append(row);
  });
  elements.resultsBody.replaceChildren(fragment);
  const resultByPlan = Object.fromEntries(publication.results.map((result) => [result.planId, result]));
  const o2Result = publication.results.find((result) => result.planId === "o2");
  elements.evaluationScope.textContent = publication.scopeLabel;
  elements.summaryVideo.textContent = `${formatVideoFraction(resultByPlan.baseline.videoFraction)} video`;
  elements.summaryO1.textContent = `${formatVideoFraction(resultByPlan.o1.videoFraction)} video`;
  elements.summaryO2.textContent = `${formatVideoFraction(resultByPlan.o2.videoFraction)} video`;
  elements.metricVideo.textContent = formatVideoFraction(publication.candidateMetrics.selectivity);
  elements.metricRecall.textContent = `${(publication.candidateMetrics.recall * 100).toFixed(0)}%`;
  elements.metricCost.textContent = `−${(publication.summary.costReductionFraction * 100).toFixed(1)}%`;
  elements.metricF1.textContent = formatFraction(o2Result.f1);
}

function wireInteractions() {
  elements.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      state = executionReducer(state, { type: "select-plan", planId: tab.dataset.plan }, currentPlan().stages.length);
      renderPlan();
    });
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const target = elements.tabs[(index + direction + elements.tabs.length) % elements.tabs.length];
      target.focus();
      target.click();
    });
  });
  elements.runNext.addEventListener("click", () => {
    state = executionReducer(state, { type: "run-next" }, currentPlan().stages.length);
    renderPlan();
  });
  elements.reset.addEventListener("click", () => {
    state = executionReducer(state, { type: "reset" }, currentPlan().stages.length);
    renderPlan();
  });
}

async function initialize() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = validateArtifact(await response.json());
    renderResults();
    renderPlan();
    wireInteractions();
  } catch (error) {
    elements.expression.textContent = "Recorded artifact unavailable";
    elements.executionStatus.textContent = "Unable to load the recorded execution. Reload this page to retry.";
    elements.runNext.disabled = true;
    console.error("Unable to initialize Concord demo", error);
  }
}

initialize();
