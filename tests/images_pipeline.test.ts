/**
 * lib/images 파이프라인 테스트. 네트워크를 쓰지 않는다 (fetch 를 가로챈다).
 *
 *   npx tsx --test tests/images_pipeline.test.ts
 *
 * lib/db 는 import 시점에 SCENENOTE_DB 를 읽으므로, 환경 변수를 먼저 정하고 모듈은 before() 에서 동적으로 불러온다.
 */
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

const TMP = mkdtempSync(path.join(os.tmpdir(), "scenenote-images-"));
process.env.SCENENOTE_DB = path.join(TMP, "test.db");
process.env.SCENENOTE_DATA_DIR = path.join(TMP, "data");
process.env.SCENENOTE_SIDECAR_URL = "http://sidecar.test";
delete process.env.SIDECAR_URL;
process.env.SCENENOTE_GLOSS_LLM = "0";
delete process.env.SCENENOTE_IMAGE_QUOTA_OVERRIDE;
delete process.env.SCENENOTE_IMAGE_MODEL;
delete process.env.SCENENOTE_IMAGE_TIMEOUT_MS;
// 실제 키가 환경에 있어도 쓰지 않는다. 테스트는 가짜 키 + 가로챈 fetch 로만 돈다.
const REAL_KEY = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
const FAKE_KEY = "sk-or-test-not-a-real-key";

// ── fetch 가로채기 ──────────────────────────────────────────────────────────
type Call = { url: string; init?: RequestInit; body: any };
let calls: Call[] = [];
let handler: (c: Call) => Promise<Response> | Response = () => {
  throw new Error("예상하지 못한 네트워크 호출");
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let body: any = null;
  if (typeof init?.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  const c = { url, init, body };
  calls.push(c);
  return handler(c);
}) as typeof fetch;

const json = (status: number, obj: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });

