// 7D-C 순수 계약 테스트 — 프롬프트 빌더 + 생성 Job 상태 기계.
// 외부 API 호출 없음.
import assert from "node:assert/strict";
import test from "node:test";
import { buildImageRecipe, type DecisionCandidate } from "../lib/domain/decisionToImage";
import {
  buildCanonicalPrompt, buildPromptForProvider, buildAllPrompts,
} from "../lib/domain/decisionToImage/promptBuilder";
import {
  canTransition, completeJob, decideQueueing, PROVIDER_AVAILABILITY, anyProviderConnected,
  type ImageGenerationJob,
} from "../lib/domain/decisionToImage/generationJob";

const candidate: DecisionCandidate = {
  id: "dc-1", projectId: "p1", sceneId: "scene-34",
  statement: "마지막은 청록 형광등이 남은 빈 수영장으로 간다",
  evidenceUids: ["U-014", "U-021", "U-026"],
  decisionType: "visual", conflictStatus: "none", aiStatus: "candidate",
  humanStatus: "decided", decidedBy: "p-dir", decidedAt: "2026-08-02T05:00:00.000Z",
  visualizationEligibility: "eligible", visualizationType: "shot",
};

const recipeOf = () => {
  const r = buildImageRecipe(candidate, {
    location: "실내 수영장", time: "야간", framing: "wide shot",
    lighting: ["차가운 청록색 형광등"], colorPalette: ["muted cyan"],
    emotionalTarget: ["공허함"],
    requiredElements: ["비어 있는 수영장", "젖은 바닥"],
    prohibitedElements: ["사람", "따뜻한 노을"],
  });
  if (!r.ok) throw new Error("recipe build failed");
  return r.recipe;
};

const provenance = {
  sourceDecisionId: "dc-1", recipeVersionId: "irv-1",
  recipeVersion: 1, evidenceUids: ["U-014", "U-021", "U-026"],
};

// ── 프롬프트 빌더 ──────────────────────────────────────────────────────────

test("canonical_prompt_carries_provenance", () => {
  const c = buildCanonicalPrompt(recipeOf(), provenance);
  assert.equal(c.provenance.sourceDecisionId, "dc-1");
  assert.equal(c.provenance.recipeVersion, 1);
  assert.deepEqual(c.provenance.evidenceUids, ["U-014", "U-021", "U-026"]);
});

test("prohibited_elements_become_negative", () => {
  const c = buildCanonicalPrompt(recipeOf(), provenance);
  assert.deepEqual(c.negative, ["사람", "따뜻한 노을"],
    "금지 요소가 negative 로 넘어가야 합니다. 조용히 버리면 안 됩니다.");
});

test("prompt_builder_never_mutates_recipe", () => {
  const recipe = recipeOf();
  const snapshot = JSON.stringify(recipe);
  buildAllPrompts(recipe, provenance);
  assert.equal(JSON.stringify(recipe), snapshot,
    "모델별 프롬프트가 Image Recipe 정본을 수정하면 안 됩니다.");
});

test("gpt_image_inlines_negative_as_sentence", () => {
  const p = buildPromptForProvider(recipeOf(), provenance, "gpt_image");
  assert.equal(p.negativePrompt, null, "GPT Image 는 별도 negative 파라미터가 없습니다.");
  assert.match(p.prompt, /Do not include: 사람, 따뜻한 노을/);
  assert.match(p.prompt, /Must include: 비어 있는 수영장/);
});

test("midjourney_uses_no_flag", () => {
  const p = buildPromptForProvider(recipeOf(), provenance, "midjourney");
  assert.match(p.prompt, /--no 사람, 따뜻한 노을$/);
});

test("flux_separates_negative_parameter", () => {
  const p = buildPromptForProvider(recipeOf(), provenance, "flux");
  assert.equal(p.negativePrompt, "사람, 따뜻한 노을");
  assert.doesNotMatch(p.prompt, /--no/);
});

test("all_providers_share_same_provenance", () => {
  const all = buildAllPrompts(recipeOf(), provenance);
  assert.equal(all.length, 3);
  for (const p of all) {
    assert.equal(p.provenance.sourceDecisionId, "dc-1");
    assert.deepEqual(p.provenance.evidenceUids, ["U-014", "U-021", "U-026"]);
  }
});

// ── Job 상태 기계 ──────────────────────────────────────────────────────────

