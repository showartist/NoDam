import type { ResolvedDecision } from "./types";
import type { ProductionImageRecipe } from "../productionRecipe/types";

export interface StalePropagationInput {
  existingDecision: ResolvedDecision;
  existingProductionRecipe?: ProductionImageRecipe;
  changeType:
    | "issue_reopened"
    | "answer_changed"
    | "element_changed"
    | "evidence_modified"
    | "new_consolidated_version"
    | "new_decision_version";
  reason: string;
}

export interface StalePropagationResult {
  updatedDecision: ResolvedDecision;
  updatedProductionRecipe?: ProductionImageRecipe;
  isStalePropagated: boolean;
  reason: string;
}

/**
 * SPRINT 3-G — Stale Propagation Pure Engine
 */
export function propagateResolutionChange(input: StalePropagationInput): StalePropagationResult {
  const { existingDecision, existingProductionRecipe, changeType, reason } = input;

  const nextDecisionStatus = changeType === "new_decision_version" ? "superseded" : "stale";
  const updatedDecision: ResolvedDecision = {
    ...existingDecision,
    status: nextDecisionStatus,
  };

  let updatedProductionRecipe: ProductionImageRecipe | undefined = undefined;
  if (existingProductionRecipe) {
    updatedProductionRecipe = {
      ...existingProductionRecipe,
      status: "stale",
    };
  }

  return {
    updatedDecision,
    updatedProductionRecipe,
    isStalePropagated: true,
    reason: `[Stale 전파 Engine] ${changeType}: ${reason}`,
  };
}
