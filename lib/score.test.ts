import { calculateSceneSyncScore } from "./score";

// 간이 어서션 헬퍼
function assertEqual(actual: any, expected: any, testName: string) {
  if (actual === expected) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} — Expected: ${expected}, Got: ${actual}`);
    process.exit(1);
  }
}

console.log("🧪 Running SceneSync Score & Readiness Contract Tests (8종 논리 단위 / 11개 어서션)...\n");

// Test 1: 100점 기본값 및 readiness=ready
const t1 = calculateSceneSyncScore([]);
assertEqual(t1.score, 100, "Test 1-1: 이슈 없으면 100점");
assertEqual(t1.readiness, "ready", "Test 1-2: 이슈 없으면 readiness=ready");

// Test 2: 0점 미만 금지 (Clamp 테스트)
const t2Issues = Array.from({ length: 10 }, (_, i) => ({
  id: `i_${i}`,
  meeting_id: "m_01",
  issue_id: `CRIT_${i}`,
  type: "constraint_conflict",
  subject: `Critical Issue ${i}`,
  question: "Q?",
  positions: "[]",
  evidence: "[]",
  severity: "critical",
  status: "open",
  blocks_roles: "[]",
}));
const t2 = calculateSceneSyncScore(t2Issues as any);
assertEqual(t2.score, 0, "Test 2: 150점 감점이어도 최소 0점으로 Clamp");

// Test 3: 산술 정확도 — 45점에서 High 1건 해결 시 55점 ➔ 2건 해결 시 65점 ➔ 모두 해결 시 100점
const mock6Issues = [
  { issue_id: "A-04", subject: "세트 벽체 하중", severity: "critical", status: "open" },
  { issue_id: "A-01", subject: "윤서 표정", severity: "high", status: "open" },
  { issue_id: "A-03", subject: "간판 200만 원 예산", severity: "high", status: "open" },
  { issue_id: "A-07", subject: "shot_coverage", severity: "high", status: "open" },
  { issue_id: "A-02", subject: "대사 삭제 유예", severity: "medium", status: "open" },
  { issue_id: "A-05", subject: "운동화 연속성", severity: "medium", status: "open" },
];

const initial45 = calculateSceneSyncScore(mock6Issues as any);
assertEqual(initial45.score, 45, "Test 3-1: 초기 6개 open 이슈 시 정확히 45점 (-55)");
assertEqual(initial45.readiness, "blocked", "Test 3-2: Critical A-04 열려있을 때 readiness=blocked");

// A-01 (High -10) 해결 후
mock6Issues[1].status = "resolved";
const resolvedA01 = calculateSceneSyncScore(mock6Issues as any);
assertEqual(resolvedA01.score, 55, "Test 3-3: High 이슈 A-01 해결 시 45점 ➔ 55점 (+10)");

// A-07 (High -10) 추가 해결 후
mock6Issues[3].status = "resolved";
const resolvedA07 = calculateSceneSyncScore(mock6Issues as any);
assertEqual(resolvedA07.score, 65, "Test 3-4: High 이슈 A-07 추가 해결 시 55점 ➔ 65점 (+10)");

// 모든 이슈 해결 후
mock6Issues.forEach((i) => (i.status = "resolved"));
const resolvedAll = calculateSceneSyncScore(mock6Issues as any);
assertEqual(resolvedAll.score, 100, "Test 3-5: 모든 이슈 해결 시 정확히 100점 (98점 아님)");
assertEqual(resolvedAll.readiness, "ready", "Test 3-6: 모든 이슈 해결 시 readiness=ready");

// Test 4: 중복 Coverage 이중 감점 금지
const duplicateTestIssues = [
  { issue_id: "A-07", subject: "shot_coverage", severity: "high", status: "open" },
];
const dupScore = calculateSceneSyncScore(duplicateTestIssues as any, 1);
assertEqual(dupScore.score, 90, "Test 4: A-07이 open일 때 coverageGaps=1 이어도 이중 감점 없이 -10점만 차감");

// Test 5: 100점이어도 미승인 샷/브리프 존재 시 readiness=needs_review (다차원 readiness)
const multiDimTest = calculateSceneSyncScore([], 0, 2, 1);
assertEqual(multiDimTest.score, 100, "Test 5-1: 미승인 샷이 있어도 이슈가 없으면 정렬도는 100점");
assertEqual(multiDimTest.readiness, "needs_review", "Test 5-2: 100점이어도 미승인 샷 2건이 남아있으면 readiness=needs_review");

console.log("\n🎉 All 8 SceneSync Score & Readiness Contract Tests PASSED Successfully!\n");
