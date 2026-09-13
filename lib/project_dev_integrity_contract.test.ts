import projectDevData from "../fixtures/film/project_dev_breath.json";
import { evaluateCharacterFieldState, getProjectIssueImpact, classifyBriefState } from "./project_dev_view";

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

console.log("🧪 Running SceneSync Project Development Integrity Contract Suite...\n");

// ── 1. Visual Alignment 레퍼런스 비주얼 카드 및 4개 역할 분리 렌더 계약 ────
const vRefs = projectDevData.visual_references;
assertTrue(vRefs.length >= 2, "Contract 1-1: Visual References 2건 이상 수록 확인");

const r01 = vRefs.find((r) => r.id === "R-01");
assertTrue(r01 !== undefined && (r01 as any).image_url !== undefined, "Contract 1-2: R-01 레퍼런스 비주얼 이미지 URL 포함 확인");
assertTrue(r01?.role_interpretations.director.length! > 0, "Contract 1-3: 감독 시각 해석 수록");
assertTrue(r01?.role_interpretations.writer.length! > 0, "Contract 1-4: 작가 시각 해석 수록");
assertTrue(r01?.role_interpretations.art_director.length! > 0, "Contract 1-5: 미술감독 시각 해석 수록");
assertTrue(r01?.role_interpretations.producer.length! > 0, "Contract 1-6: 제작PD 시각 해석 수록");

// ── 2. Character Bible 필드 분해 및 승인 상태/근거 추적 계약 ───────────
// evaluateCharacterFieldState 본체는 lib/project_dev_view.ts 로 이동함 (Workbench.tsx 가 실제로 쓴다).
const wantState = evaluateCharacterFieldState("external_goal");
assertEqual(wantState.state, "confirmed", "Contract 2-1: Character Want 필드 confirmed 상태 검증");
assertEqual(wantState.approver, "작가 최은서", "Contract 2-2: Character Want 승인자 작가 최은서 연동 검증");

// ── 3. Project Issue 파급 영향 범위 (Stale Impact Scope) 계약 ────────────
// getProjectIssueImpact 본체는 lib/project_dev_view.ts 로 이동함.
const impactP01 = getProjectIssueImpact("P-01");
assertTrue(impactP01.impactScope.includes("Character.wound"), "Contract 3-1: P-01 파급 영향 Character.wound 수록 검증");
assertTrue(impactP01.linkedScenes.includes("SCENE 34"), "Contract 3-2: P-01 관련 씬 SCENE 34 연동 검증");

// ── 4. Scene Brief 4단계 세분화 상태 분류 계약 ───────────────────────
// classifyBriefState 본체는 lib/project_dev_view.ts 로 이동함.
assertEqual(classifyBriefState("LOCATION").label, "🟢 확정", "Contract 4-1: 장명 명세 장소 확정 표기 검증");
assertEqual(classifyBriefState("SAFETY_CONSTRAINTS").label, "🔴 제작 차단", "Contract 4-2: 안전 제약 제작 차단 표기 검증");

console.log("\n🎉 Project Development Integrity Contract Suite PASSED 100%!\n");
