import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AI_ALLOWED_STATES, SHOT_STATUS_LABEL } from "../lib/types";
import type { CascadeInput } from "../lib/domain/projectVisual/contracts";
import { defaultProjectVisualAdapter } from "../lib/domain/projectVisual/adapter";

// CURRENT PRODUCT CONTRACTS — executable against today's canonical code.
describe("current product contracts", () => {
  test("ShotStatus canonical values exclude legacy draft", () => {
    assert.deepEqual(Object.keys(SHOT_STATUS_LABEL), ["proposed", "approved", "restale"]);
  });

  test("AI cannot assign confirmed", () => {
    assert.equal(AI_ALLOWED_STATES.includes("confirmed"), false);
    assert.equal(AI_ALLOWED_STATES.includes("candidate"), true);
  });
});

const contract = defaultProjectVisualAdapter;

const baseVersionUpdate: CascadeInput = {
  changeType: "version_update",
  beforeVersion: { id: "vp1-v1", principleId: "vp1", version: 1, status: "confirmed", contentHash: "old" },
  afterVersion: { id: "vp1-v2", principleId: "vp1", version: 2, status: "candidate", contentHash: "new" },
  principleSceneLinks: [{ principleVersionId: "vp1-v2", sceneId: "scene-34" }],
  principleShotLinks: [{ principleVersionId: "vp1-v2", shotId: "shot-03" }],
  targets: [
    { targetType: "scene", targetId: "scene-34", reviewStatus: "current", inExplicitScope: true, legacyLinkAvailable: true },
    { targetType: "scene", targetId: "scene-12", reviewStatus: "current", inExplicitScope: false, legacyLinkAvailable: true },
    { targetType: "shot", targetId: "shot-03", shotStatus: "approved", generatedImageState: "generated", inExplicitScope: true, legacyLinkAvailable: true },
    { targetType: "shot", targetId: "shot-04", shotStatus: "proposed", generatedImageState: "not_generated", inExplicitScope: true, legacyLinkAvailable: true },
    { targetType: "shot", targetId: "legacy-01", shotStatus: "approved", generatedImageState: "generated", inExplicitScope: true, legacyLinkAvailable: false },
  ],
};

describe("new implementation contracts", () => {
  test("first_confirmation_does_not_restale_existing_shots", () => {
    const input = { ...baseVersionUpdate, changeType: "first_confirmation" as const, beforeVersion: null };
    const impacts = contract.calculateCascadeImpact(input);
    assert.equal(impacts.find((x) => x.targetId === "shot-03")?.targetNewStatus, null);
  });

  test("version_update_restales_only_explicitly_linked_approved_shots", () => {
    const impacts = contract.calculateCascadeImpact(baseVersionUpdate);
    assert.equal(impacts.find((x) => x.targetId === "shot-03")?.targetNewStatus, "restale");
    assert.equal(impacts.find((x) => x.targetId === "legacy-01")?.targetNewStatus, null);
  });

  test("unapproved_linked_shot_keeps_status", () => {
    const impact = contract.calculateCascadeImpact(baseVersionUpdate).find((x) => x.targetId === "shot-04");
    assert.equal(impact?.impactResult, "affected");
    assert.equal(impact?.targetNewStatus, null);
  });

  test("unrelated_scene_is_unaffected", () => {
    const impact = contract.calculateCascadeImpact(baseVersionUpdate).find((x) => x.targetId === "scene-12");
    assert.deepEqual([impact?.impactResult, impact?.targetNewStatus], ["unaffected", null]);
  });

  test("linkless_legacy_shot_is_unknown", () => {
    const impact = contract.calculateCascadeImpact(baseVersionUpdate).find((x) => x.targetId === "legacy-01");
    assert.deepEqual([impact?.impactResult, impact?.targetNewStatus], ["unknown", null]);
  });

  test("cascade_does_not_change_image_state", () => {
    const before = baseVersionUpdate.targets.filter((x) => x.targetType === "shot").map((x) => x.generatedImageState);
    contract.calculateCascadeImpact(baseVersionUpdate);
    const after = baseVersionUpdate.targets.filter((x) => x.targetType === "shot").map((x) => x.generatedImageState);
    assert.deepEqual(after, before);
  });

  test("decided_question_creates_candidate_not_confirmed", () => {
    assert.equal(contract.decideQuestion({ id: "dq-1", state: "decided", decidedOptionId: "o1", decidedBy: "u1", decidedAt: "2026-08-02T00:00:00Z" }), "candidate");
  });

  test("confirmed_requires_director_and_producer_approval", () => {
    const oneApproval = [{ principleVersionId: "vp1-v2", role: "director" as const, approverId: "d1", approvedAt: "2026-08-02T00:00:00Z", status: "active" as const }];
    assert.equal(contract.canConfirmVisualPrinciple(oneApproval), false);
    assert.equal(contract.canConfirmVisualPrinciple([...oneApproval, { ...oneApproval[0], role: "producer", approverId: "p1" }]), true);
  });

  test("withdrawn_approval_moves_to_needs_review", () => {
    const approvals = [
      { principleVersionId: "vp1-v2", role: "director" as const, approverId: "d1", approvedAt: "2026-08-02T00:00:00Z", status: "active" as const },
      { principleVersionId: "vp1-v2", role: "producer" as const, approverId: "p1", approvedAt: "2026-08-02T00:00:00Z", status: "active" as const },
    ];
    assert.equal(contract.withdrawApproval("confirmed", approvals, "p1"), "needs_review");
  });

  test("legacy_draft_shot_migrates_to_proposed", () => {
    assert.equal(contract.migrateLegacyShotStatus("draft"), "proposed");
  });

  test("approved_without_approval_metadata_migrates_to_needs_review", () => {
    assert.equal(contract.migrateLegacyPrincipleStatus({ status: "approved", approvedBy: null, approvedAt: null }), "needs_review");
  });
});

describe("character visual implementation contracts", () => {
  test("character_visual_change_uses_character_id_links_only", () => {
    const impacts = contract.calculateCharacterVisualImpact({ characterId: "c-01", linkedSceneIds: ["scene-34"], candidateSceneIds: ["scene-12", "scene-34"] });
    assert.equal(impacts.find((x) => x.targetId === "scene-34")?.impactResult, "affected");
    assert.equal(impacts.find((x) => x.targetId === "scene-12")?.impactResult, "unaffected");
  });
});
