import scene34Input from "../fixtures/inputs/scene34_empty_pool_level3.json";
import scene34Gold from "../fixtures/gold/scene34_empty_pool_level3.gold.json";
import { parseTranscript } from "./parse";
import { filterUtterancesBySemantic, getUidLinkageNode, formatCompactHeader, type SemanticFilterType } from "./transcript_filters";

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

console.log("🧪 Running SceneSync Transcript Linkage & Semantic Filter Contract Suite...\n");

const utterances = parseTranscript(scene34Input.transcript);

// ── 1. 의미 기반 필터 (Semantic Filters) 테스트 ─────────────────────────
// SemanticFilterType/filterUtterancesBySemantic 본체는 lib/transcript_filters.ts 로 이동함
// (Workbench.tsx 가 실제로 쓴다).
const mockShots = [
  { shot_number: 1, evidence: JSON.stringify(["U53", "U54"]) },
  { shot_number: 3, evidence: JSON.stringify(["U57", "U58", "U64"]) },
];

const issueEvidenceRows = filterUtterancesBySemantic(utterances, "issue_evidence", scene34Gold.expected_issues, mockShots);
assertTrue(issueEvidenceRows.length > 0 && issueEvidenceRows.some((r) => r.uid === "U04"), "Contract 1-1: 이슈 근거 발언 필터링 작동 검증 (U04 수록)");

const shotEvidenceRows = filterUtterancesBySemantic(utterances, "shot_evidence", scene34Gold.expected_issues, mockShots);
assertTrue(shotEvidenceRows.length > 0 && shotEvidenceRows.some((r) => r.uid === "U57"), "Contract 1-2: 쇼트 근거 발언 필터링 작동 검증 (U57 수록)");

// ── 2. U-ID 상호 연결 노드 (Linkage Map) 테스트 ────────────────────────
// getUidLinkageNode 본체는 lib/transcript_filters.ts 로 이동함.
const nodeU57 = getUidLinkageNode("U57", scene34Gold.expected_issues, mockShots, []);
assertTrue(nodeU57.shots.includes(3), "Contract 2-1: U57 ➔ SHOT 03 연결 노드 확인");

// ── 3. 컴팩트 헤더 렌더링 포맷 테스트 ───────────────────────────────
// formatCompactHeader 본체는 lib/transcript_filters.ts 로 이동함.
const headerFormatted = formatCompactHeader("U01", "00:00", "이지현", "PROD · 제작");
assertEqual(headerFormatted, "U01 · 00:00 · 이지현 · PROD · 제작", "Contract 3-1: 컴팩트 스캔 헤더 포맷 검증");

console.log("\n🎉 Transcript Linkage & Semantic Filter Contract Suite PASSED 100%!\n");
