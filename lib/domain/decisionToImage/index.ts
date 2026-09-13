// Phase 7D-B — 결정 → 시각화 판정 → Image Recipe.
//
// 이 모듈은 순수 함수만 담는다. DB·네트워크·LLM·이미지 API 를 쓰지 않는다.
// 그래서 이미지 API 비용 없이 "이 발언이 실제로 그릴 수 있는 결정인가" 를 끝까지
// 검증할 수 있다.
//
// 절대 규칙
//   1. AI 는 결정을 확정할 수 없다 — humanStatus 는 이 모듈이 바꾸지 않는다.
//   2. 근거(evidenceUids) 없는 결정은 생성 대상이 될 수 없다.
//   3. 충돌이 해소되지 않은 결정은 생성 대상이 될 수 없다.
//   4. 생성 가부를 애매하게 넘기지 않는다 — 막았으면 왜 막혔는지 사유를 함께 낸다.

export type DecisionType = "visual" | "narrative" | "production" | "safety" | "schedule";
export type ConflictStatus = "none" | "unresolved" | "resolved";
export type HumanStatus = "pending" | "decided" | "rejected";
export type VisualizationEligibility = "eligible" | "not_eligible" | "needs_review";
export type VisualizationType =
  | "environment" | "character" | "costume" | "prop" | "mood" | "shot" | "storyboard";

export type DecisionCandidate = {
  id: string;
  projectId: string;
  sceneId?: string | null;
  statement: string;
  evidenceUids: string[];
  decisionType: DecisionType;
  conflictStatus: ConflictStatus;
  /** AI 는 언제나 candidate. 이 모듈은 이 값을 읽기만 한다. */
  aiStatus: "candidate";
  humanStatus: HumanStatus;
  decidedBy?: string | null;
  decidedAt?: string | null;
  visualizationEligibility?: VisualizationEligibility;
  visualizationType?: VisualizationType | null;
};

// ── 시각화 판정 ────────────────────────────────────────────────────────────

/** 그릴 수 없는 결정 종류 — 일정·예산·안전 승인은 이미지로 만들 대상이 아니다. */
const NEVER_VISUAL: ReadonlySet<DecisionType> = new Set(["production", "safety", "schedule"]);

export type EligibilityVerdict = {
  eligibility: VisualizationEligibility;
  reason: string;
};

/**
 * 결정 종류만으로 1차 판정한다.
 * `visual` 이라도 자동으로 eligible 로 올리지 않는다 — 무엇을 그릴지(type)는
 * 사람이 정해야 하므로 needs_review 로 둔다.
 */
export function judgeVisualizationEligibility(candidate: DecisionCandidate): EligibilityVerdict {
  if (NEVER_VISUAL.has(candidate.decisionType)) {
    return {
      eligibility: "not_eligible",
      reason: `${candidate.decisionType} 결정은 이미지로 만들 대상이 아닙니다 (일정·예산·안전은 시각 자산이 아님).`,
    };
  }
  if (candidate.decisionType === "narrative") {
    return {
      eligibility: "needs_review",
      reason: "서사 결정입니다. 화면에 담기는 내용이면 시각 유형을 지정하세요.",
    };
  }
  return {
    eligibility: "needs_review",
    reason: "시각 결정입니다. 무엇을 그릴지(visualizationType) 지정하면 생성할 수 있습니다.",
  };
}

// ── 생성 게이트 ────────────────────────────────────────────────────────────

export type GenerationGate =
  | { allowed: true }
  | { allowed: false; blockers: string[] };

/**
 * 이미지 생성 가능 여부. 5개 조건을 모두 만족해야 한다.
 * 막혔을 때 **무엇 때문에 막혔는지 전부** 돌려준다 — 하나씩 고치게 하지 않는다.
 */
export function evaluateGenerationGate(candidate: DecisionCandidate): GenerationGate {
  const blockers: string[] = [];

  if (candidate.humanStatus !== "decided") {
    blockers.push(
      candidate.humanStatus === "pending"
        ? "아직 결정으로 인정되지 않았습니다. 연출부가 '결정으로 인정' 을 눌러야 합니다."
        : "잘못 추출된 것으로 표시된 후보입니다.",
    );
  }
  if (!candidate.decidedBy || !candidate.decidedAt) {
    blockers.push("결정자와 결정 시각이 기록되지 않았습니다.");
  }
  if (candidate.visualizationEligibility !== "eligible") {
    blockers.push(
      candidate.visualizationEligibility === "not_eligible"
        ? "이미지로 만들 대상이 아닌 결정입니다."
        : "시각화 가능 여부가 아직 확정되지 않았습니다.",
    );
  }
  if (!candidate.visualizationType) {
    blockers.push("무엇을 그릴지(visualizationType) 가 지정되지 않았습니다.");
  }
  if (candidate.evidenceUids.length === 0) {
    blockers.push("근거 발언(U-ID) 이 없습니다. 근거 없는 결정으로 이미지를 만들지 않습니다.");
  }
  if (candidate.conflictStatus === "unresolved") {
    blockers.push("해소되지 않은 충돌이 있습니다. 충돌을 정리한 뒤 생성하세요.");
  }

  return blockers.length === 0 ? { allowed: true } : { allowed: false, blockers };
}

// ── Image Recipe ───────────────────────────────────────────────────────────

