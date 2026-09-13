import type { ImageRecipe, ProviderType } from "./types";

/**
 * 대표님의 자동 추천 규칙:
 * 1. 기존 이미지 부분 수정 (isRefinementOfImageId 존재) → FLUX.2 Pro
 * 2. Character Visual / Reference 가 많은 경우 (2개 이상) → Gemini 3.1 Flash Image
 * 3. 최초 생성, 복잡한 required/prohibited 지시 → GPT Image 2 (기본 추천)
 */
export function recommendProvider(recipe: ImageRecipe): ProviderType {
  // 규칙 1: 기존 이미지 부분 수정 시 FLUX.2 Pro
  if (recipe.isRefinementOfImageId) {
    return "flux_2_pro";
  }

  // 규칙 2: Character Visual 또는 Reference 가 2개 이상이면 Gemini
  const totalRefs = (recipe.referenceIds?.length ?? 0) + (recipe.characterVisualIds?.length ?? 0);
  if (totalRefs >= 2) {
    return "gemini_flash_image";
  }

  // 규칙 3: 최초 생성 및 일반 장면 → GPT Image 2
  return "gpt_image_2";
}
