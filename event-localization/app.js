"use strict";

import { canInspectStage, createExecutionState, executionReducer, stageStatus } from "./execution-state.js";
import { validateArtifact } from "./artifact-schema.js";

const EXAMPLES = {
  lecture: "./data/lecture-event-localization-v3.json",
  soccer: "./data/soccer-event-localization-v3.json",
};

let state = createExecutionState("o2");
let selectedExampleId = "lecture";
let selectedClipId = null;
let data = null;
const artifacts = new Map();
const loadErrors = new Map();
const mediaCache = { sourcePlayer: null, candidateVideo: null, clipId: null };

const elements = {
  examples: [...document.querySelectorAll("[data-example]")],
  tabs: [...document.querySelectorAll("[data-plan]")],
  title: document.querySelector("#example-title"),
  query: document.querySelector("#example-query"),
  panel: document.querySelector("#plan-panel"),
  expression: document.querySelector("#plan-expression"),
  trace: document.querySelector("#operator-trace"),
  executionStatus: document.querySelector("#execution-status"),
  runNext: document.querySelector("#run-next-stage"),
  reset: document.querySelector("#reset-plan"),
  resultsTitle: document.querySelector("#results-title"),
  resultsCaption: document.querySelector("#results-caption"),
  resultsBody: document.querySelector("#results-body"),
  evaluationScope: document.querySelector("#evaluation-scope"),
  traceScope: document.querySelector("#trace-scope"),
  summaryVideo: document.querySelector("#summary-baseline-video"),
  summaryO1: document.querySelector("#summary-o1-video"),
  summaryO2: document.querySelector("#summary-o2-video"),
  metricVideo: document.querySelector("#metric-video"),
  metricVideoNote: document.querySelector("#metric-video-note"),
  metricRecall: document.querySelector("#metric-recall"),
  metricRecallNote: document.querySelector("#metric-recall-note"),
  metricCost: document.querySelector("#metric-cost"),
  metricF1: document.querySelector("#metric-f1"),
  metricF1Note: document.querySelector("#metric-f1-note"),
};

function node(tagName, options = {}) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes || {})) element.setAttribute(name, value);
  return element;
}

function currentPlan() { return data.trace.plans[state.planId]; }
function currentClip() { return data.trace.materializedClips.find((clip) => clip.clipId === selectedClipId); }
function windowForClip(clip) { return data.trace.candidateWindows.find((window) => window.windowId === clip.windowId); }
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
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secondText}` : `${minutes}:${secondText}`;
}

function eventTime(event) { return event.eventKind === "point" ? event.timeSeconds : event.startSeconds; }
function eventEnd(event) { return event.eventKind === "point" ? event.timeSeconds : event.endSeconds; }
function formatEvent(event, offset = 0) {
  if (event.eventKind === "point") return formatClock(event.timeSeconds - offset, true);
  return `${formatClock(event.startSeconds - offset, true)}–${formatClock(event.endSeconds - offset, true)}`;
}

function list(items) {
  const result = node("ul");
  for (const item of items) result.append(node("li", { text: item }));
  return result;
}

function contractCard(label, items, pending = false) {
  const card = node("section", { className: "contract-card" });
  card.append(node("span", { text: label }));
  card.append(pending ? node("p", { className: "artifact-note", text: "Available after this operator executes." }) : list(items));
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

function releaseMedia() {
  if (mediaCache.candidateVideo) {
    mediaCache.candidateVideo.pause();
    mediaCache.candidateVideo.removeAttribute("src");
    mediaCache.candidateVideo.load();
  }
  if (mediaCache.sourcePlayer) {
    const iframe = mediaCache.sourcePlayer.querySelector("iframe");
    if (iframe) iframe.src = "about:blank";
  }
  mediaCache.sourcePlayer = null;
  mediaCache.candidateVideo = null;
  mediaCache.clipId = null;
}

function createSourcePlayer() {
  if (mediaCache.sourcePlayer) return mediaCache.sourcePlayer;
  const { source } = data.trace;
  if (source.media.kind === "unavailable") {
    mediaCache.sourcePlayer = node("div", { className: "source-unavailable", text: source.media.reason });
    return mediaCache.sourcePlayer;
  }
  const player = node("div", { className: "source-player", attributes: { "data-media-kind": "youtube" } });
  const facade = node("div", { className: "source-facade" });
  facade.style.backgroundImage = `url("${source.media.thumbnailUrl}")`;
  const copy = node("div");
  copy.append(
    node("span", { text: `Complete source ${data.example.sourceTypeLabel} · ${formatClock(source.durationSeconds)}` }),
    node("strong", { text: source.title }),
  );
  const load = node("button", { className: "button", text: `Load full ${data.example.sourceTypeLabel}`, attributes: { type: "button" } });
  load.addEventListener("click", () => {
    const iframe = node("iframe", { attributes: {
      src: `https://www.youtube-nocookie.com/embed/${source.media.youtubeId}?rel=0`,
      title: `Full source video: ${source.title}`,
      allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      allowfullscreen: "", referrerpolicy: "strict-origin-when-cross-origin",
    } });
    player.replaceChildren(iframe);
  });
  copy.append(load);
  facade.append(copy);
  player.append(facade);
  mediaCache.sourcePlayer = player;
  return player;
}

