import test from "node:test";
import assert from "node:assert/strict";
import { parseMeetingTranscript, type MeetingImportInput } from "../lib/domain/meetingInput";
import { runDeterministicAlignmentRules } from "../lib/domain/alignmentCheck/deterministicRules";
import { resolveAlignmentIssues } from "../lib/domain/alignmentCheck/resolver";
import {
  validateImageTakePermission,
  ExplorationImageTakeForbiddenError,
  createProductionCandidate,
  type ExplorationImage,
  type SelectedElement,
} from "../lib/domain/visualSynthesis";

test("Phase H — Vertical Core MVP 10단계 E2E 전체 흐름 시뮬레이션 검증", () => {
  // 1. 회의 전사 입력 수신
  const meetingInput: MeetingImportInput = {
    projectId: "p_01",
    sceneIds: ["12"],
    meetingTitle: "SCENE 12 프리프로덕션 4인 회의",
    meetingType: "preproduction_dept",
    meetingDate: "2026-08-02",
    participants: [
      { id: "p1", name: "한지우", role: "director" },
      { id: "p2", name: "서민재", role: "cinematographer" },
      { id: "p3", name: "오세라", role: "production_designer" },
      { id: "p4", name: "강태수", role: "producer" },
    ],
    transcriptRaw: `
한지우(감독): 인물 없는 텅 빈 수영장 공간이었으면 좋겠습니다.
서민재(촬영): 인물을 멀리 작게 남기는 와이드 샷이 감정 잡기에 좋습니다.
오세라(미술): 청록빛 젖은 타일 반사를 꼭 살리고 폐허처럼 부서진 질감을 주죠.
한지우(감독): 너무 폐허처럼 보이면 안 되고 적막한 분위기여야 합니다.
강태수(제작): 현장에서 과한 조명은 금지하고 차갑게 가죠.
오세라(미술): 전체 톤앤매너와 분위기에 동의 및 합의합니다.
`,
  };

  // Step 1: 전사 파싱 검증
  const parseResult = parseMeetingTranscript(meetingInput);
  assert.equal(parseResult.ok, true);
  assert.equal(parseResult.utterances.length, 6);
  assert.equal(parseResult.utterances[0].uid, "U-001");

  // Step 2: 10대 결정론적 동상이몽 탐지
  const { findings, issues } = runDeterministicAlignmentRules(
    "m_test_01",
    meetingInput.projectId,
    meetingInput.sceneIds!,
    parseResult.utterances
  );

  assert.ok(issues.length >= 2);
  assert.ok(findings.length >= 1);
  const conflictIssue = issues.find((i) => i.issueType === "conflict" && i.severity === "blocking");
  assert.ok(conflictIssue);
  assert.equal(conflictIssue?.topic, "인물 존재 여부 및 공간 배치 충돌");

  // Step 3: 화자/부서별 position 분리 확인
  assert.ok(conflictIssue.participantPositions.length >= 2);
  const directorPos = conflictIssue.participantPositions.find((p) => p.participantRole === "director");
  const dopPos = conflictIssue.participantPositions.find((p) => p.participantRole === "cinematographer");
  assert.ok(directorPos);
  assert.ok(dopPos);

  // Step 4: Exploration Image 생성 및 TAKE 하드 차단 검증
  const explorationImage: ExplorationImage = {
    id: "img_exp_dir_01",
    tier: "exploration",
    speakerRole: "director",
    groundingUids: directorPos.evidenceUids,
    derivedPrompt: "텅 빈 수영장 공간",
    imageUri: "",
    visualParameters: { emotionAndTone: "적막함, 텅 빔" },
    canBeTaken: false,
    createdAt: new Date().toISOString(),
  };

  assert.throws(
    () => validateImageTakePermission(explorationImage),
    ExplorationImageTakeForbiddenError
  );

  // Step 5: 인간 주도 요소 선택 (Director + DOP + Art)
  const selectedElements: SelectedElement[] = [
    {
      sourceImageId: "img_exp_dir_01",
      sourceSpeakerRole: "director",
      category: "emotionAndTone",
      selectedText: "적막한 분위기와 적막함",
    },
    {
      sourceImageId: "img_exp_dop_01",
      sourceSpeakerRole: "cinematographer",
      category: "shotSizeAndLens",
      selectedText: "인물을 멀리 남기는 35mm 와이드 샷",
    },
    {
      sourceImageId: "img_exp_art_01",
      sourceSpeakerRole: "production_designer",
      category: "textureAndColor",
      selectedText: "청록빛 젖은 타일 질감",
    },
  ];

  // Step 6: Conflict 해결 및 통합 레시피 생성 ➔ Production Candidate 상태 전환
  const { resolvedDecision, updatedIssues } = resolveAlignmentIssues(
    meetingInput.projectId,
    12,
    issues,
    selectedElements,
    "한지우(감독)"
  );

  assert.equal(resolvedDecision.selectedVisualElements.length, 3);
  assert.equal(updatedIssues.every((i) => i.status === "resolved"), true);

  // Step 7: Production Candidate 이미지 생성 및 TAKE 허용 검증
  const candidate = createProductionCandidate(resolvedDecision.integratedRecipe, 1, "/assets/candidate_1.png");
  assert.equal(candidate.tier, "production_candidate");
  assert.equal(validateImageTakePermission(candidate), true);
});
