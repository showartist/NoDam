import scene34Input from "../fixtures/inputs/scene34_empty_pool_level3.json";
import { parseTranscript } from "./parse";
import { filterUtterancesByRole, searchUtterancesByKeyword, getEvidenceIndex, TYPOGRAPHY_THEME } from "./transcript_filters";

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

console.log("🧪 Running SceneSync Transcript Navigation & Accessibility Contract Suite...\n");

const utterances = parseTranscript(scene34Input.transcript);

// ── 1. 역할 필터링 로직 계약 ─────────────────────────────────────────────
// filterUtterancesByRole 본체는 lib/transcript_filters.ts 로 이동함 (Workbench.tsx 가 실제로 쓴다).
const directorUtterances = filterUtterancesByRole(utterances, "director");
assertTrue(directorUtterances.length > 0 && directorUtterances.every((u) => u.role === "감독"), "Contract 1-1: 감독 역할 필터 작동 검증");

const writerUtterances = filterUtterancesByRole(utterances, "writer");
assertTrue(writerUtterances.length > 0 && writerUtterances.every((u) => u.role === "작가"), "Contract 1-2: 작가 역할 필터 작동 검증");

// ── 2. 키워드 검색 로직 계약 ─────────────────────────────────────────────
// searchUtterancesByKeyword 본체는 lib/transcript_filters.ts 로 이동함.
const poolSearchResults = searchUtterancesByKeyword(utterances, "수영모");
assertTrue(poolSearchResults.length > 0, "Contract 2-1: '수영모' 키워드 검색 작동 검증");

// ── 3. 근거 네비게이션 시퀀스 계약 ───────────────────────────────────────
// getEvidenceIndex 본체는 lib/transcript_filters.ts 로 이동함.
const mockEvidenceList = ["U53", "U55", "U57", "U64"];
const navInfo = getEvidenceIndex(mockEvidenceList, "U55");
assertEqual(navInfo.index, 2, "Contract 3-1: U55 2번째 근거 인덱스 계산 검증");
assertEqual(navInfo.prevUid, "U53", "Contract 3-2: 이전 근거 U53 선택 계산 검증");
assertEqual(navInfo.nextUid, "U57", "Contract 3-3: 다음 근거 U57 선택 계산 검증");

// ── 4. 명도 계층(Typography Hierarchy) & 중립 지문 스타일 계약 ─────────
// TYPOGRAPHY_THEME 본체는 lib/transcript_filters.ts 로 이동함.
assertEqual(TYPOGRAPHY_THEME.textPrimary, "#0f172a", "Contract 4-1: 장문 본문 안정적 명도 #0f172a 적용 계약");
assertEqual(TYPOGRAPHY_THEME.stageDirectionColor, "#475569", "Contract 4-2: 지문 중립 회색 #475569 적용 계약");

console.log("\n🎉 Transcript Navigation & Accessibility Contract Suite PASSED 100%!\n");
