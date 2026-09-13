/**
 * 캐릭터 컨셉 초안 (계획서 3-5, 중간보고서의 "캐릭터 컨셉 아트 초안").
 *
 * 1. 모으기: 회의마다 발언에서 극중 인물의 외형 묘사(나이대·얼굴·머리·체형·의상·소품·표정)를 근거 U-ID 와 함께 뽑는다.
 *    회의에서 말하지 않은 묘사는 넣지 않는다. 같은 입력이면 다시 부르지 않는다(source_hash).
 * 2. 합치기: 작품의 회의를 순서대로 겹쳐, 항목마다 가장 최근 회의의 값을 쓴다. 사람이 승인한 결정(원장) 가운데
 *    결정 이름에 인물 이름이 들어 있고 항목이 의상·소품이면 그 값이 발언보다 앞선다. 의견이 갈린 값(contested)은
 *    그리지 않고 "확인 필요"로 둔다.
 * 3. 그리기: 첫 판은 묘사만으로 그린다. 묘사가 바뀌면 이전 판 이미지를 참조로 넣어 같은 사람을 유지하고,
 *    바뀐 항목만 고치게 한다. 이전 판과의 이미지 유사도(사이드카 SigLIP)를 함께 남긴다.
 *
 * 초안은 초안일 뿐이다. 사람이 이름을 적어 "이 판을 기준으로"를 눌러야 채택으로 기록된다.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { db, now, uid } from "../db";
import { chatJson, type Usage } from "../llm/openrouter";
import { listLedger } from "../consistency/ledger";
import { generateImage, imageModel } from "../images/openrouterImages";
import { completeImage, failImage, getImage, reserveImage } from "../images/storage";
import { ImageGenError } from "../images/errors";
import { resolveStoredPath } from "../images/paths";
import { sniffMediaType, toDataUrl } from "../images/imageBytes";
import { resolveGlosses } from "../images/gloss";
import { measureSimilarity } from "../images/similarity";

export const ASPECTS = ["age", "face", "hair", "body", "wardrobe", "props", "expression"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const ASPECT_LABEL: Record<Aspect, string> = {
  age: "나이대",
  face: "얼굴",
  hair: "머리",
  body: "체형",
  wardrobe: "의상",
  props: "소품",
  expression: "표정·분위기",
};
/** 원장 항목 → 인물 묘사 항목. 여기 없는 항목(조명·구도 등)은 인물 묘사가 아니다. */
const SLOT_TO_ASPECT: Record<string, Aspect> = { wardrobe: "wardrobe", props: "props" };

export const MAX_DRAFTS_PER_CHARACTER = 4;
export const CHARACTER_MODEL = process.env.SCENENOTE_CHARACTER_MODEL ?? "anthropic/claude-sonnet-5";

