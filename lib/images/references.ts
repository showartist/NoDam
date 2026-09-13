/**
 * 회의 레퍼런스 이미지 (meeting_references 표 + .data/references/ 파일). 서버 전용.
 *
 * 반영 수준은 퍼센트가 아니라 4단계다 (제품 원칙 3·7).
 *
 *   core      핵심 반영  참조 이미지로 첨부 + "N번에서 <가져올 요소>를 가져오고 <가져오지 않을 요소>는 가져오지 말 것"
 *   partial   부분 반영  참조 이미지로 첨부 + 가져올 요소만, 약한 표현
 *   reference 참고       첨부하지 않는다. 가져올 요소를 글로만 적는다
 *   excluded  제외       첨부하지 않는다. 가져올 요소가 부정 지시가 된다
 *
 * 생성 입력으로는 팀이 올린 파일만 쓴다. 외부 서비스에서 이미지를 받아 오지 않는다.
 * 출처가 TMDB·Unsplash 인 파일은 약관상 AI 입력으로 쓸 수 없어 첨부하지 않고 글로만 반영한다.
 *
 * 팔레트: core·partial 이미지에서 node-vibrant 로 색 견본을 뽑아 palette_json 에 남긴다.
 *   - 실제 픽셀에서 나온 견본(population > 0)만 남긴다. 합성 견본은 버린다.
 *   - 프롬프트에는 가져올 요소에 색 관련 말이 있고, 가져오지 않을 요소에는 없을 때만 넣는다.
 *     색을 가져오라는 말이 없는데 색을 넘기면 "가져올 요소"를 우리가 늘리는 셈이다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db, now, uid } from "../db";
import { ImageGenError } from "./errors";
import { EXT_BY_MEDIA, sniffMediaType, toDataUrl } from "./imageBytes";
import { referencesDir, resolveStoredPath, toStoredPath } from "./paths";
import type { ReferenceImageInput } from "./openrouterImages";
import type { GlossFn } from "./recipeFromPosition";

export const ADOPTIONS = ["core", "partial", "reference", "excluded"] as const;
export type Adoption = (typeof ADOPTIONS)[number];
export const ADOPTION_LABEL: Record<Adoption, string> = {
  core: "핵심 반영",
  partial: "부분 반영",
  reference: "참고",
  excluded: "제외",
};

export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

export type PaletteSwatch = { name: string; hex: string; population: number };
export type PaletteRecord =
  | { status: "extracted"; extractor: string; swatches: PaletteSwatch[]; extracted_at: string }
  | { status: "failed"; extractor: string; error: string; extracted_at: string };

export type MeetingReference = {
  id: string;
  meetingId: string;
  title: string;
  source: string;
  uploadedBy: string | null;
  adoption: Adoption;
  take: string[];
  avoid: string[];
  filePath: string | null;
  palette: PaletteRecord | null;
  evidence: string[];
  createdAt: string;
};

type Row = {
  id: string;
  meeting_id: string;
  title: string;
  source: string;
  uploaded_by: string | null;
  adoption: string;
  take_json: string;
  avoid_json: string;
  file_path: string | null;
  palette_json: string | null;
  evidence: string;
  created_at: string;
};

const arr = (s: string | null): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

function toRef(r: Row): MeetingReference {
  let palette: PaletteRecord | null = null;
  try {
    palette = r.palette_json ? (JSON.parse(r.palette_json) as PaletteRecord) : null;
  } catch {
    palette = null;
  }
  return {
    id: r.id,
    meetingId: r.meeting_id,
    title: r.title,
    source: r.source,
    uploadedBy: r.uploaded_by,
    adoption: (ADOPTIONS as readonly string[]).includes(r.adoption) ? (r.adoption as Adoption) : "reference",
    take: arr(r.take_json),
    avoid: arr(r.avoid_json),
    filePath: r.file_path,
    palette,
    evidence: arr(r.evidence),
    createdAt: r.created_at,
  };
}

export function listReferences(meetingId: string): MeetingReference[] {
  return (
    db().prepare(`SELECT * FROM meeting_references WHERE meeting_id = ? ORDER BY created_at, id`).all(meetingId) as unknown as Row[]
  ).map(toRef);
}

export function getReference(id: string): MeetingReference | null {
  const r = db().prepare(`SELECT * FROM meeting_references WHERE id = ?`).get(id) as unknown as Row | undefined;
  return r ? toRef(r) : null;
}

// ── 규칙 판정 ───────────────────────────────────────────────────────────────

/** TMDB·Unsplash 는 약관이 AI 입력 사용을 제한한다. 첨부하지 않는다. */
export function isRestrictedSource(source: string): boolean {
  return /tmdb|themoviedb|unsplash/i.test(source);
}

