import type { ResolvedDecision } from "../resolvedDecision/types";
import type { ProductionGenerationRequest, ProductionImageRecipe } from "./types";
import { recommendProvider } from "../imageGeneration/router";

export class UnconfirmedDecisionError extends Error {
  constructor(decisionId: string) {
    super(`[Production Recipe 생성 거부] 결정 (${decisionId})이 confirmed 상태가 아닙니다.`);
    this.name = "UnconfirmedDecisionError";
  }
}

export class DirectExplorationInputForbiddenError extends Error {
  constructor() {
    super("[보안 정책 위반] Exploration Recipe 또는 Consolidated Recipe를 직접 Production Image Recipe로 변환할 수 없습니다. 인간 합의 확정(confirmed ResolvedDecision)이 필수입니다.");
    this.name = "DirectExplorationInputForbiddenError";
  }
}

export class StaleDecisionInputForbiddenError extends Error {
  constructor(decisionId: string) {
    super(`[보안 정책 위반] Stale 또는 Superseded 결정 (${decisionId})으로는 Production Image Recipe를 생성할 수 없습니다.`);
    this.name = "StaleDecisionInputForbiddenError";
  }
}

/**
 * SPRINT 3-E — Confirmed ResolvedDecision 으로부터 ProductionImageRecipe 생성
 */
export function buildProductionImageRecipe(
  decision: ResolvedDecision,
  createdBy: string
): ProductionImageRecipe {
  if (decision.status !== "confirmed") {
    if (decision.status === "stale" || decision.status === "superseded") {
      throw new StaleDecisionInputForbiddenError(decision.id);
    }
    throw new UnconfirmedDecisionError(decision.id);
  }

  const recipeMap: Record<string, string> = {};
  for (const el of decision.selectedVisualElements) {
    recipeMap[el.category] = el.selectedValue;
  }
  for (const ans of decision.finalAnswers) {
    recipeMap[ans.field] = ans.value;
  }

  return {
    id: `prod_recipe_${decision.id}_v${decision.version}`,
    projectId: decision.projectId,
    sceneIds: decision.sceneIds,
    sourceResolvedDecisionId: decision.id,
    version: decision.version,
    status: "ready_for_generation",

    composition: recipeMap["composition"],
    subjectPresence: recipeMap["subjectPresence"],
    subjectPlacement: recipeMap["subjectPlacement"],
    environment: recipeMap["environment"],
    lighting: recipeMap["lighting"],
    colorIntent: recipeMap["colorIntent"],
    wardrobe: recipeMap["wardrobe"],
    props: recipeMap["props"],
    subjectAction: recipeMap["subjectAction"],
    performanceDirection: recipeMap["performanceDirection"],

    requiredElements: decision.selectedVisualElements.map((e) => e.selectedValue),
    prohibitedElements: [],

    evidenceUids: decision.evidenceUids,
    referenceIds: [],
    createdBy,
    createdAt: new Date().toISOString(),
  };
}

/**
 * SPRINT 3-F — Production Candidate Generation Request Preview (Zero Live HTTP Requests)
 */
export function buildProductionGenerationRequestPreview(
  recipe: ProductionImageRecipe
): ProductionGenerationRequest {
  const blockedReasons: string[] = [];

  if (recipe.status !== "ready_for_generation") {
    blockedReasons.push(`Production Recipe status가 ready_for_generation이 아닌 ${recipe.status} 상태입니다.`);
  }

  const selectedProvider = recommendProvider({
    id: recipe.id,
    projectId: recipe.projectId,
    sceneNumber: Number(recipe.sceneIds[0] || 12),
    promptText: recipe.composition || "Production Shot",
    requiredElements: recipe.requiredElements,
    prohibitedElements: recipe.prohibitedElements,
    referenceIds: recipe.referenceIds,
    characterVisualIds: [],
  });

  const hasKey = Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);

  let readinessStatus: ProductionGenerationRequest["readinessStatus"] = "ready";
  if (blockedReasons.length > 0) {
    readinessStatus = "blocked";
  } else if (!hasKey) {
    readinessStatus = "provider_not_configured";
  }

  const promptPayload = `[PRODUCTION GENERATION PAYLOAD] ${recipe.projectId} Scene ${recipe.sceneIds.join(",")} — Comp: ${recipe.composition || "N/A"} | Subject: ${recipe.subjectPresence || "N/A"} | Light: ${recipe.lighting || "N/A"}`;

  return {
    productionRecipeId: recipe.id,
    provider: selectedProvider,
    model: selectedProvider === "gemini_flash_image" ? "gemini-3.1-flash-image" : "gpt-image-2",
    promptPayload,
    negativeConstraints: recipe.prohibitedElements,
    references: recipe.referenceIds,
    outputCount: 1,
    size: "1920x1080",
    aspectRatio: "16:9",
    estimatedCost: null, // 임의 가격 미생성 규칙 준수
    currency: null,
    pricingVersion: null,
    readinessStatus,
    blockedReasons,
  };
}
