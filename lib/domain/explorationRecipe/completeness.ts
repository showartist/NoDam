import type { ParticipantExplorationRecipe, RecipeCompletenessCheck, CompletenessStatus } from "./types";

/**
 * SPRINT 2-B — Recipe Completeness & Quality Check
 */
export function checkRecipeCompleteness(recipe: ParticipantExplorationRecipe): RecipeCompletenessCheck {
  const missingRequiredFields: string[] = [];
  const conflictingFields: { field: string; reason: string }[] = [];

  if (!recipe.subjectPresence) missingRequiredFields.push("subjectPresence (인물 존재 여부)");
  if (!recipe.environment) missingRequiredFields.push("environment (공간 정보)");
  if (!recipe.composition) missingRequiredFields.push("composition (구도)");

  // Check conflicting values
  if (
    recipe.subjectPresence?.includes("인물 부재") &&
    recipe.subjectPlacement?.includes("인물 배치")
  ) {
    conflictingFields.push({
      field: "subjectPresence vs subjectPlacement",
      reason: "인물 부재로 설정되었으나 인물 배치가 동시에 기술되어 상충합니다.",
    });
  }

  let status: CompletenessStatus = "ready";
  if (conflictingFields.length > 0) {
    status = "blocked";
  } else if (missingRequiredFields.length > 0) {
    status = "needs_review";
  }

  return {
    recipeId: recipe.id,
    status,
    missingRequiredFields,
    conflictingFields,
    aiSuggestedFieldsCount: recipe.aiSuggestedFields.length,
    evaluatedAt: new Date().toISOString(),
  };
}
