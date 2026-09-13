import type { ConsolidatedExplorationRecipe, ParticipantExplorationRecipe, SelectedVisualElement } from "./types";

export class BlockingIssueUnresolvedError extends Error {
  constructor(issueId: string) {
    super(`[Production Candidate 생성 거부] Blocking Issue (${issueId})가 해결되지 않은 상태에서는 Production Candidate 를 생성할 수 없습니다.`);
    this.name = "BlockingIssueUnresolvedError";
  }
}

const REQUIRED_CATEGORIES: SelectedVisualElement["category"][] = [
  "composition",
  "subjectPresence",
  "lighting",
  "colorIntent",
  "environment",
];

/**
 * SPRINT 2-F — Consolidated Exploration Recipe Generator
 */
export function createConsolidatedExplorationRecipe(
  sourceIssueId: string,
  sourceRecipes: ParticipantExplorationRecipe[],
  selectedElements: SelectedVisualElement[],
  createdBy: string,
  version: number = 1
): ConsolidatedExplorationRecipe {
  const sourceRecipeIds = sourceRecipes.map((r) => r.id);
  const evidenceUids = Array.from(new Set(selectedElements.flatMap((el) => el.evidenceUids)));

  const selectedCategories = new Set(selectedElements.map((el) => el.category));
  const unresolvedFields = REQUIRED_CATEGORIES.filter((cat) => !selectedCategories.has(cat));

  const promptParts = selectedElements.map(
    (el) => `[${el.sourceParticipantRole.toUpperCase()} -> ${el.category}]: ${el.selectedValue}`
  );
  const compiledPrompt = `[Consolidated Exploration Recipe v${version}] ${promptParts.join(" | ")}`;

  // Strict Rule: Allow ready_for_resolution ONLY when all required elements are selected!
  const status: "draft" | "needs_review" | "ready_for_resolution" =
    unresolvedFields.length > 0 ? "needs_review" : "ready_for_resolution";

  return {
    id: `recipe_consolidated_${sourceIssueId}_v${version}`,
    sourceIssueId,
    sourceRecipeIds,
    selectedVisualElements: selectedElements,
    unresolvedFields,
    evidenceUids,
    compiledPrompt,
    createdBy,
    createdAt: new Date().toISOString(),
    version,
    status,
    canBeTaken: false, // Consolidated Recipe도 승인 전까지 TAKE 불가
  };
}
