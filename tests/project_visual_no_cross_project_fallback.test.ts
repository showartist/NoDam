// 교차 프로젝트 폴백 회귀 테스트
//
// 한때 WorkspaceReadModelRepository.get() 에 "요청한 프로젝트가 없으면 가장 오래된
// 프로젝트를 대신 반환하는" 폴백이 들어온 적이 있다. 그 상태에서는 존재하지 않는
// projectId 를 요청해도 200 과 함께 **다른 작품의** 레퍼런스·원칙·캐릭터가 그대로
// 돌아왔고, 사용자는 그게 잘못된 데이터임을 알 수 없었다.
//
// 커밋 810a056(cross-meeting fallback 오염 제거)이 Scene Development 쪽에서 세운
// 원칙과 같다 — 한 요청 = 하나의 데이터 출처. 없으면 없다고 말한다.
//
// 이 파일은 그 폴백이 되살아나면 실패한다.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WorkspaceReadModelRepository } from "../lib/repositories/projectVisual/readModelRepository";
import {
  ProjectVisualService,
  ProjectVisualServiceError,
  toProjectVisualError,
  type ProjectVisualServiceDependencies,
} from "../lib/services/projectVisual";

const now = "2026-08-02T00:00:00.000Z";

/** 다른 프로젝트가 DB 에 존재하는 상황을 만든다 — 폴백이 있으면 이걸 집어온다. */
const OTHER_PROJECT = {
  id: "project-other",
  title: "다른 작품",
  domain: "film",
  status: "development",
  one_line: null,
  created_at: now,
  updated_at: now,
};

/**
 * 최소 QueryExecutor 스텁.
 * `projects WHERE id=$1` 은 요청 ID 가 실제로 있을 때만 행을 준다.
 * 그 외 `FROM projects` 조회(= 폴백이 쓰던 "가장 오래된 프로젝트" 질의)에는
 * 항상 다른 프로젝트를 돌려준다. 폴백이 살아 있으면 그걸 잡아 성공해버린다.
 */
function stubDb(existingProjectIds: string[]) {
  const queries: string[] = [];
  const db = {
    queries,
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      queries.push(sql);
      if (/FROM projects WHERE id=\$1/i.test(sql)) {
        const requested = String(params[0]);
        return existingProjectIds.includes(requested)
          ? ([{ ...OTHER_PROJECT, id: requested }] as unknown as T[])
          : ([] as T[]);
      }
      // 폴백이 되살아나면 여기로 온다 ("SELECT id FROM projects ORDER BY created_at ...")
      if (/FROM projects/i.test(sql)) return ([OTHER_PROJECT] as unknown as T[]);
      return [] as T[];
    },
  };
  return db;
}

// ── 1. 다른 프로젝트가 있어도 대체 반환하지 않는다 ─────────────────────────
test("no_cross_project_fallback_when_other_projects_exist", async () => {
  const db = stubDb(["project-other"]); // 다른 프로젝트는 실제로 존재
  const repo = new WorkspaceReadModelRepository(db as never);

  const result = await repo.get("project-does-not-exist");

  assert.equal(result, null, "존재하지 않는 프로젝트에 다른 프로젝트를 대체 반환하면 안 됩니다.");
});

// ── 2. repository 는 null 을, service 는 NOT_FOUND 를 낸다 ─────────────────
test("repository_returns_null_and_service_raises_not_found", async () => {
  const db = stubDb([]);
  const repo = new WorkspaceReadModelRepository(db as never);
  assert.equal(await repo.get("missing-project"), null);

  const deps = {
    readModel: { get: async () => null },
    references: {}, questions: {}, principles: {},
    approvals: {}, characters: {}, lineage: {},
  } as unknown as ProjectVisualServiceDependencies;

  await assert.rejects(
    () => new ProjectVisualService(deps).getProjectVisualWorkspace("missing-project"),
    (error: unknown) => {
      assert.ok(error instanceof ProjectVisualServiceError);
      assert.equal((error as ProjectVisualServiceError).code, "NOT_FOUND");
      return true;
    },
  );
});

// ── 3. API 는 HTTP 404 ────────────────────────────────────────────────────
test("not_found_maps_to_http_404", () => {
  const safe = toProjectVisualError(new ProjectVisualServiceError("NOT_FOUND", "Project was not found"));
  assert.equal(safe.status, 404, "NOT_FOUND 는 404 로 나가야 합니다.");
  assert.equal(safe.code, "NOT_FOUND");
});

// ── 4. 응답에 다른 projectId 데이터가 섞이지 않는다 ────────────────────────
test("response_never_contains_other_project_data", async () => {
  const db = stubDb(["project-other"]);
  const repo = new WorkspaceReadModelRepository(db as never);

  const result = await repo.get("project-does-not-exist");
  assert.equal(result, null);

  // 폴백이 있었다면 다른 프로젝트를 찾으려고 id 목록 질의를 했을 것이다.
  const looked = db.queries.some((q) => /FROM projects/i.test(q) && !/WHERE id=\$1/i.test(q));
  assert.equal(looked, false, "다른 프로젝트를 찾는 질의를 하면 안 됩니다 (폴백 흔적).");

  // 존재하는 프로젝트를 요청했을 때는 정확히 그 프로젝트만 돌아와야 한다.
  const ok = await new WorkspaceReadModelRepository(stubDb(["project-1"]) as never).get("project-1");
  assert.ok(ok);
  assert.equal(ok!.project.id, "project-1");
  assert.notEqual(ok!.project.id, OTHER_PROJECT.id);
});

// ── 5. Scene Development 에도 교차 폴백이 없다 ─────────────────────────────
// Scene Development 는 SQLite getBundle 경로라 런타임 스텁 대신 소스 계약으로 고정한다.
// 커밋 810a056 이 세운 "bundle 없음 → notFound" 규칙이 되돌려지면 실패한다.
test("scene_development_has_no_cross_meeting_fallback", () => {
  const page = readFileSync(new URL("../app/m/[id]/page.tsx", import.meta.url), "utf8");

  assert.match(page, /if\s*\(!bundle\)\s*notFound\(\)/,
    "bundle 이 없으면 notFound() 여야 합니다.");
  assert.doesNotMatch(page, /bundle\s*\?\?\s*\w/,
    "다른 장면 데이터로 병합하는 ?? 폴백이 되살아났습니다.");
  assert.doesNotMatch(page, /ORDER BY created_at ASC LIMIT 1/i,
    "가장 오래된 회의를 대신 집어오는 폴백이 있으면 안 됩니다.");

  const repoSrc = readFileSync(
    new URL("../lib/repositories/projectVisual/readModelRepository.ts", import.meta.url), "utf8");
  assert.doesNotMatch(repoSrc, /ORDER BY created_at ASC LIMIT 1/i,
    "Project Visual 읽기 모델에 교차 프로젝트 폴백이 되살아났습니다.");
  assert.doesNotMatch(repoSrc, /fallbackProjects/,
    "fallbackProjects 폴백이 되살아났습니다.");
});
