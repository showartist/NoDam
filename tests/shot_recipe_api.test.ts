// Shot Recipe API 계층 계약 테스트 — 도메인 오류 → HTTP 상태 매핑 검증.
// 실행: npx tsx --test tests/shot_recipe_api.test.ts
//
// 메인 DB 를 건드리지 않는다. 인메모리 저장소로 서비스를 만들고 핸들러를 직접 호출해
// **상태 코드와 오류 코드가 정확히 나오는지**를 본다.
// 핸들러가 NextRequest/NextResponse 에 의존하지 않게 분리해 둔 덕분에 HTTP 서버 없이 검증된다.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRecipe, getRecipe, listVersions, createVersion,
  transitionRecipe, recordApproval, revokeApproval, deleteDraftVersion,
  type ApiResult,
} from "../lib/api/shotRecipe/handlers";
import { ShotRecipeService } from "../lib/services/shotRecipe";
import type {
  ShotRecipeApprovalEvent, ShotRecipeLineage, ShotRecipeLinks,
  ShotRecipeStatus, ShotRecipeVersion, ShotRecipeVersionBody,
} from "../lib/domain/shotRecipe/types";

/** 인메모리 저장소. DB 제약이 아니라 서비스·API 규칙만 시험한다. */
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
    } as ShotRecipeVersion);
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
  async appendApproval(i: any) {
    this.approvals.push({
      ...i,
      approvedAt: i.approvedAt ?? new Date(Date.now() + this.approvals.length * 1000).toISOString(),
      rationale: i.rationale ?? null,
      evidence: i.evidence ?? [],
    } as ShotRecipeApprovalEvent);
  }
  async listApprovals(versionId: string) { return this.approvals.filter((a) => a.versionId === versionId); }
  async markStaleByPrincipleVersion() { return []; }
  async markStaleByCharacterVisual() { return []; }
  async deleteUnapprovedDraft(versionId: string) {
    const v = this.versions.get(versionId);
    if (!v) return { deleted: false, reason: "버전을 찾을 수 없습니다." };
    if (v.status !== "draft") return { deleted: false, reason: `draft 만 삭제할 수 있습니다 (현재 ${v.status}).` };
    if (this.approvals.some((a) => a.versionId === versionId)) {
      return { deleted: false, reason: "승인 이력이 있어 삭제할 수 없습니다." };
    }
    this.versions.delete(versionId);
    return { deleted: true };
  }
}

const PROJECT = "p1", SCENE = "s1", SHOT = "sh1";

function makeService() {
  const repo = new FakeRepo();
  let n = 0;
  const svc = new ShotRecipeService(
    repo as never,
    {
      getShot: async (id) => (id === SHOT ? { sceneId: SCENE } : { sceneId: "other_scene" }),
      getScene: async (id) => (id === SCENE ? { projectId: PROJECT } : { projectId: "other_project" }),
      getCharacterProjects: async (ids) => Object.fromEntries(ids.map((i) => [i, PROJECT])),
    },
    () => `id_${++n}`,
  );
  return { repo, svc };
}

const newRecipe = (svc: ShotRecipeService) =>
  createRecipe(svc, {
    projectId: PROJECT, sceneId: SCENE, shotId: SHOT,
    body: { subjectAction: "이름표를 뜯는다" }, createdBy: "u_dir",
  });

const recipeIdOf = (r: ApiResult) => (r.body as any).data.recipeId as string;
const errCode = (r: ApiResult) => (r.body as any).error.code as string;

// ── 정상 경로 ──────────────────────────────────────────────────────────────

test("POST /shot-recipe → 201, v1 은 draft", async () => {
  const { svc } = makeService();
  const r = await newRecipe(svc);
  assert.equal(r.status, 201);
  assert.equal((r.body as any).ok, true);
  assert.equal((r.body as any).data.currentVersion.status, "draft");
});

