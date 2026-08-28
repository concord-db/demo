"use strict";

const DATA_URL = "./data/event-localization-v1.json";

const state = {
  data: null,
  planId: "o2",
  stageIndex: 0,
};

const elements = {
  tabs: [...document.querySelectorAll("[data-plan]")],
  panel: document.querySelector("#plan-panel"),
  expression: document.querySelector("#plan-expression"),
  stageList: document.querySelector("#stage-list"),
  stageTitle: document.querySelector("#stage-title"),
  stageDescription: document.querySelector("#stage-description"),
  previous: document.querySelector("#previous-stage"),
  next: document.querySelector("#next-stage"),
  replay: document.querySelector("#replay-plan"),
  processedDuration: document.querySelector("#processed-duration"),
  candidateWindow: document.querySelector("#candidate-window"),
  eventMarkers: [document.querySelector(".event-one"), document.querySelector(".event-two")],
  transcriptPanel: document.querySelector("#transcript-panel"),
  transcriptSegments: document.querySelector("#transcript-segments"),
  transcriptCount: document.querySelector("#transcript-count"),
  candidateRationale: document.querySelector("#candidate-rationale"),
  videoPanel: document.querySelector("#video-panel"),
  videoHeading: document.querySelector("#video-heading"),
  candidateVideo: document.querySelector("#candidate-video"),
  mediaFallback: document.querySelector("#media-fallback"),
  clipRange: document.querySelector("#clip-range"),
  detailTimeline: document.querySelector("#detail-timeline"),
  predictionList: document.querySelector("#prediction-list"),
  predictionCount: document.querySelector("#prediction-count"),
  resultsBody: document.querySelector("#results-body"),
  summaryVideo: document.querySelector("#summary-baseline-video"),
  summaryO1: document.querySelector("#summary-o1-video"),
  summaryO2: document.querySelector("#summary-o2-video"),
  metricVideo: document.querySelector("#metric-video"),
  metricRecall: document.querySelector("#metric-recall"),
  metricCost: document.querySelector("#metric-cost"),
  metricF1: document.querySelector("#metric-f1"),
};

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateData(data) {
  if (data.schemaVersion !== 1) throw new Error("Unsupported artifact schema");
  requireFinite(data.source.durationSeconds, "source duration");
  if (data.source.durationSeconds <= 0) throw new Error("Source duration must be positive");
  for (const [label, interval] of [
    ["candidate", data.candidate],
    ...data.referenceEvents.map((event, index) => [`reference event ${index}`, event]),
  ]) {
    requireFinite(interval.startSeconds, `${label} start`);
    requireFinite(interval.endSeconds, `${label} end`);
    if (interval.startSeconds < 0 || interval.endSeconds <= interval.startSeconds || interval.endSeconds > data.source.durationSeconds) {
      throw new Error(`${label} lies outside the source timeline`);
    }
  }
  for (const planId of ["baseline", "o1", "o2"]) {
    const plan = data.plans[planId];
    if (!plan || !Array.isArray(plan.stages) || !Array.isArray(plan.predictions)) {
      throw new Error(`Plan ${planId} is incomplete`);
    }
  }
}

function percent(value, total) {
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

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

function formatFraction(value, digits = 3) {
  return value.toFixed(digits).replace(/^0/, "");
}

function formatVideoFraction(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatTokens(value) {
  return `${(value / 1_000_000).toFixed(3)}M`;
}

function currentPlan() {
  return state.data.plans[state.planId];
}

function renderSourceTimeline() {
  const { source, candidate, referenceEvents } = state.data;
  const plan = currentPlan();
  const processesVideo = plan.videoFraction > 0;
  const start = state.planId === "baseline" ? 0 : candidate.startSeconds;
  const end = state.planId === "baseline" ? source.durationSeconds : candidate.endSeconds;

  elements.candidateWindow.hidden = !processesVideo;
  elements.candidateWindow.style.left = percent(start, source.durationSeconds);
  elements.candidateWindow.style.width = percent(end - start, source.durationSeconds);
  elements.processedDuration.textContent = processesVideo
    ? `${formatVideoFraction(plan.videoFraction)} of source video processed`
    : "No video processed";

  elements.eventMarkers.forEach((element, index) => {
    element.style.left = percent(referenceEvents[index].startSeconds, source.durationSeconds);
  });
}

function renderStages() {
  const plan = currentPlan();
  elements.stageList.replaceChildren();

  plan.stages.forEach((stage, index) => {
    const item = document.createElement("li");
    item.dataset.index = String(index + 1).padStart(2, "0");
    item.classList.toggle("active", index === state.stageIndex);
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.setAttribute("aria-label", `${stage.title}: ${stage.summary}`);
    item.innerHTML = `<strong>${stage.title}</strong><small>${stage.summary}</small>`;
    const selectStage = () => {
      state.stageIndex = index;
      renderPlan();
    };
    item.addEventListener("click", selectStage);
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectStage();
      }
    });
    elements.stageList.append(item);
  });

  const activeStage = plan.stages[state.stageIndex];
  elements.stageTitle.textContent = activeStage.title;
  elements.stageDescription.textContent = activeStage.description;
  elements.previous.disabled = state.stageIndex === 0;
  elements.next.disabled = state.stageIndex === plan.stages.length - 1;
}

