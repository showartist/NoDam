/**
 * 캐릭터 컨셉 초안(lib/characters): 묘사 모으기(가짜 LLM), 회의 순서·승인된 결정으로 합치기, 바뀐 항목, 이미지 프롬프트.
 * 외부 API 를 부르지 않는다.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SCENENOTE_DB = path.join(mkdtempSync(path.join(tmpdir(), "scenenote-char-")), "t.db");
process.env.OPENROUTER_API_KEY = "test-key";

let C: typeof import("../lib/characters");
let D: typeof import("../lib/db");

before(async () => {
  C = await import("../lib/characters");
  D = await import("../lib/db");
  const d = D.db();
  d.prepare(`INSERT INTO projects (id,title,domain,one_line,created_at) VALUES ('p_c','카페','film','SCENE 18. INT. 골목 카페 – NIGHT','2026-09-01')`).run();
  d.prepare(`INSERT INTO meetings (id,project_id,title,raw_transcript,created_at) VALUES ('m_c1','p_c','1차','', '2026-09-01T00:00:00Z'), ('m_c2','p_c','2차','', '2026-09-08T00:00:00Z')`).run();
  const u = d.prepare(`INSERT INTO utterances (id, meeting_id, idx, uid, speaker_id, speaker_name, role, text_raw, text_clean, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  u.run("c1_0", "m_c1", 0, "U01", null, "윤도현", "감독", "여주인공은 서른 초반, 단발머리로 가죠.", "여주인공은 서른 초반, 단발머리로 가죠.", "x");
  u.run("c1_1", "m_c1", 1, "U02", null, "마준호", "미술감독", "코트는 짙은 남색으로 준비하겠습니다.", "코트는 짙은 남색으로 준비하겠습니다.", "x");
});

const realFetch = globalThis.fetch;
function mockLlm(content: unknown, onCall?: () => void) {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/models/")) return new Response(JSON.stringify({ data: { endpoints: [{ supported_parameters: ["structured_outputs", "max_tokens", "response_format"] }] } }));
    onCall?.();
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 } }));
  }) as typeof fetch;
}

test("묘사 모으기: 이 회의에 없는 발언을 근거로 댄 묘사는 버리고, 같은 입력은 다시 부르지 않는다", async () => {
  let calls = 0;
  mockLlm(
    {
      characters: [
        {
          name: "여주인공",
          notes: [
            { aspect: "age", value: "서른 초반", status: "agreed", evidence: ["U01"] },
            { aspect: "hair", value: "단발머리", status: "agreed", evidence: ["U01"] },
            { aspect: "wardrobe", value: "짙은 남색 코트", status: "agreed", evidence: ["U02"] },
            { aspect: "face", value: "주근깨", status: "agreed", evidence: ["U99"] },
          ],
        },
      ],
    },
    () => calls++,
  );
  try {
    const r1 = await C.extractCharacterNotes("m_c1");
    assert.equal(r1.notes, 3, "U99 근거는 회의에 없으므로 버림");
    const r2 = await C.extractCharacterNotes("m_c1");
    assert.equal(r2.cached, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("합치기: 뒤 회의 값이 앞 회의 값을 덮고, 인물 이름이 든 승인된 결정은 발언보다 앞선다. 갈린 값은 그리지 않는다", () => {
  const d = D.db();
  const ins = d.prepare(
    `INSERT INTO character_notes (id, project_id, meeting_id, character, aspect, value, status, evidence, source_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  ins.run("n1", "p_c", "m_c2", "여주인공", "hair", "긴 생머리", "agreed", '["U05"]', "h2", "x");
  ins.run("n2", "p_c", "m_c2", "여주인공", "props", "빨간 우산", "contested", '["U06"]', "h2", "x");
  d.prepare(
    `INSERT INTO decision_ledger (id, project_id, meeting_id, decision, slot, value, evidence, decided_by, decided_at) VALUES ('L9','p_c','m_c2','여주인공 코트 색상','wardrobe','카멜색 롱코트','["U02"]','감독','2026-09-08T01:00:00Z')`,
  ).run();
  const p = C.characterProfiles("p_c").find((x) => x.name === "여주인공")!;
  assert.equal(p.aspects.hair?.value, "긴 생머리");
  assert.equal(p.aspects.age?.value, "서른 초반");
  assert.equal(p.aspects.wardrobe?.value, "카멜색 롱코트");
  assert.equal(p.aspects.wardrobe?.source.kind, "decision");
  assert.equal(p.aspects.props, undefined);
  assert.deepEqual(p.contested.map((c) => c.value), ["빨간 우산"]);
  assert.deepEqual(
    p.history.filter((h) => h.aspect === "wardrobe").map((h) => [h.value, h.kind]),
    [
      ["짙은 남색 코트", "meeting"],
      ["카멜색 롱코트", "decision"],
    ],
  );
});

test("바뀐 항목과 이미지 프롬프트: 이전 판을 참조로 넣을 때만 '같은 사람, 바뀐 것만'을 적는다", () => {
  const changes = C.describeChanges({ wardrobe: "짙은 남색 코트", hair: "단발머리" }, { wardrobe: "카멜색 롱코트", hair: "단발머리", age: "서른 초반" });
  assert.deepEqual(changes.map((c) => [c.aspect, c.before, c.after]), [
    ["age", null, "서른 초반"],
    ["wardrobe", "짙은 남색 코트", "카멜색 롱코트"],
  ]);
  const first = C.buildCharacterPrompt("여주인공", { wardrobe: "짙은 남색 코트" }, { hasReference: false, gloss: new Map([["짙은 남색 코트", "dark navy coat"]]) });
  assert.match(first, /짙은 남색 코트 \(dark navy coat\)/);
  assert.match(first, /Anything not listed must stay plain and neutral/);
  assert.doesNotMatch(first, /previous draft/);
  const next = C.buildCharacterPrompt("여주인공", { wardrobe: "카멜색 롱코트" }, { hasReference: true, changes });
  assert.match(next, /previous draft of this same character/);
  assert.match(next, /의상: 짙은 남색 코트 -> 카멜색 롱코트/);
});
