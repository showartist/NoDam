/**
 * 해석 차이 탐지 v2 — 규칙 검사·조립·해석 거리·사람 승인 규칙.
 * LLM 을 부르지 않는다. LLM 출력은 손으로 만든 값을 넣는다.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// DB 경로는 lib/db 를 처음 불러올 때 정해지므로, 환경변수를 먼저 두고 모듈은 before 에서 동적으로 부른다.
process.env.SCENENOTE_DB = path.join(mkdtempSync(path.join(tmpdir(), "scenenote-v2-")), "t.db");
delete process.env.OPENROUTER_API_KEY;

let normalizeForMatch: typeof import("../lib/alignment/checks").normalizeForMatch;
let quoteFound: typeof import("../lib/alignment/checks").quoteFound;
let checkSpeakerEvidence: typeof import("../lib/alignment/checks").checkSpeakerEvidence;
let conditionPhrase: typeof import("../lib/alignment/checks").conditionPhrase;
let computeSlotDiff: typeof import("../lib/alignment/distance").computeSlotDiff;
let computeDistance: typeof import("../lib/alignment/distance").computeDistance;
let pairKey: typeof import("../lib/alignment/distance").pairKey;
let assembleAll: typeof import("../lib/alignment/assemble").assembleAll;
let buildSpeakerLabels: typeof import("../lib/alignment/prompt").buildSpeakerLabels;
let formatTranscript: typeof import("../lib/alignment/prompt").formatTranscript;
let LlmAnalysisOutput: typeof import("../lib/alignment/schema").LlmAnalysisOutput;
let AlignmentIssueV2: typeof import("../lib/alignment/schema").AlignmentIssueV2;
let llmOutputJsonSchema: typeof import("../lib/alignment/schema").llmOutputJsonSchema;
let parseSceneLine: typeof import("../lib/alignment/present").parseSceneLine;
let labels: Map<string, import("../lib/alignment/prompt").SpeakerLabel>;

before(async () => {
  ({ normalizeForMatch, quoteFound, checkSpeakerEvidence, conditionPhrase } = await import("../lib/alignment/checks"));
  ({ computeSlotDiff, computeDistance, pairKey } = await import("../lib/alignment/distance"));
  ({ assembleAll } = await import("../lib/alignment/assemble"));
  ({ buildSpeakerLabels, formatTranscript } = await import("../lib/alignment/prompt"));
  ({ LlmAnalysisOutput, AlignmentIssueV2, llmOutputJsonSchema } = await import("../lib/alignment/schema"));
  ({ parseSceneLine } = await import("../lib/alignment/present"));
  labels = buildSpeakerLabels(utts);
});

type U = import("../lib/alignment/store").MeetingUtterance;
const U = (uid: string, idx: number, name: string, role: string, text: string): U => ({
  uid, idx, speakerKey: `N:${name}`, speakerId: null, speakerName: name, role, text, startMs: null, endMs: null,
});

const utts: U[] = [
  U("U01", 0, "박재인", "감독", "공간 톤은 차갑게 가죠. 푸른 새벽빛이 필요합니다."),
  U("U02", 1, "김태오", "촬영감독", "그러면 천창 쪽에서 낮은 색온도의 빛을 넣겠습니다."),
  U("U03", 2, "최은서", "작가", "저는 표정이 거의 없는 편이 더 무섭다고 봐요."),
  U("U04", 3, "박재인", "감독", "지금은 무표정 기준으로 가죠. 아주 미세한 반응은 열어둡시다."),
  U("U05", 4, "이지현", "제작PD", "안전관리자 확인 전에는 크레인을 승인할 수 없습니다."),
];

function ctx(extra: Record<string, unknown> = {}) {
  return { meetingId: "m_t", runId: "run_t", dataMode: "live" as const, utts, labels, window: null, now: "2026-09-11T00:00:00Z", ...extra };
}

function llmIssue(over: Record<string, unknown>) {
  return {
    key: "k",
    type: "interpretation_gap",
    decision: "d",
    concept: "",
    state: "open",
    condition: null,
    positions: [],
    question: "q?",
    why_it_matters: "w",
    severity: "high",
    role_briefs: [],
    ...over,
  };
}

test("정규화와 인용 검사: 띄어쓰기·문장부호 차이는 통과, 지어낸 구절은 떨어진다", () => {
  assert.equal(normalizeForMatch("푸른 새벽빛이, 필요합니다!"), "푸른새벽빛이필요합니다");
  assert.ok(quoteFound("푸른 새벽빛이 필요", [utts[0].text]));
  assert.ok(quoteFound("천창쪽에서 낮은 색온도의 빛", [utts[1].text]));
  assert.ok(!quoteFound("붉은 노을빛으로 가죠", [utts[0].text]));
  assert.ok(!quoteFound("짧음", [utts[0].text]), "4자 미만 인용은 인정하지 않는다");
});

test("화자 근거 검사: 근거 중에 그 사람의 발언이 있어야 한다", () => {
  const byUid = new Map(utts.map((u) => [u.uid, u]));
  assert.equal(checkSpeakerEvidence("N:박재인", ["U01"], byUid).result, "ok");
  assert.equal(checkSpeakerEvidence("N:김태오", ["U01"], byUid).result, "mismatch");
  assert.equal(checkSpeakerEvidence(null, ["U01"], byUid).result, "unknown_speaker");
});

test("조건 표현 탐지", () => {
  assert.ok(conditionPhrase("안전관리자 확인 전에는 크레인을 승인할 수 없습니다"));
  assert.ok(conditionPhrase("미세한 반응은 열어둡시다"));
  assert.equal(conditionPhrase("청록색으로 정하죠"), null);
});

test("전사 형식: 이름 대신 화자 라벨", () => {
  const t = formatTranscript(utts.slice(0, 2), labels);
  assert.match(t, /^\[U01\] S1 공간 톤은/);
  assert.match(t, /\[U02\] S2 /);
  assert.ok(!t.includes("박재인"));
});

test("조립: 한 사람의 두 발언으로 만든 '두 사람의 충돌'은 떨어진다", () => {
  const out = LlmAnalysisOutput.parse({
    issues: [
      llmIssue({
        positions: [
          { speaker: "S1", meaning: "차갑게", quote: "공간 톤은 차갑게 가죠", evidence: ["U01"], slots: [] },
          { speaker: "S1", meaning: "무표정", quote: "지금은 무표정 기준으로 가죠", evidence: ["U04"], slots: [] },
        ],
      }),
    ],
    agreements: [],
  });
  const r = assembleAll(out, ctx());
  assert.equal(r.issues.length, 0);
  assert.equal(r.stats.mergedPositions, 1);
  assert.match(r.stats.droppedIssues[0].reason, /서로 다른 화자가 1명/);
});

test("조립: 다른 사람 발언을 근거로 댄 입장과 지어낸 인용은 떨어지고 기록에 남는다", () => {
  const out = LlmAnalysisOutput.parse({
    issues: [
      llmIssue({
        type: "missing_information",
        positions: [
          { speaker: "S2", meaning: "감독 발언을 촬영감독 입장으로", quote: "푸른 새벽빛이 필요합니다", evidence: ["U01"], slots: [] },
          { speaker: "S4", meaning: "크레인 승인 보류", quote: "안전관리자 확인 전에는 크레인을", evidence: ["U05"], slots: [] },
          { speaker: "S3", meaning: "지어낸 인용", quote: "배우가 울어야 한다", evidence: ["U03"], slots: [] },
          { speaker: "S1", meaning: "없는 발언 번호", quote: "무표정 기준으로", evidence: ["U99"], slots: [] },
        ],
      }),
    ],
    agreements: [],
  });
  const r = assembleAll(out, ctx());
  assert.equal(r.issues.length, 1);
  const i = r.issues[0];
  assert.equal(i.positions.length, 1);
  assert.equal(i.positions[0].speaker.name, "이지현");
  assert.equal(i.positions[0].speaker.role, "제작PD", "이름·역할은 화자 매핑에서 채운다");
  assert.equal(i.dropped.length, 3);
  assert.equal(r.stats.speakerMismatch, 1);
  assert.equal(r.stats.quoteNotFound, 1);
  assert.equal(r.stats.invalidUids, 1);
  assert.ok(AlignmentIssueV2.safeParse(i).success);
});

test("조립: 합의 후보인데 근거에 조건 표현이 있으면 조건부 합의로 내린다", () => {
  const out = LlmAnalysisOutput.parse({
    issues: [
      llmIssue({
        type: "competing_alternatives",
        state: "agreed_candidate",
        positions: [
          { speaker: "S3", meaning: "무표정", quote: "표정이 거의 없는 편이 더 무섭다", evidence: ["U03"], slots: [{ slot: "performanceDirection", value: "무표정" }] },
          { speaker: "S1", meaning: "미세한 반응", quote: "아주 미세한 반응은 열어둡시다", evidence: ["U04"], slots: [{ slot: "performanceDirection", value: "미세한 반응 허용" }] },
        ],
      }),
    ],
    agreements: [],
  });
  const r = assembleAll(out, ctx());
  const i = r.issues[0];
  assert.equal(i.state, "conditional");
  assert.ok(i.condition);
  assert.equal(r.stats.stateAdjusted, 1);
  assert.equal(i.distance.differs, 1);
  assert.equal(i.distance.compared, 1);
  assert.equal(i.distance.value, 1);
});

test("조립: AI 는 resolved 를 쓸 수 없다 (LLM 스키마가 거부)", () => {
  const bad = { issues: [llmIssue({ state: "resolved" })], agreements: [] };
  assert.equal(LlmAnalysisOutput.safeParse(bad).success, false);
});

test("해석 거리: 비교할 항목이 없으면 null, 판정 모델이 같다고 한 짝은 같음", () => {
  const pos = (key: string, slots: Record<string, string>) => ({
    speaker: { key, name: key, role: null },
    meaning: "",
    quote: "",
    evidence: [],
    slots,
    checks: { speaker: "ok" as const, quote: "ok" as const, context: "not_checked" as const, contextNote: null },
  });
  assert.equal(computeDistance(computeSlotDiff([pos("a", { lighting: "푸른빛" })])).value, null);
  const ps = [pos("a", { lighting: "푸른 새벽빛", colorIntent: "청록" }), pos("b", { lighting: "낮은 색온도의 빛", colorIntent: "청록" })];
  const d1 = computeDistance(computeSlotDiff(ps));
  assert.deepEqual([d1.differs, d1.compared], [1, 2]);
  const verdicts = new Map([[pairKey("lighting", "푸른 새벽빛", "낮은 색온도의 빛"), "same" as const]]);
  const d2 = computeDistance(computeSlotDiff(ps, verdicts));
  assert.deepEqual([d2.differs, d2.compared], [0, 2]);
  const unclear = new Map([[pairKey("lighting", "푸른 새벽빛", "낮은 색온도의 빛"), "unclear" as const]]);
  assert.equal(computeDistance(computeSlotDiff(ps, unclear)).differs, 1, "확실하지 않으면 다름으로 두고 사람에게 묻는다");
});

test("조건 붙은 합의는 표시된다", () => {
  const out = LlmAnalysisOutput.parse({ issues: [], agreements: [{ topic: "크레인", summary: "보류", evidence: ["U05"] }, { topic: "톤", summary: "차갑게", evidence: ["U01", "U77"] }] });
  const r = assembleAll(out, ctx());
  assert.ok(r.agreements[0].condition);
  assert.equal(r.agreements[1].condition, null);
  assert.deepEqual(r.agreements[1].evidence, ["U01"], "회의에 없는 번호는 버린다");
});

test("LLM 출력 JSON Schema 는 strict 모드 제약을 지킨다 (모든 필드 required, 추가 필드 금지)", () => {
  const schema = llmOutputJsonSchema() as any;
  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object" && node.properties) {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...(node.required ?? [])].sort(), Object.keys(node.properties).sort());
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(schema);
});

test("장면 한 줄 설명 나누기", () => {
  assert.deepEqual(parseSceneLine("SCENE 34. INT. 실내 수영장 – NIGHT — 폐장 후 텅 빈 실내 수영장."), {
    sceneNumber: 34,
    slugline: "INT. 실내 수영장 – NIGHT",
    oneLiner: "폐장 후 텅 빈 실내 수영장.",
  });
  assert.deepEqual(parseSceneLine("자유 형식 설명"), { sceneNumber: null, slugline: null, oneLiner: "자유 형식 설명" });
});

test("사람 승인: 이름 없이는 해결되지 않고, 승인하면 결정 원장에 들어간다", async () => {
  const { db } = await import("../lib/db");
  const store = await import("../lib/alignment/store");
  const res = await import("../lib/alignment/resolution");
  db().prepare(`INSERT INTO projects (id,title,domain,one_line,created_at) VALUES ('p_t','t','film',NULL,'x')`).run();
  db().prepare(`INSERT INTO meetings (id,project_id,title,raw_transcript,created_at) VALUES ('m_t','p_t',NULL,'','x')`).run();
  const out = LlmAnalysisOutput.parse({
    issues: [
      llmIssue({
        positions: [
          { speaker: "S1", meaning: "푸른빛", quote: "푸른 새벽빛이 필요합니다", evidence: ["U01"], slots: [{ slot: "lighting", value: "푸른 새벽빛" }] },
          { speaker: "S2", meaning: "낮은 색온도", quote: "낮은 색온도의 빛을 넣겠습니다", evidence: ["U02"], slots: [{ slot: "lighting", value: "낮은 색온도" }] },
        ],
      }),
    ],
    agreements: [],
  });
  const runId = store.createRun("m_t", "batch", "test-model");
  const r = assembleAll(out, ctx({ runId }));
  store.saveIssues(runId, r.issues);
  store.finishRun(runId, { status: "completed", agreements: [] });
  const issueId = r.issues[0].issue_id;
  const sel = [{ slot: "lighting" as const, value: "푸른 새벽빛", speakerKey: "N:박재인", evidence: ["U01"], source: "selected" as const }];
  assert.throws(
    () => res.resolveIssue({ meetingId: "m_t", runId, issueId, selected: sel, summary: "", resolvedBy: " ", projectId: "p_t" }),
    /승인한 사람 이름/,
  );
  const ok = res.resolveIssue({ meetingId: "m_t", runId, issueId, selected: sel, summary: "푸른 새벽빛", resolvedBy: "박재인", projectId: "p_t" });
  assert.equal(ok.ledgerIds.length, 1);
  assert.equal(store.getIssue("m_t", issueId, runId)?.state, "resolved");
  const ledger = db().prepare(`SELECT slot, value, decided_by FROM decision_ledger WHERE meeting_id='m_t'`).all() as any[];
  assert.deepEqual(ledger.map((l) => [l.slot, l.value, l.decided_by]), [["lighting", "푸른 새벽빛", "박재인"]]);
  assert.ok(res.humanTouchedCount(runId) >= 1, "재분석 전 경고에 쓰는 수");
  assert.throws(
    () => res.resolveIssue({ meetingId: "m_t", runId, issueId, selected: sel, summary: "", resolvedBy: "박재인", projectId: "p_t" }),
    /이미 승인된/,
  );
});
