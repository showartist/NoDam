import { DEFAULT_IMAGE_MODEL, isImageGenConfigured } from "../../../images/openrouterImages";
import type { ImageProviderAdapter } from "../providerInterface";
import { MissingApiKeyError } from "../providerInterface";
import type { GenerationResult, ImageRecipe, ProviderType } from "../types";
import { assertNoCharacterVisuals, generateViaOpenRouter, referenceInputsFromIds } from "./openrouterDelegate";

/** Gemini 3.1 Flash Image — 참조 이미지 최대 14장. OpenRouter 로 실제 호출한다. */
export class GeminiFlashImageAdapter implements ImageProviderAdapter {
  readonly provider: ProviderType = "gemini_flash_image";
  readonly model = DEFAULT_IMAGE_MODEL;
  readonly modelVersion = DEFAULT_IMAGE_MODEL;

  isAvailable(): boolean {
    return isImageGenConfigured();
  }

  derivePrompt(recipe: ImageRecipe): string {
    // 레퍼런스는 id 를 글로 적지 않고 실제 이미지로 첨부한다.
    const refs = recipe.referenceIds.length
      ? ` Use the ${recipe.referenceIds.length} attached reference image(s) as visual references.`
      : "";
    const req = recipe.requiredElements.length ? ` Must include: ${recipe.requiredElements.join(", ")}.` : "";
    const pro = recipe.prohibitedElements.length ? ` Do not include: ${recipe.prohibitedElements.join(", ")}.` : "";
    return `${recipe.promptText.trim()}${refs}${req}${pro}`;
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
