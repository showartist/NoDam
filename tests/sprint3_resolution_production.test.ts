import test from "node:test";
import assert from "node:assert/strict";

// 이 파일의 미리보기 검사는 "생성 키가 없는 상태"를 전제로 한다(provider_not_configured).
// 셸 환경변수에 키가 있어도 같은 결과가 나오도록 키를 지운다. 키는 호출할 때 읽으므로 import 순서와 무관하다.
delete process.env.OPENROUTER_API_KEY;
import type { AlignmentIssue } from "../lib/domain/alignmentCheck/types";
import { buildParticipantExplorationRecipes } from "../lib/domain/explorationRecipe/builder";
import { createConsolidatedExplorationRecipe } from "../lib/domain/explorationRecipe/consolidated";
import type { SelectedVisualElement } from "../lib/domain/explorationRecipe/types";

import type { FinalResolutionAnswer } from "../lib/domain/resolvedDecision/types";
import { checkResolutionReadiness } from "../lib/domain/resolvedDecision/readiness";
import {
  createResolvedDecision,
  confirmResolvedDecision,
  MissingResolvedByError,
  MissingEvidenceUidsError,
  UnresolvedFieldsRemainingError,
} from "../lib/domain/resolvedDecision/builder";
import {
  buildProductionImageRecipe,
  buildProductionGenerationRequestPreview,
  UnconfirmedDecisionError,
  StaleDecisionInputForbiddenError,
} from "../lib/domain/productionRecipe/builder";
import { propagateResolutionChange } from "../lib/domain/resolvedDecision/stalePropagation";

