// Shot Recipe 도메인 계약 테스트.
// 실행: npx tsx --test tests/shot_recipe_domain.test.ts
//
// 규칙이 "동작한다"가 아니라 "위반이 실제로 막히는가"를 확인한다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildNextVersion,
  canCreateNextVersion,
  canMarkApproved,
  canRevoke,
  computeApproval,
  generationBlockReason,
  isUsableForGeneration,
  latestEventForRole,
  normalizeBody,
  normalizeLinks,
  ShotRecipeValidationError,
  assertConsistentLinks,
  transition,
  type ShotRecipeApprovalEvent,
  type ShotRecipeVersion,
} from "../lib/domain/shotRecipe";
import { EMPTY_LINKS, EMPTY_VERSION_BODY } from "../lib/domain/shotRecipe/types";

const evt = (
  id: string,
  role: "director" | "producer",
  decision: "approved" | "revoked",
  at: string,
): ShotRecipeApprovalEvent => ({
  id, versionId: "v1", approverRole: role, decision, approvedBy: `p_${role}`,
  approvedAt: at, rationale: null, evidence: [],
});

// ── 승인 판정 ────────────────────────────────────────────────
test("승인은 두 역할의 최신 결정이 모두 approved 일 때만 성립한다", () => {
  assert.equal(canMarkApproved([]), false);
  assert.equal(canMarkApproved([evt("a", "director", "approved", "2026-01-01T00:00:00Z")]), false);
  assert.equal(canMarkApproved([evt("b", "producer", "approved", "2026-01-01T00:00:00Z")]), false);
  assert.equal(
    canMarkApproved([
      evt("a", "director", "approved", "2026-01-01T00:00:00Z"),
      evt("b", "producer", "approved", "2026-01-01T00:01:00Z"),
    ]),
    true,
  );
});

test("철회 이후 과거 승인을 근거로 approved 가 되지 않는다", () => {
  const events = [
    evt("a", "director", "approved", "2026-01-01T00:00:00Z"),
    evt("b", "producer", "approved", "2026-01-01T00:01:00Z"),
    evt("c", "director", "revoked", "2026-01-01T00:02:00Z"),
  ];
  assert.equal(canMarkApproved(events), false);
  assert.deepEqual(computeApproval(events).blockingReasons, ["감독 승인 철회됨"]);
});

test("철회 후 재승인하면 다시 approved 가 된다", () => {
  const events = [
    evt("a", "director", "approved", "2026-01-01T00:00:00Z"),
    evt("b", "producer", "approved", "2026-01-01T00:01:00Z"),
    evt("c", "director", "revoked", "2026-01-01T00:02:00Z"),
    evt("d", "director", "approved", "2026-01-01T00:03:00Z"),
  ];
  assert.equal(canMarkApproved(events), true);
});

test("같은 시각이면 id 로 결정론적으로 최신을 고른다", () => {
  const same = "2026-01-01T00:00:00Z";
  const latest = latestEventForRole(
    [evt("a", "director", "approved", same), evt("z", "director", "revoked", same)],
    "director",
  );
  assert.equal(latest?.id, "z");
});

test("approvedBy/approvedAt 은 본문이 아니라 최신 이벤트에서 계산된다", () => {
  const r = computeApproval([
    evt("a", "director", "approved", "2026-01-01T00:00:00Z"),
    evt("b", "producer", "approved", "2026-01-01T00:05:00Z"),
  ]);
  assert.equal(r.approved, true);
  assert.equal(r.approvedBy, "p_producer"); // 더 늦은 승인
  assert.equal(r.approvedAt, "2026-01-01T00:05:00Z");
});

test("철회 가능 여부는 그 역할의 최신 결정으로 판정한다", () => {
  assert.equal(canRevoke([], "director").ok, false);
  const approved = [evt("a", "director", "approved", "2026-01-01T00:00:00Z")];
  assert.equal(canRevoke(approved, "director").ok, true);
  const revoked = [...approved, evt("b", "director", "revoked", "2026-01-01T00:01:00Z")];
  assert.equal(canRevoke(revoked, "director").ok, false);
});

// ── 상태 전이 ────────────────────────────────────────────────
test("승인 이벤트 없이 approve 로 전이할 수 없다", () => {
  const r = transition("proposed", "approve", []);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /감독·제작의 최신 승인/);
});

test("draft 에서 바로 approve 할 수 없다", () => {
  const both = [
    evt("a", "director", "approved", "2026-01-01T00:00:00Z"),
    evt("b", "producer", "approved", "2026-01-01T00:01:00Z"),
  ];
  assert.equal(transition("draft", "approve", both).ok, false);
  assert.equal(transition("proposed", "approve", both).ok, true);
});

test("stale Recipe 는 생성에 쓸 수 없다", () => {
  assert.equal(isUsableForGeneration("stale"), false);
  assert.equal(isUsableForGeneration("approved"), true);
  assert.match(generationBlockReason("stale")!, /재검토/);
  assert.equal(generationBlockReason("approved"), null);
});

