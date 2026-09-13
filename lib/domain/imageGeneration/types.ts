export type ProviderType = "gpt_image_2" | "gemini_flash_image" | "flux_2_pro";

export interface ImageRecipe {
  id: string;
  projectId: string;
  sceneNumber: number;
  shotNumber?: number;
  promptText: string;
  requiredElements: string[];
  prohibitedElements: string[];
  referenceIds: string[];
  characterVisualIds: string[];
  isRefinementOfImageId?: string;
  refinementMaskRegion?: string;
}

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  modelVersion: string;
  resolution: "low" | "high";
}

export interface GenerationJob {
  id: string;
  recipeId: string;
  provider: ProviderType;
  model: string;
  modelVersion: string;
  derivedPrompt: string;
  referenceIds: string[];
  status: "queued" | "generating" | "completed" | "failed";
  errorMessage?: string;
  cost?: number;
  createdAt: string;
  completedAt?: string;
}

export interface GenerationResult {
  jobId: string;
  recipeId: string;
  provider: ProviderType;
  /** 실제로 받은 이미지를 쓴 파일 경로(.data/images/…). 준비된 데모 이미지 경로를 넣지 않는다 */
  imageUri: string;
  adoptionRating?: "take" | "drop" | "pending";
  resolution: "low" | "high";
  generatedAt: string;
  /** 실제로 호출한 OpenRouter 모델 */
  model?: string;
  /** 실제로 보낸 프롬프트 */
  prompt?: string;
  /** 응답 usage.cost. 응답에 없으면 null (단가로 추정하지 않는다) */
  costUsd?: number | null;
  width?: number | null;
  height?: number | null;
  referenceIds?: string[];
}

export interface MeetingGenerationQuota {
  meetingId: string;
  decisionImagesCount: Record<string, number>;
  totalMeetingImagesCount: number;
}

export const MAX_IMAGES_PER_DECISION = 2;
export const MAX_IMAGES_PER_MEETING = 6;
