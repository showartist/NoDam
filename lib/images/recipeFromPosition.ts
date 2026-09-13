/**
 * 해석 차이 안건(AlignmentIssueV2) → 이미지 프롬프트 정본.
 *
 * 두 가지 그림을 만든다.
 *   perspective — 한 사람의 입장(PositionV2)을 그대로 그린다. "X 는 이렇게 떠올리고 있다".
 *   consensus   — 사람이 관점 비교 화면에서 항목별로 고른 값({slot,value,speakerKey,evidence})을 그린다.
 *
 * 규칙 (lib/domain/decisionToImage/promptBuilder.ts 의 규칙을 그대로 잇는다)
 *   1. 말하지 않은 슬롯은 비워 둔다. 값을 지어내지 않고, 모델에게도 중립으로 두라고 적는다.
 *   2. prohibitedElements 는 반드시 부정 지시로 들어간다. 조용히 버리지 않는다.
 *   3. 모든 프롬프트에 출처 {issueId, runId, speakerKey, evidenceUids} 가 따라붙는다.
 *      출처는 프롬프트 객체와 DB 행에 남기고, 모델에게 보내는 글에는 넣지 않는다
 *      (U-ID 가 그림 속 글자로 찍히는 것을 막는다).
 *   4. 한국어 원문은 그대로 보낸다. 영어 풀이는 괄호 속 보조일 뿐이다.
 *
 * 순수 모듈이다. DB·네트워크·파일을 쓰지 않는다. 브라우저 번들에서 import 해도 된다.
 */
import { SLOT_KEYS, type AlignmentIssueV2, type SlotKey } from "../alignment/schema";
import { ImageGenError } from "./errors";
import { glossaryGloss } from "./glossary";

export type DescriptiveSlot = Exclude<SlotKey, "requiredElements" | "prohibitedElements">;
export const DESCRIPTIVE_SLOTS = SLOT_KEYS.filter(
  (k): k is DescriptiveSlot => k !== "requiredElements" && k !== "prohibitedElements",
);

/** 모델에게 보내는 영어 항목 이름. 순서는 SLOT_KEYS 순서를 따른다. */
export const SLOT_PROMPT_LABEL: Record<DescriptiveSlot, string> = {
  composition: "Composition / framing",
  subjectPresence: "People in frame",
  subjectPlacement: "Placement of people",
  environment: "Environment / set",
  lighting: "Lighting",
  colorIntent: "Colour",
  wardrobe: "Wardrobe",
  props: "Props",
  subjectAction: "Action",
  performanceDirection: "Performance / emotion",
};

export type ImageKind = "perspective" | "consensus";

/** alignment_v2_resolutions.selected_json 과 같은 모양. 사람이 고른 값이다. */
export type ConsensusSelection = {
  slot: SlotKey;
  value: string;
  speakerKey: string | null;
  evidence: string[];
};

export type MeetingContext = {
  /** 대본 표기 슬러그라인. 예: SCENE 34 · INT. 실내 수영장 – DAWN */
  slugline: string | null;
  /** 작품 한 줄 소개. 화면 표시용으로만 들고 다니고 프롬프트에는 넣지 않는다(renderImagePrompt 참고) */
  oneLiner: string | null;
  projectTitle: string | null;
};

export const EMPTY_CONTEXT: MeetingContext = { slugline: null, oneLiner: null, projectTitle: null };

export type SlotSource = { speakerKey: string | null; evidence: string[] };

export type PromptProvenance = {
  meetingId: string;
  issueId: string;
  runId: string;
  kind: ImageKind;
  /** perspective 는 그 화자. consensus 는 null 이고 항목별 출처는 slotSources 에 있다 */
  speakerKey: string | null;
  speakerKeys: string[];
  positionIndex: number | null;
  evidenceUids: string[];
  slotSources: Partial<Record<SlotKey, SlotSource[]>>;
};

