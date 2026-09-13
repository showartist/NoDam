/**
 * 2·3단계 모듈: 단어 → 화자 다시 나누기, 조각 사이 화자 잇기(사이드카는 가짜 fetch), 창 단위 병합,
 * 조사, 결정 이력, 쇼트에 이미지 붙이기 규칙. 외부 API 를 부르지 않는다.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SCENENOTE_DB = path.join(mkdtempSync(path.join(tmpdir(), "scenenote-p2-")), "t.db");
process.env.OPENROUTER_API_KEY = "test-key";

type M = {
  resegment: typeof import("../lib/transcription/resegment");
  link: typeof import("../lib/audio/speakerLink");
  window: typeof import("../lib/alignment/window");
  josa: typeof import("../lib/text/josa");
  history: typeof import("../lib/consistency/history");
  shot: typeof import("../lib/images/shotLink");
  db: typeof import("../lib/db");
};
let m: M;

before(async () => {
  m = {
    resegment: await import("../lib/transcription/resegment"),
    link: await import("../lib/audio/speakerLink"),
    window: await import("../lib/alignment/window"),
    josa: await import("../lib/text/josa"),
    history: await import("../lib/consistency/history"),
    shot: await import("../lib/images/shotLink"),
    db: await import("../lib/db"),
  };
});

const realFetch = globalThis.fetch;
function mockFetch(handler: (url: string, body: any) => unknown) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const out = handler(String(url), body);
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("단어 → 사이드카 화자 구간으로 발언 다시 나누기: 공급자가 한 번호로 합친 두 사람을 가른다", () => {
  const words = [
    { text: "푸른", startMs: 0, endMs: 300, speaker: "0" },
    { text: "새벽빛으로", startMs: 320, endMs: 800, speaker: "0" },
    { text: "네", startMs: 900, endMs: 1000, speaker: "0" },
    { text: "좋습니다", startMs: 1010, endMs: 1400, speaker: "0" },
  ];
  const spans = [
    { startMs: 0, endMs: 850, speaker: "S1" },
    { startMs: 880, endMs: 1500, speaker: "S2" },
  ];
  const r = m.resegment.resegment(words, spans, 400);
  assert.equal(r.speakerCount, 2);
  assert.deepEqual(r.utterances.map((u) => [u.speakerId, u.text]), [
    ["SPEAKER_01", "푸른 새벽빛으로"],
    ["SPEAKER_02", "네 좋습니다"],
  ]);
  assert.equal(m.resegment.speakerForWord({ startMs: 5000, endMs: 5100 }, spans), null, "1초보다 멀면 화자를 만들지 않는다");
});

test("조각 사이 화자 잇기: 비슷한 목소리는 같은 전역 화자, 같은 조각의 두 사람은 합치지 않는다", async () => {
  const A = [1, 0, 0];
  const B = [0, 1, 0];
  mockFetch((url, body) => {
    if (url.endsWith("/health")) return { ok: true };
    if (url.endsWith("/embed")) return { embeddings: body.segments.map((s: any) => (s.start_ms < 5000 ? A : B)) };
    return {};
  });
  try {
    const first = await m.link.linkChunk({
      audioPath: "/x.wav",
      chunkIndex: 0,
      registry: [],
      segments: [
        { local: "L1", startMs: 0, endMs: 3000 },
        { local: "L2", startMs: 6000, endMs: 9000 },
      ],
    });
    assert.equal(first.method, "embedding");
    assert.deepEqual(Object.values(first.mapping).sort(), ["SPEAKER_01", "SPEAKER_02"]);
    // 두 번째 조각: 로컬 번호는 뒤바뀌었지만 목소리로 이어 붙인다.
    const second = await m.link.linkChunk({
      audioPath: "/y.wav",
      chunkIndex: 1,
      registry: first.registry,
      segments: [
        { local: "L1", startMs: 7000, endMs: 9000 },
        { local: "L2", startMs: 0, endMs: 2500 },
      ],
    });
    assert.equal(second.mapping.L2, first.mapping.L1);
    assert.equal(second.mapping.L1, first.mapping.L2);
    assert.equal(second.registry.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("사이드카가 꺼져 있으면 잇지 않고 조각 표시를 붙인다(가짜로 잇지 않음)", async () => {
  globalThis.fetch = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  try {
    const r = await m.link.linkChunk({ audioPath: "/x.wav", chunkIndex: 2, registry: [], segments: [{ local: "L1", startMs: 0, endMs: 3000 }] });
    assert.equal(r.method, "unlinked");
    assert.equal(r.mapping.L1, "C3-L1");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("창 단위 병합: 같은 key 는 번호를 유지해 갱신하고, 사람이 승인한 안건은 덮지 않는다", async () => {
  const U = (uid: string, idx: number, name: string, text: string) => ({ uid, idx, speakerKey: `N:${name}`, speakerId: null, speakerName: name, role: null, text, startMs: null, endMs: null });
  const utts = [
    U("U01", 0, "감독", "공간은 푸른 새벽빛으로 가죠."),
    U("U02", 1, "촬영", "천창에서 낮은 색온도의 빛을 넣겠습니다."),
    U("U03", 2, "감독", "그 빛은 파랗게 보여야 합니다."),
    U("U04", 3, "촬영", "그럼 화이트밸런스를 낮춰서 푸르게 맞추겠습니다."),
  ];
  const issue = (state: string, ev2: string) => ({
    issues: [
      {
        key: "light_color",
        type: "interpretation_gap",
        decision: "조명 색",
        concept: "낮은 색온도",
        state,
        condition: null,
        positions: [
          { speaker: "S1", meaning: "푸른빛", quote: "푸른 새벽빛으로 가죠", evidence: ["U01"], slots: [{ slot: "lighting", value: "푸른 새벽빛" }] },
          { speaker: "S2", meaning: "낮은 색온도", quote: ev2 === "U02" ? "낮은 색온도의 빛을 넣겠습니다" : "화이트밸런스를 낮춰서 푸르게", evidence: [ev2], slots: [{ slot: "lighting", value: "푸른빛(화이트밸런스)" }] },
        ],
        question: "q",
        why_it_matters: "w",
        severity: "high",
        role_briefs: [],
      },
    ],
    agreements: [],
  });
  let call = 0;
  mockFetch((url) => {
    if (url.includes("/models/")) return { data: { endpoints: [{ supported_parameters: ["structured_outputs", "max_tokens", "temperature", "response_format"] }] } };
    call++;
    const content = JSON.stringify(call === 1 ? issue("open", "U02") : issue("agreed_candidate", "U04"));
    return { choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.001 } };
  });
  try {
    const st = m.window.newWindowState("m_w", "run_w");
    const meeting = { projectTitle: null, sceneLine: null };
    const r1 = await m.window.runWindow(st, { allUtts: utts.slice(0, 2), context: [], window: utts.slice(0, 2), meeting, contextCheck: false });
    assert.equal(r1.newIssues.length, 1);
    const id = r1.newIssues[0].issue_id;
    const r2 = await m.window.runWindow(st, { allUtts: utts, context: utts.slice(0, 2), window: utts.slice(2), meeting, contextCheck: false });
    assert.equal(r2.newIssues.length, 0);
    assert.equal(r2.updatedIssues[0].issue_id, id, "같은 key 는 같은 번호");
    assert.equal(r2.updatedIssues[0].state, "agreed_candidate");
    // 사람이 승인한 뒤에는 창 분석이 덮지 않는다.
    st.issues.set("light_color", { ...st.issues.get("light_color")!, state: "resolved" });
    const r3 = await m.window.runWindow(st, { allUtts: utts, context: utts.slice(0, 2), window: utts.slice(2), meeting, contextCheck: false });
    assert.equal(r3.updatedIssues.length, 0);
    assert.equal(st.issues.get("light_color")!.state, "resolved");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("조사 고르기", () => {
  const { josa } = m.josa;
  assert.equal(josa("의상", "을/를"), "의상을");
  assert.equal(josa("구도", "을/를"), "구도를");
  assert.equal(josa("남색 코트", "(으)로"), "남색 코트로");
  assert.equal(josa("카멜색", "(으)로"), "카멜색으로");
  assert.equal(josa("연필", "(으)로"), "연필로");
  assert.equal(josa("35mm", "(으)로"), "35mm(으)로");
  assert.equal(josa("윤도현 (감독)", "이/가"), "윤도현 (감독)이");
  assert.equal(josa('"남색"', "(으)로"), '"남색"으로');
});

test("결정 이력: 과거 결정 충돌을 정리한 결정은 옛 결정을 대체하고, 이력에 바뀐 값으로 나온다", () => {
  const d = m.db.db();
  d.prepare(`INSERT INTO projects (id,title,domain,one_line,created_at) VALUES ('p_h','t','film',NULL,'2026-09-01')`).run();
  d.prepare(`INSERT INTO meetings (id,project_id,title,raw_transcript,created_at) VALUES ('m_h1','p_h','1차','', '2026-09-01T00:00:00Z'), ('m_h2','p_h','2차','', '2026-09-08T00:00:00Z')`).run();
  const ins = d.prepare(`INSERT INTO decision_ledger (id, project_id, meeting_id, decision, slot, value, evidence, decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  ins.run("L1", "p_h", "m_h1", "코트 색", "wardrobe", "남색 코트", '["U11"]', "감독", "2026-09-01T01:00:00Z");
  ins.run("L2", "p_h", "m_h2", "여주인공 코트 색상", "wardrobe", "카멜색 코트", '["U02"]', "감독", "2026-09-08T01:00:00Z");
  d.prepare(`UPDATE decision_ledger SET superseded_by = 'L2' WHERE id = 'L1'`).run();
  const h = m.history.projectHistory("p_h");
  assert.equal(h.steps.length, 2);
  assert.deepEqual(h.steps[1].changes.map((c) => [c.before, c.after]), [["남색 코트", "카멜색 코트"]]);
  assert.equal(Object.values(h.current)[0].value, "카멜색 코트");
});

test("쇼트에 이미지 붙이기: 다른 회의·미완성 이미지는 거부, 붙이면 다시 승인 대기", () => {
  const d = m.db.db();
  d.prepare(
    `INSERT INTO shots (id, meeting_id, shot_number, shot_size, lens, camera_height, camera_move, character_action, dialogue_sound, duration, purpose, production_check, evidence, image_state, status, updated_at)
     VALUES ('sh1','m_h1',1,'WS','35mm','eye','static','-','-','3s','-','-','[]','not_generated','approved','x')`,
  ).run();
  const img = d.prepare(`INSERT INTO generated_images (id, meeting_id, kind, model, prompt, resolution, status, created_at) VALUES (?,?,?,?,?,?,?,?)`);
  img.run("img_ok", "m_h1", "consensus", "m", "p", "draft", "completed", "x");
  img.run("img_other", "m_h2", "consensus", "m", "p", "draft", "completed", "x");
  img.run("img_wip", "m_h1", "consensus", "m", "p", "draft", "generating", "x");
  assert.throws(() => m.shot.attachImageToShot("sh1", "img_other", "a"), /다른 회의/);
  assert.throws(() => m.shot.attachImageToShot("sh1", "img_wip", "a"), /생성이 끝난/);
  const r = m.shot.attachImageToShot("sh1", "img_ok", "미술감독");
  assert.equal(r.imageUrl, "/api/images/img_ok");
  const row = d.prepare(`SELECT image_state, status, approved_by FROM shots WHERE id = 'sh1'`).get() as any;
  assert.deepEqual([row.image_state, row.status, row.approved_by], ["generated", "proposed", null]);
});

test("과거 결정 충돌: 비교표에 지난 결정 열이 붙고, 부딪힌 발언을 근거로 한 합의 후보는 빠진다", async () => {
  const { compareColumns, slotRows, isLedgerKey } = await import("../lib/alignment/present");
  const { withdrawConflictingAgreements } = await import("../lib/consistency/check");
  const issue = {
    positions: [{ speaker: { key: "N:마준호", name: "마준호", role: "미술감독" }, slots: { wardrobe: "카멜색 롱코트" }, evidence: ["U02"] }],
    past_decisions: [{ ledger_id: "L-1", meeting_id: "m_1", slot: "wardrobe", value: "남색 코트", evidence: ["U10"] }],
    slot_diff: [{ slot: "wardrobe", state: "differs", pairs: [] }],
    evidence_all: ["U02"],
    audit: [] as string[],
  } as any;
  const cols = compareColumns(issue);
  assert.deepEqual(cols.map((c) => [c.label, c.slots.wardrobe, c.evidence.length]), [
    ["마준호 (미술감독)", "카멜색 롱코트", 1],
    ["지난 회의 결정", "남색 코트", 0],
  ]);
  assert.ok(isLedgerKey(cols[1].key));
  assert.equal(slotRows(issue)[0].state, "differs", "한 사람만 말함이 아니라 지난 결정과 다름");

  const agreements = [
    { topic: "의상 준비", summary: "카멜색 롱코트 준비 완료", evidence: ["U02"], condition: null },
    { topic: "촬영 시간", summary: "밤 11시부터", evidence: ["U06"], condition: null },
  ];
  const w = withdrawConflictingAgreements(agreements, [issue]);
  assert.equal(w.withdrawn, 1);
  assert.deepEqual(w.agreements.map((a) => a.topic), ["촬영 시간"]);
  assert.match(issue.audit[0], /합의 후보에서 뺌: 의상 준비/);
});

test("조명·색처럼 다른 항목에 적은 같은 대상은 한 줄로 비교한다", async () => {
  const { computeSlotDiff, computeDistance, pairKey } = await import("../lib/alignment/distance");
  const { slotRows } = await import("../lib/alignment/present");
  const pos = (key: string, slots: Record<string, string>) =>
    ({ speaker: { key, name: key, role: null }, meaning: "", quote: "", evidence: [], slots, checks: { speaker: "ok", quote: "ok", context: "supported", contextNote: null } }) as any;
  const director = pos("S1", { colorIntent: "푸른 새벽빛" });
  const dp = pos("S2", { lighting: "천창에서 낮은 색온도 조명" });

  const diff = computeSlotDiff([director, dp]);
  assert.equal(diff.length, 1);
  assert.deepEqual([diff[0].slot, diff[0].slots, diff[0].state], ["lighting", ["lighting", "colorIntent"], "differs"]);
  assert.match(computeDistance(diff).basis, /조명·색/);
  const rows = slotRows({ positions: [director, dp], past_decisions: [], slot_diff: diff } as any);
  assert.deepEqual(rows.map((r) => [r.label, r.values.length, r.state]), [["조명·색", 2, "differs"]]);

  // 판정 모델이 같다고 하면 같음
  const same = computeSlotDiff([director, dp], new Map([[pairKey("lighting", "푸른 새벽빛", "천창에서 낮은 색온도 조명"), "same" as const]]));
  assert.equal(same[0].state, "same");

  // 한 항목을 이미 두 사람이 말했으면 묶지 않는다
  const both = computeSlotDiff([pos("S1", { lighting: "푸른빛", colorIntent: "청록" }), pos("S2", { lighting: "따뜻한 빛" })]);
  assert.deepEqual(both.map((d) => [d.slot, d.slots ?? null]), [["lighting", null]]);
});
