import test from "node:test";
import assert from "node:assert/strict";
import {
  recommendProvider,
  GptImage2Adapter,
  GeminiFlashImageAdapter,
  Flux2ProAdapter,
  MissingApiKeyError,
  MAX_IMAGES_PER_DECISION,
  MAX_IMAGES_PER_MEETING,
  type ImageRecipe,
} from "../lib/domain/imageGeneration";

test("자동 추천 규칙: 최초 일반 장면 ➔ GPT Image 2 추천", () => {
  const recipe: ImageRecipe = {
    id: "rec_01",
    projectId: "p_01",
    sceneNumber: 12,
    promptText: "어두운 모텔방 창가에 앉은 윤서의 쓸쓸한 전신 샷",
    requiredElements: ["틸 톤 조명"],
    prohibitedElements: ["네온 글로시 브라이트 조명"],
    referenceIds: [],
    characterVisualIds: [],
  };

  const provider = recommendProvider(recipe);
  assert.equal(provider, "gpt_image_2");
});

test("자동 추천 규칙: 다중 레퍼런스/캐릭터 2개 이상 ➔ Gemini 3.1 Flash Image 추천", () => {
  const recipe: ImageRecipe = {
    id: "rec_02",
    projectId: "p_01",
    sceneNumber: 12,
    promptText: "수영장 벽면에 서서 수영모를 쥔 수현의 인물 조감",
    requiredElements: [],
    prohibitedElements: [],
    referenceIds: ["ref_01"],
    characterVisualIds: ["char_suhyeon_v1"],
  };

  const provider = recommendProvider(recipe);
  assert.equal(provider, "gemini_flash_image");
});

test("자동 추천 규칙: 기존 이미지 부분 수정 ➔ FLUX.2 Pro 추천", () => {
  const recipe: ImageRecipe = {
    id: "rec_03",
    projectId: "p_01",
    sceneNumber: 12,
    promptText: "의상 색상을 검은색 가운으로 부분 수정",
    requiredElements: [],
    prohibitedElements: [],
    referenceIds: [],
    characterVisualIds: [],
    isRefinementOfImageId: "img_take_01",
  };

  const provider = recommendProvider(recipe);
  assert.equal(provider, "flux_2_pro");
});

test("FLUX.2 Pro 어댑터: 최초 생성 시도 시 거부 계약 검증", () => {
  const adapter = new Flux2ProAdapter();
  const invalidRecipe: ImageRecipe = {
    id: "rec_invalid",
    projectId: "p_01",
    sceneNumber: 12,
    promptText: "최초 신규 샷 생성",
    requiredElements: [],
    prohibitedElements: [],
    referenceIds: [],
    characterVisualIds: [],
  };

  assert.throws(
    () => adapter.derivePrompt(invalidRecipe),
    /FLUX.2 Pro 는 기존 TAKE 후보의 정밀 편집 용도로만 사용해야 합니다/
  );
});

test("API 키 누락 시 실효적 거부: 픽스처 위장 성공 금지 계약 검증", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalOpenRouter = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;

  const adapter = new GptImage2Adapter();
  const recipe: ImageRecipe = {
    id: "rec_04",
    projectId: "p_01",
    sceneNumber: 12,
    promptText: "테스트 샷",
    requiredElements: [],
    prohibitedElements: [],
    referenceIds: [],
    characterVisualIds: [],
  };

  await assert.rejects(
    () => adapter.generate(recipe),
    MissingApiKeyError
  );

  // Restore env
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  if (originalOpenRouter) process.env.OPENROUTER_API_KEY = originalOpenRouter;
});

test("생성 제약 상한 검증: 1건당 2장, 회의당 6장 상한", () => {
  assert.equal(MAX_IMAGES_PER_DECISION, 2);
  assert.equal(MAX_IMAGES_PER_MEETING, 6);
});