export class CharacterError extends Error {
  constructor(
    readonly code: "NO_MEETING" | "NO_DESCRIPTION" | "NO_CHANGE" | "LIMIT" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

// ── 1. 모으기 ───────────────────────────────────────────────────────────────

const Extraction = z.object({
  characters: z.array(
    z.object({
      name: z.string().describe("대본 속 인물 이름. 이름이 없으면 회의에서 부른 말(예: 여주인공)"),
      notes: z.array(
        z.object({
          aspect: z.enum(ASPECTS),
          value: z.string().describe("짧은 명사구. 회의에서 말한 표현에 가깝게"),
          status: z.enum(["agreed", "proposed", "contested"]),
          evidence: z.array(z.string()).describe("그 묘사가 나온 발언의 U-ID"),
        }),
      ),
    }),
  ),
});

const EXTRACT_SYSTEM = `당신은 영화 제작 회의 녹취에서 극중 인물(캐릭터)의 외형 묘사만 모으는 추출기다.
- 극중 인물만 적는다. 회의 참석자(감독·촬영감독·미술감독 등)는 극중 인물이 아니다.
- 회의에서 실제로 말한 묘사만 적는다. 추측하거나 보태지 않는다. 말하지 않은 항목은 넣지 않는다.
- aspect: age(나이대), face(얼굴 생김새·화장), hair(머리 모양·색), body(체형·키), wardrobe(옷·신발·수영모처럼 몸에 걸친 것),
  props(인물이 손에 들거나 지니는 물건), expression(표정·자세·분위기).
- status: 반대 없이 받아들여졌으면 agreed, 한 사람이 제안했을 뿐이면 proposed, 사람들이 서로 다른 값을 말했으면 contested(값마다 따로 적는다).
- 회의 안에서 값을 바꿨으면 마지막 값만 agreed 로 적는다.
- 장소·조명·카메라 이야기는 인물 묘사가 아니다.
- 극중 인물 묘사가 없으면 characters 는 빈 배열이다.`;

type Utt = { uid: string; speaker_name: string | null; role: string | null; text: string };

function meetingInput(meetingId: string): { projectId: string; sceneLine: string | null; utts: Utt[] } {
  const m = db()
    .prepare(`SELECT m.project_id, p.one_line FROM meetings m JOIN projects p ON p.id = m.project_id WHERE m.id = ?`)
    .get(meetingId) as { project_id: string; one_line: string | null } | undefined;
  if (!m) throw new CharacterError("NO_MEETING", "회의를 찾을 수 없습니다.");
  const utts = db()
    .prepare(`SELECT uid, speaker_name, role, COALESCE(NULLIF(text_clean, ''), text_raw) AS text FROM utterances WHERE meeting_id = ? ORDER BY idx`)
    .all(meetingId) as Utt[];
  return { projectId: m.project_id, sceneLine: m.one_line, utts };
}

export type ExtractResult = { meetingId: string; notes: number; characters: string[]; cached: boolean; usage: Usage | null };

export async function extractCharacterNotes(meetingId: string, opts: { model?: string } = {}): Promise<ExtractResult> {
  const { projectId, sceneLine, utts } = meetingInput(meetingId);
  const model = opts.model ?? CHARACTER_MODEL;
  const transcript = utts.map((u) => `[${u.uid}] ${[u.speaker_name, u.role].filter(Boolean).join("·") || "화자 미상"}: ${u.text}`).join("\n");
  const user = `${sceneLine ? `장면: ${sceneLine}\n\n` : ""}회의 발언:\n${transcript}`;
  const hash = createHash("sha256").update(`${model}\n${EXTRACT_SYSTEM}\n${user}`).digest("hex").slice(0, 32);

  const have = db().prepare(`SELECT source_hash, character FROM character_notes WHERE meeting_id = ?`).all(meetingId) as {
    source_hash: string;
    character: string;
  }[];
  if (have.length && have.every((r) => r.source_hash === hash)) {
    return { meetingId, notes: have.length, characters: [...new Set(have.map((r) => r.character))], cached: true, usage: null };
  }
  if (!utts.length) return { meetingId, notes: 0, characters: [], cached: false, usage: null };

  const schema = z.toJSONSchema(Extraction, { target: "draft-07" }) as Record<string, unknown>;
  const r = await chatJson({
    model,
    schemaName: "character_notes",
    schema,
    messages: [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: user },
    ],
    maxTokens: 4000,
  });
  const out = Extraction.parse(r.data);
  const known = new Set(utts.map((u) => u.uid));
  const rows: { character: string; aspect: Aspect; value: string; status: string; evidence: string[] }[] = [];
  for (const c of out.characters) {
    const name = c.name.trim();
    if (!name) continue;
    for (const n of c.notes) {
      const evidence = [...new Set(n.evidence.filter((e) => known.has(e)))];
      const value = n.value.trim().slice(0, 120);
      // 근거 발언이 이 회의에 없으면 버린다(지어낸 묘사를 막는다).
      if (!value || !evidence.length) continue;
      rows.push({ character: name, aspect: n.aspect, value, status: n.status, evidence });
    }
  }
  const d = db();
  const ts = now();
  d.exec("BEGIN");
  try {
    d.prepare(`DELETE FROM character_notes WHERE meeting_id = ?`).run(meetingId);
    const ins = d.prepare(
      `INSERT INTO character_notes (id, project_id, meeting_id, character, aspect, value, status, evidence, source_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const x of rows) ins.run(`cn_${uid()}`, projectId, meetingId, x.character, x.aspect, x.value, x.status, JSON.stringify(x.evidence), hash, ts);
    // 묘사가 하나도 없는 회의도 "읽었음"을 남겨 다시 부르지 않게 한다.
    if (!rows.length) ins.run(`cn_${uid()}`, projectId, meetingId, "", "none", "", "none", "[]", hash, ts);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { meetingId, notes: rows.length, characters: [...new Set(rows.map((x) => x.character))], cached: false, usage: r.usage };
}

// ── 2. 합치기 ───────────────────────────────────────────────────────────────

export type AspectSource =
  | { kind: "meeting"; meetingId: string; meetingTitle: string | null; evidence: string[]; status: "agreed" | "proposed" }
  | { kind: "decision"; meetingId: string; ledgerId: string; decision: string; decidedBy: string };

export type CharacterProfile = {
  name: string;
  aspects: Partial<Record<Aspect, { value: string; source: AspectSource }>>;
  /** 의견이 갈려 그리지 않은 값 */
  contested: { aspect: Aspect; value: string; meetingId: string; meetingTitle: string | null; evidence: string[] }[];
  /** 항목 값이 회의를 거치며 바뀐 기록(오래된 것부터) */
  history: { aspect: Aspect; value: string; meetingId: string; meetingTitle: string | null; kind: "meeting" | "decision" }[];
};

export function characterProfiles(projectId: string): CharacterProfile[] {
  const meetings = db().prepare(`SELECT id, title, created_at FROM meetings WHERE project_id = ? ORDER BY created_at`).all(projectId) as {
    id: string;
    title: string | null;
  }[];
  const titleOf = new Map(meetings.map((m) => [m.id, m.title]));
  const order = new Map(meetings.map((m, i) => [m.id, i]));
  const notes = (
    db()
      .prepare(`SELECT meeting_id, character, aspect, value, status, evidence FROM character_notes WHERE project_id = ? AND character <> ''`)
      .all(projectId) as { meeting_id: string; character: string; aspect: Aspect; value: string; status: string; evidence: string }[]
  ).sort((a, b) => (order.get(a.meeting_id) ?? 0) - (order.get(b.meeting_id) ?? 0));

  const profiles = new Map<string, CharacterProfile>();
  const get = (name: string) => {
    if (!profiles.has(name)) profiles.set(name, { name, aspects: {}, contested: [], history: [] });
    return profiles.get(name)!;
  };
  for (const n of notes) {
    const p = get(n.character);
    const evidence = JSON.parse(n.evidence) as string[];
    if (n.status === "contested") {
      p.contested.push({ aspect: n.aspect, value: n.value, meetingId: n.meeting_id, meetingTitle: titleOf.get(n.meeting_id) ?? null, evidence });
      continue;
    }
    const prev = p.aspects[n.aspect];
    if (!prev || prev.value !== n.value) {
      p.history.push({ aspect: n.aspect, value: n.value, meetingId: n.meeting_id, meetingTitle: titleOf.get(n.meeting_id) ?? null, kind: "meeting" });
    }
    p.aspects[n.aspect] = {
      value: n.value,
      source: { kind: "meeting", meetingId: n.meeting_id, meetingTitle: titleOf.get(n.meeting_id) ?? null, evidence, status: n.status as "agreed" | "proposed" },
    };
    // 뒤 회의에서 다시 정리됐으면 앞 회의의 "갈림"은 풀린 것으로 본다.
    p.contested = p.contested.filter((c) => c.aspect !== n.aspect || (order.get(c.meetingId) ?? 0) > (order.get(n.meeting_id) ?? 0));
  }
  // 사람이 승인한 결정이 발언보다 앞선다. 결정 이름에 인물 이름이 있고 항목이 인물 묘사일 때만.
  for (const e of listLedger(projectId, { activeOnly: true }).sort((a, b) => a.decided_at.localeCompare(b.decided_at))) {
    const aspect = SLOT_TO_ASPECT[e.slot];
    if (!aspect) continue;
    for (const p of profiles.values()) {
      if (!e.decision.includes(p.name)) continue;
      if (p.aspects[aspect]?.value !== e.value) {
        p.history.push({ aspect, value: e.value, meetingId: e.meeting_id, meetingTitle: titleOf.get(e.meeting_id) ?? null, kind: "decision" });
      }
      p.aspects[aspect] = { value: e.value, source: { kind: "decision", meetingId: e.meeting_id, ledgerId: e.id, decision: e.decision, decidedBy: e.decided_by } };
      p.contested = p.contested.filter((c) => c.aspect !== aspect);
    }
  }
  return [...profiles.values()].filter((p) => Object.keys(p.aspects).length || p.contested.length);
}

// ── 3. 그리기 ───────────────────────────────────────────────────────────────

export type DraftRow = {
  id: string;
  project_id: string;
  character: string;
  version: number;
  image_id: string;
  parent_id: string | null;
  description: Partial<Record<Aspect, string>>;
  changes: { aspect: Aspect; before: string | null; after: string | null }[];
  similarity_to_parent: number | null;
  adopted_by: string | null;
  adopted_at: string | null;
  created_at: string;
};

export function listDrafts(projectId: string, character?: string): DraftRow[] {
  const rows = (
    character
      ? db().prepare(`SELECT * FROM character_drafts WHERE project_id = ? AND character = ? ORDER BY version`).all(projectId, character)
      : db().prepare(`SELECT * FROM character_drafts WHERE project_id = ? ORDER BY character, version`).all(projectId)
  ) as (Omit<DraftRow, "description" | "changes"> & { description_json: string; changes_json: string })[];
  return rows.map(({ description_json, changes_json, ...r }) => ({
    ...r,
    description: JSON.parse(description_json),
    changes: JSON.parse(changes_json),
  }));
}

export function describeChanges(
  before: Partial<Record<Aspect, string>> | null,
  after: Partial<Record<Aspect, string>>,
): { aspect: Aspect; before: string | null; after: string | null }[] {
  const out: { aspect: Aspect; before: string | null; after: string | null }[] = [];
  for (const a of ASPECTS) {
    const x = before?.[a] ?? null;
    const y = after[a] ?? null;
    if (x !== y) out.push({ aspect: a, before: x, after: y });
  }
  return out;
}

/** 이미지 모델에 넣는 글. 값은 한국어 원문과 풀이를 함께 넣고, 말하지 않은 것은 보태지 말라고 적는다. */
export function buildCharacterPrompt(
  name: string,
  description: Partial<Record<Aspect, string>>,
  opts: { gloss?: Map<string, string>; changes?: { aspect: Aspect; before: string | null; after: string | null }[]; hasReference: boolean; sceneLine?: string | null },
): string {
  const g = (v: string) => {
    const e = opts.gloss?.get(v);
    return e && e !== v ? `${v} (${e})` : v;
  };
  const lines = ASPECTS.filter((a) => description[a]).map((a) => `- ${ASPECT_LABEL[a]} / ${a}: ${g(description[a]!)}`);
  const head = [
    `Character concept art sheet for a Korean film pre-production meeting. Character: "${name}".`,
    opts.sceneLine ? `Scene context (for mood only, do not draw the location in detail): ${opts.sceneLine}` : null,
    "Layout: one full-body view and one face close-up of the same person side by side, plain light-grey studio background, soft even lighting, realistic film concept art. No text, no labels, no logos.",
    "Use only the traits listed below. Anything not listed must stay plain and neutral: simple unbranded clothing, natural hair, no accessories or props that are not listed.",
    "Traits (Korean as said in the meeting, English gloss in parentheses):",
    ...lines,
  ].filter(Boolean) as string[];
  if (opts.hasReference && opts.changes?.length) {
    head.push(
      "The attached reference image is the previous draft of this same character. Keep the same person: identical face, hairstyle, body and age. Change only the following:",
      ...opts.changes.map((c) => `- ${ASPECT_LABEL[c.aspect]}: ${c.before ? g(c.before) : "(not specified)"} -> ${c.after ? g(c.after) : "(remove; keep neutral)"}`),
    );
  }
  return head.join("\n");
}

export type DrawResult = { draft: DraftRow; imageUrl: string; latencyMs: number; costUsd: number | null };

export async function drawCharacterDraft(opts: { projectId: string; character: string; meetingId: string }): Promise<DrawResult> {
  const profile = characterProfiles(opts.projectId).find((p) => p.name === opts.character);
  if (!profile || !Object.keys(profile.aspects).length) throw new CharacterError("NO_DESCRIPTION", "회의에서 모은 이 인물의 묘사가 없습니다.");
  const description = Object.fromEntries(Object.entries(profile.aspects).map(([a, v]) => [a, v!.value])) as Partial<Record<Aspect, string>>;
  const drafts = listDrafts(opts.projectId, opts.character);
  const last = drafts[drafts.length - 1] ?? null;
  const changes = describeChanges(last?.description ?? null, description);
  if (last && !changes.length) throw new CharacterError("NO_CHANGE", `v${last.version} 이후 바뀐 묘사가 없습니다. 같은 그림을 다시 사지 않습니다.`);
  if (drafts.length >= MAX_DRAFTS_PER_CHARACTER) throw new CharacterError("LIMIT", `인물마다 초안은 ${MAX_DRAFTS_PER_CHARACTER}판까지입니다.`);

  const sceneLine = (db().prepare(`SELECT one_line FROM projects WHERE id = ?`).get(opts.projectId) as { one_line: string | null } | undefined)?.one_line ?? null;
  const gl = await resolveGlosses(Object.values(description) as string[]).catch(() => null);
  const gloss = new Map([...(gl?.map ?? new Map()).entries()].map(([k, v]) => [k, v.text]));

  let reference: { id: string; dataUrl: string; absPath: string } | null = null;
  if (last) {
    const img = getImage(last.image_id);
    const abs = img?.filePath ? resolveStoredPath(img.filePath) : null;
    if (!abs || !existsSync(abs)) throw new CharacterError("NOT_FOUND", `이전 판(v${last.version}) 이미지 파일이 없어 같은 사람으로 이어 그릴 수 없습니다.`);
    const bytes = readFileSync(abs);
    const mt = sniffMediaType(bytes);
    if (!mt) throw new CharacterError("NOT_FOUND", "이전 판 파일이 이미지가 아닙니다.");
    reference = { id: last.image_id, dataUrl: toDataUrl(bytes, mt), absPath: abs };
  }
  const prompt = buildCharacterPrompt(opts.character, description, { gloss, changes: last ? changes : undefined, hasReference: !!reference, sceneLine });
  const evidence = Object.values(profile.aspects).flatMap((v) => (v!.source.kind === "meeting" ? v!.source.evidence.map((u) => `${v!.source.meetingId}:${u}`) : []));
  const row = reserveImage({
    target: { meetingId: opts.meetingId, issueId: null, kind: "character", speakerKey: opts.character },
    runId: null,
    model: imageModel(),
    prompt,
    negative: ["text", "labels", "logos", "props or accessories not listed"],
    referenceIds: reference ? [reference.id] : [],
    evidenceUids: [...new Set(evidence)],
    resolution: "draft",
  });
  let done;
  let latencyMs = 0;
  try {
    const r = await generateImage({ prompt, resolution: "draft", aspectRatio: "16:9", references: reference ? [{ id: reference.id, dataUrl: reference.dataUrl }] : [] });
    latencyMs = r.latencyMs;
    done = completeImage(row.id, { bytes: r.bytes, mediaType: r.mediaType, width: r.width, height: r.height, costUsd: r.costUsd, model: r.model });
  } catch (e) {
    failImage(row.id, (e as Error).message);
    if (e instanceof ImageGenError) e.imageId = row.id;
    throw e;
  }

  // 같은 사람으로 이어졌는지: 이전 판과의 이미지 유사도(사이드카가 없으면 null).
  let sim: number | null = null;
  if (reference && done.filePath) {
    const m = await measureSimilarity(resolveStoredPath(done.filePath), [{ id: reference.id, adoption: "core", attached: true, absPath: reference.absPath }]).catch(() => null);
    if (m?.status === "checked") sim = m.items[0]?.similarity ?? null;
  }
  const id = `cd_${uid()}`;
  db()
    .prepare(
      `INSERT INTO character_drafts (id, project_id, character, version, image_id, parent_id, description_json, changes_json, similarity_to_parent, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, opts.projectId, opts.character, (last?.version ?? 0) + 1, done.id, last?.id ?? null, JSON.stringify(description), JSON.stringify(changes), sim, now());
  const draft = listDrafts(opts.projectId, opts.character).find((x) => x.id === id)!;
  return { draft, imageUrl: `/api/images/${done.id}`, latencyMs, costUsd: done.costUsd };
}

/** 사람이 이 판을 기준으로 채택. 같은 인물의 다른 판 채택은 풀린다. */
export function adoptDraft(draftId: string, by: string): DraftRow {
  if (!by.trim()) throw new CharacterError("NOT_FOUND", "채택하는 사람 이름이 필요합니다.");
  const d = db().prepare(`SELECT project_id, character FROM character_drafts WHERE id = ?`).get(draftId) as { project_id: string; character: string } | undefined;
  if (!d) throw new CharacterError("NOT_FOUND", "초안을 찾을 수 없습니다.");
  db().prepare(`UPDATE character_drafts SET adopted_by = NULL, adopted_at = NULL WHERE project_id = ? AND character = ?`).run(d.project_id, d.character);
  db().prepare(`UPDATE character_drafts SET adopted_by = ?, adopted_at = ? WHERE id = ?`).run(by.trim(), now(), draftId);
  return listDrafts(d.project_id, d.character).find((x) => x.id === draftId)!;
}
