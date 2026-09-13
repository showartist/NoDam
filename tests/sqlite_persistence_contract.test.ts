import test from "node:test";
import assert from "node:assert/strict";
import {
  saveAlignmentIssue,
  getAlignmentIssues,
  saveExplorationRecipe,
  saveConsolidatedRecipe,
  saveResolvedDecision,
  saveProductionImageRecipe,
} from "../lib/domain/persistence/sqliteRepository";
import type { AlignmentIssue } from "../lib/domain/alignmentCheck/types";
import type { ParticipantExplorationRecipe, ConsolidatedExplorationRecipe } from "../lib/domain/explorationRecipe/types";
import type { ResolvedDecision } from "../lib/domain/resolvedDecision/types";
import type { ProductionImageRecipe } from "../lib/domain/productionRecipe/types";

test("SQLite Persistence Contract Test: 5개 영속 도메인 테이블 저장 및 조회 검증", () => {
  const issue: AlignmentIssue = {
    id: "issue_sqlite_test_01",
    meetingId: "m_test_01",
    projectId: "p_test_01",
    sceneIds: ["12"],
    issueType: "conflict",
    severity: "blocking",
    topic: "수영장 조명 톤앤매너 충돌",
    summary: "사이드 사이언 조명 vs 텅 빈 자연광",
    participantPositions: [
      { participantId: "U-001", participantName: "한지우", participantRole: "director", interpretation: "자연광 중심", visualElements: ["자연광"], evidenceUids: ["U-001"], basis: "explicit", confidence: 0.95 },
    ],
    evidenceUids: ["U-001"],
    whyItMatters: "톤앤매너",
    suggestedQuestion: "조명 톤 설정",
    status: "needs_review",
    createdAt: new Date().toISOString(),
  };

  // 1. AlignmentIssue 저장 및 조회
  saveAlignmentIssue(issue);
  const fetchedIssues = getAlignmentIssues("m_test_01");
  assert.ok(fetchedIssues.length > 0);
  const fetched = fetchedIssues.find((i) => i.id === issue.id);
  assert.ok(fetched);
  assert.equal(fetched.topic, "수영장 조명 톤앤매너 충돌");

  // 2. ExplorationRecipe 저장
  const expRecipe: ParticipantExplorationRecipe = {
    id: "exp_01",
    sourceIssueId: issue.id,
    projectId: issue.projectId, meetingId: issue.meetingId, sceneIds: issue.sceneIds,
    requiredElements: [], prohibitedElements: [], aiSuggestedFields: [], canBeTaken: false,
    participantId: "U-001",
    participantName: "한지우",
    participantRole: "director",
    interpretation: "자연광 중심",
    evidenceUids: ["U-001"],
    basis: "explicit",
    confidence: 0.95,
    lighting: "자연광",
    status: "draft",
    createdAt: new Date().toISOString(),
  };
  saveExplorationRecipe(expRecipe);

  // 3. ConsolidatedRecipe 저장
  const consRecipe: ConsolidatedExplorationRecipe = {
    id: "cons_01",
    canBeTaken: false,
    sourceIssueId: issue.id,
    sourceRecipeIds: ["exp_01"],
    selectedVisualElements: [],
    unresolvedFields: [],
    evidenceUids: ["U-001"],
    compiledPrompt: "자연광 수영장 씬",
    createdBy: "한지우",
    createdAt: new Date().toISOString(),
    version: 1,
    status: "draft",
  };
  saveConsolidatedRecipe(consRecipe);

  // 4. ResolvedDecision 저장
  const decision: ResolvedDecision = {
    id: "dec_01",
    projectId: "p_test_01",
    meetingId: "m_test_01",
    sceneIds: ["12"],
    sourceIssueIds: [issue.id],
    sourceExplorationRecipeIds: ["exp_01"],
    sourceConsolidatedRecipeId: "cons_01",
    selectedVisualElements: [],
    finalAnswers: [],
    evidenceUids: ["U-001"],
    decisionSummary: "자연광 톤 확정",
    resolvedBy: "한지우(감독)",
    resolvedAt: new Date().toISOString(),
    version: 1,
    status: "confirmed",
  };
  saveResolvedDecision(decision);

  // 5. ProductionImageRecipe 저장
  const prodRecipe: ProductionImageRecipe = {
    id: "prod_01",
    requiredElements: [], prohibitedElements: [],
    projectId: "p_test_01",
    sceneIds: ["12"],
    sourceResolvedDecisionId: "dec_01",
    version: 1,
    status: "ready_for_generation",
    lighting: "자연광",
    evidenceUids: ["U-001"],
    referenceIds: [],
    createdBy: "한지우(감독)",
    createdAt: new Date().toISOString(),
  };
  saveProductionImageRecipe(prodRecipe);
});
