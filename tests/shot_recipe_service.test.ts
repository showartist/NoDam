// Shot Recipe 서비스 계약 테스트 (인메모리 fake repository).
// 실행: npx tsx --test tests/shot_recipe_service.test.ts
//
// DB 없이도 "규칙이 실제로 막는가"를 확인한다.
// 같은 규칙을 DB 트리거가 최종 강제하는지는 scripts/phase8/verify-shot-recipe-a.ts 가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ShotRecipeService, ShotRecipeServiceError } from "../lib/services/shotRecipe";
import { EMPTY_LINKS, EMPTY_VERSION_BODY } from "../lib/domain/shotRecipe/types";
import type {
  ShotRecipeApprovalEvent,
  ShotRecipeLineage,
  ShotRecipeLinks,
  ShotRecipeStatus,
  ShotRecipeVersion,
  ShotRecipeVersionBody,
} from "../lib/domain/shotRecipe/types";

/** 최소 인메모리 저장소. DB 제약이 아니라 서비스 규칙만 시험한다. */
class FakeRepo {
  lineages = new Map<string, ShotRecipeLineage>();
  versions = new Map<string, ShotRecipeVersion>();
  approvals: ShotRecipeApprovalEvent[] = [];

  async createLineage(l: ShotRecipeLineage) { this.lineages.set(l.recipeId, { ...l }); }
  async getLineage(id: string) { return this.lineages.get(id) ?? null; }
  async getLineageByShot(shotId: string) {
    return [...this.lineages.values()].find((l) => l.shotId === shotId) ?? null;
  }
  async createVersion(i: { versionId: string; recipeId: string; version: number; body: ShotRecipeVersionBody; links: ShotRecipeLinks; createdBy: string }) {
    this.versions.set(i.versionId, {
      ...i.body, versionId: i.versionId, recipeId: i.recipeId, version: i.version,
      status: "draft", createdBy: i.createdBy, createdAt: new Date().toISOString(), links: i.links,
    });
    const l = this.lineages.get(i.recipeId)!;
    this.lineages.set(i.recipeId, { ...l, currentVersionId: i.versionId });
  }
  async getVersion(id: string) { return this.versions.get(id) ?? null; }
  async getCurrentVersion(recipeId: string) {
    const l = this.lineages.get(recipeId);
    return l?.currentVersionId ? this.versions.get(l.currentVersionId) ?? null : null;
  }
  async listVersionHistory(recipeId: string) {
    return [...this.versions.values()].filter((v) => v.recipeId === recipeId).sort((a, b) => a.version - b.version);
  }
  async nextVersionNumber(recipeId: string) {
    return (await this.listVersionHistory(recipeId)).reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }
  async setStatus(versionId: string, status: ShotRecipeStatus) {
    const v = this.versions.get(versionId)!;
    this.versions.set(versionId, { ...v, status });
  }
  async appendApproval(i: Omit<ShotRecipeApprovalEvent, "approvedAt" | "evidence" | "rationale"> & { approvedAt?: string; rationale?: string | null; evidence?: string[] }) {
    this.approvals.push({
      ...i,
      approvedAt: i.approvedAt ?? new Date(Date.now() + this.approvals.length * 1000).toISOString(),
      rationale: i.rationale ?? null,
      evidence: i.evidence ?? [],
    } as ShotRecipeApprovalEvent);
  }
  async listApprovals(versionId: string) {
    return this.approvals.filter((a) => a.versionId === versionId);
  }
  async markStaleByPrincipleVersion(pv: string) {
    const hit = [...this.versions.values()].filter((v) => v.links.visualPrincipleVersionIds.includes(pv) && v.status !== "stale");
    for (const v of hit) this.versions.set(v.versionId, { ...v, status: "stale" });
    return hit.map((v) => v.versionId);
  }
  async markStaleByCharacterVisual() { return []; }
  async deleteUnapprovedDraft(versionId: string) {
    const v = this.versions.get(versionId);
    if (!v) return { deleted: false, reason: "버전을 찾을 수 없습니다." };
    if (v.status !== "draft") return { deleted: false, reason: `draft 만 삭제할 수 있습니다 (현재 ${v.status}).` };
    if (this.approvals.some((a) => a.versionId === versionId)) return { deleted: false, reason: "승인 이력이 있어 삭제할 수 없습니다." };
    this.versions.delete(versionId);
    return { deleted: true };
  }
}

const PROJECT = "p1", SCENE = "s1", SHOT = "sh1";

