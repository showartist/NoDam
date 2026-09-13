/**
 * 안건 → 프롬프트 → OpenRouter 생성 → 파일·행 저장 → 유사도. 서버 전용.
 *
 * 순서가 중요하다.
 *   1. 키가 없으면 행을 만들지 않고 NOT_CONFIGURED.
 *   2. 프롬프트·첨부 파일을 모두 준비한 뒤에 상한을 검사하고 generating 행을 만든다.
 *   3. 생성이 실패하면 행을 failed 로 닫고 오류를 남긴다. 다른 이미지로 대신하지 않는다.
 *   4. 유사도는 덤이다. 사이드카가 없거나 실패해도 생성 결과는 그대로다.
 */
import { getIssue } from "../alignment/store";
import { db } from "../db";
import { SLUGLINE_FIELDS } from "../types";
import { ImageGenError } from "./errors";
import { resolveGlosses } from "./gloss";
import {
  DEFAULT_ASPECT_RATIO,
  generateImage,
  getModelCaps,
  imageModel,
  isImageGenConfigured,
  type ImageResolution,
  type SentParams,
} from "./openrouterImages";
import { resolveStoredPath } from "./paths";
import {
  glossTargets,
  recipeFromConsensus,
  recipeFromPosition,
  renderImagePrompt,
  type ConsensusSelection,
  type ImagePromptRecipe,
  type MeetingContext,
} from "./recipeFromPosition";
import {
  ensurePalette,
  listReferences,
  loadReferenceInputs,
  planReferences,
  similarityTargets,
  type MeetingReference,
  type ReferenceUse,
} from "./references";
import { measureSimilarity, type SimilarityRecord } from "./similarity";
import { completeImage, failImage, getImage, reserveImage, setImageSimilarity, type GeneratedImage } from "./storage";

/** 회의의 슬러그라인(Scene Brief)과 작품 정보. 없으면 null 로 둔다. */
export function loadMeetingContext(meetingId: string): MeetingContext {
  const d = db();
  const m = d
    .prepare(
      `SELECT p.title AS project_title, p.one_line AS one_line
         FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
        WHERE m.id = ?`,
    )
    .get(meetingId) as { project_title: string | null; one_line: string | null } | undefined;
  const brief = d
    .prepare(
      `SELECT field, COALESCE(user_value, ai_value) AS value FROM scene_brief_items
        WHERE meeting_id = ? AND field IN (?,?,?,?) ORDER BY idx`,
    )
    .all(meetingId, ...SLUGLINE_FIELDS) as Array<{ field: string; value: string | null }>;
  const first = (f: string) => (brief.find((b) => b.field === f)?.value ?? "").trim();
  const [num, intExt, loc, time] = SLUGLINE_FIELDS.map(first);
  // 대본 표기 그대로: SCENE 12 · INT. 모텔방 – NIGHT
  const slugline = [num, [[intExt, loc].filter(Boolean).join(" "), time].filter(Boolean).join(" – ")]
    .filter(Boolean)
    .join(" · ");
  return { slugline: slugline || null, oneLiner: m?.one_line ?? null, projectTitle: m?.project_title ?? null };
}

export type GenerationOutcome = {
  image: GeneratedImage;
  prompt: string;
  negative: string[];
  warnings: string[];
  references: ReferenceUse[];
  gloss: { llmModel: string | null; untranslated: string[]; note: string | null };
  sent: SentParams;
  latencyMs: number;
  attempts: number;
  similarity: SimilarityRecord;
};

export type RunGenerationInput = {
  recipe: ImagePromptRecipe;
  resolution?: ImageResolution;
  /** 생략하면 그 회의의 레퍼런스 전부 */
  references?: MeetingReference[];
  model?: string;
  aspectRatio?: string;
  timeoutMs?: number;
};