function renderSourceMedia() {
  const { source } = data.trace;
  const panel = artifactPanel("Input media", data.example.sourceArtifactTitle, true);
  panel.append(createSourcePlayer());
  const note = node("p", { className: "media-credit" });
  if (source.media.kind === "youtube") {
    note.append("This is the complete input—not a candidate excerpt. ", node("a", {
      text: "Open the source page ↗", attributes: { href: source.media.pageUrl, target: "_blank", rel: "noreferrer" },
    }));
  } else {
    note.textContent = "The trace retains authentic source timestamps and operator outputs without redistributing the source broadcast.";
  }
  panel.append(note);
  return panel;
}

function renderTranscriptAvailability() {
  const panel = artifactPanel("Input relation", "Source-aligned transcript");
  panel.append(node("p", { className: "artifact-note", text: `${data.trace.transcriptSegments.length} timestamped segments are shown across the retained neighborhoods. The transcript was materialized before query execution.` }));
  return panel;
}

function segmentOverlapsEvent(segment, event) {
  return segment.startSeconds <= eventEnd(event) && segment.endSeconds >= eventTime(event);
}

function renderTranscript(stageId) {
  const { candidateWindows, transcriptSegments } = data.trace;
  const panel = artifactPanel("Source-aligned representation", "Transcript evidence", true);
  const showCandidate = stageId === "candidate";
  const rationale = node("div", { className: "candidate-rationale" });
  rationale.textContent = showCandidate
    ? `Candidate evidence (${candidateWindows.length}): ${candidateWindows.map((window) => `“${window.evidence}”`).join(" · ")}`
    : "Each segment carries start and end timestamps on the source-video timeline.";
  panel.append(rationale);
  const scroll = node("div", { className: "transcript-scroll" });
  for (const segment of transcriptSegments) {
    const row = node("div", { className: "transcript-segment" });
    if (showCandidate && candidateWindows.some((window) => segment.segmentId >= window.startSegmentId && segment.segmentId <= window.endSegmentId)) row.classList.add("candidate");
    if (state.planId === "o1" && stageId === "transcript-localize" && currentPlan().predictions.some((prediction) => segmentOverlapsEvent(segment, prediction))) row.classList.add("prediction");
    row.append(node("time", { text: formatClock(segment.startSeconds) }), node("span", { text: segment.text }));
    scroll.append(row);
  }
  panel.append(scroll);
  return panel;
}