test("GET /shot-recipe/{id} → 200", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await getRecipe(svc, id);
  assert.equal(r.status, 200);
  assert.equal((r.body as any).data.recipeId, id);
});

test("GET versions → 200, 이력 배열", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await listVersions(svc, id);
  assert.equal(r.status, 200);
  assert.equal((r.body as any).data.versions.length, 1);
});

test("POST versions → 201, 새 버전은 draft 이며 승인 미승계", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  await recordApproval(svc, id, { approverRole: "producer", approvedBy: "u_prod" });
  await transitionRecipe(svc, id, { action: "propose" });
  await transitionRecipe(svc, id, { action: "approve" });

  const r = await createVersion(svc, id, { changes: { subjectAction: "다르게 뜯는다" }, createdBy: "u_dir" });
  assert.equal(r.status, 201);
  assert.equal((r.body as any).data.currentVersion.version, 2);
  assert.equal((r.body as any).data.currentVersion.status, "draft", "새 버전은 이전 승인을 승계하지 않는다.");
});

test("POST approvals → 201, 상태는 아직 안 바뀜", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  assert.equal(r.status, 201);
  const detail = await getRecipe(svc, id);
  assert.equal((detail.body as any).data.currentVersion.status, "draft");
});

test("승인 2인 후 approve → 200 approved, 철회 → 200 needs_review", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  await recordApproval(svc, id, { approverRole: "producer", approvedBy: "u_prod" });
  await transitionRecipe(svc, id, { action: "propose" });

  const approved = await transitionRecipe(svc, id, { action: "approve" });
  assert.equal(approved.status, 200);
  assert.equal((approved.body as any).data.currentVersion.status, "approved");

  const revoked = await revokeApproval(svc, id, {
    approverRole: "director", approvedBy: "u_dir", reason: "조명 방향 재검토",
  });
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body as any).data.currentVersion.status, "needs_review");
});

// ── 오류 매핑: 422 상태 기계 위약 ──────────────────────────────────────────

test("draft → approve 는 422 INVALID_STATE_TRANSITION", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  // 승인 2인을 채워도 draft 에서 바로 approve 는 전이 자체가 막힌다.
  await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  await recordApproval(svc, id, { approverRole: "producer", approvedBy: "u_prod" });

  const r = await transitionRecipe(svc, id, { action: "approve" });
  assert.equal(r.status, 422, "형식은 맞지만 지금 상태에서 처리 불가 → 422");
  assert.equal(errCode(r), "INVALID_STATE_TRANSITION");
});

// ── 오류 매핑: 409 승인 부족 ───────────────────────────────────────────────

test("승인 부족 상태로 approve 는 409 APPROVAL_INCOMPLETE", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  await transitionRecipe(svc, id, { action: "propose" });

  const r = await transitionRecipe(svc, id, { action: "approve" });
  assert.equal(r.status, 409);
  assert.equal(errCode(r), "APPROVAL_INCOMPLETE");
});

test("director 만 승인해도 409 (두 역할 모두 필요)", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  await transitionRecipe(svc, id, { action: "propose" });

  const r = await transitionRecipe(svc, id, { action: "approve" });
  assert.equal(r.status, 409);
  assert.equal(errCode(r), "APPROVAL_INCOMPLETE");
});

// ── 오류 매핑: 404 없는 자원 ───────────────────────────────────────────────

test("없는 recipeId 조회는 404", async () => {
  const { svc } = makeService();
  const r = await getRecipe(svc, "does-not-exist");
  assert.equal(r.status, 404);
  assert.equal(errCode(r), "NOT_FOUND");
});

test("없는 versionId 삭제는 404", async () => {
  const { svc } = makeService();
  const r = await deleteDraftVersion(svc, "no-such-version");
  assert.equal(r.status, 404);
  assert.equal(errCode(r), "NOT_FOUND");
});

// ── 오류 매핑: 400 요청 자체가 잘못됨 ──────────────────────────────────────