/** 이미 만든 정본으로 한 장 생성한다. 스모크 스크립트도 이 경로를 쓴다. */
export async function runGeneration(input: RunGenerationInput): Promise<GenerationOutcome> {
  if (!isImageGenConfigured()) {
    throw new ImageGenError("NOT_CONFIGURED", "OPENROUTER_API_KEY 가 설정되지 않아 이미지를 생성할 수 없습니다.");
  }
  const { recipe } = input;
  const resolution = input.resolution ?? "draft";
  const model = input.model ?? imageModel();
  const aspectRatio = input.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const caps = await getModelCaps(model);

  const refs: MeetingReference[] = [];
  for (const r of input.references ?? listReferences(recipe.provenance.meetingId)) refs.push(await ensurePalette(r));

  const glosses = await resolveGlosses(glossTargets(recipe, refs.flatMap((r) => [...r.take, ...r.avoid])));
  const gloss = (v: string) => glosses.map.get(v)?.text ?? null;

  const plan = planReferences(refs, { maxAttached: caps.maxReferences, gloss, hasColourSlot: Boolean(recipe.slots.colorIntent) });
  const rendered = renderImagePrompt(recipe, {
    gloss,
    referenceLines: plan.lines,
    referenceNegatives: plan.negatives,
    aspectRatio,
  });
  const inputs = loadReferenceInputs(plan);
  const warnings = [...recipe.warnings, ...plan.warnings];
  if (glosses.llmNote) warnings.push(glosses.llmNote);

  const reserved = reserveImage({
    target: {
      meetingId: recipe.provenance.meetingId,
      issueId: recipe.provenance.issueId,
      kind: recipe.kind,
      speakerKey: recipe.provenance.speakerKey,
    },
    runId: recipe.provenance.runId,
    model,
    prompt: rendered.prompt,
    negative: rendered.negative,
    referenceIds: plan.referenceIds,
    evidenceUids: recipe.provenance.evidenceUids,
    resolution,
  });

  let result;
  try {
    result = await generateImage({
      prompt: rendered.prompt,
      model,
      resolution,
      aspectRatio,
      references: inputs,
      caps,
      timeoutMs: input.timeoutMs,
    });
  } catch (e) {
    const err =
      e instanceof ImageGenError ? e : new ImageGenError("PROVIDER_ERROR", `이미지 생성 중 오류: ${(e as Error).message}`);
    failImage(reserved.id, `${err.code}: ${err.message}`);
    err.imageId = reserved.id;
    throw err;
  }

  const done = completeImage(reserved.id, {
    bytes: result.bytes,
    mediaType: result.mediaType,
    width: result.width,
    height: result.height,
    costUsd: result.costUsd,
    model: result.model,
  });

  let similarity: SimilarityRecord;
  try {
    similarity = await measureSimilarity(resolveStoredPath(done.filePath!), similarityTargets(refs, plan));
  } catch (e) {
    similarity = { status: "failed", error: (e as Error).message, checked_at: new Date().toISOString() };
  }
  setImageSimilarity(done.id, similarity);

  return {
    image: getImage(done.id)!,
    prompt: rendered.prompt,
    negative: rendered.negative,
    warnings,
    references: plan.uses,
    gloss: { llmModel: glosses.llmModel, untranslated: glosses.missing, note: glosses.llmNote },
    sent: result.sent,
    latencyMs: result.latencyMs,
    attempts: result.attempts,
    similarity,
  };
}

export type GenerateForIssueInput = {
  meetingId: string;
  issueId: string;
  runId?: string | null;
  positionIndex?: number;
  consensus?: ConsensusSelection[];
  resolution?: ImageResolution;
  /** 쓸 레퍼런스를 고른다. 생략하면 회의 레퍼런스 전부 */
  referenceIds?: string[];
};

export async function generateForIssue(input: GenerateForIssueInput): Promise<GenerationOutcome> {
  const hasPosition = typeof input.positionIndex === "number";
  const hasConsensus = Array.isArray(input.consensus);
  if (hasPosition === hasConsensus) {
    throw new ImageGenError("INVALID_INPUT", "positionIndex(관점 그림) 와 consensus(합의안 그림) 중 하나만 보내야 합니다.");
  }
  const issue = getIssue(input.meetingId, input.issueId, input.runId ?? null);
  if (!issue || issue.meeting_id !== input.meetingId) {
    throw new ImageGenError("NOT_FOUND", `안건을 찾을 수 없습니다: ${input.issueId}${input.runId ? ` (run ${input.runId})` : ""}`);
  }
  const context = loadMeetingContext(input.meetingId);
  const recipe = hasPosition
    ? recipeFromPosition(issue, input.positionIndex!, context)
    : recipeFromConsensus(issue, input.consensus!, context);

  let references = listReferences(input.meetingId);
  if (input.referenceIds) {
    const want = new Set(input.referenceIds);
    const unknown = input.referenceIds.filter((id) => !references.some((r) => r.id === id));
    if (unknown.length) throw new ImageGenError("NOT_FOUND", `이 회의에 없는 레퍼런스입니다: ${unknown.join(", ")}`);
    references = references.filter((r) => want.has(r.id));
  }
  return runGeneration({ recipe, resolution: input.resolution, references });
}
