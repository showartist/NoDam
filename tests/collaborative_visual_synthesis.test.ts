import test from "node:test";
import assert from "node:assert/strict";
import {
  validateImageTakePermission,
  ExplorationImageTakeForbiddenError,
  formulateIntegratedRecipe,
  createProductionCandidate,
  type ExplorationImage,
  type SelectedElement,
} from "../lib/domain/visualSynthesis";

test("안전 규칙 1: 탐색용 이미지 (Type A)는 TAKE 승인 하드 차단 검증", () => {
  const explorationImage: ExplorationImage = {
    id: "img_exp_director_01",
    tier: "exploration",
    speakerRole: "director",
    groundingUids: ["U-014"],
    derivedPrompt: "수영장에 홀로 서 있는 윤서의 고독한 전신",
    imageUri: "/assets/exploration_director.png",
    visualParameters: { emotionAndTone: "고독함, 정적" },
    canBeTaken: false,
    createdAt: new Date().toISOString(),
  };

  assert.throws(
    () => validateImageTakePermission(explorationImage),
    ExplorationImageTakeForbiddenError
  );
});

test("안전 규칙 2: 확정 후보 이미지 (Type B)는 TAKE 승인 허용 검증", () => {
  const selectedElements: SelectedElement[] = [
    {
      sourceImageId: "img_exp_director_01",
      sourceSpeakerRole: "director",
      category: "emotionAndTone",
      selectedText: "고독감과 정적",
    },
    {
      sourceImageId: "img_exp_dop_01",
      sourceSpeakerRole: "cinematographer",
      category: "shotSizeAndLens",
      selectedText: "35mm 와이드 샷",
    },
  ];

  const recipe = formulateIntegratedRecipe(12, selectedElements);
  const candidate = createProductionCandidate(recipe, 1, "/assets/candidate_1.png");

  const canTake = validateImageTakePermission(candidate);
  assert.equal(canTake, true);
  assert.equal(candidate.canBeTaken, true);
  assert.equal(candidate.tier, "production_candidate");
});
