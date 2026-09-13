import { isImageGenConfigured } from "../../../images/openrouterImages";
import type { ImageProviderAdapter } from "../providerInterface";
import { MissingApiKeyError } from "../providerInterface";
import type { GenerationResult, ImageRecipe, ProviderType } from "../types";
import {
  assertNoCharacterVisuals,
  generateViaOpenRouter,
  generatedImageInput,
  referenceInputsFromIds,
} from "./openrouterDelegate";

/** FLUX.2 Pro — 기존 TAKE 후보의 부분 수정 전용. 원본 이미지를 첫 참조 이미지로 첨부해 OpenRouter 로 호출한다. */
export class Flux2ProAdapter implements ImageProviderAdapter {
  readonly provider: ProviderType = "flux_2_pro";
  readonly model = "black-forest-labs/flux.2-pro";
  readonly modelVersion = "black-forest-labs/flux.2-pro";

  isAvailable(): boolean {
    return isImageGenConfigured();
  }

  derivePrompt(recipe: ImageRecipe): string {
    if (!recipe.isRefinementOfImageId) {
      throw new Error("[FLUX.2 Pro] FLUX.2 Pro 는 기존 TAKE 후보의 정밀 편집 용도로만 사용해야 합니다.");
    }
    const region = recipe.refinementMaskRegion ? ` Change only this region: ${recipe.refinementMaskRegion}.` : "";
    const pro = recipe.prohibitedElements.length ? ` Do not include: ${recipe.prohibitedElements.join(", ")}.` : "";
    return `Edit the first attached image. Keep everything else unchanged. Modification: ${recipe.promptText.trim()}.${region}${pro}`;
  }

  async generate(recipe: ImageRecipe, resolution: "low" | "high" = "high"): Promise<GenerationResult> {
    if (!this.isAvailable()) {
      throw new MissingApiKeyError(this.provider, "OPENROUTER_API_KEY");
    }
    const prompt = this.derivePrompt(recipe);
    assertNoCharacterVisuals(recipe);
    const references = [generatedImageInput(recipe.isRefinementOfImageId!), ...referenceInputsFromIds(recipe.referenceIds)];
    return generateViaOpenRouter(this, recipe, prompt, resolution, references);
  }
}