export type ImageRecipeBody = {
  type: VisualizationType;
  sceneId: string | null;
  purpose: string;
  location: string | null;
  time: string | null;
  subjects: string[];
  framing: string | null;
  cameraPosition: string | null;
  lighting: string[];
  colorPalette: string[];
  emotionalTarget: string[];
  requiredElements: string[];
  prohibitedElements: string[];
  evidenceUids: string[];
};

export type RecipeDraftInput = {
  purpose?: string;
  location?: string | null;
  time?: string | null;
  subjects?: string[];
  framing?: string | null;
  cameraPosition?: string | null;
  lighting?: string[];
  colorPalette?: string[];
  emotionalTarget?: string[];
  requiredElements?: string[];
  prohibitedElements?: string[];
};

export type RecipeBuildResult =
  | { ok: true; recipe: ImageRecipeBody; warnings: string[] }
  | { ok: false; blockers: string[] };

const dedupe = (xs: string[]) =>
  [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/**
 * 결정 + 사람이 채운 시각 사양 → Image Recipe 본문.
 *
 * 생성 게이트를 통과하지 못하면 Recipe 자체를 만들지 않는다. Recipe 가 있다는 것은
 * "생성해도 되는 결정" 이라는 뜻이어야 하기 때문이다.
 */
export function buildImageRecipe(
  candidate: DecisionCandidate,
  draft: RecipeDraftInput = {},
): RecipeBuildResult {
  const gate = evaluateGenerationGate(candidate);
  if (!gate.allowed) return { ok: false, blockers: gate.blockers };

  const warnings: string[] = [];
  const prohibited = dedupe(draft.prohibitedElements ?? []);
  const required = dedupe(draft.requiredElements ?? []);

  // 제품 원칙 7 — 레퍼런스에는 include 와 exclude 가 모두 필요하다.
  // 여기서 막지는 않되(초안 단계일 수 있음) 경고는 반드시 남긴다.
  if (prohibited.length === 0) {
    warnings.push(
      "가져오지 않을 요소(prohibitedElements)가 비어 있습니다. " +
      "무엇을 뺄지 적지 않으면 같은 충돌이 이미지 단계에서 반복됩니다.",
    );
  }
  if (required.length === 0) {
    warnings.push("필수 요소(requiredElements)가 비어 있습니다.");
  }

  return {
    ok: true,
    warnings,
    recipe: {
      type: candidate.visualizationType!,
      sceneId: candidate.sceneId ?? null,
      purpose: (draft.purpose ?? candidate.statement).trim(),
      location: draft.location ?? null,
      time: draft.time ?? null,
      subjects: dedupe(draft.subjects ?? []),
      framing: draft.framing ?? null,
      cameraPosition: draft.cameraPosition ?? null,
      lighting: dedupe(draft.lighting ?? []),
      colorPalette: dedupe(draft.colorPalette ?? []),
      emotionalTarget: dedupe(draft.emotionalTarget ?? []),
      requiredElements: required,
      prohibitedElements: prohibited,
      // 근거는 결정에서 그대로 승계한다. Recipe 가 근거를 새로 만들지 않는다.
      evidenceUids: [...candidate.evidenceUids],
    },
  };
}

// ── 중복 생성 방지 ─────────────────────────────────────────────────────────

/**
 * 같은 Recipe 버전 · 같은 모델 · 같은 프롬프트면 같은 키가 나온다.
 * 해시는 저장 계층에서 계산하고, 여기서는 **키 구성 요소의 순서와 정규화**만 고정한다.
 */
export function generationIdempotencyParts(input: {
  recipeVersionId: string;
  provider: string;
  modelVersion: string;
  prompt: string;
}): string {
  return [
    input.recipeVersionId.trim(),
    input.provider.trim().toLowerCase(),
    input.modelVersion.trim(),
    input.prompt.replace(/\s+/g, " ").trim(),
  ].join(" ");
}

// ── 결정 변경 시 전파 ──────────────────────────────────────────────────────

export type ImageStatus = "generated" | "selected" | "dropped" | "superseded";

export type ImagePropagation = {
  imageId: string;
  previousStatus: ImageStatus;
  nextStatus: ImageStatus;
  reviewRequired: boolean;
  reason: string;
};

/**
 * 결정이 바뀌었을 때 기존 이미지 처리.
 *
 * 감독이 TAKE 한 이미지를 시스템이 말없이 내리지 않는다 — 재검토 표시만 하고
 * 상태는 유지한다. 이미 버린(dropped) 것은 건드리지 않는다.
 */
export function propagateDecisionChangeToImages(
  images: Array<{ id: string; status: ImageStatus }>,
): ImagePropagation[] {
  return images.map((img) => {
    if (img.status === "selected") {
      return {
        imageId: img.id, previousStatus: img.status, nextStatus: "selected",
        reviewRequired: true,
        reason: "결정이 변경되었습니다. 채택된 이미지라 자동으로 내리지 않고 재검토로 표시합니다.",
      };
    }
    if (img.status === "generated") {
      return {
        imageId: img.id, previousStatus: img.status, nextStatus: "superseded",
        reviewRequired: false,
        reason: "결정 변경으로 이전 버전 후보가 되었습니다.",
      };
    }
    return {
      imageId: img.id, previousStatus: img.status, nextStatus: img.status,
      reviewRequired: false,
      reason: img.status === "dropped" ? "이미 버려진 후보입니다." : "이미 이전 버전으로 표시되었습니다.",
    };
  });
}
