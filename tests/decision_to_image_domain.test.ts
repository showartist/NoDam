// Phase 7D-B 도메인 계약 테스트.
// 설계 문서의 7가지 시나리오(C-01~C-07)를 그대로 고정한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  judgeVisualizationEligibility,
  evaluateGenerationGate,
  buildImageRecipe,
  generationIdempotencyParts,
  propagateDecisionChangeToImages,
  type DecisionCandidate,
} from "../lib/domain/decisionToImage";

const base = (over: Partial<DecisionCandidate> = {}): DecisionCandidate => ({
  id: "dc-1",
  projectId: "project-1",
  sceneId: "scene-34",
  statement: "마지막은 청록 형광등이 남은 빈 수영장으로 간다",
  evidenceUids: ["U-014", "U-021", "U-026"],
  decisionType: "visual",
  conflictStatus: "none",
  aiStatus: "candidate",
  humanStatus: "decided",
  decidedBy: "participant-director",
  decidedAt: "2026-08-02T05:00:00.000Z",
  visualizationEligibility: "eligible",
  visualizationType: "shot",
  ...over,
});

// ── 시각화 판정 ────────────────────────────────────────────────────────────

test("schedule_production_safety_are_never_eligible", () => {
  for (const t of ["schedule", "production", "safety"] as const) {
    const v = judgeVisualizationEligibility(base({ decisionType: t }));
    assert.equal(v.eligibility, "not_eligible", `${t} 는 이미지 대상이 아니어야 합니다.`);
  }
});

test("visual_decision_needs_human_type_selection", () => {
  const v = judgeVisualizationEligibility(base({ decisionType: "visual" }));
  assert.equal(v.eligibility, "needs_review",
    "시각 결정이라도 무엇을 그릴지는 사람이 정해야 하므로 자동 eligible 이 아닙니다.");
});

// ── C-01 확정 + eligible + 충돌 없음 → 생성 가능 ───────────────────────────

test("C01_decided_eligible_no_conflict_allows_generation", () => {
  const gate = evaluateGenerationGate(base());
  assert.equal(gate.allowed, true);
});

// ── C-02 미결정 → 생성 금지 ────────────────────────────────────────────────

test("C02_pending_decision_blocks_generation", () => {
  const gate = evaluateGenerationGate(base({ humanStatus: "pending", decidedBy: null, decidedAt: null }));
  assert.equal(gate.allowed, false);
  assert.ok(gate.allowed === false && gate.blockers.some((b) => /결정으로 인정/.test(b)),
    "왜 막혔는지 사유가 있어야 합니다.");
});

test("C02b_rejected_decision_blocks_generation", () => {
  const gate = evaluateGenerationGate(base({ humanStatus: "rejected" }));
  assert.equal(gate.allowed, false);
});

// ── C-03 충돌 미해소 → 생성 보류 ───────────────────────────────────────────

test("C03_unresolved_conflict_blocks_generation", () => {
  const gate = evaluateGenerationGate(base({ conflictStatus: "unresolved" }));
  assert.equal(gate.allowed, false);
  assert.ok(gate.allowed === false && gate.blockers.some((b) => /충돌/.test(b)));
});

test("C03b_resolved_conflict_allows_generation", () => {
  assert.equal(evaluateGenerationGate(base({ conflictStatus: "resolved" })).allowed, true);
});

// ── 근거 없는 결정 차단 ────────────────────────────────────────────────────

test("evidence_missing_blocks_generation", () => {
  const gate = evaluateGenerationGate(base({ evidenceUids: [] }));
  assert.equal(gate.allowed, false);
  assert.ok(gate.allowed === false && gate.blockers.some((b) => /근거/.test(b)));
});

test("decided_without_actor_blocks_generation", () => {
  const gate = evaluateGenerationGate(base({ decidedBy: null }));
  assert.equal(gate.allowed, false);
  assert.ok(gate.allowed === false && gate.blockers.some((b) => /결정자/.test(b)));
});

test("all_blockers_reported_at_once", () => {
  const gate = evaluateGenerationGate(base({
    humanStatus: "pending", decidedBy: null, decidedAt: null,
    evidenceUids: [], conflictStatus: "unresolved",
    visualizationEligibility: "needs_review", visualizationType: null,
  }));
  assert.equal(gate.allowed, false);
  assert.ok(gate.allowed === false && gate.blockers.length >= 5,
    "막힌 이유를 하나씩 알려주지 않고 한 번에 전부 돌려줘야 합니다.");
});

// ── Image Recipe ───────────────────────────────────────────────────────────