function makeService(overrides: Partial<{ characters: Record<string, string | null> }> = {}) {
  const repo = new FakeRepo();
  let n = 0;
  const svc = new ShotRecipeService(
    repo as never,
    {
      getShot: async (id) => (id === SHOT ? { sceneId: SCENE } : { sceneId: "other_scene" }),
      getScene: async (id) => (id === SCENE ? { projectId: PROJECT } : { projectId: "other_project" }),
      getCharacterProjects: async (ids) =>
        Object.fromEntries(ids.map((i) => [i, (overrides.characters ?? { c1: PROJECT })[i] ?? null])),
    },
    () => `id_${++n}`,
  );
  return { repo, svc };
}

const create = (svc: ShotRecipeService, body: Partial<ShotRecipeVersionBody> = { subjectAction: "이름표를 뜯는다" }) =>
  svc.createRecipe({ projectId: PROJECT, sceneId: SCENE, shotId: SHOT, body, createdBy: "u_dir" });

const bothApprove = async (svc: ShotRecipeService, recipeId: string) => {
  await svc.recordApproval({ recipeId, approverRole: "director", approvedBy: "u_dir" });
  await svc.recordApproval({ recipeId, approverRole: "producer", approvedBy: "u_prod" });
};

// ── 생성·일관성 ──────────────────────────────────────────────
test("Recipe 생성 시 v1 은 draft 이고 승인은 비어 있다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  assert.equal(d.currentVersion?.version, 1);
  assert.equal(d.currentVersion?.status, "draft");
  assert.equal(d.approval.approved, false);
  assert.equal(d.usableForGeneration, false);
});

test("scene 불일치 Recipe 생성은 거부된다", async () => {
  const { svc } = makeService();
  await assert.rejects(
    () => svc.createRecipe({ projectId: PROJECT, sceneId: "s_other", shotId: SHOT, createdBy: "u_dir" }),
    (e: ShotRecipeServiceError) => e.code === "VALIDATION_ERROR",
  );
});

test("한 Shot 에 Recipe 를 두 번 만들 수 없다", async () => {
  const { svc } = makeService();
  await create(svc);
  await assert.rejects(() => create(svc), (e: ShotRecipeServiceError) => e.code === "CONFLICT");
});

test("다른 프로젝트 캐릭터는 연결할 수 없다", async () => {
  const { svc } = makeService({ characters: { c_other: "other_project" } });
  await assert.rejects(
    () => svc.createRecipe({ projectId: PROJECT, sceneId: SCENE, shotId: SHOT, links: { subjectIds: ["c_other"] }, createdBy: "u_dir" }),
    (e: ShotRecipeServiceError) => e.code === "VALIDATION_ERROR" && /다른 프로젝트의 캐릭터/.test(e.message),
  );
});

// ── 승인 규칙 ────────────────────────────────────────────────
test("감독 단독 승인으로는 approve 할 수 없다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await svc.recordApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir" });
  await assert.rejects(
    () => svc.approve(d.recipeId),
    (e: ShotRecipeServiceError) => e.code === "APPROVAL_INCOMPLETE",
  );
});

test("두 역할 승인 후에만 approved 가 된다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await bothApprove(svc, d.recipeId);
  const after = await svc.approve(d.recipeId);
  assert.equal(after.currentVersion?.status, "approved");
  assert.equal(after.approval.approved, true);
  assert.equal(after.usableForGeneration, true);
  assert.equal(after.generationBlockedReason, null);
});

test("철회하면 approved 가 풀리고 이력은 남는다", async () => {
  const { svc, repo } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await bothApprove(svc, d.recipeId);
  await svc.approve(d.recipeId);

  const after = await svc.revokeApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir", reason: "재검토" });
  assert.equal(after.currentVersion?.status, "needs_review");
  assert.equal(after.approval.approved, false);
  assert.deepEqual(after.approval.blockingReasons, ["감독 승인 철회됨"]);
  // append-only: 덮어쓰지 않고 3건이 쌓인다
  assert.equal(repo.approvals.length, 3);
});

test("철회 후 재승인하면 다시 approved 가 된다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await bothApprove(svc, d.recipeId);
  await svc.approve(d.recipeId);
  await svc.revokeApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir", reason: "재검토" });
  await svc.recordApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir" });
  const after = await svc.approve(d.recipeId);
  assert.equal(after.currentVersion?.status, "approved");
});

test("이미 철회된 승인을 또 철회할 수 없다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.recordApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir" });
  await svc.revokeApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir", reason: "1차" });
  await assert.rejects(
    () => svc.revokeApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir", reason: "2차" }),
    (e: ShotRecipeServiceError) => e.code === "INVALID_STATE_TRANSITION",
  );
});

// ── 버전 규칙 ────────────────────────────────────────────────
test("새 버전은 draft 이며 승인을 승계하지 않는다", async () => {
  const { svc, repo } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await bothApprove(svc, d.recipeId);
  await svc.approve(d.recipeId);

  const next = await svc.createNewVersion({ recipeId: d.recipeId, changes: { subjectAction: "다르게 뜯는다" }, createdBy: "u_dir" });
  assert.equal(next.currentVersion?.version, 2);
  assert.equal(next.currentVersion?.status, "draft");
  assert.equal(next.approval.approved, false);
  assert.equal((await repo.listApprovals(next.currentVersion!.versionId)).length, 0);
});

