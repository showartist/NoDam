import type { SpeakerRole } from "../visualSynthesis/types";
import type { ProviderType } from "../imageGeneration/types";

export type RecipeStatus =
  | "draft"
  | "ready_for_generation"
  | "generation_blocked"
  | "generated"
  | "failed";

export type CompletenessStatus = "ready" | "needs_review" | "blocked";

export type PayloadReadinessStatus =
  | "provider_not_configured"
  | "payload_ready"
  | "blocked"
  | "generation_not_started"
  | "cost_unavailable";

export interface ParticipantExplorationRecipe {
  id: string;
  projectId: string;
  meetingId: string;
  sceneIds: string[];
  sourceIssueId: string;
  participantId: string;
  participantName: string;
  participantRole: SpeakerRole;
  interpretation: string;
  basis: "explicit" | "inferred";
  confidence: number; // 0.0 ~ 1.0
  evidenceUids: string[];

  // 12대 시각 요소 파라미터 전수 포함
  composition?: string;
  subjectPresence?: string;
  subjectPlacement?: string;
  environment?: string;
  lighting?: string;
  colorIntent?: string;
  wardrobe?: string;
  props?: string;
  subjectAction?: string; // 무엇을 하는가 (물리적 행동)
  performanceDirection?: string; // 어떤 감정과 연기 방식으로 하는가 (정서/연기 지시)
  requiredElements: string[];
  prohibitedElements: string[];

  aiSuggestedFields: string[]; // 직접 의견과 AI 보완 분리
  canBeTaken: false; // Exploration Recipe는 TAKE 절대 불가
  status: RecipeStatus;
  createdAt: string;
}

export interface RecipeCompletenessCheck {
  recipeId: string;
  status: CompletenessStatus;
  missingRequiredFields: string[];
  conflictingFields: { field: string; reason: string }[];
  aiSuggestedFieldsCount: number;
  evaluatedAt: string;
}

export interface ProviderPayloadPreview {
  recipeId: string;
  selectedProvider: ProviderType;
  model: string;
  promptPayload: string;
  negativeConstraints: string[];
  references: string[];
  outputCount: number;
  size: string;
  aspectRatio: string;
  estimatedCost: number | null; // 임의 가격 금지! 계산 불가능 시 null
  currency: "USD" | "KRW" | null;
  pricingVersion: string | null;
  readinessStatus: PayloadReadinessStatus;
}

export interface SelectedVisualElement {
  category:
    | "composition"
    | "subjectPresence"
    | "subjectPlacement"
    | "lighting"
    | "colorIntent"
    | "environment"
    | "wardrobe"
    | "props"
    | "subjectAction"
    | "performanceDirection";
  sourceRecipeId: string;
  sourceParticipantId: string;
  sourceParticipantRole: SpeakerRole;
  selectedValue: string;
  selectedBy: string;
  selectedAt: string;
  evidenceUids: string[];
}

export interface ConsolidatedExplorationRecipe {
  id: string;
  sourceIssueId: string;
  sourceRecipeIds: string[];
  selectedVisualElements: SelectedVisualElement[];
  unresolvedFields: string[]; // 미선택 필수 카테고리 목록
  evidenceUids: string[];
  compiledPrompt: string;
  createdBy: string;
  createdAt: string;
  version: number;
  status: "draft" | "needs_review" | "ready_for_resolution";
  canBeTaken: false;
}