const job = (over: Partial<ImageGenerationJob> = {}): ImageGenerationJob => ({
  id: "job-1", projectId: "p1", recipeVersionId: "irv-1", sourceDecisionId: "dc-1",
  idempotencyKey: "k1", provider: "gpt_image", model: "gpt-image-1",
  prompt: "p", negativePrompt: null, state: "queued",
  estimatedImageCount: 2, actualImageCount: 0, failureReason: null,
  costEstimate: null, actualCost: null, attempt: 0,
  createdAt: "2026-08-02T00:00:00.000Z", updatedAt: "2026-08-02T00:00:00.000Z",
  ...over,
});

test("valid_and_invalid_transitions", () => {
  assert.equal(canTransition("queued", "running").ok, true);
  assert.equal(canTransition("running", "succeeded").ok, true);
  assert.equal(canTransition("failed", "queued").ok, true);
  assert.equal(canTransition("succeeded", "running").ok, false, "완료된 Job 을 되돌릴 수 없습니다.");
  assert.equal(canTransition("queued", "queued").ok, false);
});

test("succeeded_requires_actual_images", () => {
  const r = completeJob(job({ state: "running" }), { kind: "succeeded", actualImageCount: 0 });
  assert.equal(r.ok, false, "이미지 0장으로 성공 처리하면 안 됩니다.");
  assert.match(r.ok === false ? r.reason : "", /0장/);
});

test("succeeded_records_count_and_cost", () => {
  const r = completeJob(job({ state: "running" }), { kind: "succeeded", actualImageCount: 4, actualCost: 12 });
  assert.equal(r.ok, true);
  assert.equal(r.job?.actualImageCount, 4);
  assert.equal(r.job?.actualCost, 12);
  assert.equal(r.job?.failureReason, null);
});

test("failed_requires_reason", () => {
  assert.equal(completeJob(job({ state: "running" }), { kind: "failed", reason: "  " }).ok, false);
  const r = completeJob(job({ state: "running" }), { kind: "failed", reason: "provider timeout" });
  assert.equal(r.ok, true);
  assert.equal(r.job?.failureReason, "provider timeout");
  assert.equal(r.job?.actualImageCount, 0);
});

// ── 큐잉 게이트 ────────────────────────────────────────────────────────────

const limits = { perDecisionMax: 4, meetingRemaining: 10 };
const avail = PROVIDER_AVAILABILITY.gpt_image;

test("duplicate_idempotency_reuses_existing_job", () => {
  const d = decideQueueing({
    idempotencyKey: "k1", provider: "gpt_image", estimatedImageCount: 2,
    existingJob: job(), availability: avail, limits,
  });
  assert.equal(d.action, "reuse_existing");
  assert.equal(d.action === "reuse_existing" && d.jobId, "job-1");
});

test("per_decision_limit_blocks", () => {
  const d = decideQueueing({
    idempotencyKey: "k2", provider: "gpt_image", estimatedImageCount: 5,
    existingJob: null, availability: avail, limits,
  });
  assert.equal(d.action, "blocked");
  assert.ok(d.action === "blocked" && d.reasons.some((r) => /1건당 최대/.test(r)));
});

test("meeting_remaining_limit_blocks", () => {
  const d = decideQueueing({
    idempotencyKey: "k3", provider: "gpt_image", estimatedImageCount: 3,
    existingJob: null, availability: avail, limits: { perDecisionMax: 4, meetingRemaining: 2 },
  });
  assert.equal(d.action, "blocked");
  assert.ok(d.action === "blocked" && d.reasons.some((r) => /잔여 생성 한도/.test(r)));
});

test("queue_allowed_even_when_provider_not_connected", () => {
  // 계약·UI 를 먼저 검증하기 위해 큐잉 자체는 허용한다.
  const d = decideQueueing({
    idempotencyKey: "k4", provider: "gpt_image", estimatedImageCount: 2,
    existingJob: null, availability: avail, limits,
  });
  assert.equal(d.action, "queue");
});

test("no_provider_is_connected_yet", () => {
  assert.equal(anyProviderConnected(), false,
    "provider 를 연결하지 않았는데 연결된 것으로 표시하면 안 됩니다.");
  for (const p of Object.values(PROVIDER_AVAILABILITY)) {
    assert.equal(p.connected, false);
    assert.ok(p.reason && p.reason.length > 0, "미연결 사유가 있어야 합니다.");
  }
});
