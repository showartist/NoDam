import type { ProviderType } from "../imageGeneration/types";

export type ProductionRecipeStatus =
  | "draft"
  | "needs_review"
  | "ready_for_generation"
  | "stale";

export type ProductionReadinessStatus =
  | "ready"
  | "provider_not_configured"
  | "recipe_needs_review"
  | "blocked"
  | "generation_not_started";

export interface ProductionImageRecipe {
  id: string;
  projectId: string;
  sceneIds: string[];
  sourceResolvedDecisionId: string;
  sourceShotRecipeId?: string;
  version: number;
  status: ProductionRecipeStatus;

  // 12대 시각 필드
  composition?: string;
  subjectPresence?: string;
  subjectPlacement?: string;
  environment?: string;
  lighting?: string;
  colorIntent?: string;
  wardrobe?: string;
  props?: string;
  subjectAction?: string;
  performanceDirection?: string;
  requiredElements: string[];
  prohibitedElements: string[];

  evidenceUids: string[];
  referenceIds: string[];
  createdBy: string;
  createdAt: string;
}

export interface ProductionGenerationRequest {
  productionRecipeId: string;
  provider: ProviderType;
  model: string;
  promptPayload: string;
  negativeConstraints: string[];
  references: string[];
  outputCount: number;
  size: string;
  aspectRatio: string;
  estimatedCost: number | null; // 임의 가격 미생성
  currency: "USD" | "KRW" | null;
  pricingVersion: string | null;
  readinessStatus: ProductionReadinessStatus;
  blockedReasons: string[];
}
