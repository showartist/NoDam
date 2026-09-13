import { isImageGenConfigured } from "../../../images/openrouterImages";
import type { ImageProviderAdapter } from "../providerInterface";
import { MissingApiKeyError } from "../providerInterface";
import type { GenerationResult, ImageRecipe, ProviderType } from "../types";
import { assertNoCharacterVisuals, generateViaOpenRouter, referenceInputsFromIds } from "./openrouterDelegate";

/** GPT Image 2 — OpenRouter 로 실제 호출한다. 키가 없으면 MissingApiKeyError(NOT_CONFIGURED). */
export class GptImage2Adapter implements ImageProviderAdapter {
  readonly provider: ProviderType = "gpt_image_2";
  readonly model = "openai/gpt-image-2";
  readonly modelVersion = "openai/gpt-image-2";

  isAvailable(): boolean {
    // 이 어댑터가 실제로 쓰는 경로는 OpenRouter 뿐이다. 다른 키로 "연결됨"을 주장하지 않는다.
    return isImageGenConfigured();
  }

  derivePrompt(recipe: ImageRecipe): string {
    const req = recipe.requiredElements.length ? ` Must include: ${recipe.requiredElements.join(", ")}.` : "";
    const pro = recipe.prohibitedElements.length ? ` Do not include: ${recipe.prohibitedElements.join(", ")}.` : "";
    return `${recipe.promptText.trim()}${req}${pro}`;
  }

  async generate(recipe: ImageRecipe, resolution: "low" | "high" = "low"): Promise<GenerationResult> {
    if (!this.isAvailable()) {
      throw new MissingApiKeyError(this.provider, "OPENROUTER_API_KEY");
    }
    assertNoCharacterVisuals(recipe);
    const references = referenceInputsFromIds(recipe.referenceIds);
    return generateViaOpenRouter(this, recipe, this.derivePrompt(recipe), resolution, references);
  }
}