export type ImagePromptRecipe = {
  kind: ImageKind;
  /** 값이 있는 서술 슬롯만 들어 있다 */
  slots: Partial<Record<DescriptiveSlot, string>>;
  /** 회의에서 말하지 않은 서술 슬롯 */
  unspecified: DescriptiveSlot[];
  mustInclude: string[];
  mustNotInclude: string[];
  context: MeetingContext;
  provenance: PromptProvenance;
  /** 근거 없음·검사 실패 같은 경고. 막지는 않지만 화면에 보여 줘야 한다 */
  warnings: string[];
};

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** 필수·금지 요소 값을 항목으로 나눈다. 쉼표·줄바꿈·세미콜론·가운뎃점 기준. */
export function splitElements(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  const parts = Array.isArray(v) ? v : v.split(/[\n,;、·]+/);
  return uniq(parts);
}

function clean(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/**
 * 슬롯 값 묶음 → 정본. perspective·consensus·Exploration Recipe 미리보기가 모두 여기로 모인다.
 */
export function recipeFromSlots(input: {
  kind: ImageKind;
  slots: Partial<Record<SlotKey, string | string[] | null | undefined>>;
  provenance: PromptProvenance;
  context?: MeetingContext;
  warnings?: string[];
}): ImagePromptRecipe {
  const slots: Partial<Record<DescriptiveSlot, string>> = {};
  const unspecified: DescriptiveSlot[] = [];
  for (const k of DESCRIPTIVE_SLOTS) {
    const raw = input.slots[k];
    const v = clean(Array.isArray(raw) ? raw.join(", ") : raw);
    if (v) slots[k] = v;
    else unspecified.push(k);
  }
  const mustInclude = splitElements(input.slots.requiredElements ?? null);
  const mustNotInclude = splitElements(input.slots.prohibitedElements ?? null);
  const warnings = [...(input.warnings ?? [])];

  if (Object.keys(slots).length === 0 && mustInclude.length === 0) {
    throw new ImageGenError(
      "INVALID_INPUT",
      "그림으로 옮길 항목이 하나도 없습니다. 말하지 않은 값을 지어내 그리지 않습니다.",
    );
  }
  if (input.provenance.evidenceUids.length === 0) {
    warnings.push("근거 없음: 이 그림을 뒷받침하는 발언 번호가 없습니다.");
  }

  return {
    kind: input.kind,
    slots,
    unspecified,
    mustInclude,
    mustNotInclude,
    context: input.context ?? EMPTY_CONTEXT,
    provenance: {
      ...input.provenance,
      speakerKeys: [...input.provenance.speakerKeys],
      evidenceUids: [...input.provenance.evidenceUids],
    },
    warnings,
  };
}

/** 한 사람의 입장 → perspective 정본. */
export function recipeFromPosition(
  issue: AlignmentIssueV2,
  positionIndex: number,
  context: MeetingContext = EMPTY_CONTEXT,
): ImagePromptRecipe {
  const position = issue.positions[positionIndex];
  if (!position) {
    throw new ImageGenError(
      "INVALID_INPUT",
      `안건 ${issue.issue_id} 에 ${positionIndex}번 입장이 없습니다 (입장 ${issue.positions.length}개).`,
    );
  }
  const speakerKey = position.speaker.key ?? null;
  const evidence = uniq(position.evidence);
  const warnings: string[] = [];
  if (position.checks.speaker !== "ok") warnings.push(`화자 검사: ${position.checks.speaker} — 이 입장의 화자 확인이 필요합니다.`);
  if (position.checks.quote === "not_found") warnings.push("인용 검사: 인용구가 근거 발언 원문에 없습니다.");
  if (position.checks.context === "contradicted") warnings.push("문맥 검사: 근거 발언이 이 해석과 어긋난다고 판정되었습니다.");
  if (issue.state === "dismissed") warnings.push("제외된 안건입니다.");

  const slotSources: Partial<Record<SlotKey, SlotSource[]>> = {};
  for (const k of SLOT_KEYS) {
    if (clean(position.slots[k])) slotSources[k] = [{ speakerKey, evidence }];
  }

  return recipeFromSlots({
    kind: "perspective",
    slots: position.slots,
    context,
    warnings,
    provenance: {
      meetingId: issue.meeting_id,
      issueId: issue.issue_id,
      runId: issue.analysis_run_id,
      kind: "perspective",
      speakerKey,
      speakerKeys: speakerKey ? [speakerKey] : [],
      positionIndex,
      evidenceUids: evidence,
      slotSources,
    },
  });
}

/** 사람이 고른 항목 값 → consensus 정본. */
export function recipeFromConsensus(
  issue: AlignmentIssueV2,
  selections: ConsensusSelection[],
  context: MeetingContext = EMPTY_CONTEXT,
): ImagePromptRecipe {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new ImageGenError("INVALID_INPUT", "합의안에 고른 항목이 없습니다.");
  }
  const knownSpeakers = new Set(issue.positions.map((p) => p.speaker.key).filter((k): k is string => Boolean(k)));
  const knownEvidence = new Set(issue.evidence_all);
  const warnings: string[] = [];
  const slots: Partial<Record<SlotKey, string[]>> = {};
  const slotSources: Partial<Record<SlotKey, SlotSource[]>> = {};
  const evidenceAll: string[] = [];
  const speakers: string[] = [];

  for (const s of selections) {
    if (!(SLOT_KEYS as readonly string[]).includes(s.slot)) {
      throw new ImageGenError("INVALID_INPUT", `알 수 없는 항목입니다: ${String(s.slot)}`);
    }
    const value = clean(s.value);
    if (!value) throw new ImageGenError("INVALID_INPUT", `${s.slot} 값이 비어 있습니다.`);
    const isList = s.slot === "requiredElements" || s.slot === "prohibitedElements";
    if (!isList && slots[s.slot]?.length) {
      throw new ImageGenError("INVALID_INPUT", `${s.slot} 에 값이 둘 이상 골라졌습니다. 한 항목에는 한 값만 고릅니다.`);
    }
    const evidence = uniq(Array.isArray(s.evidence) ? s.evidence : []);
    const speakerKey = s.speakerKey ?? null;
    if (evidence.length === 0) warnings.push(`근거 없음: ${s.slot} 값에 발언 번호가 없습니다.`);
    const unknown = evidence.filter((u) => !knownEvidence.has(u));
    if (unknown.length) warnings.push(`${s.slot}: 안건 근거에 없는 발언 번호 ${unknown.join(", ")}`);
    if (speakerKey && !knownSpeakers.has(speakerKey)) warnings.push(`${s.slot}: 안건 입장에 없는 화자 ${speakerKey}`);

    (slots[s.slot] ??= []).push(value);
    (slotSources[s.slot] ??= []).push({ speakerKey, evidence });
    evidenceAll.push(...evidence);
    if (speakerKey) speakers.push(speakerKey);
  }
  if (issue.state === "dismissed") warnings.push("제외된 안건입니다.");

  return recipeFromSlots({
    kind: "consensus",
    slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v!.join(", ")])),
    context,
    warnings,
    provenance: {
      meetingId: issue.meeting_id,
      issueId: issue.issue_id,
      runId: issue.analysis_run_id,
      kind: "consensus",
      speakerKey: null,
      speakerKeys: uniq(speakers),
      positionIndex: null,
      evidenceUids: uniq(evidenceAll),
      slotSources,
    },
  });
}

