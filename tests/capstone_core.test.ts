import test from "node:test";
import assert from "node:assert/strict";
import { calculateDongsangIndex } from "../lib/analysis/dongsangIndex";
import { computeSlotDiff, computeDistance, pairKey } from "../lib/alignment/distance";
import { SCHEMA_VERSION, type AlignmentIssueV2, type PositionV2 } from "../lib/alignment/schema";
import { diagnoseAlignmentIssue, runDeterministicAlignmentRules } from "../lib/domain/alignmentCheck/deterministicRules";
import { inferSpeakerNames } from "../lib/transcription/speakerNames";
import type { TranscriptUtterance } from "../lib/transcription/types";

function position(key: string, value: string): PositionV2 {
  return { speaker: { key, name: key, role: null }, meaning: value, quote: value, evidence: [`U-${key}`],
    slots: { lighting: value }, checks: { speaker: "ok", quote: "ok", context: "supported", contextNote: null } };
}
function issue(values: string[], judged = true): AlignmentIssueV2 {
  const positions = values.map((v, i) => position(String(i), v));
  const verdicts = new Map<string, "different">();
  if (judged) for (const a of values) for (const b of values) if (a !== b) verdicts.set(pairKey("lighting", a, b), "different");
  const slot_diff = computeSlotDiff(positions, verdicts);
  return { schema: SCHEMA_VERSION, issue_id: "I-01", key: "light", meeting_id: "m_test", analysis_run_id: "r_test",
    data_mode: "live", window: null, type: "interpretation_gap", decision: "조명", concept: "톤", state: "open", condition: null,
    positions, slot_diff, distance: computeDistance(slot_diff), question: "조명을 어떻게 할까요?", why_it_matters: "촬영 준비", severity: "high",
    role_briefs: {}, evidence_all: positions.flatMap(p => p.evidence), dropped: [], audit: [], past_decisions: [], created_at: "", updated_at: "" };
}
test("동일 0점, 전부 다른 100점, 3명 중 2쌍 차이 66.7점", () => {
  assert.equal(calculateDongsangIndex([issue(["blue", "blue"])]).score, 0);
  assert.equal(calculateDongsangIndex([issue(["blue", "red"])]).score, 100);
  assert.equal(calculateDongsangIndex([issue(["blue", "blue", "red"])]).score, 66.7);
});
test("판정 불명은 충돌이 아니며 미판정과 커버리지로 표시", () => {
  const result = calculateDongsangIndex([issue(["blue", "red"], false)]);
  assert.equal(result.score, null); assert.equal(result.unknown, 1); assert.equal(result.coverage, 0);
});
test("부분 커버리지: 확인된 같은 쌍만 0점, 나머지 미판정", () => {
  const result = calculateDongsangIndex([issue(["blue", "blue", "red"], false)]);
  assert.equal(result.score, 0); assert.equal(result.unknown, 2); assert.equal(result.coverage, 33.3);
});
test("한 사람·빈 입력·확인되지 않은 문맥은 계산 보류", () => {
  assert.equal(calculateDongsangIndex([]).score, null);
  assert.equal(calculateDongsangIndex([issue(["blue"])]).score, null);
  const i = issue(["blue", "red"]); i.positions[0].checks.context = "partial";
  assert.equal(calculateDongsangIndex([i]).score, null);
});
test("중복 창은 한 번만 계산, 해소/제외/과거 비교는 활성 지수에서 제외", () => {
  const i = issue(["blue", "red"]);
  assert.equal(calculateDongsangIndex([i, { ...i, issue_id: "I-02" }]).compared, 1);
  assert.equal(calculateDongsangIndex([{ ...i, state: "resolved" }, { ...i, state: "dismissed" }]).score, null);
  assert.equal(calculateDongsangIndex([{ ...i, type: "past_decision_conflict" }]).score, null);
});
test("경보는 근거·실측 수치·질문 포함", () => {
  const d = diagnoseAlignmentIssue(issue(["blue", "red"]));
  assert.equal(d.alert, true); assert.match(d.reason, /1쌍/); assert.ok(d.evidenceUids.length); assert.match(d.question, /조명/);
});
test("규칙 임계치 및 같은 화자의 정정 오경보 억제", () => {
  const u = (uid: string, name: string, text: string) => ({ uid, lineNumber: 1, speakerName: name, speakerRole: "director" as const, rawText: text });
  const inputs = [u("U-1", "가", "텅 빈 공간"), u("U-2", "나", "인물을 멀리 배치")];
  assert.equal(runDeterministicAlignmentRules("m", "p", [], inputs).issues.length, 1);
  assert.equal(runDeterministicAlignmentRules("m", "p", [], inputs, { minConfidence: 0.96 }).issues.length, 0);
  assert.equal(runDeterministicAlignmentRules("m", "p", [], inputs.map(x => ({ ...x, speakerName: "가" }))).issues.length, 0);
  assert.equal(runDeterministicAlignmentRules("m", "p", [], [u("U-3", "나", "차가운 블루톤 색온도")]).issues.length, 0);
  assert.throws(() => runDeterministicAlignmentRules("m", "p", [], inputs, { minConfidence: NaN }));
});
const utt = (speakerId: string | null, text: string): TranscriptUtterance => ({ speakerId, text, speakerName: null, startMs: 0, endMs: 1000, confidence: null });
test("자기소개 이름 매핑, 역할·타인 소개·미상 화자는 제외", () => {
  const names = inferSpeakerNames([utt("S1", "안녕하세요. 저는 김민수입니다."), utt("S2", "제 이름은 이영희라고 합니다."), utt("S3", "저는 감독입니다."), utt("S4", "저분은 박철수입니다."), utt(null, "저는 강철수입니다.")]);
  assert.deepEqual([...names], [["S1", "김민수"], ["S2", "이영희"]]);
});
test("한 화자의 복수 이름/서로 다른 화자의 같은 이름은 자동 매핑 보류", () => {
  assert.equal(inferSpeakerNames([utt("S1", "저는 김민수입니다."), utt("S1", "저는 이영희입니다.")]).size, 0);
  assert.equal(inferSpeakerNames([utt("S1", "저는 김민수입니다."), utt("S2", "저는 김민수입니다.")]).size, 0);
});

