/**
 * 입력 검증 — 저장 전에 계약 위반을 잡는다.
 *
 * DB 제약(CHECK/FK/트리거)이 최종 방어선이고, 여기는 사람이 읽을 수 있는
 * 도메인 오류를 만드는 자리다. 둘은 같은 규칙을 표현한다.
 */
import {
  APPROVER_ROLES,
  SHOT_RECIPE_STATUSES,
  type ApprovalDecision,
  type ApproverRole,
  type ReferenceRole,
  type ShotRecipeLinks,
  type ShotRecipeStatus,
  type ShotRecipeVersionBody,
} from "./types";

export class ShotRecipeValidationError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ShotRecipeValidationError";
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export function requireId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new ShotRecipeValidationError(`${field} 가 올바르지 않습니다.`, field);
  }
  return value;
}

export function optionalText(value: unknown, field: string, max = 5000): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    throw new ShotRecipeValidationError(`${field} 는 ${max}자 이하 문자열이어야 합니다.`, field);
  }
  return value;
}

export function stringList(value: unknown, field: string): string[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new ShotRecipeValidationError(`${field} 는 문자열 배열이어야 합니다.`, field);
  }
  return value as string[];
}

export function requireStatus(value: unknown): ShotRecipeStatus {
  if (!SHOT_RECIPE_STATUSES.includes(value as ShotRecipeStatus)) {
    throw new ShotRecipeValidationError(
      `status 는 ${SHOT_RECIPE_STATUSES.join(" | ")} 중 하나여야 합니다.`,
      "status",
    );
  }
  return value as ShotRecipeStatus;
}

export function requireRole(value: unknown): ApproverRole {
  if (!APPROVER_ROLES.includes(value as ApproverRole)) {
    throw new ShotRecipeValidationError("승인 역할은 director 또는 producer 여야 합니다.", "approverRole");
  }
  return value as ApproverRole;
}

export function requireDecision(value: unknown): ApprovalDecision {
  if (value !== "approved" && value !== "revoked") {
    throw new ShotRecipeValidationError("decision 은 approved 또는 revoked 여야 합니다.", "decision");
  }
  return value;
}

const REFERENCE_ROLES: ReferenceRole[] = ["first_frame", "last_frame", "general"];

/** 버전 본문 정규화. 근거 없는 기본값을 채우지 않는다. */
export function normalizeBody(input: Partial<ShotRecipeVersionBody>): ShotRecipeVersionBody {
  const duration = input.durationSeconds;
  if (duration !== null && duration !== undefined) {
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
      throw new ShotRecipeValidationError("durationSeconds 는 0 보다 큰 숫자여야 합니다.", "durationSeconds");
    }
  }

  return {
    narrativePurpose: optionalText(input.narrativePurpose, "narrativePurpose"),
    emotionalTarget: optionalText(input.emotionalTarget, "emotionalTarget"),
    framing: optionalText(input.framing, "framing"),
    shotSize: optionalText(input.shotSize, "shotSize"),
    lensIntent: optionalText(input.lensIntent, "lensIntent"),
    cameraPosition: optionalText(input.cameraPosition, "cameraPosition"),
    cameraMovement: optionalText(input.cameraMovement, "cameraMovement"),
    subjectAction: optionalText(input.subjectAction, "subjectAction"),
    performanceDirection: optionalText(input.performanceDirection, "performanceDirection"),
    environment: optionalText(input.environment, "environment"),
    lighting: optionalText(input.lighting, "lighting"),
    colorIntent: optionalText(input.colorIntent, "colorIntent"),
    wardrobe: optionalText(input.wardrobe, "wardrobe"),
    props: optionalText(input.props, "props"),
    startState: optionalText(input.startState, "startState"),
    endState: optionalText(input.endState, "endState"),
    durationSeconds: duration ?? null,
    motionSpeed: optionalText(input.motionSpeed, "motionSpeed"),
    continuityInputs: stringList(input.continuityInputs, "continuityInputs"),
    allowedElements: stringList(input.allowedElements, "allowedElements"),
    prohibitedElements: stringList(input.prohibitedElements, "prohibitedElements"),
    productionConstraints: stringList(input.productionConstraints, "productionConstraints"),
  };
}

/** 링크 정규화. 중복 ID 는 제거한다. */
export function normalizeLinks(input: Partial<ShotRecipeLinks>): ShotRecipeLinks {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const references = (input.references ?? []).map((r) => {
    requireId(r.referenceId, "references[].referenceId");
    if (!REFERENCE_ROLES.includes(r.role)) {
      throw new ShotRecipeValidationError(
        `reference role 은 ${REFERENCE_ROLES.join(" | ")} 중 하나여야 합니다.`,
        "references[].role",
      );
    }
    return r;
  });
  const refKey = (r: { referenceId: string; role: ReferenceRole }) => `${r.referenceId}::${r.role}`;
  const seen = new Set<string>();

  return {
    subjectIds: uniq(stringList(input.subjectIds, "subjectIds")),
    characterVisualVersionIds: uniq(stringList(input.characterVisualVersionIds, "characterVisualVersionIds")),
    visualPrincipleVersionIds: uniq(stringList(input.visualPrincipleVersionIds, "visualPrincipleVersionIds")),
    references: references.filter((r) => (seen.has(refKey(r)) ? false : (seen.add(refKey(r)), true))),
    evidenceIds: uniq(stringList(input.evidenceIds, "evidenceIds")),
  };
}

/**
 * project / scene / shot 일관성.
 * DB 트리거(T4)와 동일한 규칙이며, 여기서는 먼저 걸러 명확한 오류를 준다.
 */
export function assertConsistentLinks(input: {
  recipeProjectId: string;
  recipeSceneId: string;
  shotSceneId: string | null;
  sceneProjectId: string | null;
}): void {
  if (!input.shotSceneId) {
    throw new ShotRecipeValidationError("Shot 이 Scene 에 속해 있지 않습니다.", "shotId");
  }
  if (input.shotSceneId !== input.recipeSceneId) {
    throw new ShotRecipeValidationError(
      `Recipe 의 Scene 이 Shot 의 Scene 과 다릅니다. (recipe=${input.recipeSceneId}, shot=${input.shotSceneId})`,
      "sceneId",
    );
  }
  if (input.sceneProjectId !== input.recipeProjectId) {
    throw new ShotRecipeValidationError(
      `Recipe 의 Project 가 Scene 의 Project 와 다릅니다. (recipe=${input.recipeProjectId}, scene=${input.sceneProjectId})`,
      "projectId",
    );
  }
}
