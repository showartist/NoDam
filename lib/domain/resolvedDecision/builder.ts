import type { ConsolidatedExplorationRecipe } from "../explorationRecipe/types";
import type { FinalResolutionAnswer, ResolvedDecision } from "./types";
import { checkResolutionReadiness } from "./readiness";

export class UnresolvedFieldsRemainingError extends Error {
  constructor(fields: string[]) {
    super(`[합의 확정 거부] 미해결 필드 (${fields.join(", ")})가 남아있어 confirmed 할 수 없습니다.`);
    this.name = "UnresolvedFieldsRemainingError";
  }
}

export class MissingResolvedByError extends Error {
  constructor() {
    super("[합의 확정 거부] 확정 담당자(resolvedBy) 정보가 누락되었습니다. AI 자동 확정은 금지됩니다.");
    this.name = "MissingResolvedByError";
  }
}

export class MissingEvidenceUidsError extends Error {
  constructor() {
    super("[합의 확정 거부] 확정 근거 발언(evidenceUids)이 0건이므로 confirmed 할 수 없습니다.");
    this.name = "MissingEvidenceUidsError";
  }
}

export class FakeConfirmationTamperingError extends Error {
  constructor() {
    super("[위조 위협 차단] human confirm action 없이 status를 confirmed로 위조한 객체는 거부됩니다.");
    this.name = "FakeConfirmationTamperingError";
  }
}

export class CrossProjectLinkageError extends Error {
  constructor(expected: string, actual: string) {
    super(`[프로젝트 격리 위반] 다른 프로젝트 (${actual})의 레시피를 이 프로젝트 (${expected})에 연결할 수 없습니다.`);
    this.name = "CrossProjectLinkageError";
  }
}

/**
 * SPRINT 3-C — ResolvedDecision 생성 (draft 상태)
 */
export function createResolvedDecision(
  projectId: string,
  meetingId: string,
  sceneIds: string[],
  sourceIssueIds: string[],
  consolidatedRecipe: ConsolidatedExplorationRecipe,
  finalAnswers: FinalResolutionAnswer[],
  createdBy: string,
  version: number = 1
): ResolvedDecision {
  const evidenceUids = Array.from(
    new Set([
      ...consolidatedRecipe.evidenceUids,
      ...finalAnswers.flatMap((a) => a.evidenceUids),
    ])
  );

  const decisionSummary = `[합의 결정문 v${version}] Scene ${sceneIds.join(",")} 시각적 연출 가이드확정안`;

  return {
    id: `decision_${consolidatedRecipe.sourceIssueId}_v${version}`,
    projectId,
    meetingId,
    sceneIds,
    sourceIssueIds,
    sourceExplorationRecipeIds: consolidatedRecipe.sourceRecipeIds,
    sourceConsolidatedRecipeId: consolidatedRecipe.id,
    selectedVisualElements: consolidatedRecipe.selectedVisualElements,
    finalAnswers,
    evidenceUids,
    decisionSummary,
    resolvedBy: createdBy,
    resolvedAt: new Date().toISOString(),
    version,
    status: "draft",
  };
}

/**
 * SPRINT 3-C — ResolvedDecision 인간 합의 확정 (Human Confirm Action)
 */
export function confirmResolvedDecision(
  decision: ResolvedDecision,
  consolidatedRecipe: ConsolidatedExplorationRecipe,
  confirmedBy: string
): ResolvedDecision {
  if (!confirmedBy || !confirmedBy.trim() || confirmedBy.toLowerCase().includes("ai")) {
    throw new MissingResolvedByError();
  }

  const readiness = checkResolutionReadiness(consolidatedRecipe, decision.finalAnswers);
  if (readiness.status !== "ready") {
    throw new UnresolvedFieldsRemainingError(readiness.unresolvedFields.concat(readiness.blockedReasons));
  }

  if (!decision.evidenceUids || decision.evidenceUids.length === 0) {
    throw new MissingEvidenceUidsError();
  }

  return {
    ...decision,
    resolvedBy: confirmedBy,
    resolvedAt: new Date().toISOString(),
    status: "confirmed",
  };
}