function renderTimeline(kind) {
  const { source, candidateWindows } = data.trace;
  const unpadded = kind === "candidateRange";
  const title = unpadded ? "Transcript-derived candidates" : kind === "resolvedTimeline" ? "Resolved retained windows" : "Padded source windows";
  const panel = artifactPanel("Source-time ranges", title, true);
  const sourceView = node("div", { className: "source-view" });
  const header = node("div", { className: "source-view-header" });
  const copy = node("div");
  copy.append(node("span", { text: "Complete source timeline" }), node("strong", { text: source.title }));
  header.append(copy, node("strong", { text: `${candidateWindows.length} ${candidateWindows.length === 1 ? "range" : "ranges"}` }));
  const labels = node("div", { className: "timeline-labels" });
  labels.append(node("span", { text: "0:00" }), node("span", { text: formatClock(source.durationSeconds) }));
  const timeline = node("div", { className: "timeline", attributes: { "aria-label": title } });
  timeline.append(node("div", { className: "timeline-track" }));
  for (const candidate of candidateWindows) {
    const start = unpadded ? candidate.unpaddedStartSeconds : candidate.startSeconds;
    const end = unpadded ? candidate.unpaddedEndSeconds : candidate.endSeconds;
    const window = node("div", { className: `timeline-window${unpadded ? " unpadded" : ""}`, attributes: { title: `${formatClock(start, true)}–${formatClock(end, true)}` } });
    window.style.left = percent(start, source.durationSeconds);
    window.style.width = percent(end - start, source.durationSeconds);
    timeline.append(window);
  }
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
  const { source, materializedClips } = data.trace;
  const clips = state.planId === "baseline" ? [{ sourceStartSeconds: 0, sourceEndSeconds: source.durationSeconds }] : materializedClips;
  const panel = artifactPanel("Video extent presented to the MLLM", `${formatVideoFraction(fraction)} of source video`, true);
  const meter = node("div", { className: "retained-meter" });
  const header = node("div", { className: "retained-meter-header" });
  header.append(node("span", { text: state.planId === "baseline" ? `Complete ${data.example.sourceTypeLabel}` : `${clips.length} materialized candidate ${clips.length === 1 ? "window" : "windows"}` }), node("strong", { text: formatVideoFraction(fraction) }));
  const track = node("div", { className: "retained-meter-track" });
  for (const clip of clips) {
    const fill = node("div", { className: "retained-meter-fill", attributes: { title: `${formatClock(clip.sourceStartSeconds, true)}–${formatClock(clip.sourceEndSeconds, true)}` } });
    fill.style.left = percent(clip.sourceStartSeconds, source.durationSeconds);
    fill.style.width = percent(clip.sourceEndSeconds - clip.sourceStartSeconds, source.durationSeconds);
    track.append(fill);
  }
  const axis = node("div", { className: "retained-meter-axis" });
  axis.append(node("span", { text: "0:00" }), node("span", { text: formatClock(source.durationSeconds) }));
  meter.append(header, track, axis);
  panel.append(meter);
  return panel;
}

function candidateVideo(clip) {
  if (clip.kind !== "file") return null;
  if (mediaCache.candidateVideo && mediaCache.clipId === clip.clipId) return mediaCache.candidateVideo;
  releaseMedia();
  const video = node("video", { attributes: { controls: "", preload: "metadata", src: clip.url } });
  video.textContent = "Your browser does not support HTML video.";
  mediaCache.candidateVideo = video;
  mediaCache.clipId = clip.clipId;
  return video;
}

function seekToPrediction(prediction) {
  const clip = data.trace.materializedClips.find((item) => item.clipId === prediction.clipId);
  if (!clip || clip.kind !== "file") return;
  if (selectedClipId !== clip.clipId) {
    selectedClipId = clip.clipId;
    renderPlan();
  }
  const video = candidateVideo(clip);
  const clipTime = Math.max(0, eventTime(prediction) - clip.sourceStartSeconds);
  video.currentTime = Math.min(clipTime, video.duration || clipTime);
  video.play().catch(() => {});
}

function renderClipSelector() {
  const selector = node("div", { className: "clip-selector", attributes: { "aria-label": "Materialized clips" } });
  data.trace.materializedClips.forEach((clip, index) => {
    const button = node("button", { text: `Clip ${index + 1} · ${formatClock(clip.sourceStartSeconds, true)}`, attributes: { type: "button", "aria-pressed": String(clip.clipId === selectedClipId) } });
    button.addEventListener("click", () => {
      if (selectedClipId === clip.clipId) return;
      releaseMedia();
      selectedClipId = clip.clipId;
      renderPlan();
    });
    selector.append(button);
  });
  return selector;
}