test("이전 버전 본문은 그대로 남는다 (불변)", async () => {
  const { svc } = makeService();
  const d = await create(svc, { subjectAction: "원본" });
  const v1 = d.currentVersion!.versionId;
  await svc.createNewVersion({ recipeId: d.recipeId, changes: { subjectAction: "수정본" }, createdBy: "u_dir" });
  const history = await svc.listHistory(d.recipeId);
  assert.equal(history[0].versionId, v1);
  assert.equal(history[0].subjectAction, "원본");
  assert.equal(history[1].subjectAction, "수정본");
});

test("내용이 같으면 새 버전을 만들지 않는다", async () => {
  const { svc } = makeService();
  const d = await create(svc, { subjectAction: "같은 값" });
  await assert.rejects(
    () => svc.createNewVersion({ recipeId: d.recipeId, changes: { subjectAction: "같은 값" }, createdBy: "u_dir" }),
    (e: ShotRecipeServiceError) => e.code === "VALIDATION_ERROR",
  );
});

test("performanceDirection 만 바꿔도 새 버전이 된다", async () => {
  const { svc } = makeService();
  const d = await create(svc, { subjectAction: "뜯는다" });
  const next = await svc.createNewVersion({
    recipeId: d.recipeId, changes: { performanceDirection: "무표정 기준" }, createdBy: "u_dir",
  });
  assert.equal(next.currentVersion?.version, 2);
  assert.equal(next.currentVersion?.performanceDirection, "무표정 기준");
  assert.equal(next.currentVersion?.subjectAction, "뜯는다"); // 유지
});

// ── stale · 생성 가용성 ──────────────────────────────────────
test("원칙 버전이 바뀌면 링크된 Recipe 만 stale 이 된다", async () => {
  const { svc, repo } = makeService();
  const d = await svc.createRecipe({
    projectId: PROJECT, sceneId: SCENE, shotId: SHOT,
    links: { visualPrincipleVersionIds: ["vp_v1"] }, createdBy: "u_dir",
  });
  const staled = await svc.markStaleByPrincipleVersion("vp_v1");
  assert.equal(staled.length, 1);
  assert.equal((await repo.getCurrentVersion(d.recipeId))?.status, "stale");

  const none = await svc.markStaleByPrincipleVersion("vp_other");
  assert.equal(none.length, 0);
});

test("stale Recipe 는 생성에 쓸 수 없고 사유가 나온다", async () => {
  const { svc } = makeService();
  const d = await svc.createRecipe({
    projectId: PROJECT, sceneId: SCENE, shotId: SHOT,
    links: { visualPrincipleVersionIds: ["vp_v1"] }, createdBy: "u_dir",
  });
  await svc.markStaleByPrincipleVersion("vp_v1");
  const after = await svc.getRecipe(d.recipeId);
  assert.equal(after.usableForGeneration, false);
  assert.match(after.generationBlockedReason!, /재검토/);
});

// ── 삭제 정책 ────────────────────────────────────────────────
test("승인 이력이 없는 draft 는 삭제된다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await assert.doesNotReject(() => svc.deleteDraftVersion(d.currentVersion!.versionId));
});

test("승인 이력이 있으면 삭제가 거부된다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.recordApproval({ recipeId: d.recipeId, approverRole: "director", approvedBy: "u_dir" });
  await assert.rejects(
    () => svc.deleteDraftVersion(d.currentVersion!.versionId),
    (e: ShotRecipeServiceError) => e.code === "DELETE_RESTRICTED",
  );
});

test("draft 가 아니면 삭제가 거부된다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await svc.propose(d.recipeId);
  await assert.rejects(
    () => svc.deleteDraftVersion(d.currentVersion!.versionId),
    (e: ShotRecipeServiceError) => e.code === "DELETE_RESTRICTED",
  );
});

// ── 오류 표면 ────────────────────────────────────────────────
test("없는 Recipe 조회는 NOT_FOUND 다", async () => {
  const { svc } = makeService();
  await assert.rejects(() => svc.getRecipe("nope"), (e: ShotRecipeServiceError) => e.code === "NOT_FOUND" && e.status === 404);
});

test("draft 에서 바로 approve 하면 상태 전이 오류다", async () => {
  const { svc } = makeService();
  const d = await create(svc);
  await bothApprove(svc, d.recipeId);
  await assert.rejects(
    () => svc.approve(d.recipeId),
    (e: ShotRecipeServiceError) => e.code === "INVALID_STATE_TRANSITION",
  );
});