const COLOUR_WORDS = /색|컬러|칼라|톤|팔레트|채도|명도|colou?r|palette|tone|hue|grade|grading/i;
export const mentionsColour = (items: string[]) => items.some((x) => COLOUR_WORDS.test(x));

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

export type NewReferenceInput = {
  meetingId: string;
  title: string;
  source: string;
  uploadedBy?: string | null;
  adoption: Adoption;
  take: string[];
  avoid: string[];
  evidence?: string[];
  file?: { bytes: Uint8Array; fileName?: string } | null;
};

/** 업로드 검증. 오류 목록이 비어 있어야 저장한다. */
export function validateReferenceInput(input: NewReferenceInput): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.meetingId?.trim()) errors.push("meetingId 가 필요합니다.");
  if (!input.title?.trim()) errors.push("title(레퍼런스 이름)이 필요합니다.");
  if (!input.source?.trim()) errors.push("source(출처)가 필요합니다.");
  if (!(ADOPTIONS as readonly string[]).includes(input.adoption)) {
    errors.push(`adoption 은 ${ADOPTIONS.join(" | ")} 중 하나여야 합니다.`);
  }
  const take = uniq(input.take ?? []);
  const avoid = uniq(input.avoid ?? []);
  // 제품 원칙 7: 무엇을 가져오고 무엇을 가져오지 않는지가 둘 다 있어야 한다.
  if (take.length === 0) errors.push("take(가져올 요소)가 비어 있습니다.");
  if ((input.adoption === "core" || input.adoption === "partial") && avoid.length === 0) {
    errors.push("핵심·부분 반영 레퍼런스는 avoid(가져오지 않을 요소)가 있어야 합니다. 이미지를 첨부하면 모델이 전부 따라 할 수 있습니다.");
  }
  if (input.adoption === "reference" && avoid.length === 0) warnings.push("avoid(가져오지 않을 요소)가 비어 있습니다.");
  if ((input.adoption === "core" || input.adoption === "partial") && !input.file) {
    errors.push("핵심·부분 반영 레퍼런스는 이미지 파일이 있어야 합니다(참조 이미지로 첨부됩니다).");
  }
  if (input.file) {
    if (input.file.bytes.byteLength > MAX_REFERENCE_BYTES) errors.push("이미지는 10MB 이하만 올릴 수 있습니다.");
    if (!sniffMediaType(input.file.bytes)) errors.push("PNG·JPEG·WebP 이미지만 올릴 수 있습니다.");
  }
  if (isRestrictedSource(input.source ?? "") && (input.adoption === "core" || input.adoption === "partial")) {
    warnings.push("TMDB·Unsplash 출처 이미지는 약관상 생성 입력으로 첨부하지 않습니다. 글로만 반영됩니다.");
  }
  return { errors, warnings };
}