function renderPredictionTimeline(clip) {
  const timeline = node("div", { className: "detail-timeline", attributes: { "aria-label": "Clip-level prediction timeline" } });
  const predictions = currentPlan().predictions.filter((prediction) => prediction.clipId === clip.clipId);
  predictions.forEach((prediction, index) => {
    const marker = node("button", { className: `detail-marker prediction${prediction.eventKind === "point" ? " point" : ""}`, attributes: { type: "button", "aria-label": `Seek to prediction ${index + 1}`, title: `Prediction ${index + 1}` } });
    marker.style.left = percent(eventTime(prediction) - clip.sourceStartSeconds, clip.expectedDurationSeconds);
    marker.style.width = prediction.eventKind === "point" ? "4px" : percent(prediction.endSeconds - prediction.startSeconds, clip.expectedDurationSeconds);
    marker.addEventListener("click", () => seekToPrediction(prediction));
    timeline.append(marker);
  });
  return timeline;
}

function renderMaterializedClip(showPredictions) {
  const clip = currentClip();
  const panel = artifactPanel("Materialized View", "Candidate clip", true);
  if (data.trace.materializedClips.length > 1) panel.append(renderClipSelector());
  panel.querySelector(".artifact-heading").append(node("strong", { text: `${formatClock(clip.sourceStartSeconds, true)}–${formatClock(clip.sourceEndSeconds, true)}` }));
  const frame = node("div", { className: "video-frame" });
  if (clip.kind === "file") {
    const fallback = node("div", { className: "media-fallback", text: "The materialized clip could not be loaded. Timeline and output records remain available.", attributes: { hidden: "" } });
    const video = candidateVideo(clip);
    video.addEventListener("error", () => { fallback.hidden = false; }, { once: true });
    video.addEventListener("loadedmetadata", () => { fallback.hidden = true; }, { once: true });
    frame.append(video, fallback);
  } else {
    frame.append(node("div", { className: "media-fallback", text: clip.reason }));
  }
  panel.append(frame);
  if (showPredictions) panel.append(renderPredictionTimeline(clip));
  panel.append(node("p", { className: "media-credit", text: "The clip retains its source-video boundaries; clip-relative outputs are mapped back to the original source timeline." }));
  return panel;
}

