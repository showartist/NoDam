import type {
  ExplorationImage,
  IntegratedRecipe,
  ProductionCandidateImage,
  SelectedElement,
  SpeakerOpinion,
  VisualParameters,
} from "./types";

/**
 * 9단계 파이프라인 중 6단계: 인간이 선택한 요소들로 통합 레시피 생성
 */
export function formulateIntegratedRecipe(
  sceneNumber: number,
  selectedElements: SelectedElement[]
): IntegratedRecipe {
  if (selectedElements.length < 2) {
    throw new Error("통합 레시피 생성을 위해 최소 2개 이상의 화자별 탐색 요소가 선택되어야 합니다.");
  }

  const promptParts = selectedElements.map(
    (el) => `[${el.sourceSpeakerRole.toUpperCase()} -> ${el.category}]: ${el.selectedText}`
  );
  const compiledPrompt = `[Human-Integrated Production Recipe] Scene ${sceneNumber} — ${promptParts.join(" | ")}`;

  return {
    id: `rec_integrated_${Date.now()}`,
    sceneNumber,
    selectedElements,
    compiledPrompt,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 7단계: 통합 레시피 기반 확정 후보 이미지 생성 객체 생성
 */
export function createProductionCandidate(
  recipe: IntegratedRecipe,
  candidateNumber: number,
  imageUri: string
): ProductionCandidateImage {
  return {
    id: `prod_candidate_${recipe.id}_${candidateNumber}`,
    tier: "production_candidate",
    integratedRecipeId: recipe.id,
    candidateNumber,
    derivedPrompt: recipe.compiledPrompt,
    imageUri,
    status: "pending",
    canBeTaken: true,
    createdAt: new Date().toISOString(),
  };
}
