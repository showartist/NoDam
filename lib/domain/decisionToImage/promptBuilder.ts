// Phase 7D-C(1) — Image Recipe → 모델별 프롬프트.
//
// 순수 함수. 외부 API 를 호출하지 않는다.
//
// 절대 규칙
//   1. 모델별 프롬프트는 **Image Recipe 정본을 수정하지 않는다.** Recipe 는 읽기만 한다.
//      프롬프트는 파생물이고, 모델이 바뀌면 프롬프트를 다시 만들지 Recipe 를 고치지 않는다.
//   2. 모든 프롬프트에 sourceDecisionId · evidenceUids · recipeVersion 이 따라붙는다.
//      "이 이미지가 어느 회의 결정에서 나왔는가" 를 잃지 않기 위해서다.
//   3. prohibitedElements 는 반드시 negative 지시로 전달된다. 조용히 버리지 않는다.

import type { ImageRecipeBody } from "./index";

export type ImageProvider = "gpt_image" | "midjourney" | "flux";

export type PromptProvenance = {
  sourceDecisionId: string;
  recipeVersionId: string;
  recipeVersion: number;
  evidenceUids: string[];
};

/** 모델 중립 정본 프롬프트. 각 어댑터는 이것을 자기 문법으로 옮기기만 한다. */
export type CanonicalImagePrompt = {
  subject: string;
  scene: string[];
  style: string[];
  /** 반드시 들어가야 하는 것 */
  positive: string[];
  /** 반드시 빠져야 하는 것 — prohibitedElements 에서 옴 */
  negative: string[];
  provenance: PromptProvenance;
};

export type BuiltPrompt = {
  provider: ImageProvider;
  /** 실제 모델에 보낼 문자열 */
  prompt: string;
  /** 모델이 별도 negative 파라미터를 받는 경우 (없으면 prompt 에 인라인) */
  negativePrompt: string | null;
  provenance: PromptProvenance;
};

const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

const TYPE_SUBJECT: Record<ImageRecipeBody["type"], string> = {
  environment: "location establishing image",
  character: "character portrait",
  costume: "costume reference",
  prop: "prop reference",
  mood: "mood and tone reference",
  shot: "film still",
  storyboard: "storyboard panel",
};

/**
 * Image Recipe → 모델 중립 정본 프롬프트.
 * Recipe 객체를 변형하지 않는다 (읽기 전용).
 */
export function buildCanonicalPrompt(
  recipe: Readonly<ImageRecipeBody>,
  provenance: PromptProvenance,
): CanonicalImagePrompt {
  const scene = clean([
    recipe.location ?? "",
    recipe.time ?? "",
    ...recipe.subjects,
  ]);

  const style = clean([
    recipe.framing ?? "",
    recipe.cameraPosition ?? "",
    ...recipe.lighting,
    ...recipe.colorPalette,
    ...recipe.emotionalTarget,
  ]);

  return {
    subject: TYPE_SUBJECT[recipe.type],
    scene,
    style,
    positive: clean(recipe.requiredElements),
    // 규칙 3 — 금지 요소는 반드시 negative 로 넘어간다
    negative: clean(recipe.prohibitedElements),
    provenance: {
      ...provenance,
      evidenceUids: [...provenance.evidenceUids],
    },
  };
}

/** GPT Image — 자연어 문장. negative 를 별도 파라미터로 받지 않아 문장에 녹인다. */
function toGptImage(c: CanonicalImagePrompt): BuiltPrompt {
  const parts = [
    c.subject,
    c.scene.length ? c.scene.join(", ") : "",
    c.style.length ? c.style.join(", ") : "",
    c.positive.length ? `Must include: ${c.positive.join(", ")}` : "",
    c.negative.length ? `Do not include: ${c.negative.join(", ")}` : "",
  ].filter(Boolean);
  return {
    provider: "gpt_image",
    prompt: parts.join(". ") + ".",
    negativePrompt: null,
    provenance: c.provenance,
  };
}

/** Midjourney — 쉼표 나열 + `--no` 플래그. */
function toMidjourney(c: CanonicalImagePrompt): BuiltPrompt {
  const body = clean([c.subject, ...c.scene, ...c.style, ...c.positive]).join(", ");
  const no = c.negative.length ? ` --no ${c.negative.join(", ")}` : "";
  return {
    provider: "midjourney",
    prompt: `${body}${no}`,
    negativePrompt: c.negative.length ? c.negative.join(", ") : null,
    provenance: c.provenance,
  };
}

/** Flux — 서술형 프롬프트 + 분리된 negative. */
function toFlux(c: CanonicalImagePrompt): BuiltPrompt {
  const body = clean([c.subject, ...c.scene, ...c.style, ...c.positive]).join(", ");
  return {
    provider: "flux",
    prompt: body,
    negativePrompt: c.negative.length ? c.negative.join(", ") : null,
    provenance: c.provenance,
  };
}

const ADAPTERS: Record<ImageProvider, (c: CanonicalImagePrompt) => BuiltPrompt> = {
  gpt_image: toGptImage,
  midjourney: toMidjourney,
  flux: toFlux,
};

export function buildPromptForProvider(
  recipe: Readonly<ImageRecipeBody>,
  provenance: PromptProvenance,
  provider: ImageProvider,
): BuiltPrompt {
  return ADAPTERS[provider](buildCanonicalPrompt(recipe, provenance));
}

/** 모든 지원 모델의 프롬프트를 한 번에. 비교 UI 용. */
export function buildAllPrompts(
  recipe: Readonly<ImageRecipeBody>,
  provenance: PromptProvenance,
): BuiltPrompt[] {
  const canonical = buildCanonicalPrompt(recipe, provenance);
  return (Object.keys(ADAPTERS) as ImageProvider[]).map((p) => ADAPTERS[p](canonical));
}