function renderTranscript() {
  const { candidate, transcriptSegments } = state.data;
  const showTranscript = state.planId !== "baseline";
  elements.transcriptPanel.classList.toggle("is-inactive", !showTranscript);
  if (!showTranscript) return;

  elements.transcriptCount.textContent = `${transcriptSegments.length} segments`;
  elements.candidateRationale.textContent = `Candidate evidence: “${candidate.evidence}”`;
  const o1Prediction = state.data.plans.o1.predictions[0];
  const fragment = document.createDocumentFragment();

  transcriptSegments.forEach((segment) => {
    const row = document.createElement("div");
    row.className = "transcript-segment";
    row.classList.toggle("candidate", segment.segmentId >= candidate.startSegmentId && segment.segmentId <= candidate.endSegmentId);
    row.classList.toggle(
      "prediction",
      state.planId === "o1"
      && segment.segmentId >= o1Prediction.startSegmentId
      && segment.segmentId <= o1Prediction.endSegmentId,
    );
    row.innerHTML = `<time>${formatClock(segment.startSeconds)}</time><span>${segment.text}</span>`;
    fragment.append(row);
  });
  elements.transcriptSegments.replaceChildren(fragment);
}

function seekToSourceTime(sourceSeconds) {
  const clipTime = Math.max(0, sourceSeconds - state.data.media.sourceStartSeconds);
  elements.candidateVideo.currentTime = Math.min(clipTime, elements.candidateVideo.duration || clipTime);
}

function renderDetailTimeline() {
  const { candidate, referenceEvents } = state.data;
  const predictions = currentPlan().predictions;
  elements.detailTimeline.replaceChildren();

  referenceEvents.forEach((event) => {
    const marker = document.createElement("span");
    marker.className = "detail-marker reference";
    marker.style.left = percent(event.startSeconds - candidate.startSeconds, candidate.durationSeconds);
    marker.style.width = percent(event.endSeconds - event.startSeconds, candidate.durationSeconds);
    marker.title = `Reference ${formatClock(event.startSeconds, true)}–${formatClock(event.endSeconds, true)}`;
    elements.detailTimeline.append(marker);
  });

  predictions.forEach((prediction, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "detail-marker prediction";
    marker.style.left = percent(prediction.startSeconds - candidate.startSeconds, candidate.durationSeconds);
    marker.style.width = percent(prediction.endSeconds - prediction.startSeconds, candidate.durationSeconds);
    marker.setAttribute("aria-label", `Seek to prediction ${index + 1} at ${formatClock(prediction.startSeconds, true)}`);
    marker.title = `Prediction ${index + 1}`;
    marker.addEventListener("click", () => seekToSourceTime(prediction.startSeconds));
    elements.detailTimeline.append(marker);
  });
}

function renderPredictions() {
  const predictions = currentPlan().predictions;
  elements.predictionCount.textContent = `${predictions.length} record${predictions.length === 1 ? "" : "s"}`;
  const fragment = document.createDocumentFragment();
  predictions.forEach((prediction, index) => {
    const card = document.createElement("article");
    card.className = "prediction-card";
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = `
      <span>Event ${String(index + 1).padStart(2, "0")}</span>
      <strong>${formatClock(prediction.startSeconds, true)}–${formatClock(prediction.endSeconds, true)}</strong>
      <p>${prediction.evidence}</p>`;
    button.addEventListener("click", () => {
      if (state.planId !== "o1") seekToSourceTime(prediction.startSeconds);
    });
    card.append(button);
    fragment.append(card);
  });
  elements.predictionList.replaceChildren(fragment);
}