function predictionCards({ output = false } = {}) {
  const panel = artifactPanel(output ? "Query output" : "Semantic-function output", output ? "Source-time event records" : "Localized occurrences", true);
  const cards = node("div", { className: "prediction-list" });
  currentPlan().predictions.forEach((prediction, index) => {
    const card = node("article", { className: "prediction-card" });
    const clip = prediction.clipId ? data.trace.materializedClips.find((item) => item.clipId === prediction.clipId) : null;
    const isClipRelative = state.planId === "o2" && !output && clip;
    const isSeekable = isClipRelative && clip.kind === "file";
    const content = isSeekable
      ? node("button", { className: "prediction-card-content", attributes: { type: "button", "aria-label": `Play event ${index + 1} in its materialized clip` } })
      : node("div", { className: "prediction-card-content" });
    const offset = isClipRelative ? clip.sourceStartSeconds : 0;
    content.append(
      node("span", { text: output ? `Output tuple ${String(index + 1).padStart(2, "0")}` : `Event ${String(index + 1).padStart(2, "0")}` }),
      node("strong", { text: `${formatEvent(prediction, offset)}${isClipRelative ? " clip time" : " source time"}` }),
      node("p", { text: prediction.evidence }),
    );
    if (isSeekable) content.addEventListener("click", () => seekToPrediction(prediction));
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
  body.append(status === "complete" ? renderArtifacts(stage) : node("div", { className: "empty-artifact", text: `Run ${stage.operator} to reveal this operator’s output.` }));
  return body;
}

function renderTrace() {
  const plan = currentPlan();
  elements.trace.replaceChildren();
  plan.stages.forEach((stage, index) => {
    const status = stageStatus(state, index);
    const item = node("li", { className: `operator-step${index === state.selectedStageIndex ? " is-selected" : ""}`, attributes: { "data-stage-id": stage.id, "data-status": status } });
    const trigger = node("button", { className: "step-trigger", attributes: { type: "button", "aria-expanded": String(index === state.selectedStageIndex), "aria-label": `${stage.operator}: ${stage.summary}. ${status}.` } });
    trigger.disabled = !canInspectStage(state, index);
    const operator = node("span", { className: "step-operator" });
    operator.append(node("strong", { text: stage.operator }), node("span", { text: stage.id }));
    trigger.append(node("span", { className: "step-number", text: status === "complete" ? "✓" : String(index + 1).padStart(2, "0") }), operator, node("span", { className: "step-summary", text: stage.summary }), node("span", { className: "step-status", text: status }));
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
  releaseMedia();
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
  const o2Result = resultByPlan.o2;
  elements.title.textContent = data.example.title;
  elements.query.textContent = data.trace.query.text;
  elements.resultsTitle.textContent = data.example.resultsTitle;
  elements.resultsCaption.textContent = data.example.resultsCaption;
  elements.evaluationScope.textContent = publication.scopeLabel;
  elements.traceScope.textContent = data.example.traceScope;
  elements.summaryVideo.textContent = `${formatVideoFraction(resultByPlan.baseline.videoFraction)} video`;
  elements.summaryO1.textContent = `${formatVideoFraction(resultByPlan.o1.videoFraction)} video`;
  elements.summaryO2.textContent = `${formatVideoFraction(resultByPlan.o2.videoFraction)} video`;
  elements.metricVideo.textContent = formatVideoFraction(publication.candidateMetrics.selectivity);
  elements.metricVideoNote.textContent = `O2 ${data.example.sourceTypeLabel} query`;
  elements.metricRecall.textContent = `${(publication.candidateMetrics.recall * 100).toFixed(0)}%`;
  elements.metricRecallNote.textContent = data.example.candidateCoverageLabel;
  elements.metricCost.textContent = `−${(publication.summary.costReductionFraction * 100).toFixed(1)}%`;
  elements.metricF1.textContent = formatFraction(o2Result.f1);
  elements.metricF1Note.textContent = data.example.primaryMetricLabel;
}

function selectExample(exampleId) {
  if (!artifacts.has(exampleId) || exampleId === selectedExampleId) return;
  releaseMedia();
  selectedExampleId = exampleId;
  data = artifacts.get(exampleId);
  selectedClipId = data.trace.materializedClips[0].clipId;
  state = createExecutionState(state.planId);
  elements.examples.forEach((button) => {
    const selected = button.dataset.example === selectedExampleId;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  renderResults();
  renderPlan();
}

function wireInteractions() {
  elements.examples.forEach((button, index) => {
    button.addEventListener("click", () => selectExample(button.dataset.example));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const target = elements.examples[(index + direction + elements.examples.length) % elements.examples.length];
      target.focus();
      target.click();
    });
  });
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
  const entries = Object.entries(EXAMPLES);
  const results = await Promise.allSettled(entries.map(async ([exampleId, url]) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${exampleId}: HTTP ${response.status}`);
    return [exampleId, validateArtifact(await response.json())];
  }));
  results.forEach((result, index) => {
    const exampleId = entries[index][0];
    if (result.status === "fulfilled") artifacts.set(...result.value);
    else loadErrors.set(exampleId, result.reason);
  });
  elements.examples.forEach((button) => {
    if (!artifacts.has(button.dataset.example)) {
      button.disabled = true;
      button.title = "This example artifact could not be loaded";
    }
  });
  const initialId = artifacts.has(selectedExampleId) ? selectedExampleId : artifacts.keys().next().value;
  if (!initialId) {
    elements.expression.textContent = "Example artifacts unavailable";
    elements.executionStatus.textContent = "Unable to load either example. Reload this page to retry.";
    elements.runNext.disabled = true;
    console.error("Unable to initialize Concord examples", Object.fromEntries(loadErrors));
    return;
  }
  selectedExampleId = initialId;
  data = artifacts.get(initialId);
  selectedClipId = data.trace.materializedClips[0].clipId;
  wireInteractions();
  renderResults();
  renderPlan();
}

initialize();
