import test from "node:test";
import assert from "node:assert/strict";

// 이 파일의 미리보기 검사는 "생성 키가 없는 상태"를 전제로 한다(provider_not_configured).
// 셸 환경변수에 키가 있어도 같은 결과가 나오도록 키를 지운다. 키는 호출할 때 읽으므로 import 순서와 무관하다.
delete process.env.OPENROUTER_API_KEY;
import type { AlignmentIssue } from "../lib/domain/alignmentCheck/types";
import { buildParticipantExplorationRecipes, MissingEvidenceError } from "../lib/domain/explorationRecipe/builder";
import { checkRecipeCompleteness } from "../lib/domain/explorationRecipe/completeness";
import { buildProviderPayloadPreview } from "../lib/domain/explorationRecipe/providerPreview";
import { createConsolidatedExplorationRecipe } from "../lib/domain/explorationRecipe/consolidated";
import {
  validateImageTakePermission,
  promoteToShotReference,
  convertToProductionCandidateDirectly,
  ExplorationImageTakeForbiddenError,
  ExplorationShotReferencePromotionForbiddenError,
  ExplorationDirectProductionCandidateForbiddenError,
  ExplorationFakeCanBeTakenTamperingError,
} from "../lib/domain/visualSynthesis/twoTierImage";
import type { SelectedVisualElement } from "../lib/domain/explorationRecipe/types";

test("Sprint 2-G: subjectAction 과 performanceDirection 분리 정의 테스트", () => {
  const issue: AlignmentIssue = {
    id: "issue_sep_01",
    meetingId: "m_01",
    projectId: "p_01",
    sceneIds: ["12"],
    issueType: "conflict",
    severity: "blocking",
    topic: "행동 및 연기 지시 분리",
    summary: "분리 테스트",
    participantPositions: [
      {
        participantId: "U-001",
        participantName: "한지우",
        participantRole: "director",
        interpretation: "인물 없는 텅 빈 수영장 공간이었으면 좋겠습니다.",
        visualElements: ["텅 빈"],
        evidenceUids: ["U-001"],
        basis: "explicit",
        confidence: 0.95,
      },
    ],
    evidenceUids: ["U-001"],
    whyItMatters: "분리 검증",
    suggestedQuestion: "질문",
    status: "detected",
    createdAt: new Date().toISOString(),
  };

  const recipes = buildParticipantExplorationRecipes(issue);
  assert.equal(recipes[0].subjectAction, "공간에 정적 유지 (무행동)"); // 무엇을 하는가
  assert.equal(recipes[0].performanceDirection, "고독하고 서늘한 부재의 정서"); // 어떤 감정과 연기 방식으로 하는가
});

test("Sprint 2-G: Provider Payload Preview 전체 12필드 및 estimatedCost null 지침 테스트", () => {
  const issue: AlignmentIssue = {
    id: "issue_prev_01",
    meetingId: "m_01",
    projectId: "p_01",
    sceneIds: ["12"],
    issueType: "ambiguity",
    severity: "comparison_recommended",
    topic: "Preview 테스트",
    summary: "미리보기 검증",
    participantPositions: [
      {
        participantId: "U-001",
        participantName: "한지우",
        participantRole: "director",
        interpretation: "인물 없는 텅 빈 수영장",
        visualElements: ["텅 빈"],
        evidenceUids: ["U-001"],
        basis: "explicit",
        confidence: 0.9,
      },
    ],
    evidenceUids: ["U-001"],
    whyItMatters: "중요",
    suggestedQuestion: "질문",
    status: "detected",
    createdAt: new Date().toISOString(),
  };

  const recipes = buildParticipantExplorationRecipes(issue);
  const preview = buildProviderPayloadPreview(recipes[0]);

  assert.ok(preview.recipeId);
  assert.ok(preview.selectedProvider);
  assert.ok(preview.model);
  assert.ok(preview.promptPayload);
  assert.ok(Array.isArray(preview.negativeConstraints));
  assert.ok(Array.isArray(preview.references));
  assert.equal(preview.outputCount, 1);
  assert.equal(preview.size, "1920x1080");
  assert.equal(preview.aspectRatio, "16:9");
  assert.equal(preview.estimatedCost, null); // 임의 가격 미생성 null 지침
  assert.equal(preview.currency, null);
  assert.equal(preview.pricingVersion, null);
  assert.equal(preview.readinessStatus, "provider_not_configured");
});

