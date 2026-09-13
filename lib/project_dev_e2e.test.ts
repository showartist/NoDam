import projectDevData from "../fixtures/film/project_dev_breath.json";
import meetingInput from "../fixtures/inputs/project_dev_meeting_e2e.json";
import { evaluateCascadingStale, type ProjectChange, type SceneTarget } from "./cascading";

function assertEqual(actual: any, expected: any, testName: string) {
  if (actual === expected) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} — Expected: ${expected}, Got: ${actual}`);
    process.exit(1);
  }
}

function assertTrue(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} — Condition evaluated to false`);
    process.exit(1);
  }
}

console.log("🧪 Running Full E2E Pipeline Test: Project Development & Selective Cascade...\n");

// E2E Step 1: 개발 회의 전사 입력 수신 검증
assertEqual(meetingInput.meeting_id, "m_proj_dev_01", "E2E Step 1: 신규 개발 회의 전사 정상 수신");
assertEqual(meetingInput.utterances.length, 5, "E2E Step 1-2: 5개 핵심 발언 입력 확인");

// E2E Step 2: Project Bible 필드 완전성 및 로그라인 검증
const pb = projectDevData.project_bible;
assertTrue(pb.logline.includes("실종된 동생"), "E2E Step 2-1: 로그라인 정상 등록");
assertTrue(pb.theme.length > 0, "E2E Step 2-2: 주제 (Theme) 정상 등록");

// E2E Step 3: 캐릭터 동기 충돌 (P-01) 감지 검증
const charIssue = projectDevData.project_issues.find((i) => i.issue_id === "P-01");
assertTrue(charIssue !== undefined, "E2E Step 3-1: 캐릭터 동기 충돌 P-01 감지 확인");
assertEqual(charIssue?.scope, "character", "E2E Step 3-2: Scope=character 설정 확인");

// E2E Step 4: Visual Reference 4대 부서 해석 비교 검증
const r01 = projectDevData.visual_references.find((r) => r.id === "R-01");
assertTrue(r01 !== undefined, "E2E Step 4-1: R-01 시각 레퍼런스 존재");
assertTrue(r01?.role_interpretations.director !== undefined, "E2E Step 4-2: 감독 해석 수록");
assertTrue(r01?.role_interpretations.writer !== undefined, "E2E Step 4-3: 작가 해석 수록");
assertTrue(r01?.role_interpretations.art_director !== undefined, "E2E Step 4-4: 미술감독 해석 수록");
assertTrue(r01?.role_interpretations.producer !== undefined, "E2E Step 4-5: 제작PD 해석 수록");

// E2E Step 5: 동일 키워드 다지점 시각 해석 동상이몽 (Visual Alignment Issue) 감지 검증
const valIssue = projectDevData.visual_alignment_issues[0];
assertTrue(valIssue !== undefined, "E2E Step 5-1: Visual Alignment Issue 존재");
assertEqual(valIssue.keyword, "서늘한 새벽 수영장 (Cool Dawn Pool)", "E2E Step 5-2: 동상이몽 키워드 수록 일치");
assertTrue(valIssue.question.length > 0, "E2E Step 5-3: 확인 질문 도출 완료");

// E2E Step 6: include / exclude 명시 검증
assertTrue(r01?.include_elements.length! > 0, "E2E Step 6-1: include_elements 명시 완비");
assertTrue(r01?.exclude_elements.length! > 0, "E2E Step 6-2: exclude_elements 명시 완비");

// E2E Step 7: Visual Principle VP-01 승인 검증
const vp = projectDevData.visual_principles[0];
assertEqual(vp.status, "approved", "E2E Step 7: Visual Principle 승인 상태 검증");

// E2E Step 8: 선택적 Stale 전파 검증
const scenes: SceneTarget[] = [
  { scene_id: "m_01", scene_number: "SCENE 12", title: "모텔방", characters: ["민규", "지훈"], status: "approved" },
  { scene_id: "m_02", scene_number: "SCENE 34", title: "수영장", characters: ["수현", "민규"], status: "approved" },
];

const arcChange: ProjectChange = {
  id: "c_arc_change",
  scope: "character",
  target_id: "c_01",
  target_name: "수현 (Character Arc)",
  affected_characters: ["수현"],
  before_value: "죄책감 연출",
  after_value: "서늘한 은폐 연출",
  reason: "작가 기획 변경",
  evidence_uids: ["PU02", "PU03"],
  changed_by: "박재인",
  timestamp: "2026-08-01T22:30:00Z",
};

const cascadeResults = evaluateCascadingStale(arcChange, scenes);
const scene12 = cascadeResults.find((r) => r.scene_number === "SCENE 12");
const scene34 = cascadeResults.find((r) => r.scene_number === "SCENE 34");

assertEqual(scene12?.new_status, "unchanged", "E2E Step 8-1: 수현 미등장 SCENE 12 영향 없음 (unchanged)");
assertEqual(scene34?.new_status, "review_required", "E2E Step 8-2: 수현 등장 SCENE 34만 선택적 review_required 전파");

console.log("\n🎉 Full E2E Pipeline Test: Project Development & Selective Cascade PASSED 100%!\n");
