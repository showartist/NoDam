import { ImageGenError } from "../../images/errors";
import type { GenerationResult, ImageRecipe, ProviderType } from "./types";

export interface ImageProviderAdapter {
  provider: ProviderType;
  /** 실제로 호출하는 OpenRouter 모델 slug */
  model: string;
  modelVersion: string;
  isAvailable(): boolean;
  derivePrompt(recipe: ImageRecipe): string;
  generate(recipe: ImageRecipe, resolution?: "low" | "high"): Promise<GenerationResult>;
}

/** 키 없음. lib/images 의 NOT_CONFIGURED 오류와 같은 계열이라 API 라우트가 같은 방식으로 다룬다. */
export class MissingApiKeyError extends ImageGenError {
  constructor(provider: ProviderType, envVar: string) {
    super("NOT_CONFIGURED", `[${provider}] API 키가 설정되지 않았습니다 (${envVar}). 픽스처 성공 위장은 차단됩니다.`);
    this.name = "MissingApiKeyError";
  }
}
