import type { AlignmentIssue, IssueStatus } from "./types";
import type { SelectedElement, IntegratedRecipe } from "../visualSynthesis/types";
import { formulateIntegratedRecipe } from "../visualSynthesis/pipeline";

export interface ResolvedDecision {
  id: string;
  projectId: string;
  sceneIds: string[];
  resolvedIssueIds: string[];
  selectedVisualElements: SelectedElement[];
  integratedRecipe: IntegratedRecipe;
  resolvedBy: string;
  resolvedAt: string;
}

/**
 * PHASE G — Resolved Decision Engine
 * Blocking issue 들이 모두 해결되고 인간이 요소를 선택하면 Production Candidate 로 전환 가능한 상태로 승격
 */
export function resolveAlignmentIssues(
  projectId: string,
  sceneNumber: number,
  issues: AlignmentIssue[],
  selectedElements: SelectedElement[],
  resolvedBy: string
): { resolvedDecision: ResolvedDecision; updatedIssues: AlignmentIssue[] } {
  const blockingIssues = issues.filter((i) => i.severity === "blocking" && i.status !== "resolved");

  // Mark resolved issues
  const updatedIssues = issues.map((issue) => {
    if (issue.severity === "blocking" || issue.severity === "comparison_recommended") {
      return { ...issue, status: "resolved" as IssueStatus };
    }
    return issue;
  });

  const integratedRecipe = formulateIntegratedRecipe(sceneNumber, selectedElements);

  const resolvedDecision: ResolvedDecision = {
    id: `decision_resolved_${Date.now()}`,
    projectId,
    sceneIds: [String(sceneNumber)],
    resolvedIssueIds: issues.map((i) => i.id),
    selectedVisualElements: selectedElements,
    integratedRecipe,
    resolvedBy,
    resolvedAt: new Date().toISOString(),
  };

  return { resolvedDecision, updatedIssues };
}