export async function createReference(input: NewReferenceInput): Promise<{ reference: MeetingReference; warnings: string[] }> {
  const { errors, warnings } = validateReferenceInput(input);
  if (errors.length) throw new ImageGenError("INVALID_INPUT", errors.join(" "), { detail: { errors } });

  const id = `ref_${uid()}`;
  let storedPath: string | null = null;
  if (input.file) {
    const mediaType = sniffMediaType(input.file.bytes)!;
    const dir = referencesDir();
    mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, `${id}.${EXT_BY_MEDIA[mediaType]}`);
    writeFileSync(abs, input.file.bytes);
    storedPath = toStoredPath(abs);
  }
  db()
    .prepare(
      `INSERT INTO meeting_references
         (id, meeting_id, title, source, uploaded_by, adoption, take_json, avoid_json, file_path, palette_json, evidence, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.meetingId.trim(),
      input.title.trim(),
      input.source.trim(),
      input.uploadedBy?.trim() || null,
      input.adoption,
      JSON.stringify(uniq(input.take)),
      JSON.stringify(uniq(input.avoid)),
      storedPath,
      null,
      JSON.stringify(uniq(input.evidence ?? [])),
      now(),
    );
  let reference = getReference(id)!;
  if (reference.adoption === "core" || reference.adoption === "partial") reference = await ensurePalette(reference);
  return { reference, warnings };
}

// ── 팔레트 ──────────────────────────────────────────────────────────────────

export const PALETTE_EXTRACTOR = "node-vibrant@4";

/** 실제 픽셀에서 나온 견본만, 많이 나온 순서로. PNG·JPEG 만 읽는다(WebP 는 디코더가 없다). */
export async function extractPalette(absPath: string): Promise<PaletteSwatch[]> {
  const { Vibrant } = await import("node-vibrant/node");
  const palette = await Vibrant.from(absPath).getPalette();
  const out: PaletteSwatch[] = [];
  for (const [name, sw] of Object.entries(palette)) {
    if (sw && sw.population > 0) out.push({ name, hex: sw.hex.toLowerCase(), population: sw.population });
  }
  return out.sort((a, b) => b.population - a.population);
}

/** core·partial 이고 파일이 있는데 팔레트가 없으면 뽑아서 저장한다. */
export async function ensurePalette(ref: MeetingReference): Promise<MeetingReference> {
  if (ref.palette || !ref.filePath || (ref.adoption !== "core" && ref.adoption !== "partial")) return ref;
  const abs = resolveStoredPath(ref.filePath);
  let record: PaletteRecord;
  try {
    const swatches = await extractPalette(abs);
    record = { status: "extracted", extractor: PALETTE_EXTRACTOR, swatches, extracted_at: now() };
  } catch (e) {
    record = { status: "failed", extractor: PALETTE_EXTRACTOR, error: (e as Error).message.slice(0, 300), extracted_at: now() };
  }
  db().prepare(`UPDATE meeting_references SET palette_json = ? WHERE id = ?`).run(JSON.stringify(record), ref.id);
  return { ...ref, palette: record };
}

// ── 프롬프트 계획 ───────────────────────────────────────────────────────────

export type ReferenceUse = {
  referenceId: string;
  adoption: Adoption;
  /** 참조 이미지로 보냈으면 그 번호(1부터), 아니면 null */
  attachedAs: number | null;
  paletteUsed: boolean;
  note: string | null;
};

export type ReferencePlan = {
  /** 첨부 순서 = 프롬프트의 "Reference image N" */
  attached: MeetingReference[];
  lines: string[];
  negatives: string[];
  /** 첨부한 것(순서대로) → 글로만 쓴 것 → 제외. generated_images.reference_ids 에 그대로 남긴다 */
  referenceIds: string[];
  uses: ReferenceUse[];
  warnings: string[];
};

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

/**
 * 반영 수준별 규칙을 적용해 프롬프트 줄과 첨부 목록을 만든다. 파일을 읽지 않는 순수 함수다.
 */
export function planReferences(
  refs: MeetingReference[],
  opts: { maxAttached: number; gloss?: GlossFn; hasColourSlot?: boolean },
): ReferencePlan {
  const g = (s: string) => {
    const x = opts.gloss?.(s);
    return x && x !== s ? `${s} [EN: ${x}]` : s;
  };
  const list = (xs: string[]) => xs.map(g).join("; ");
  const plan: ReferencePlan = { attached: [], lines: [], negatives: [], referenceIds: [], uses: [], warnings: [] };
  const textOnly: Array<{ ref: MeetingReference; reason: string | null }> = [];

  const ordered = [
    ...refs.filter((r) => r.adoption === "core"),
    ...refs.filter((r) => r.adoption === "partial"),
  ];
  for (const ref of ordered) {
    let reason: string | null = null;
    if (!ref.filePath) reason = "파일이 없어 첨부하지 못했습니다";
    else if (isRestrictedSource(ref.source)) reason = "TMDB·Unsplash 출처라 첨부하지 않았습니다";
    else if (ref.take.length === 0) reason = "가져올 요소가 비어 첨부하지 않았습니다";
    else if (plan.attached.length >= opts.maxAttached) reason = `모델의 참조 이미지 상한(${opts.maxAttached}장)을 넘어 첨부하지 못했습니다`;
    if (reason) {
      textOnly.push({ ref, reason });
      continue;
    }
    plan.attached.push(ref);
    const n = plan.attached.length;
    const title = q(ref.title);
    let line: string;
    if (ref.adoption === "core") {
      line = `Reference image ${n} ${title} (key reference): take ${list(ref.take)} from it.`;
      line += ref.avoid.length ? ` Do not take ${list(ref.avoid)} from it.` : " Do not copy anything else from it.";
      if (!ref.avoid.length) plan.warnings.push(`${ref.title}: 가져오지 않을 요소가 비어 있습니다.`);
    } else {
      line = `Reference image ${n} ${title} (partial reference): you may lightly borrow ${list(ref.take)} from it. Take nothing else from it.`;
    }

    let paletteUsed = false;
    let note: string | null = null;
    const sw = ref.palette?.status === "extracted" ? ref.palette.swatches : [];
    if (sw.length && mentionsColour(ref.take) && !mentionsColour(ref.avoid)) {
      const hexes = sw.slice(0, 5).map((s) => s.hex).join(", ");
      line +=
        ref.adoption === "core"
          ? ` Colour swatches measured from reference image ${n}, most frequent first: ${hexes}. Use them as the palette.`
          : ` Colour swatches measured from reference image ${n}, most frequent first: ${hexes}. You may echo them.`;
      if (opts.hasColourSlot) line += " If they conflict with the Colour line above, follow the Colour line.";
      paletteUsed = true;
    } else if (sw.length) {
      note = mentionsColour(ref.avoid) ? "색을 가져오지 않을 요소로 적어 팔레트를 넣지 않았습니다" : "가져올 요소에 색이 없어 팔레트를 넣지 않았습니다";
    }
    plan.lines.push(line);
    plan.referenceIds.push(ref.id);
    plan.uses.push({ referenceId: ref.id, adoption: ref.adoption, attachedAs: n, paletteUsed, note });
  }

  for (const ref of refs.filter((r) => r.adoption === "reference")) textOnly.push({ ref, reason: null });

  for (const { ref, reason } of textOnly) {
    if (ref.take.length === 0) {
      plan.uses.push({ referenceId: ref.id, adoption: ref.adoption, attachedAs: null, paletteUsed: false, note: "가져올 요소가 비어 반영하지 않았습니다" });
      plan.warnings.push(`${ref.title}: 가져올 요소가 비어 프롬프트에 넣지 않았습니다.`);
      continue;
    }
    const strength = ref.adoption === "core" ? "Important" : ref.adoption === "partial" ? "Optional" : "Loose idea";
    let line = `${strength} (image not attached) from ${q(ref.title)}: ${list(ref.take)}.`;
    if (ref.adoption === "core" && ref.avoid.length) line += ` Not: ${list(ref.avoid)}.`;
    plan.lines.push(line);
    plan.referenceIds.push(ref.id);
    plan.uses.push({ referenceId: ref.id, adoption: ref.adoption, attachedAs: null, paletteUsed: false, note: reason });
    if (reason) plan.warnings.push(`${ref.title}: ${reason}. 글로만 반영합니다.`);
  }

  for (const ref of refs.filter((r) => r.adoption === "excluded")) {
    for (const t of ref.take) plan.negatives.push(`${g(t)} (as in the rejected reference ${q(ref.title)})`);
    plan.referenceIds.push(ref.id);
    plan.uses.push({
      referenceId: ref.id,
      adoption: "excluded",
      attachedAs: null,
      paletteUsed: false,
      note: ref.take.length ? null : "가져올 요소가 비어 부정 지시가 없습니다",
    });
  }
  return plan;
}

/** 첨부할 레퍼런스 파일을 data URL 로 읽는다. 파일이 사라졌으면 NOT_FOUND 로 막는다(말없이 빼지 않는다). */
export function loadReferenceInputs(plan: ReferencePlan): ReferenceImageInput[] {
  return plan.attached.map((ref) => {
    const abs = resolveStoredPath(ref.filePath!);
    if (!existsSync(abs)) throw new ImageGenError("NOT_FOUND", `레퍼런스 ${ref.title} 파일이 없습니다: ${ref.filePath}`);
    const bytes = readFileSync(abs);
    const mediaType = sniffMediaType(bytes);
    if (!mediaType) throw new ImageGenError("INVALID_INPUT", `레퍼런스 ${ref.title} 파일이 이미지가 아닙니다.`);
    return { id: ref.id, dataUrl: toDataUrl(bytes, mediaType) };
  });
}

/** 유사도 측정용: 파일이 있는 레퍼런스 전부(반영 수준과 첨부 여부를 함께). */
export function similarityTargets(refs: MeetingReference[], plan: ReferencePlan) {
  return refs
    .filter((r) => r.filePath && existsSync(resolveStoredPath(r.filePath)))
    .map((r) => ({
      id: r.id,
      adoption: r.adoption,
      attached: plan.attached.some((a) => a.id === r.id),
      absPath: resolveStoredPath(r.filePath!),
    }));
}