test("본문이 JSON 객체가 아니면 400", async () => {
  const { svc } = makeService();
  for (const bad of [null, "문자열", [1, 2]]) {
    const r = await createRecipe(svc, bad);
    assert.equal(r.status, 400, `${JSON.stringify(bad)} 는 400 이어야 합니다.`);
    assert.equal(errCode(r), "VALIDATION_ERROR");
  }
});

test("필수 필드 누락은 400", async () => {
  const { svc } = makeService();
  const r = await createRecipe(svc, { projectId: PROJECT, sceneId: SCENE });
  assert.equal(r.status, 400);
  assert.equal(errCode(r), "VALIDATION_ERROR");
});

test("알 수 없는 action 은 400", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await transitionRecipe(svc, id, { action: "confirm" });
  assert.equal(r.status, 400);
  assert.equal(errCode(r), "VALIDATION_ERROR");
});

test("잘못된 approverRole 은 400", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await recordApproval(svc, id, { approverRole: "editor", approvedBy: "u1" });
  assert.equal(r.status, 400);
  assert.equal(errCode(r), "VALIDATION_ERROR");
});

test("scene/shot 불일치는 400 VALIDATION_ERROR", async () => {
  const { svc } = makeService();
  const r = await createRecipe(svc, {
    projectId: PROJECT, sceneId: SCENE, shotId: "other_shot", createdBy: "u_dir",
  });
  assert.equal(r.status, 400);
  assert.equal(errCode(r), "VALIDATION_ERROR");
});

// ── 오류 매핑: 409 충돌·삭제 제한 ──────────────────────────────────────────

test("같은 Shot 에 Recipe 중복 생성은 409 CONFLICT", async () => {
  const { svc } = makeService();
  await newRecipe(svc);
  const r = await newRecipe(svc);
  assert.equal(r.status, 409);
  assert.equal(errCode(r), "CONFLICT");
});

test("승인 이력 있는 버전 삭제는 409 DELETE_RESTRICTED", async () => {
  const { svc, repo } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  await recordApproval(svc, id, { approverRole: "director", approvedBy: "u_dir" });
  const versionId = repo.lineages.get(id)!.currentVersionId!;

  const r = await deleteDraftVersion(svc, versionId);
  assert.equal(r.status, 409);
  assert.equal(errCode(r), "DELETE_RESTRICTED");
});

test("철회할 승인이 없으면 422 INVALID_STATE_TRANSITION", async () => {
  const { svc } = makeService();
  const id = recipeIdOf(await newRecipe(svc));
  const r = await revokeApproval(svc, id, {
    approverRole: "producer", approvedBy: "u_prod", reason: "사유",
  });
  assert.equal(r.status, 422);
  assert.equal(errCode(r), "INVALID_STATE_TRANSITION");
});

// ── 오류 응답 형태 ─────────────────────────────────────────────────────────

test("오류 응답은 ok:false 와 code·message 를 갖는다", async () => {
  const { svc } = makeService();
  const r = await getRecipe(svc, "nope");
  const b = r.body as any;
  assert.equal(b.ok, false);
  assert.ok(typeof b.error.code === "string" && b.error.code.length > 0);
  assert.ok(typeof b.error.message === "string" && b.error.message.length > 0);
  assert.equal(b.data, undefined, "오류 응답에 data 가 들어가면 안 됩니다.");
});

test("성공 응답은 ok:true 와 data 를 갖는다", async () => {
  const { svc } = makeService();
  const r = await newRecipe(svc);
  const b = r.body as any;
  assert.equal(b.ok, true);
  assert.ok(b.data);
  assert.equal(b.error, undefined);
});

test("실패를 200 으로 감추지 않는다", async () => {
  const { svc } = makeService();
  const failures = [
    await getRecipe(svc, "nope"),
    await createRecipe(svc, null),
    await transitionRecipe(svc, "nope", { action: "approve" }),
  ];
  for (const f of failures) {
    assert.notEqual(f.status, 200);
    assert.equal((f.body as any).ok, false);
  }
});