// ── 작은 PNG 만들기 (외부 도구 없이) ─────────────────────────────────────────
function crc32(buf: Buffer): number {
  return (zlib as unknown as { crc32: (b: Buffer) => number }).crc32(buf);
}
function makePng(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const BLUE: [number, number, number] = [20, 60, 140];
const SAND: [number, number, number] = [200, 180, 60];
const TWO_TONE = makePng(64, 32, (x) => (x < 32 ? BLUE : SAND));
const OUT_PNG = makePng(32, 18, () => [30, 90, 110]);

const imageOk = (cost: number | null = 0.067) =>
  json(200, {
    created: 0,
    data: [{ b64_json: OUT_PNG.toString("base64"), media_type: "image/png" }],
    usage: cost === null ? { prompt_tokens: 10, completion_tokens: 1120 } : { cost, completion_tokens: 1120 },
  });

// ── 모듈 (동적 import) ──────────────────────────────────────────────────────
let schema: typeof import("../lib/alignment/schema");
let store: typeof import("../lib/alignment/store");
let db: typeof import("../lib/db");
let errors: typeof import("../lib/images/errors");
let client: typeof import("../lib/images/openrouterImages");
let recipes: typeof import("../lib/images/recipeFromPosition");
let glossary: typeof import("../lib/images/glossary");
let refs: typeof import("../lib/images/references");
let storage: typeof import("../lib/images/storage");
let pipeline: typeof import("../lib/images/pipeline");
let gloss: typeof import("../lib/images/gloss");
let adapters: typeof import("../lib/domain/imageGeneration");

type Issue = import("../lib/alignment/schema").AlignmentIssueV2;

function slots(partial: Partial<Record<string, string>>): Record<any, string> {
  const out: Record<string, string> = {};
  for (const k of schema.SLOT_KEYS) out[k] = partial[k] ?? "";
  return out;
}

const checksOk = { speaker: "ok" as const, quote: "ok" as const, context: "not_checked" as const, contextNote: null };

function makeIssue(meetingId: string, runId: string, issueId = "iss_pool_people"): Issue {
  const ts = new Date().toISOString();
  return {
    schema: "scenenote.alignment/2",
    issue_id: issueId,
    key: "pool-people",
    meeting_id: meetingId,
    analysis_run_id: runId,
    data_mode: "fixture",
    window: null,
    type: "interpretation_gap",
    decision: "SCENE 34 수영장에 인물을 둘 것인가",
    concept: "텅 빈",
    state: "open",
    condition: null,
    positions: [
      {
        speaker: { key: "SPEAKER_01", name: "박재인", role: "감독" },
        meaning: "사람이 없는 새벽 수영장",
        quote: "아무도 없는 수영장이어야 해요",
        evidence: ["U03", "U05"],
        slots: slots({
          subjectPresence: "인물 없음",
          lighting: "푸른 새벽빛",
          requiredElements: "타일의 녹색 곰팡이, 바랜 안내판",
          prohibitedElements: "사람 그림자, 따뜻한 조명",
        }),
        checks: checksOk,
      },
      {
        speaker: { key: "SPEAKER_02", name: "김태오", role: "촬영감독" },
        meaning: "구석에 작게 한 사람",
        quote: "구석에 한 명은 있어야죠",
        evidence: ["U07"],
        slots: slots({ subjectPresence: "한 명", subjectPlacement: "화면 하단 구석", lighting: "형광등" }),
        checks: checksOk,
      },
      {
        speaker: { key: "SPEAKER_03", name: "최은서", role: "작가" },
        meaning: "아직 말하지 않음",
        quote: "글쎄요 잘 모르겠네요",
        evidence: ["U09"],
        slots: slots({}),
        checks: checksOk,
      },
    ],
    slot_diff: [],
    distance: { differs: 0, compared: 0, value: null, basis: "exact" },
    question: "새벽 수영장에 사람을 둘까요?",
    why_it_matters: "촬영 인원·조명이 달라진다",
    severity: "high",
    role_briefs: {},
    evidence_all: ["U03", "U05", "U07", "U09"],
    dropped: [],
    audit: [],
    past_decisions: [],
    created_at: ts,
    updated_at: ts,
  };
}

function saveIssue(meetingId: string): { runId: string; issue: Issue } {
  const runId = store.createRun(meetingId, "batch", "test-model", { dataMode: "fixture" });
  const issue = makeIssue(meetingId, runId);
  store.upsertIssue(runId, issue);
  store.finishRun(runId, { status: "completed" });
  return { runId, issue };
}

function memRef(p: Partial<import("../lib/images/references").MeetingReference>): import("../lib/images/references").MeetingReference {
  return {
    id: p.id ?? `ref_${Math.random().toString(36).slice(2, 8)}`,
    meetingId: "m_mem",
    title: p.title ?? "레퍼런스",
    source: p.source ?? "팀 촬영",
    uploadedBy: null,
    adoption: p.adoption ?? "reference",
    take: p.take ?? [],
    avoid: p.avoid ?? [],
    filePath: p.filePath === undefined ? "x.png" : p.filePath,
    palette: p.palette ?? null,
    evidence: [],
    createdAt: new Date().toISOString(),
  };
}

before(async () => {
  schema = await import("../lib/alignment/schema");
  store = await import("../lib/alignment/store");
  db = await import("../lib/db");
  errors = await import("../lib/images/errors");
  client = await import("../lib/images/openrouterImages");
  recipes = await import("../lib/images/recipeFromPosition");
  glossary = await import("../lib/images/glossary");
  refs = await import("../lib/images/references");
  storage = await import("../lib/images/storage");
  pipeline = await import("../lib/images/pipeline");
  gloss = await import("../lib/images/gloss");
  adapters = await import("../lib/domain/imageGeneration");
  db.db(); // 표 만들기
});

beforeEach(() => {
  calls = [];
  handler = () => {
    throw new Error("예상하지 못한 네트워크 호출");
  };
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SCENENOTE_IMAGE_QUOTA_OVERRIDE;
  process.env.SCENENOTE_GLOSS_LLM = "0";
});

after(() => {
  globalThis.fetch = realFetch;
  if (REAL_KEY) process.env.OPENROUTER_API_KEY = REAL_KEY;
  rmSync(TMP, { recursive: true, force: true });
});

// ── 1. 정본 만들기 ──────────────────────────────────────────────────────────

test("관점 정본: 말하지 않은 슬롯은 비워 두고 중립 지시로 넘긴다", () => {
  const issue = makeIssue("m_r", "run_r");
  const r = recipes.recipeFromPosition(issue, 0, { slugline: "SCENE 34 · INT. 실내 수영장 – DAWN", oneLiner: "차가운 청록빛 아래…", projectTitle: "숨" });
  assert.deepEqual(Object.keys(r.slots).sort(), ["lighting", "subjectPresence"]);
  assert.ok(r.unspecified.includes("wardrobe") && r.unspecified.includes("composition") && r.unspecified.includes("colorIntent"));
  assert.equal(r.slots.wardrobe, undefined);

  const { prompt } = recipes.renderImagePrompt(r);
  assert.match(prompt, /People in frame: 인물 없음 \[EN: no people\]/);
  assert.match(prompt, /Lighting: 푸른 새벽빛 \[EN: blue dawn light\]/);
  assert.doesNotMatch(prompt, /- Wardrobe:|- Composition \/ framing:|- Colour:/, "빈 슬롯에 값이 생기면 안 된다");
  assert.match(prompt, /Not specified in the meeting: composition \/ framing, placement of people, environment \/ set, colour, wardrobe, props, action, performance \/ emotion\. Keep these plain and neutral and do not invent them/);
  // 한 줄 소개는 해석이 섞여 있어 보내지 않는다
  assert.doesNotMatch(prompt, /청록빛/);
  assert.match(prompt, /Scene heading: SCENE 34 · INT\. 실내 수영장 – DAWN/);
});

test("관점 정본: 금지 요소는 부정 지시로 들어가고 버려지지 않는다", () => {
  const r = recipes.recipeFromPosition(makeIssue("m_r", "run_r"), 0);
  assert.deepEqual(r.mustNotInclude, ["사람 그림자", "따뜻한 조명"]);
  assert.deepEqual(r.mustInclude, ["타일의 녹색 곰팡이", "바랜 안내판"]);
  const { prompt, negative } = recipes.renderImagePrompt(r);
  assert.equal(negative.length, 2);
  assert.match(prompt, /Must NOT include[^\n]*\n- 사람 그림자[^\n]*\n- 따뜻한 조명 \[EN: warm lighting\]/);
  assert.match(prompt, /Must include:\n- 타일의 녹색 곰팡이 \[EN: tile green mould\]\n- 바랜 안내판 \[EN: faded sign\]/);
});

test("관점 정본: 출처(issueId·runId·speakerKey·evidenceUids)가 붙고, 글에는 U-ID·이름이 들어가지 않는다", () => {
  const r = recipes.recipeFromPosition(makeIssue("m_r", "run_r"), 1);
  assert.equal(r.provenance.issueId, "iss_pool_people");
  assert.equal(r.provenance.runId, "run_r");
  assert.equal(r.provenance.speakerKey, "SPEAKER_02");
  assert.deepEqual(r.provenance.evidenceUids, ["U07"]);
  assert.equal(r.provenance.kind, "perspective");
  assert.deepEqual(r.provenance.slotSources.lighting, [{ speakerKey: "SPEAKER_02", evidence: ["U07"] }]);
  const { prompt } = recipes.renderImagePrompt(r);
  assert.doesNotMatch(prompt, /U0\d|SPEAKER_|김태오|촬영감독/);
});

test("관점 정본: 그릴 항목이 없는 입장은 지어내지 않고 막는다", () => {
  assert.throws(
    () => recipes.recipeFromPosition(makeIssue("m_r", "run_r"), 2),
    (e: any) => e instanceof errors.ImageGenError && e.code === "INVALID_INPUT",
  );
  assert.throws(() => recipes.recipeFromPosition(makeIssue("m_r", "run_r"), 9), /입장이 없습니다/);
});

test("합의 정본: 항목별 출처가 남고, 같은 항목 중복·근거 없음은 막거나 경고한다", () => {
  const issue = makeIssue("m_r", "run_r");
  const r = recipes.recipeFromConsensus(issue, [
    { slot: "subjectPresence", value: "인물 없음", speakerKey: "SPEAKER_01", evidence: ["U03"] },
    { slot: "lighting", value: "형광등", speakerKey: "SPEAKER_02", evidence: ["U07"] },
    { slot: "prohibitedElements", value: "따뜻한 조명", speakerKey: "SPEAKER_01", evidence: ["U05", "U99"] },
  ]);
  assert.equal(r.kind, "consensus");
  assert.equal(r.provenance.speakerKey, null);
  assert.deepEqual(r.provenance.speakerKeys, ["SPEAKER_01", "SPEAKER_02"]);
  assert.deepEqual(r.provenance.evidenceUids, ["U03", "U07", "U05", "U99"]);
  assert.deepEqual(r.provenance.slotSources.lighting, [{ speakerKey: "SPEAKER_02", evidence: ["U07"] }]);
  assert.deepEqual(r.mustNotInclude, ["따뜻한 조명"]);
  assert.ok(r.warnings.some((w) => w.includes("U99")), "안건 근거에 없는 발언 번호는 경고");

  assert.throws(
    () =>
      recipes.recipeFromConsensus(issue, [
        { slot: "lighting", value: "형광등", speakerKey: "SPEAKER_02", evidence: ["U07"] },
        { slot: "lighting", value: "푸른 새벽빛", speakerKey: "SPEAKER_01", evidence: ["U03"] },
      ]),
    /값이 둘 이상/,
  );
  const noEvidence = recipes.recipeFromConsensus(issue, [{ slot: "lighting", value: "형광등", speakerKey: null, evidence: [] }]);
  assert.ok(noEvidence.warnings.some((w) => w.startsWith("근거 없음")));
});

test("결정적 풀이: 모든 낱말을 알 때만 영어를 붙인다", () => {
  assert.equal(glossary.glossaryGloss("푸른 새벽빛"), "blue dawn light");
  assert.equal(glossary.glossaryGloss("인물 없음"), "no people");
  assert.equal(glossary.glossaryGloss("타일의 녹색 곰팡이와 바랜 안내판"), "tile green mould faded sign");
  assert.equal(glossary.glossaryGloss("수현의 망설이는 뒷모습"), null, "모르는 낱말이 있으면 풀이하지 않는다");
  assert.equal(glossary.glossaryGloss("35mm wide"), null, "영어는 풀이가 필요 없다");
});

// ── 2. 레퍼런스 규칙 ────────────────────────────────────────────────────────

test("레퍼런스: 핵심·부분은 첨부, 참고는 글로만, 제외는 부정 지시", () => {
  const palette = {
    status: "extracted" as const,
    extractor: "node-vibrant@4",
    extracted_at: "",
    swatches: [
      { name: "DarkVibrant", hex: "#143c8c", population: 36 },
      { name: "Vibrant", hex: "#ccb43c", population: 30 },
    ],
  };
  const core = memRef({ id: "r_core", title: "새벽 수영장 사진", adoption: "core", take: ["타일 질감", "색감"], avoid: ["인물"], palette });
  const partial = memRef({ id: "r_part", title: "형광등 복도", adoption: "partial", take: ["형광등"], avoid: ["복도 구조"] });
  const loose = memRef({ id: "r_ref", title: "옛 영화 스틸", adoption: "reference", take: ["고요한"], avoid: ["흑백"] });
  const excluded = memRef({ id: "r_ex", title: "리조트 광고", adoption: "excluded", take: ["따뜻한 조명", "야자수"], avoid: [] });

  const plan = refs.planReferences([excluded, loose, partial, core], { maxAttached: 14, gloss: glossary.glossaryGloss });
  assert.deepEqual(plan.attached.map((r) => r.id), ["r_core", "r_part"], "핵심이 1번, 부분이 2번");
  assert.deepEqual(plan.referenceIds, ["r_core", "r_part", "r_ref", "r_ex"]);

  const [coreLine, partLine, refLine] = plan.lines;
  assert.match(coreLine, /^Reference image 1 "새벽 수영장 사진" \(key reference\): take 타일 질감; 색감 \[EN: colour palette\] from it\. Do not take 인물 \[EN: person\] from it\./);
  assert.match(coreLine, /Colour swatches measured from reference image 1, most frequent first: #143c8c, #ccb43c\. Use them as the palette\./);
  assert.match(partLine, /^Reference image 2 "형광등 복도" \(partial reference\): you may lightly borrow 형광등 \[EN: fluorescent light\] from it\. Take nothing else from it\.$/);
  assert.doesNotMatch(partLine, /복도 구조/, "부분 반영은 가져올 요소만 적는다");
  assert.match(refLine, /^Loose idea \(image not attached\) from "옛 영화 스틸": 고요한/);
  assert.equal(plan.lines.length, 3, "제외 레퍼런스는 참조 줄이 없다");
  assert.deepEqual(plan.negatives, [
    '따뜻한 조명 [EN: warm lighting] (as in the rejected reference "리조트 광고")',
    '야자수 (as in the rejected reference "리조트 광고")',
  ]);
  const use = Object.fromEntries(plan.uses.map((u) => [u.referenceId, u]));
  assert.equal(use.r_core.attachedAs, 1);
  assert.equal(use.r_core.paletteUsed, true);
  assert.equal(use.r_ref.attachedAs, null);
  assert.equal(use.r_ex.attachedAs, null);

  // 제외 레퍼런스의 가져올 요소가 프롬프트의 부정 지시에 들어간다
  const recipe = recipes.recipeFromPosition(makeIssue("m_r", "run_r"), 0);
  const { prompt, negative } = recipes.renderImagePrompt(recipe, { referenceLines: plan.lines, referenceNegatives: plan.negatives });
  assert.ok(negative.some((n) => n.includes("야자수")));
  assert.match(prompt, /References:\n- Reference image 1/);
  assert.match(prompt, /Unless a reference line above covers them, keep these plain and neutral/, "팔레트와 '색은 중립' 지시가 부딪치지 않는다");
});

test("레퍼런스: 색을 가져오라는 말이 없거나 피하라고 했으면 팔레트를 넣지 않는다", () => {
  const palette = { status: "extracted" as const, extractor: "x", extracted_at: "", swatches: [{ name: "Vibrant", hex: "#112233", population: 5 }] };
  const noColour = memRef({ id: "a", adoption: "core", take: ["인물 간 거리"], avoid: ["의상"], palette });
  const avoidColour = memRef({ id: "b", adoption: "core", take: ["톤"], avoid: ["색감"], palette });
  const plan = refs.planReferences([noColour, avoidColour], { maxAttached: 14 });
  assert.ok(plan.lines.every((l) => !l.includes("#112233")));
  assert.ok(plan.uses.every((u) => !u.paletteUsed && u.note));
});

test("레퍼런스: TMDB·Unsplash 출처·파일 없음·상한 초과는 첨부하지 않고 글로 내리며 경고한다", () => {
  const a = memRef({ id: "a", title: "A", adoption: "core", take: ["구도"], avoid: ["색"], source: "Unsplash 검색" });
  const b = memRef({ id: "b", title: "B", adoption: "core", take: ["구도"], avoid: ["색"], filePath: null });
  const c = memRef({ id: "c", title: "C", adoption: "core", take: ["조명"], avoid: ["색"] });
  const d = memRef({ id: "d", title: "D", adoption: "partial", take: ["타일"], avoid: ["색"] });
  const plan = refs.planReferences([a, b, c, d], { maxAttached: 1 });
  assert.deepEqual(plan.attached.map((r) => r.id), ["c"]);
  assert.equal(plan.warnings.length, 3);
  assert.ok(plan.lines.some((l) => l.startsWith('Important (image not attached) from "A"')));
  assert.ok(plan.lines.some((l) => l.startsWith('Optional (image not attached) from "D"')));
});

test("레퍼런스 업로드: 핵심 반영은 파일·가져오지 않을 요소가 모두 있어야 한다", async () => {
  await assert.rejects(
    refs.createReference({ meetingId: "m_up", title: "t", source: "팀", adoption: "core", take: ["구도"], avoid: [], file: { bytes: TWO_TONE } }),
    (e: any) => e.code === "INVALID_INPUT" && /avoid/.test(e.message),
  );
  await assert.rejects(
    refs.createReference({ meetingId: "m_up", title: "t", source: "팀", adoption: "core", take: ["구도"], avoid: ["색"] }),
    /파일이 있어야/,
  );
  await assert.rejects(
    refs.createReference({ meetingId: "m_up", title: "t", source: "팀", adoption: "reference", take: [], avoid: [] }),
    /take/,
  );
});

// ── 3. 팔레트 ───────────────────────────────────────────────────────────────

test("팔레트: 테스트에서 만든 PNG 에서 실제 픽셀 색만 뽑아 palette_json 에 남긴다", async () => {
  const f = path.join(TMP, "two_tone.png");
  writeFileSync(f, TWO_TONE);
  const swatches = await refs.extractPalette(f);
  assert.ok(swatches.length >= 2);
  assert.ok(swatches.every((s) => s.population > 0 && /^#[0-9a-f]{6}$/.test(s.hex)));
  const near = (hex: string, rgb: [number, number, number]) => {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return Math.abs(r - rgb[0]) + Math.abs(g - rgb[1]) + Math.abs(b - rgb[2]) < 40;
  };
  assert.ok(swatches.some((s) => near(s.hex, BLUE)), "파란 절반");
  assert.ok(swatches.some((s) => near(s.hex, SAND)), "모래색 절반");

  const { reference } = await refs.createReference({
    meetingId: "m_pal",
    title: "투톤",
    source: "팀 촬영",
    adoption: "core",
    take: ["색감"],
    avoid: ["구도"],
    file: { bytes: TWO_TONE },
  });
  assert.equal(reference.palette?.status, "extracted");
  const row = db.db().prepare(`SELECT palette_json, file_path FROM meeting_references WHERE id = ?`).get(reference.id) as any;
  assert.ok(JSON.parse(row.palette_json).swatches.length >= 2);
  assert.ok(existsSync(path.isAbsolute(row.file_path) ? row.file_path : path.join(process.cwd(), row.file_path)));

  const { reference: loose } = await refs.createReference({
    meetingId: "m_pal",
    title: "참고",
    source: "팀",
    adoption: "reference",
    take: ["고요한"],
    avoid: ["흑백"],
    file: { bytes: TWO_TONE },
  });
  assert.equal(loose.palette, null, "참고 레퍼런스는 팔레트를 뽑지 않는다");
});

// ── 4. 상한 ────────────────────────────────────────────────────────────────

function reserve(meetingId: string, issueId: string, speakerKey: string | null, kind = "perspective") {
  return storage.reserveImage({
    target: { meetingId, issueId, kind, speakerKey },
    runId: "run_q",
    model: "m",
    prompt: "p",
    negative: [],
    referenceIds: [],
    evidenceUids: ["U01"],
    resolution: "draft",
  });
}

test("상한: 같은 대상 2장, 회의 6장. 실패 행은 세지 않고 override 로 풀린다", () => {
  const m = "m_quota";
  reserve(m, "iss1", "S1");
  const second = reserve(m, "iss1", "S1");
  assert.throws(() => reserve(m, "iss1", "S1"), (e: any) => e.code === "QUOTA_EXCEEDED" && e.detail.scope === "decision");

  // 실패 행은 세지 않는다
  storage.failImage(second.id, "PROVIDER_ERROR: test");
  reserve(m, "iss1", "S1");

  reserve(m, "iss1", "S2");
  reserve(m, "iss1", null, "consensus");
  reserve(m, "iss2", "S1");
  reserve(m, "iss2", "S2"); // 6번째 (실패 1개 제외)
  assert.throws(() => reserve(m, "iss3", "S1"), (e: any) => e.code === "QUOTA_EXCEEDED" && e.detail.scope === "meeting");

  process.env.SCENENOTE_IMAGE_QUOTA_OVERRIDE = "1";
  const extra = reserve(m, "iss3", "S1");
  assert.equal(extra.status, "generating");
  delete process.env.SCENENOTE_IMAGE_QUOTA_OVERRIDE;
});

test("상한: 오래 멈춘 generating 행은 실패로 닫혀 상한을 잡아먹지 않는다", () => {
  const m = "m_stale";
  const a = reserve(m, "iss", "S1");
  reserve(m, "iss", "S1");
  db.db().prepare(`UPDATE generated_images SET created_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", a.id);
  const c = reserve(m, "iss", "S1");
  assert.equal(c.status, "generating");
  assert.equal(storage.getImage(a.id)!.status, "failed");
  assert.match(storage.getImage(a.id)!.error!, /INTERRUPTED/);
});

// ── 5. OpenRouter 클라이언트 오류 대응 ──────────────────────────────────────

const gen = (over: Partial<import("../lib/images/openrouterImages").GenerateImageRequest> = {}) =>
  client.generateImage({ prompt: "an empty pool", retryDelayMs: 0, ...over });

test("클라이언트: 키가 없으면 호출하지 않고 NOT_CONFIGURED", async () => {
  await assert.rejects(gen(), (e: any) => e.code === "NOT_CONFIGURED");
  assert.equal(calls.length, 0);
});

test("클라이언트: 요청 모양 — draft=1K, final=2K, 16:9, 참조 이미지는 data URL input_references", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = () => imageOk();
  const dataUrl = `data:image/png;base64,${TWO_TONE.toString("base64")}`;
  const r = await gen({ references: [{ id: "r1", dataUrl }] });
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/images");
  assert.equal((calls[0].init!.headers as any).authorization, `Bearer ${FAKE_KEY}`);
  assert.deepEqual(calls[0].body, {
    model: "google/gemini-3.1-flash-image",
    prompt: "an empty pool",
    resolution: "1K",
    aspect_ratio: "16:9",
    input_references: [{ type: "image_url", image_url: { url: dataUrl } }],
  });
  assert.equal(r.costUsd, 0.067);
  assert.equal(r.mediaType, "image/png");
  assert.deepEqual([r.width, r.height], [32, 18]);
  assert.deepEqual(r.sent.referenceIds, ["r1"]);

  await gen({ resolution: "final" });
  assert.equal(calls[1].body.resolution, "2K");

  process.env.SCENENOTE_IMAGE_MODEL = "openai/gpt-image-2";
  await gen({ resolution: "final" });
  assert.equal(calls[2].body.model, "openai/gpt-image-2");
  assert.equal(calls[2].body.quality, "high");
  assert.equal(calls[2].body.resolution, undefined, "resolution 을 받지 않는 모델에는 보내지 않는다");
  delete process.env.SCENENOTE_IMAGE_MODEL;

  await assert.rejects(gen({ references: [{ id: "x", dataUrl: "https://image.tmdb.org/t/p/a.jpg" }] }), (e: any) => e.code === "INVALID_INPUT");
});

test("클라이언트: 비용은 응답 usage.cost 가 있을 때만, 없으면 null", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = () => imageOk(null);
  const r = await gen();
  assert.equal(r.costUsd, null);
});

test("클라이언트: 402·429 → QUOTA_EXCEEDED, 401 → PROVIDER_ERROR, 408 → TIMEOUT", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = () => json(402, { error: { code: 402, message: "Insufficient credits" } });
  await assert.rejects(gen(), (e: any) => e.code === "QUOTA_EXCEEDED" && e.detail.scope === "provider_credits" && /Insufficient credits/.test(e.message));
  handler = () => json(429, { error: { code: 429, message: "Rate limited" } }, { "retry-after": "7" });
  await assert.rejects(gen(), (e: any) => e.code === "QUOTA_EXCEEDED" && e.detail.retryAfter === "7");
  handler = () => json(401, { error: { code: 401, message: "Missing Authentication header" } });
  await assert.rejects(gen(), (e: any) => e.code === "PROVIDER_ERROR" && e.status === 401);
  handler = () => json(408, { error: { code: 408, message: "timed out" } });
  await assert.rejects(gen(), (e: any) => e.code === "TIMEOUT");
  handler = () =>
    json(400, { success: false, error: { name: "ZodError", message: "Invalid option: expected one of \"512\"|\"1K\"" } });
  await assert.rejects(gen(), (e: any) => e.code === "PROVIDER_ERROR" && e.status === 400 && /Invalid option/.test(e.message));
  assert.equal(calls.length, 5, "4xx 는 재시도하지 않는다");
});

test("클라이언트: 5xx 는 한 번만 재시도한다", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  let n = 0;
  handler = () => (++n === 1 ? json(502, { error: { code: 502, message: "upstream down" } }) : imageOk());
  const ok = await gen();
  assert.equal(ok.attempts, 2);

  calls = [];
  handler = () => json(503, { error: { code: 503, message: "no provider" } });
  await assert.rejects(gen(), (e: any) => e.code === "PROVIDER_ERROR" && e.status === 503);
  assert.equal(calls.length, 2);
});

test("클라이언트: 제한 시간을 넘으면 TIMEOUT, 재시도하지 않는다", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = (c) =>
    new Promise<Response>((_, reject) => {
      c.init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  await assert.rejects(gen({ timeoutMs: 30 }), (e: any) => e.code === "TIMEOUT");
  assert.equal(calls.length, 1);
});

test("클라이언트: 200 인데 이미지가 없으면 NO_IMAGE", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = () => json(200, { created: 0, data: [], usage: { cost: 0 } });
  await assert.rejects(gen(), (e: any) => e.code === "NO_IMAGE");
  handler = () => json(200, { created: 0, data: [{ b64_json: Buffer.from("not an image").toString("base64") }] });
  await assert.rejects(gen(), (e: any) => e.code === "NO_IMAGE");
});

// ── 6. 파이프라인 전체 ──────────────────────────────────────────────────────

test("파이프라인: 관점 그림 → 파일·completed 행, 출처·비용 기록, 사이드카 없으면 not_checked", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  const meetingId = "m_pipe";
  const { runId } = saveIssue(meetingId);
  await refs.createReference({
    meetingId,
    title: "새벽 수영장",
    source: "팀 촬영",
    adoption: "core",
    take: ["색감", "타일 질감"],
    avoid: ["인물"],
    file: { bytes: TWO_TONE },
  });
  await refs.createReference({ meetingId, title: "리조트 광고", source: "팀 캡처", adoption: "excluded", take: ["야자수"], avoid: [] });
  handler = (c) => {
    if (c.url.startsWith("http://sidecar.test")) throw new TypeError("fetch failed: ECONNREFUSED");
    if (c.url.endsWith("/images")) return imageOk(0.0672);
    throw new Error(`예상 밖 호출 ${c.url}`);
  };

  const out = await pipeline.generateForIssue({ meetingId, issueId: "iss_pool_people", positionIndex: 0 });
  const img = out.image;
  assert.equal(img.status, "completed");
  assert.equal(img.kind, "perspective");
  assert.equal(img.speakerKey, "SPEAKER_01");
  assert.equal(img.runId, runId);
  assert.deepEqual(img.evidenceUids, ["U03", "U05"]);
  assert.equal(img.costUsd, 0.0672);
  assert.equal(img.model, "google/gemini-3.1-flash-image");
  assert.equal(img.url, `/api/images/${img.id}`);
  assert.ok(img.filePath && existsSync(path.isAbsolute(img.filePath) ? img.filePath : path.join(process.cwd(), img.filePath)));
  assert.deepEqual(readFileSync(img.filePath!), OUT_PNG, "받은 바이트 그대로 저장");
  assert.deepEqual(img.similarity, { status: "not_checked", reason: "sidecar_unreachable" });
  assert.equal(img.referenceIds.length, 2);
  assert.ok(img.negative.some((n) => n.includes("야자수")) && img.negative.some((n) => n.includes("사람 그림자")));
  assert.match(img.prompt, /Reference image 1 "새벽 수영장"/);

  const sent = calls.find((c) => c.url.endsWith("/images"))!.body;
  assert.equal(sent.input_references.length, 1, "핵심 반영 1장만 첨부, 제외는 첨부하지 않는다");
  assert.equal(sent.prompt, img.prompt, "저장한 프롬프트 = 실제로 보낸 프롬프트");
});

test("파이프라인: 사이드카가 있으면 반영 수준과 유사도를 함께 남긴다", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  const meetingId = "m_sim";
  saveIssue(meetingId);
  await refs.createReference({ meetingId, title: "코어", source: "팀", adoption: "core", take: ["구도"], avoid: ["색"], file: { bytes: TWO_TONE } });
  handler = (c) => {
    if (c.url === "http://sidecar.test/health") return json(200, { ok: true });
    if (c.url === "http://sidecar.test/image-sim") return json(200, { model: "clip-test", similarities: [0.42] });
    return imageOk();
  };
  const out = await pipeline.generateForIssue({ meetingId, issueId: "iss_pool_people", positionIndex: 1 });
  const sim = out.image.similarity as any;
  assert.equal(sim.status, "checked");
  assert.equal(sim.model, "clip-test");
  assert.equal(sim.items[0].adoption, "core");
  assert.equal(sim.items[0].attached, true);
  assert.equal(sim.items[0].similarity, 0.42);
  const simCall = calls.find((c) => c.url.endsWith("/image-sim"))!;
  assert.ok(path.isAbsolute(simCall.body.image_path) && simCall.body.reference_paths.length === 1);
});

test("파이프라인: 공급자 실패는 failed 행과 오류로 남고 파일·대체 이미지가 없다", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  const meetingId = "m_fail";
  saveIssue(meetingId);
  handler = () => json(500, { error: { code: 500, message: "boom" } });
  const err = await pipeline.generateForIssue({ meetingId, issueId: "iss_pool_people", positionIndex: 0 }).catch((e) => e);
  assert.equal(err.code, "PROVIDER_ERROR");
  assert.ok(err.imageId);
  const row = storage.getImage(err.imageId)!;
  assert.equal(row.status, "failed");
  assert.match(row.error!, /PROVIDER_ERROR: .*boom/);
  assert.equal(row.filePath, null);
  assert.equal(row.url, null);
});

test("파이프라인: 키가 없으면 행을 만들지 않고 NOT_CONFIGURED, 안건이 없으면 NOT_FOUND", async () => {
  const meetingId = "m_nokey";
  saveIssue(meetingId);
  await assert.rejects(pipeline.generateForIssue({ meetingId, issueId: "iss_pool_people", positionIndex: 0 }), (e: any) => e.code === "NOT_CONFIGURED");
  assert.equal(storage.listImages(meetingId).length, 0);
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  await assert.rejects(pipeline.generateForIssue({ meetingId, issueId: "nope", positionIndex: 0 }), (e: any) => e.code === "NOT_FOUND");
  await assert.rejects(
    pipeline.generateForIssue({ meetingId, issueId: "iss_pool_people", positionIndex: 0, consensus: [] }),
    (e: any) => e.code === "INVALID_INPUT",
  );
});

test("파이프라인: 회의 맥락은 Scene Brief 슬러그라인에서 대본 표기로 조립한다", () => {
  const d = db.db();
  d.prepare(`INSERT INTO projects (id, title, domain, one_line, created_at) VALUES (?,?,?,?,?)`).run("p_ctx", "숨을 세는 사람", "film", "한 줄", "t");
  d.prepare(`INSERT INTO meetings (id, project_id, title, raw_transcript, created_at) VALUES (?,?,?,?,?)`).run("m_ctx", "p_ctx", "회의", "", "t");
  const ins = d.prepare(
    `INSERT INTO scene_brief_items (id, meeting_id, field, idx, ai_value, user_value, decision_state, evidence, confidence) VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  ins.run("b1", "m_ctx", "SCENE_NUMBER", 0, "SCENE 34", null, "candidate", "[]", "high");
  ins.run("b2", "m_ctx", "INT_EXT", 1, "INT.", null, "candidate", "[]", "high");
  ins.run("b3", "m_ctx", "LOCATION", 2, "실내 수영장", null, "candidate", "[]", "high");
  ins.run("b4", "m_ctx", "TIME_OF_DAY", 3, "NIGHT", "DAWN", "candidate", "[]", "high");
  assert.deepEqual(pipeline.loadMeetingContext("m_ctx"), {
    slugline: "SCENE 34 · INT. 실내 수영장 – DAWN",
    oneLiner: "한 줄",
    projectTitle: "숨을 세는 사람",
  });
});

test("풀이: 사전에 없는 값만 LLM 에 묻고 해시로 캐시한다", async () => {
  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  process.env.SCENENOTE_GLOSS_LLM = "1";
  handler = (c) => {
    assert.equal(c.body.model, "anthropic/claude-haiku-4.5");
    const items = JSON.parse(c.body.messages[1].content) as Array<{ i: number; ko: string }>;
    assert.deepEqual(items.map((x) => x.ko), ["수현의 망설이는 뒷모습"]);
    return json(200, { choices: [{ message: { content: '{"glosses":[{"i":0,"en":"Suhyeon hesitating, seen from behind"}]}' } }] });
  };
  const first = await gloss.resolveGlosses(["푸른 새벽빛", "수현의 망설이는 뒷모습"]);
  assert.equal(first.map.get("푸른 새벽빛")!.source, "glossary");
  assert.deepEqual(first.map.get("수현의 망설이는 뒷모습"), { text: "Suhyeon hesitating, seen from behind", source: "llm" });
  assert.equal(calls.length, 1);
  const second = await gloss.resolveGlosses(["수현의 망설이는 뒷모습"]);
  assert.equal(second.map.get("수현의 망설이는 뒷모습")!.source, "llm_cache");
  assert.equal(calls.length, 1, "캐시 적중이면 다시 묻지 않는다");

  handler = () => json(500, { error: { message: "down" } });
  const failed = await gloss.resolveGlosses(["알수없는낱말"]);
  assert.deepEqual(failed.missing, ["알수없는낱말"]);
  assert.match(failed.llmNote!, /LLM 풀이 실패/);
});

// ── 7. 어댑터 (가짜 성공 제거) ──────────────────────────────────────────────

test("어댑터: 키가 없으면 NOT_CONFIGURED 계열 오류, 있으면 실제 호출 결과 파일 경로를 돌려준다", async () => {
  const recipe = {
    id: "rec_a",
    projectId: "p",
    sceneNumber: 34,
    promptText: "empty indoor pool at dawn",
    requiredElements: ["faded sign"],
    prohibitedElements: ["people"],
    referenceIds: [],
    characterVisualIds: [],
  };
  const gpt = new adapters.GptImage2Adapter();
  const err = await gpt.generate(recipe).catch((e) => e);
  assert.ok(err instanceof adapters.MissingApiKeyError);
  assert.ok(err instanceof errors.ImageGenError);
  assert.equal(err.code, "NOT_CONFIGURED");
  assert.equal(calls.length, 0);

  process.env.OPENROUTER_API_KEY = FAKE_KEY;
  handler = () => imageOk(0.05);
  for (const a of [gpt, new adapters.GeminiFlashImageAdapter()]) {
    const r = await a.generate(recipe);
    assert.doesNotMatch(r.imageUri, /project-visual-workspace/);
    assert.ok(existsSync(path.isAbsolute(r.imageUri) ? r.imageUri : path.join(process.cwd(), r.imageUri)));
    assert.equal(r.costUsd, 0.05);
    assert.equal(r.model, a.model);
  }
  assert.equal(calls[0].body.model, "openai/gpt-image-2");
  assert.equal(calls[1].body.model, "google/gemini-3.1-flash-image");
  assert.match(calls[0].body.prompt, /Do not include: people\./);

  // FLUX 부분 수정: 원본이 없으면 막는다
  const flux = new adapters.Flux2ProAdapter();
  await assert.rejects(flux.generate({ ...recipe, isRefinementOfImageId: "img_missing" }), (e: any) => e.code === "NOT_FOUND");
  // 캐릭터 비주얼을 불러올 경로가 없으면 빼고 생성하지 않는다
  await assert.rejects(gpt.generate({ ...recipe, characterVisualIds: ["char_1"] }), (e: any) => e.code === "INVALID_INPUT");
});

test("어댑터 소스에 준비된 데모 이미지 경로가 남아 있지 않다", () => {
  const dir = path.join(__dirname, "..", "lib", "domain", "imageGeneration", "adapters");
  for (const f of ["gptImageAdapter.ts", "geminiImageAdapter.ts", "fluxAdapter.ts", "openrouterDelegate.ts"]) {
    const src = readFileSync(path.join(dir, f), "utf8");
    assert.doesNotMatch(src, /project-visual-workspace\/assets|\.png`/, f);
  }
});