test("recipe_not_built_when_gate_blocks", () => {
  const r = buildImageRecipe(base({ humanStatus: "pending", decidedBy: null, decidedAt: null }));
  assert.equal(r.ok, false, "생성 불가한 결정으로 Recipe 를 만들면 안 됩니다.");
});

test("recipe_inherits_evidence_and_never_invents", () => {
  const r = buildImageRecipe(base(), {
    purpose: "장면 종료 후 남겨진 공허함 표현",
    location: "실내 수영장", time: "야간", framing: "wide shot",
    lighting: ["차가운 청록색 형광등", "젖은 타일의 약한 반사"],
    colorPalette: ["muted cyan", "dirty green", "gray"],
    requiredElements: ["비어 있는 수영장", "젖은 바닥", "형광등"],
    prohibitedElements: ["사람", "따뜻한 노을", "럭셔리 호텔 분위기"],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.recipe.evidenceUids, ["U-014", "U-021", "U-026"],
    "근거는 결정에서 승계하고 새로 만들지 않습니다.");
  assert.equal(r.recipe.type, "shot");
  assert.equal(r.recipe.sceneId, "scene-34");
  assert.deepEqual(r.recipe.prohibitedElements, ["사람", "따뜻한 노을", "럭셔리 호텔 분위기"]);
});

test("recipe_warns_when_prohibited_elements_empty", () => {
  const r = buildImageRecipe(base(), { requiredElements: ["빈 수영장"] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.warnings.some((w) => /가져오지 않을 요소/.test(w)),
    "exclude 가 비면 경고해야 합니다 (제품 원칙 7).");
});

test("recipe_dedupes_and_trims", () => {
  const r = buildImageRecipe(base(), {
    lighting: [" 형광등 ", "형광등", "", "반사"],
    requiredElements: ["빈 수영장"], prohibitedElements: ["사람"],
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.recipe.lighting, ["형광등", "반사"]);
});

test("recipe_purpose_falls_back_to_statement", () => {
  const r = buildImageRecipe(base(), { requiredElements: ["x"], prohibitedElements: ["y"] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.recipe.purpose, "마지막은 청록 형광등이 남은 빈 수영장으로 간다");
});

// ── C-05 중복 생성 방지 ────────────────────────────────────────────────────

test("C05_same_inputs_produce_same_idempotency_key", () => {
  const a = generationIdempotencyParts({
    recipeVersionId: "v-1", provider: "OpenAI", modelVersion: "gpt-image-1", prompt: "a  b",
  });
  const b = generationIdempotencyParts({
    recipeVersionId: " v-1 ", provider: "openai", modelVersion: "gpt-image-1", prompt: "a b",
  });
  assert.equal(a, b, "공백·대소문자 차이로 중복 생성이 나면 안 됩니다.");
});

test("C05b_different_recipe_version_differs", () => {
  const a = generationIdempotencyParts({ recipeVersionId: "v-1", provider: "openai", modelVersion: "m", prompt: "p" });
  const b = generationIdempotencyParts({ recipeVersionId: "v-2", provider: "openai", modelVersion: "m", prompt: "p" });
  assert.notEqual(a, b);
});

// ── C-04 결정 변경 시 전파 ─────────────────────────────────────────────────

test("C04_decision_change_marks_taken_image_review_not_removed", () => {
  const [taken] = propagateDecisionChangeToImages([{ id: "img-1", status: "selected" }]);
  assert.equal(taken.nextStatus, "selected", "채택 이미지를 자동으로 내리면 안 됩니다.");
  assert.equal(taken.reviewRequired, true);
});

test("C04b_pending_candidates_become_superseded", () => {
  const [cand] = propagateDecisionChangeToImages([{ id: "img-2", status: "generated" }]);
  assert.equal(cand.nextStatus, "superseded");
  assert.equal(cand.reviewRequired, false);
});

test("C07_dropped_images_untouched_by_propagation", () => {
  const [dropped] = propagateDecisionChangeToImages([{ id: "img-3", status: "dropped" }]);
  assert.equal(dropped.nextStatus, "dropped", "이미 버린 후보는 건드리지 않습니다.");
  assert.equal(dropped.reviewRequired, false);
});

test("propagation_reports_every_image_including_unchanged", () => {
  const result = propagateDecisionChangeToImages([
    { id: "a", status: "selected" },
    { id: "b", status: "generated" },
    { id: "c", status: "dropped" },
  ]);
  assert.equal(result.length, 3, "영향받지 않은 것도 기록에 남아야 합니다.");
  for (const r of result) assert.ok(r.reason.length > 0, "각 항목에 사유가 있어야 합니다.");
});