// ── 버전 규칙 ────────────────────────────────────────────────
const baseVersion = (over: Partial<ShotRecipeVersion> = {}): ShotRecipeVersion => ({
  ...EMPTY_VERSION_BODY,
  versionId: "v1", recipeId: "r1", version: 1, status: "approved",
  createdBy: "p_dir", createdAt: "2026-01-01T00:00:00Z", links: EMPTY_LINKS,
  subjectAction: "이름표를 뜯는다",
  ...over,
});

test("새 버전은 언제나 draft 이고 승인을 승계하지 않는다", () => {
  const next = buildNextVersion({
    previous: baseVersion(),
    changes: { subjectAction: "바뀐 행동" },
    createdBy: "p_dir",
  });
  assert.equal(next.status, "draft");
  assert.equal(next.version, 2);
  assert.deepEqual(next.inheritedApprovals, []);
});

test("본문은 복사하되 바뀐 필드만 덮어쓴다", () => {
  const prev = baseVersion({ performanceDirection: "무표정 기준" });
  const next = buildNextVersion({ previous: prev, changes: { subjectAction: "새 행동" }, createdBy: "p_dir" });
  assert.equal(next.body.subjectAction, "새 행동");
  assert.equal(next.body.performanceDirection, "무표정 기준"); // 유지
});

test("내용이 하나도 안 바뀌면 새 버전을 만들지 않는다", () => {
  const prev = baseVersion();
  const r = canCreateNextVersion({ previous: prev, createdBy: "p_dir" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /내용이 같습니다/);
});

test("첫 버전은 v1 이다", () => {
  const next = buildNextVersion({ previous: null, createdBy: "p_dir" });
  assert.equal(next.version, 1);
  assert.equal(next.status, "draft");
});

// ── 입력 검증 ────────────────────────────────────────────────
test("subjectAction 과 performanceDirection 은 별개 필드다", () => {
  const body = normalizeBody({ subjectAction: "뜯는다", performanceDirection: "무표정으로" });
  assert.equal(body.subjectAction, "뜯는다");
  assert.equal(body.performanceDirection, "무표정으로");
  assert.notEqual(body.subjectAction, body.performanceDirection);
});

test("durationSeconds 는 0 이하를 거부한다", () => {
  assert.throws(() => normalizeBody({ durationSeconds: 0 }), ShotRecipeValidationError);
  assert.throws(() => normalizeBody({ durationSeconds: -1 }), ShotRecipeValidationError);
  assert.equal(normalizeBody({ durationSeconds: 3.5 }).durationSeconds, 3.5);
});

test("서술형 목록은 문자열 배열만 받는다", () => {
  assert.throws(() => normalizeBody({ allowedElements: [1 as unknown as string] }), ShotRecipeValidationError);
  assert.deepEqual(normalizeBody({ allowedElements: ["젖은 머리"] }).allowedElements, ["젖은 머리"]);
});

test("근거 없는 기본값을 채우지 않는다", () => {
  const body = normalizeBody({});
  assert.equal(body.narrativePurpose, null);
  assert.equal(body.performanceDirection, null);
  assert.deepEqual(body.continuityInputs, []);
});

test("링크의 중복 ID 는 제거된다", () => {
  const links = normalizeLinks({
    subjectIds: ["c1", "c1", "c2"],
    references: [
      { referenceId: "r1", role: "general" },
      { referenceId: "r1", role: "general" },
      { referenceId: "r1", role: "first_frame" },
    ],
  });
  assert.deepEqual(links.subjectIds, ["c1", "c2"]);
  assert.equal(links.references.length, 2); // role 이 다르면 별개
});

test("알 수 없는 reference role 은 거부된다", () => {
  assert.throws(
    () => normalizeLinks({ references: [{ referenceId: "r1", role: "bogus" as never }] }),
    ShotRecipeValidationError,
  );
});

// ── 일관성 ───────────────────────────────────────────────────
test("scene/project 불일치는 거부된다", () => {
  assert.throws(
    () => assertConsistentLinks({ recipeProjectId: "p1", recipeSceneId: "s1", shotSceneId: "s2", sceneProjectId: "p1" }),
    /Scene 이 Shot 의 Scene 과 다릅니다/,
  );
  assert.throws(
    () => assertConsistentLinks({ recipeProjectId: "p1", recipeSceneId: "s1", shotSceneId: "s1", sceneProjectId: "p2" }),
    /Project 가 Scene 의 Project 와 다릅니다/,
  );
  assert.doesNotThrow(
    () => assertConsistentLinks({ recipeProjectId: "p1", recipeSceneId: "s1", shotSceneId: "s1", sceneProjectId: "p1" }),
  );
});

test("Scene 에 속하지 않은 Shot 은 거부된다", () => {
  assert.throws(
    () => assertConsistentLinks({ recipeProjectId: "p1", recipeSceneId: "s1", shotSceneId: null, sceneProjectId: "p1" }),
    /Scene 에 속해 있지 않습니다/,
  );
});