test("Sprint 3-I: 20단계 Resolution & Production Recipe 시나리오 및 보안 검증", () => {
  // 1. 회의 안건 수신
  const issue: AlignmentIssue = {
    id: "issue_det_01",
    meetingId: "m_01",
    projectId: "p_01",
    sceneIds: ["12"],
    issueType: "conflict",
    severity: "blocking",
    topic: "인물 존재 여부 및 공간 배치 충돌",
    summary: "텅 빈 공간 vs 인물 배치",
    participantPositions: [
      { participantId: "U-001", participantName: "한지우", participantRole: "director", interpretation: "인물 없는 텅 빈 수영장 공간이었으면 좋겠습니다.", visualElements: ["텅 빈"], evidenceUids: ["U-001"], basis: "explicit", confidence: 0.95 },
      { participantId: "U-002", participantName: "서민재", participantRole: "cinematographer", interpretation: "인물을 멀리 작게 남기는 와이드 샷이 감정 잡기에 좋습니다.", visualElements: ["와이드 샷"], evidenceUids: ["U-002"], basis: "explicit", confidence: 0.92 },
    ],
    evidenceUids: ["U-001", "U-002"],
    whyItMatters: "공간 구조",
    suggestedQuestion: "인물 등장 여부",
    status: "needs_review",
    createdAt: new Date().toISOString(),
  };

  const recipes = buildParticipantExplorationRecipes(issue);

  // 2. 부분 요소 선택 (SelectedVisualElement)
  const selectedElements: SelectedVisualElement[] = [
    { category: "composition", sourceRecipeId: recipes[1].id, sourceParticipantId: "U-002", sourceParticipantRole: "cinematographer", selectedValue: "35mm 와이드 샷", selectedBy: "한지우", selectedAt: new Date().toISOString(), evidenceUids: ["U-002"] },
  ];

  // 3. Consolidated Recipe 생성 및 unresolvedFields 존재 확인
  const consolidated = createConsolidatedExplorationRecipe(issue.id, recipes, selectedElements, "한지우", 1);
  assert.ok(consolidated.unresolvedFields.includes("subjectPresence"));

  // Step 1: 미해결 subjectPresence 때문에 resolution readiness: needs_answer
  let answers: FinalResolutionAnswer[] = [];
  let readiness = checkResolutionReadiness(consolidated, answers);
  assert.equal(readiness.status, "needs_answer");

  // Step 2 & 3: subjectPresence = absent 직접 답변 및 논리적 모순 검증
  answers.push({
    field: "subjectPresence",
    value: "인물 부재 (텅 빈 공간)",
    answerType: "direct_answer",
    answeredBy: "한지우(감독)",
    answeredAt: new Date().toISOString(),
    evidenceUids: ["U-001"],
  });

  // Step 4: inferred lighting 인간 확인 (confirmed_ai_suggestion)
  answers.push({ field: "lighting", value: "사이드 사이언 조명", answerType: "confirmed_ai_suggestion", answeredBy: "서민재(촬영)", answeredAt: new Date().toISOString(), evidenceUids: ["U-002"] });
  answers.push({ field: "colorIntent", value: "청록빛 톤앤매너", answerType: "confirmed_ai_suggestion", answeredBy: "오세라(미술)", answeredAt: new Date().toISOString(), evidenceUids: ["U-001"] });
  answers.push({ field: "environment", value: "수영장 타일 공간", answerType: "confirmed_ai_suggestion", answeredBy: "오세라(미술)", answeredAt: new Date().toISOString(), evidenceUids: ["U-001"] });

  // Step 5: unresolvedFields 0개 달성 확인
  readiness = checkResolutionReadiness(consolidated, answers);
  assert.equal(readiness.unresolvedFields.length, 0);
  assert.equal(readiness.status, "ready");

  // Step 6: ResolvedDecision draft 생성
  const decisionDraft = createResolvedDecision("p_01", "m_01", ["12"], [issue.id], consolidated, answers, "한지우(감독)", 1);
  assert.equal(decisionDraft.status, "draft");

  // Step 7: AI 자동 confirmed 거부 검증
  assert.throws(() => confirmResolvedDecision(decisionDraft, consolidated, "AI_Agent"), MissingResolvedByError);

  // Step 8: 사람 confirm 후 status: confirmed
  const confirmedDecision = confirmResolvedDecision(decisionDraft, consolidated, "한지우(감독)");
  assert.equal(confirmedDecision.status, "confirmed");

  // Step 10: confirmed decision 기반 ProductionImageRecipe 생성
  const prodRecipe = buildProductionImageRecipe(confirmedDecision, "한지우(감독)");
  assert.equal(prodRecipe.status, "ready_for_generation");

  // Step 11 & 12: unconfirmed 결정으로 Production Recipe 생성 시도 시 하드 차단
  assert.throws(() => buildProductionImageRecipe(decisionDraft, "한지우"), UnconfirmedDecisionError);

  // Step 13 & 14: Production Request Preview 생성 및 Provider 미설정 상태 정직 표시
  const reqPreview = buildProductionGenerationRequestPreview(prodRecipe);
  assert.equal(reqPreview.productionRecipeId, prodRecipe.id);
  assert.equal(reqPreview.estimatedCost, null); // 임의 가격 미생성
  assert.equal(reqPreview.readinessStatus, "provider_not_configured");

  // Step 15, 16, 17: 결정 변경 시 기존 decision & Production Recipe stale 파급 전파
  const staleResult = propagateResolutionChange({
    existingDecision: confirmedDecision,
    existingProductionRecipe: prodRecipe,
    changeType: "answer_changed",
    reason: "감독이 조명 톤 수정",
  });

  assert.equal(staleResult.updatedDecision.status, "stale");
  assert.equal(staleResult.updatedProductionRecipe?.status, "stale");
  assert.equal(staleResult.isStalePropagated, true);

  // Step 18: stale decision으로는 Production Recipe 생성 하드 차단
  assert.throws(() => buildProductionImageRecipe(staleResult.updatedDecision, "한지우"), StaleDecisionInputForbiddenError);
});

test("Sprint 3-I: 보안 테스트 — confirm 시 resolvedBy/evidenceUids 누락 및 미해결 필드 존재 시 차단", () => {
  const consolidated = createConsolidatedExplorationRecipe("issue_sec", [], [], "한지우", 1);
  const decisionDraft = createResolvedDecision("p_01", "m_01", ["12"], ["issue_sec"], consolidated, [], "한지우", 1);

  // 1. 미해결 필드가 남아있는데 confirm 시도 ➔ 차단
  assert.throws(() => confirmResolvedDecision(decisionDraft, consolidated, "한지우"), UnresolvedFieldsRemainingError);

  // 2. evidenceUids 0건 시 confirm ➔ 차단
  const emptyEvidenceDecision = { ...decisionDraft, evidenceUids: [] };
  assert.throws(() => confirmResolvedDecision(emptyEvidenceDecision, { ...consolidated, unresolvedFields: [] }, "한지우"), MissingEvidenceUidsError);
});
