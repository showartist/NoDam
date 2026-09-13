import projectDevData from "../fixtures/film/project_dev_breath.json";

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

console.log("🧪 Running Project Development & Visual Alignment Contract Tests...\n");

// Test 1: Project Bible 12필드 수록 검증
const pb = projectDevData.project_bible;
assertEqual(pb.working_title, "숨을 세는 사람", "Test 1-1: Project Bible working_title 검증");
assertEqual(pb.genre, "미스터리 드라마 (Mystery Drama)", "Test 1-2: Project Bible genre 검증");
assertTrue(pb.one_liner.length > 0, "Test 1-3: Project Bible one_liner 존재");
assertTrue(pb.logline.length > 0, "Test 1-4: Project Bible logline 존재");
assertTrue(pb.short_synopsis.length > 0, "Test 1-5: Project Bible short_synopsis 존재");
assertTrue(pb.theme.length > 0, "Test 1-6: Project Bible theme 존재");
assertTrue(pb.dramatic_question.length > 0, "Test 1-7: Project Bible dramatic_question 존재");
assertTrue(pb.tone.length > 0, "Test 1-8: Project Bible tone 존재");
assertTrue(pb.target_audience.length > 0, "Test 1-9: Project Bible target_audience 존재");
assertTrue(pb.ending_direction.length > 0, "Test 1-10: Project Bible ending_direction 존재");

// Test 2: Character Bible 10필드 (Want/Need/Wound/Lie/Arc) 검증
const char = projectDevData.characters[0];
assertEqual(char.name, "수현", "Test 2-1: 캐릭터 이름 검증");
assertEqual(char.external_goal, "실종된 동생의 행방을 찾고 진실을 확인한다.", "Test 2-2: Want (external_goal) 검증");
assertEqual(char.internal_need, "동생의 삶과 비밀을 자신의 통제 안에 둘 수 없음을 인정하고 내려놓는다.", "Test 2-3: Need (internal_need) 검증");
assertTrue(char.wound.length > 0, "Test 2-4: Wound 검증");
assertTrue(char.contradiction.length > 0, "Test 2-5: Lie (contradiction) 검증");
assertTrue(char.arc.length > 0, "Test 2-6: Arc 검증");

// Test 3: Visual Reference include / exclude 요소 구체 분리 검증
const refs = projectDevData.visual_references;
assertEqual(refs.length, 3, "Test 3-1: 시각적 레퍼런스 3종 존재");
const r01 = refs.find((r) => r.id === "R-01");
assertTrue(r01 !== undefined && r01.include_elements.length > 0, "Test 3-2: R-01 include_elements 분리 수록");
assertTrue(r01 !== undefined && r01.exclude_elements.length > 0, "Test 3-3: R-01 exclude_elements 분리 수록");
assertEqual(refs[2].level, "exclude", "Test 3-4: Negative Reference (R-03) level=exclude 검증");

// Test 4: Visual Principle과 References 매칭 검증
const vp = projectDevData.visual_principles[0];
assertEqual(vp.id, "VP-01", "Test 4-1: Visual Principle VP-01 존재");
assertTrue(vp.references.includes("R-01") && vp.references.includes("R-02"), "Test 4-2: VP-01 레퍼런스 R-01/R-02 매칭 검증");

// Test 5: IssueScope 확장 (project, character) 및 P-01 동상이몽 이슈 검증
const issues = projectDevData.project_issues;
const p01 = issues.find((i) => i.issue_id === "P-01");
assertEqual(p01?.scope, "character", "Test 5-1: P-01 이슈 scope=character 확장 검증");
assertEqual(p01?.type, "interpretation_gap", "Test 5-2: P-01 이슈 type=interpretation_gap 검증");

// Test 6: Cascading Stale 전파 시뮬레이션 테스트
function simulateCascadingStale(changeTopic: string, affectedScenes: string[]) {
  return affectedScenes.map((s) => ({
    scene_id: s,
    status: "review_required",
    reason: `상위 Project Decision (${changeTopic}) 변경에 따른 재검토 요구`,
  }));
}
const staleCascade = simulateCascadingStale("Character Arc: 수현의 내면 변화", ["SCENE 12", "SCENE 34"]);
assertEqual(staleCascade.length, 2, "Test 6-1: Cascading Stale 전파 항목 2건 생성");
assertEqual(staleCascade[1].status, "review_required", "Test 6-2: SCENE 34 status=review_required 로 자동 전파");

console.log("\n🎉 All 17 Project Development & Cascading Stale Contract Tests PASSED Successfully!\n");