test("잠정 임계치 경계: 20 낮음, 30 재검토, 60 경보", () => {
  const sample = (differences: number) => Array.from({length: 10}, (_, n) => {
    const i = issue(n < differences ? ["blue", "red"] : ["blue", "blue"]);
    i.positions.forEach(p => { p.evidence = p.evidence.map(e => `${e}-${n}`); });
    return i;
  });
  assert.equal(calculateDongsangIndex(sample(2)).level, "low");
  assert.equal(calculateDongsangIndex(sample(3)).level, "review");
  assert.equal(calculateDongsangIndex(sample(6)).level, "alert");
});

// B안 이후에도 위 계산 테스트는 과거 호환성 확인용으로 보존한다. 제품 계약은 아래와 같다.
import { summarizeAlignmentReview } from "../lib/analysis/reviewSummary";
import { runDemoKeywordChecks } from "../lib/domain/alignmentCheck/deterministicRules";
import { DEMO_RULE_NOTICE } from "../lib/domain/alignmentCheck/demoKeywordData";
test("B안은 점수/경보 없이 안건 수·판정 수만 공개", () => {
  const result = summarizeAlignmentReview([issue(["blue", "red"])]);
  assert.deepEqual(result, { pendingIssues: 1, compared: 1, different: 1, same: 0, unknown: 0, coverage: 100 });
  assert.ok(!("score" in result)); assert.ok(!("level" in result));
  assert.equal(summarizeAlignmentReview([]).coverage, null);
  assert.equal(summarizeAlignmentReview([{...issue(["blue", "red"]), state: "resolved"}]).pendingIssues, 0);
});
const introductions = [
  "안녕하세요. 저는 김민수입니다.",
  "네 안녕하세요 저는 김민수입니다 잘 부탁드립니다",
  "저는 김민수입니다, 반갑습니다.",
  "저는 김민수예요.",
  "저는 김민수 감독입니다.",
  "그러니까 저는 김민수입니다.",
];
for (const text of introductions) test(`검수 실측 이름: ${text}`, () => {
  assert.equal(inferSpeakerNames([utt("S1", text)]).get("S1"), "김민수");
});
test("이름 종결 변형 7종 및 오탐 억제", () => {
  for (const end of ["입니다", "이라고 합니다", "라고 합니다", "예요", "이에요", "라고 해요", "입니다만"]) {
    assert.equal(inferSpeakerNames([utt("S1", `저는 김민수${end}.`)]).get("S1"), "김민수");
  }
  for (const text of ["저는 반대입니다", "저는 그 의견에 동의합니다", "김민수 감독님은 어떻게 보세요?", "저는 감독입니다", "저는 의사예요"]) {
    assert.equal(inferSpeakerNames([utt("S1", text)]).size, 0, text);
  }
});
test("시연 낱말 검사는 핵심 판정 집계를 변경하지 않음", () => {
  const issues = [issue(["blue", "red"])], before = summarizeAlignmentReview(issues);
  const u = (uid: string, speakerName: string, rawText: string) => ({uid, speakerName, rawText, lineNumber: 1, speakerRole: "director" as const});
  const demo = runDemoKeywordChecks("m", "p", [], [u("U1", "가", "텅 빈 공간"), u("U2", "나", "인물을 멀리 배치")]);
  assert.equal(demo.issues.length, 1);
  assert.ok(demo.analysisRun.llmPayloadPreview?.messagesPreview.includes(DEMO_RULE_NOTICE));
  assert.deepEqual(summarizeAlignmentReview(issues), before);
});