// ── 글로 옮기기 ─────────────────────────────────────────────────────────────

export type GlossFn = (value: string) => string | null;

export type RenderOptions = {
  /** 한국어 값 → 영어 풀이. 기본은 결정적 사전(glossaryGloss) */
  gloss?: GlossFn;
  /** lib/images/references.ts 의 planReferences 가 만든 줄 */
  referenceLines?: string[];
  /** 제외(excluded) 레퍼런스의 가져올 요소 → 부정 지시 */
  referenceNegatives?: string[];
  aspectRatio?: string | null;
};

export type RenderedPrompt = {
  prompt: string;
  /** 부정 지시 전체(금지 요소 + 제외 레퍼런스). DB negative 컬럼에 JSON 으로 남긴다 */
  negative: string[];
};

export function withGloss(value: string, gloss: GlossFn): string {
  const g = gloss(value);
  return g && g.trim() && g.trim() !== value ? `${value} [EN: ${g.trim()}]` : value;
}

export function renderImagePrompt(recipe: ImagePromptRecipe, opts: RenderOptions = {}): RenderedPrompt {
  const gloss = opts.gloss ?? glossaryGloss;
  const lines: string[] = [];

  lines.push(
    "Pre-visualisation frame for a film production meeting: one realistic, cinematic film still. It is a draft concept, not a final design.",
  );
  // 작품 한 줄 소개(oneLiner)는 보내지 않는다. 해석이 섞여 있는 경우가 많아(예: "차가운 청록빛 아래…")
  // 말하지 않은 슬롯을 채워 버린다. 슬러그라인만 장면 표지로 보내고, 충돌하면 회의 값을 따르게 한다.
  if (recipe.context.slugline) {
    lines.push(`Scene heading: ${recipe.context.slugline} (if it conflicts with a line below, follow the line below).`);
  }

  const specified = DESCRIPTIVE_SLOTS.filter((k) => recipe.slots[k]);
  if (specified.length) {
    lines.push("");
    lines.push("Specified in the meeting. Follow exactly. Korean is the original wording; [EN: …] is a word gloss.");
    for (const k of specified) lines.push(`- ${SLOT_PROMPT_LABEL[k]}: ${withGloss(recipe.slots[k]!, gloss)}`);
  }

  if (recipe.mustInclude.length) {
    lines.push("");
    lines.push("Must include:");
    for (const x of recipe.mustInclude) lines.push(`- ${withGloss(x, gloss)}`);
  }

  const negative = [
    ...recipe.mustNotInclude.map((x) => withGloss(x, gloss)),
    ...(opts.referenceNegatives ?? []),
  ];
  if (negative.length) {
    lines.push("");
    lines.push("Must NOT include (explicit negative instructions; do not ignore any of them):");
    for (const x of negative) lines.push(`- ${x}`);
  }

  if (opts.referenceLines?.length) {
    lines.push("");
    lines.push("References:");
    for (const x of opts.referenceLines) lines.push(`- ${x}`);
  }

  lines.push("");
  if (recipe.unspecified.length) {
    const names = recipe.unspecified.map((k) => SLOT_PROMPT_LABEL[k].toLowerCase()).join(", ");
    // 레퍼런스가 색·질감 등을 대신 정했으면 그 줄이 이긴다. "중립으로 두라"와 "팔레트를 쓰라"가 부딪치지 않게 한다.
    const unless = opts.referenceLines?.length ? "Unless a reference line above covers them, keep" : "Keep";
    lines.push(
      `Not specified in the meeting: ${names}. ${unless} these plain and neutral and do not invent them. ` +
        "Do not add people, text, logos or story props that this prompt does not describe.",
    );
  } else {
    lines.push("Do not add people, text, logos or story props that this prompt does not describe.");
  }
  const ratio = opts.aspectRatio ? `, ${opts.aspectRatio}` : "";
  lines.push(`Output: a single frame${ratio}. No captions, subtitles, watermarks, borders, split panels or UI overlays.`);

  return { prompt: lines.join("\n"), negative };
}

/** 프롬프트에 들어갈 한국어 값 전체(풀이 대상). */
export function glossTargets(recipe: ImagePromptRecipe, extra: string[] = []): string[] {
  return uniq([
    ...DESCRIPTIVE_SLOTS.map((k) => recipe.slots[k] ?? ""),
    ...recipe.mustInclude,
    ...recipe.mustNotInclude,
    ...extra,
  ]).filter((v) => /[가-힣]/.test(v));
}
