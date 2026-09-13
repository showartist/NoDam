import type { SelectedVisualElement } from "../explorationRecipe/types";

export type DecisionStatus =
  | "draft"
  | "ready_for_confirmation"
  | "confirmed"
  | "superseded"
  | "stale";

export type ResolutionReadinessStatus = "ready" | "needs_answer" | "blocked";

export type AnswerType =
  | "direct_answer"
  | "selected_from_comparison"
  | "confirmed_ai_suggestion"
  | "rejected_ai_suggestion";

export interface FinalResolutionAnswer {
  field: string;
  value: string;
  answerType: AnswerType;
  answeredBy: string;
  answeredAt: string;
  evidenceUids: string[];
  note?: string;
}

export interface ResolutionReadiness {
  status: ResolutionReadinessStatus;
  unresolvedFields: string[];
  blockedReasons: string[];
  pendingHumanConfirmations: string[];
  evaluatedAt: string;
}

export interface ResolvedDecision {
  id: string;
  projectId: string;
  meetingId: string;
  sceneIds: string[];
  sourceIssueIds: string[];
  sourceExplorationRecipeIds: string[];
  sourceConsolidatedRecipeId: string;
  selectedVisualElements: SelectedVisualElement[];
  finalAnswers: FinalResolutionAnswer[];
  evidenceUids: string[];
  decisionSummary: string;
  resolvedBy: string;
  resolvedAt: string;
  version: number;
  status: DecisionStatus;
}