function renderEvidence() {
  const { candidate, media } = state.data;
  const showVideo = state.planId !== "o1";
  elements.videoPanel.classList.toggle("is-inactive", !showVideo);
  elements.videoPanel.classList.toggle("is-wide", state.planId === "baseline");
  elements.transcriptPanel.classList.toggle("is-wide", state.planId === "o1");
  elements.videoHeading.textContent = state.planId === "baseline" ? "Representative source excerpt" : "Candidate clip";
  elements.clipRange.textContent = `${formatClock(candidate.startSeconds, true)}–${formatClock(candidate.endSeconds, true)}`;
  renderTranscript();
  renderPredictions();
  if (showVideo) renderDetailTimeline();
  if (elements.candidateVideo.getAttribute("src") !== media.url) {
    elements.candidateVideo.src = media.url;
  }
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
  renderStages();
  renderSourceTimeline();
  renderEvidence();
}

function renderResults() {
  const bestF1 = Math.max(...state.data.results.map((result) => result.f1));
  const bestRecall = Math.max(...state.data.results.map((result) => result.recall));
  const fragment = document.createDocumentFragment();
  state.data.results.forEach((result) => {
    const row = document.createElement("tr");
    row.classList.toggle("highlight", result.planId === "o2");
    row.innerHTML = `
      <td>${result.label}</td>
      <td>${formatVideoFraction(result.videoFraction)}</td>
      <td>${formatFraction(result.precision)}</td>
      <td class="${result.recall === bestRecall ? "best" : ""}">${formatFraction(result.recall)}</td>
      <td class="${result.f1 === bestF1 ? "best" : ""}">${formatFraction(result.f1)}</td>
      <td>${formatTokens(result.tokenCount)}</td>
      <td>$${result.costUsd.toFixed(3)}</td>
      <td>${result.timeSeconds.toFixed(1)}s</td>`;
    fragment.append(row);
  });
  elements.resultsBody.replaceChildren(fragment);

  const { summary, plans } = state.data;
  const o2Result = state.data.results.find((result) => result.planId === "o2");
  elements.summaryVideo.textContent = `${formatVideoFraction(plans.baseline.videoFraction)} video`;
  elements.summaryO1.textContent = `${formatVideoFraction(plans.o1.videoFraction)} video`;
  elements.summaryO2.textContent = `${formatVideoFraction(plans.o2.videoFraction)} video`;
  elements.metricVideo.textContent = formatVideoFraction(summary.candidateSelectivity);
  elements.metricRecall.textContent = `${(summary.candidateRecall * 100).toFixed(0)}%`;
  elements.metricCost.textContent = `−${(summary.costReductionFraction * 100).toFixed(1)}%`;
  elements.metricF1.textContent = formatFraction(o2Result.f1);
}

function wireInteractions() {
  elements.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      state.planId = tab.dataset.plan;
      state.stageIndex = 0;
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
  elements.previous.addEventListener("click", () => {
    state.stageIndex = Math.max(0, state.stageIndex - 1);
    renderPlan();
  });
  elements.next.addEventListener("click", () => {
    state.stageIndex = Math.min(currentPlan().stages.length - 1, state.stageIndex + 1);
    renderPlan();
  });
  elements.replay.addEventListener("click", () => {
    state.stageIndex = 0;
    renderPlan();
  });
  elements.candidateVideo.addEventListener("error", () => {
    elements.mediaFallback.hidden = false;
  });
  elements.candidateVideo.addEventListener("loadedmetadata", () => {
    elements.mediaFallback.hidden = true;
  });
}

async function initialize() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    validateData(state.data);
    renderResults();
    renderPlan();
    wireInteractions();
  } catch (error) {
    elements.expression.textContent = "Recorded artifact unavailable";
    elements.stageTitle.textContent = "Unable to load the replay";
    elements.stageDescription.textContent = "The publication results remain available in the paper. Reload this page to retry the recorded artifact.";
    console.error("Unable to initialize Concord demo", error);
  }
}

initialize();