test("Sprint 2-G: unresolvedFields 존재 및 필수 요소 미선택 시 needs_review 테스트", () => {
  const issueId = "issue_con_01";
  const selectedPartialElements: SelectedVisualElement[] = [
    {
      category: "composition",
      sourceRecipeId: "r_01",
      sourceParticipantId: "U-001",
      sourceParticipantRole: "director",
      selectedValue: "35mm 와이드 샷",
      selectedBy: "한지우",
      selectedAt: new Date().toISOString(),
      evidenceUids: ["U-001"],
    },
  ];

  const consolidatedPartial = createConsolidatedExplorationRecipe(issueId, [], selectedPartialElements, "한지우", 1);
  assert.ok(consolidatedPartial.unresolvedFields.length > 0);
  assert.equal(consolidatedPartial.status, "needs_review"); // 미선택 요소가 있으므로 ready_for_resolution 불허!

  // 모든 필수 요소 선택 시
  const selectedFullElements: SelectedVisualElement[] = [
    { category: "composition", sourceRecipeId: "r_1", sourceParticipantId: "u1", sourceParticipantRole: "director", selectedValue: "35mm", selectedBy: "d", selectedAt: "", evidenceUids: ["u1"] },
    { category: "subjectPresence", sourceRecipeId: "r_1", sourceParticipantId: "u1", sourceParticipantRole: "director", selectedValue: "부재", selectedBy: "d", selectedAt: "", evidenceUids: ["u1"] },
    { category: "lighting", sourceRecipeId: "r_1", sourceParticipantId: "u1", sourceParticipantRole: "director", selectedValue: "사이드 조명", selectedBy: "d", selectedAt: "", evidenceUids: ["u1"] },
    { category: "colorIntent", sourceRecipeId: "r_1", sourceParticipantId: "u1", sourceParticipantRole: "director", selectedValue: "청록빛", selectedBy: "d", selectedAt: "", evidenceUids: ["u1"] },
    { category: "environment", sourceRecipeId: "r_1", sourceParticipantId: "u1", sourceParticipantRole: "director", selectedValue: "수영장", selectedBy: "d", selectedAt: "", evidenceUids: ["u1"] },
  ];

  const consolidatedFull = createConsolidatedExplorationRecipe(issueId, [], selectedFullElements, "한지우", 1);
  assert.equal(consolidatedFull.unresolvedFields.length, 0);
  assert.equal(consolidatedFull.status, "ready_for_resolution");
});

test("Sprint 2-G: Exploration 이미지의 TAKE, Reference 승격, Candidate 변환, canBeTaken 위조 차단 도메인 테스트", () => {
  const explorationImage = { id: "img_exp_01", tier: "exploration" as const, canBeTaken: false as const };

  // 1. Exploration TAKE 차단
  assert.throws(() => validateImageTakePermission(explorationImage as any), ExplorationImageTakeForbiddenError);

  // 2. Exploration Reference 승격 차단
  assert.throws(() => promoteToShotReference(explorationImage as any), ExplorationShotReferencePromotionForbiddenError);

  // 3. Exploration Production Candidate 직접 변환 차단
  assert.throws(() => convertToProductionCandidateDirectly(explorationImage as any), ExplorationDirectProductionCandidateForbiddenError);

  // 4. canBeTaken: true 필드 위조 시도 차단
  const tamperedImage = { id: "img_fake_01", tier: "exploration" as const, canBeTaken: true as any };
  assert.throws(() => validateImageTakePermission(tamperedImage as any), ExplorationFakeCanBeTakenTamperingError);
});
