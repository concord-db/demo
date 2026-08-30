"use strict";

export function createExecutionState(planId = "o2") {
  return {
    planId,
    selectedStageIndex: 0,
    completedStageIndex: -1,
  };
}

export function stageStatus(state, stageIndex) {
  if (stageIndex <= state.completedStageIndex) return "complete";
  if (stageIndex === state.completedStageIndex + 1) return "ready";
  return "locked";
}

export function canInspectStage(state, stageIndex) {
  return stageIndex >= 0 && stageIndex <= state.completedStageIndex + 1;
}

export function executionReducer(state, action, stageCount) {
  if (!Number.isInteger(stageCount) || stageCount <= 0) {
    throw new Error("stageCount must be a positive integer");
  }

  switch (action.type) {
    case "select-plan":
      if (!action.planId) throw new Error("select-plan requires planId");
      return createExecutionState(action.planId);
    case "select-stage": {
      if (!Number.isInteger(action.stageIndex) || !canInspectStage(state, action.stageIndex)) {
        return state;
      }
      return { ...state, selectedStageIndex: action.stageIndex };
    }
    case "run-next": {
      const nextStageIndex = state.completedStageIndex + 1;
      if (nextStageIndex >= stageCount) return state;
      return {
        ...state,
        selectedStageIndex: nextStageIndex,
        completedStageIndex: nextStageIndex,
      };
    }
    case "reset":
      return createExecutionState(state.planId);
    default:
      throw new Error(`Unknown execution action: ${action.type}`);
  }
}

