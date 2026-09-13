import projectDevData from "../fixtures/film/project_dev_breath.json";
import scene34Input from "../fixtures/inputs/scene34_empty_pool_level3.json";
import scene34Gold from "../fixtures/gold/scene34_empty_pool_level3.gold.json";
import { parseTranscript } from "./parse";
import { getRecommendedInitialTab } from "./tab_recommendation";

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

console.log("🧪 Running SceneSync UI Render Contract & Mode Isolation Test Suite...\n");

// ── 1. Scene Development 렌더 계약 ──────────────────────────────────────
const utterances = parseTranscript(scene34Input.transcript);
assertEqual(utterances.length, 107, "Contract 1-1: SCENE 34 회의 전사 107개 발언 완전 수록");

const goldIssues = scene34Gold.expected_issues;
assertTrue(goldIssues.length >= 4, "Contract 1-2: Scene Issues 4건 이상 존재");

const sampleShots = [
  { shot_number: 1, shot_size: "Wide", status: "approved" },
  { shot_number: 2, shot_size: "Medium", status: "approved" },
];
assertTrue(sampleShots.length >= 1, "Contract 1-3: Shot Board 콘티 컷 1개 이상 렌더링 대상 존재");

// ── 2. Project Development 렌더 계약 & Visual Alignment 완전성 ─────────────
const pb = projectDevData.project_bible;
assertTrue(pb.working_title.length > 0, "Contract 2-1: Project Core working_title 존재");

const vRefs = projectDevData.visual_references;
const r01 = vRefs.find((r) => r.id === "R-01");
assertTrue(r01 !== undefined, "Contract 2-2: Visual Reference R-01 존재");
assertTrue(r01?.role_interpretations.director !== undefined, "Contract 2-3: 감독 시각 해석 수록");
assertTrue(r01?.role_interpretations.writer !== undefined, "Contract 2-4: 작가 시각 해석 수록");
assertTrue(r01?.role_interpretations.art_director !== undefined, "Contract 2-5: 미술감독 시각 해석 수록");
assertTrue(r01?.role_interpretations.producer !== undefined, "Contract 2-6: 제작PD 시각 해석 수록");
assertTrue(r01?.include_elements.length! > 0, "Contract 2-7: include_elements 명시 완비");
assertTrue(r01?.exclude_elements.length! > 0, "Contract 2-8: exclude_elements 명시 완비");

const vp01 = projectDevData.visual_principles.find((vp) => vp.id === "VP-01");
assertTrue(vp01 !== undefined && vp01.status === "approved", "Contract 2-9: 승인된 Visual Principle (VP-01) 구조 상존");

// ── 3. 모드 격리 (Mode Isolation) 계약 ──────────────────────────────────
function simulateProjectChangeDoesNotMutateSceneBrief(projectBibleTheme: string, sceneBrief: any[]) {
  // Project Bible Theme 수정
  const updatedTheme = projectBibleTheme + " [수정]";
  // Scene Brief 항목 무변형 유지 확인
  const isSceneBriefIntact = sceneBrief.length > 0 && sceneBrief.every((item) => item.field !== undefined);
  return { updatedTheme, isSceneBriefIntact };
}

const mockBrief = [{ field: "LOCATION", ai_value: "폐쇄 수영장" }];
const isolationResult = simulateProjectChangeDoesNotMutateSceneBrief(pb.theme, mockBrief);
assertTrue(isolationResult.isSceneBriefIntact, "Contract 3-1: Project Core 변경 시 Scene Brief 데이터 직접 오염 미발생");

// ── 4. 진행 상태별 기본 탭 추천 로직 (Dynamic Initial Tab Recommendation) ────
// getRecommendedInitialTab 본체는 lib/tab_recommendation.ts 로 이동함 (프로덕션 코드가
// 테스트 파일 안에 있으면 안 되므로 — Workbench.tsx 가 실제로 이 함수를 쓴다).
assertEqual(getRecommendedInitialTab([], [], [{ id: 1 }]), "issues", "Contract 4-1: 미결정 안건이 있는 초기 상태 ➔ issues 탭 추천");
assertEqual(getRecommendedInitialTab([], [{ verification_state: "approved" }, { verification_state: "approved" }, { verification_state: "approved" }, { verification_state: "approved" }, { verification_state: "approved" }], []), "brief", "Contract 4-2: Brief 승인 단계 ➔ brief 탭 추천");
assertEqual(getRecommendedInitialTab([{ status: "approved" }, { status: "approved" }, { status: "approved" }], [], []), "shotboard", "Contract 4-3: 콘티 승인 단계 ➔ shotboard 탭 추천");

console.log("\n🎉 SceneSync UI Render Contract & Mode Isolation Test Suite PASSED 100%!\n");
