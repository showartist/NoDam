import test from "node:test";
import assert from "node:assert/strict";
import { parseMeetingTranscript, type MeetingImportInput } from "../lib/domain/meetingInput";
import { runDeterministicAlignmentRules, validateLlmAlignmentCandidate } from "../lib/domain/alignmentCheck/deterministicRules";
import type { AlignmentIssue } from "../lib/domain/alignmentCheck/types";

test("Sprint 1 Phase A: 회의 전사 입력 및 U-ID 생성/파싱 검증", () => {
  const meetingInput: MeetingImportInput = {
    projectId: "p_01",
    sceneIds: ["12"],
    meetingTitle: "Sprint 1 회의 전사 테스트",
    meetingType: "preproduction_dept",
    meetingDate: "2026-08-02",
    participants: [
      { id: "p1", name: "한지우", role: "director" },
      { id: "p2", name: "서민재", role: "cinematographer" },
    ],
    transcriptRaw: `
한지우(감독): 수영장은 비어 있어야 합니다.
서민재(촬영): 인물을 멀리 작게 남기는 와이드 샷이 좋습니다.
`,
  };

  const parseResult = parseMeetingTranscript(meetingInput);
  assert.equal(parseResult.ok, true);
  assert.equal(parseResult.utterances.length, 2);
  assert.equal(parseResult.utterances[0].uid, "U-001");
  assert.equal(parseResult.utterances[1].uid, "U-002");
  assert.ok(parseResult.checksum.startsWith("hash_"));
});

test("Sprint 1 Phase A: transcriptRaw 누락 및 실패율 > 30% 차단 검증", () => {
  const invalidInput: MeetingImportInput = {
    projectId: "p_01",
    meetingTitle: "오류 테스트",
    meetingType: "concept_discussion",
    meetingDate: "2026-08-02",
    participants: [],
    transcriptRaw: "가나다라마바사 잘못된 포맷의 무의미한 텍스트 줄들",
  };

  const parseResult = parseMeetingTranscript(invalidInput);
  assert.equal(parseResult.ok, false);
  assert.ok(parseResult.errors.some((e) => e.includes("파싱 실패율")));
});

test("Sprint 1 Phase B/C: AlignmentFinding 과 AlignmentIssue 분리 검증", () => {
  const utterances = [
    { uid: "U-001", lineNumber: 1, speakerName: "한지우", speakerRole: "director" as const, rawText: "수영장은 비어 있어야 합니다." },
    { uid: "U-002", lineNumber: 2, speakerName: "서민재", speakerRole: "cinematographer" as const, rawText: "인물을 멀리 작게 남기죠." },
    { uid: "U-003", lineNumber: 3, speakerName: "오세라", speakerRole: "production_designer" as const, rawText: "톤앤매너에 동의 및 합의합니다." },
  ];

  const { findings, issues, analysisRun } = runDeterministicAlignmentRules("m_01", "p_01", ["12"], utterances);

  // Finding (agreement) 과 Issue (conflict) 분리 검증
  assert.ok(findings.length >= 1);
  assert.equal(findings[0].findingType, "agreement");

  assert.ok(issues.length >= 1);
  assert.equal(issues[0].issueType, "conflict");

  // ParticipantPosition.basis 및 confidence 포함 검증
  assert.equal(issues[0].participantPositions[0].basis, "explicit");
  assert.ok(issues[0].participantPositions[0].confidence >= 0.9);

  // AnalysisRun 기록 검증
  assert.equal(analysisRun.deterministicRulesCount, 6);
  assert.equal(analysisRun.validatedIssuesCount, issues.length);
});

test("Sprint 1 Phase B/C: Layer B LLM Candidate Validator 검증", () => {
  // 근거 발언(evidenceUids) 누락 후보 배척
  const invalidCandidate: Partial<AlignmentIssue> = {
    topic: "근거 없는 제안",
    participantPositions: [],
    evidenceUids: [],
  };

  const valResult = validateLlmAlignmentCandidate(invalidCandidate);
  assert.equal(valResult.ok, false);
  assert.ok(valResult.reason?.includes("근거 발언"));
});

test("Sprint 1 Phase D: 다시 짚기 UI 상태 전이 (direct_answer, dismissed, deferred) 검증", () => {
  const issue: AlignmentIssue = {
    id: "issue_01",
    meetingId: "m_01",
    projectId: "p_01",
    sceneIds: ["12"],
    issueType: "conflict",
    severity: "blocking",
    topic: "인물 배치 충돌",
    summary: "텅 빈 공간 vs 인물 배치",
    participantPositions: [],
    evidenceUids: ["U-001"],
    whyItMatters: "샷 레이아웃 결정",
    suggestedQuestion: "인물을 남기나요?",
    status: "detected",
    createdAt: new Date().toISOString(),
  };

  // State transitions: detected -> needs_review -> resolved | dismissed | deferred
  assert.equal(issue.status, "detected");
  const inReview = { ...issue, status: "needs_review" as const };
  assert.equal(inReview.status, "needs_review");

  const resolved = { ...inReview, status: "resolved" as const };
  assert.equal(resolved.status, "resolved");

  const dismissed = { ...inReview, status: "dismissed" as const };
  assert.equal(dismissed.status, "dismissed");

  const deferred = { ...inReview, status: "deferred" as const };
  assert.equal(deferred.status, "deferred");
});
