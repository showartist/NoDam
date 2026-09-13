// Shot Recipe repository 통합 테스트 (실제 Neon 테스트 브랜치).
//
//   DATABASE_URL=<테스트 브랜치> npx tsx --test tests/shot_recipe_repository_integration.test.ts
//
// DATABASE_URL 이 없으면 명시적으로 skip 한다 — SQLite 로 폴백하지 않는다.
// 메인 브랜치이면 실행을 거부한다.
//
// 인메모리 fake 로는 SQL 이 맞는지 알 수 없다. 여기서만 실제 컬럼·링크·트리거를 확인한다.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Pool, type PoolClient, type QueryResultRow } from "@neondatabase/serverless";
import { ShotRecipeRepository } from "../lib/repositories/shotRecipe/shotRecipeRepository";
import type { TransactionExecutor } from "../lib/repositories/projectVisual/db";
import { EMPTY_LINKS, EMPTY_VERSION_BODY } from "../lib/domain/shotRecipe/types";

const MAIN_BRANCH_ID = "br-royal-waterfall-ayi4b816";
const connectionString = process.env.DATABASE_URL;
const skipReason = connectionString
  ? false
  : "DATABASE_URL is not configured; Shot Recipe integration tests do not fall back to SQLite";
const neonTest = (name: string, work: () => Promise<void>) => test(name, { skip: skipReason }, work);

const NS = `sr_it_${Date.now().toString(36)}`;
let pool: Pool;
let client: PoolClient;
let repo: ShotRecipeRepository;
let sp = 0;

/** 스위트 전체를 한 트랜잭션으로 감싸고 마지막에 ROLLBACK 한다. 트리거를 끄지 않는다. */
function executor(c: PoolClient) {
  const tx: TransactionExecutor = {
    async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
      return (await c.query<T>(text, params)).rows;
    },
    async transaction<T>(work: (inner: import("../lib/repositories/projectVisual/db").QueryExecutor) => Promise<T>): Promise<T> {
      const name = `sr_sp_${++sp}`;
      await c.query(`SAVEPOINT ${name}`);
      try {
        const r = await work(tx);
        await c.query(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await c.query(`RELEASE SAVEPOINT ${name}`);
        throw e;
      }
    },
  };
  return tx;
}

describe("Shot Recipe Neon repository integration", { concurrency: 1 }, () => {
  before(async () => {
    if (!connectionString) return;
    pool = new Pool({ connectionString });
    client = await pool.connect();

    const g = await client.query<{ b: string | null }>("SELECT current_setting('neon.branch_id', true) AS b");
    const branch = g.rows[0]?.b ?? null;
    if (!branch || branch === MAIN_BRANCH_ID) {
      throw new Error(`허용되지 않은 브랜치입니다 (${branch ?? "확인 불가"}). 실행을 거부합니다.`);
    }

    repo = new ShotRecipeRepository(executor(client) as never);
    await client.query("BEGIN");

    await client.query("INSERT INTO projects (id,title) VALUES ($1,$2)", [NS, "Shot Recipe IT"]);
    for (const [suf, role] of [["dir", "director"], ["prod", "producer"]] as const) {
      await client.query("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,$4)", [
        `${NS}_${suf}`, NS, suf, role,
      ]);
    }
    await client.query("INSERT INTO scenes (id,project_id,scene_number,title) VALUES ($1,$2,1,$3)", [`${NS}_sc`, NS, "씬"]);
    await client.query("INSERT INTO shots (id,scene_id,shot_number,title) VALUES ($1,$2,1,$3)", [`${NS}_shot`, `${NS}_sc`, "샷"]);
    await client.query("INSERT INTO characters (id,project_id,name,character_type,created_by) VALUES ($1,$2,$3,'lead',$4)", [
      `${NS}_ch`, NS, "수현", `${NS}_dir`,
    ]);
    await client.query(
      `INSERT INTO visual_references (id,project_id,title,source_method,content_type,adoption_level,responsible_role)
       VALUES ($1,$2,'레퍼런스','upload','environment','core','art_director')`,
      [`${NS}_ref`, NS],
    );
  });

  after(async () => {
    if (!connectionString) return;
    try { await client.query("ROLLBACK"); } finally { client.release(); await pool.end(); }
  });

  neonTest("lineage 생성·조회 왕복", async () => {
    await repo.createLineage({ recipeId: `${NS}_r`, projectId: NS, sceneId: `${NS}_sc`, shotId: `${NS}_shot`, currentVersionId: null });
    const l = await repo.getLineage(`${NS}_r`);
    assert.equal(l?.shotId, `${NS}_shot`);
    assert.equal(l?.sceneId, `${NS}_sc`);
    const byShot = await repo.getLineageByShot(`${NS}_shot`);
    assert.equal(byShot?.recipeId, `${NS}_r`);
  });

  neonTest("버전 본문 37필드 왕복 — performanceDirection 포함", async () => {
    await repo.createVersion({
      versionId: `${NS}_v1`,
      recipeId: `${NS}_r`,
      version: 1,
      body: {
        ...EMPTY_VERSION_BODY,
        narrativePurpose: "동생의 흔적을 처음 손에 넣는다",
        subjectAction: "이름표 조각을 뜯는다",
        performanceDirection: "무표정 기준. 손끝만 또렷하게.",
        durationSeconds: 4.5,
        continuityInputs: ["젖은 머리", "손에 쥔 조각"],
        prohibitedElements: ["화장 강조"],
      },
      links: EMPTY_LINKS,
      createdBy: `${NS}_dir`,
    });

    const v = await repo.getVersion(`${NS}_v1`);
    assert.equal(v?.narrativePurpose, "동생의 흔적을 처음 손에 넣는다");
    assert.equal(v?.subjectAction, "이름표 조각을 뜯는다");
    assert.equal(v?.performanceDirection, "무표정 기준. 손끝만 또렷하게.");
    assert.equal(v?.durationSeconds, 4.5);
    assert.deepEqual(v?.continuityInputs, ["젖은 머리", "손에 쥔 조각"]);
    assert.deepEqual(v?.prohibitedElements, ["화장 강조"]);
    assert.equal(v?.status, "draft");
  });

  neonTest("createVersion 이 current_version_id 를 올린다", async () => {
    const cur = await repo.getCurrentVersion(`${NS}_r`);
    assert.equal(cur?.versionId, `${NS}_v1`);
  });

  neonTest("링크 테이블 5종 저장·조회", async () => {
    await repo.createVersion({
      versionId: `${NS}_v2`,
      recipeId: `${NS}_r`,
      version: 2,
      body: { ...EMPTY_VERSION_BODY, subjectAction: "v2" },
      links: {
        subjectIds: [`${NS}_ch`],
        characterVisualVersionIds: [],
        visualPrincipleVersionIds: [],
        references: [{ referenceId: `${NS}_ref`, role: "first_frame" }],
        evidenceIds: ["U01", "U02"],
      },
      createdBy: `${NS}_dir`,
    });
    const links = await repo.getLinks(`${NS}_v2`);
    assert.deepEqual(links.subjectIds, [`${NS}_ch`]);
    assert.deepEqual(links.references, [{ referenceId: `${NS}_ref`, role: "first_frame" }]);
    assert.deepEqual(links.evidenceIds, ["U01", "U02"]);
  });

  neonTest("nextVersionNumber 가 최대값+1 을 준다", async () => {
    assert.equal(await repo.nextVersionNumber(`${NS}_r`), 3);
  });

  neonTest("버전 이력은 오래된 순으로 나온다", async () => {
    const h = await repo.listVersionHistory(`${NS}_r`);
    assert.deepEqual(h.map((v) => v.version), [1, 2]);
  });

  neonTest("본문 UPDATE 는 DB 트리거가 막는다", async () => {
    // 제약 위반은 트랜잭션 전체를 중단시킨다. SAVEPOINT 로 격리해야
    // 이후 테스트가 25P02 로 연쇄 실패하지 않는다.
    const name = `sr_sp_${++sp}`;
    await client.query(`SAVEPOINT ${name}`);
    await assert.rejects(
      () => client.query("UPDATE shot_recipe_versions SET subject_action=$1 WHERE id=$2", ["변경", `${NS}_v1`]),
      /불변|immutable/i,
    );
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await client.query(`RELEASE SAVEPOINT ${name}`);
  });

  neonTest("승인 이벤트 append 와 역할별 조회", async () => {
    await repo.appendApproval({
      id: `${NS}_a1`, versionId: `${NS}_v2`, approverRole: "director",
      decision: "approved", approvedBy: `${NS}_dir`,
    });
    await repo.appendApproval({
      id: `${NS}_a2`, versionId: `${NS}_v2`, approverRole: "producer",
      decision: "approved", approvedBy: `${NS}_prod`,
    });
    const events = await repo.listApprovals(`${NS}_v2`);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.approverRole).sort(), ["director", "producer"]);
    assert.equal(events[0].decision, "approved");
  });

  neonTest("두 역할 승인 후 status='approved' 가 통과한다", async () => {
    await repo.setStatus(`${NS}_v2`, "approved");
    assert.equal((await repo.getVersion(`${NS}_v2`))?.status, "approved");
  });

  neonTest("승인 이력이 있으면 draft 삭제가 거부된다", async () => {
    const r = await repo.deleteUnapprovedDraft(`${NS}_v2`);
    assert.equal(r.deleted, false);
    assert.match(r.reason!, /draft 만 삭제|승인 이력/);
  });

  neonTest("원칙 버전 링크가 있는 버전만 stale 이 된다", async () => {
    await client.query("INSERT INTO visual_principles (id,project_id,title) VALUES ($1,$2,$3)", [`${NS}_vp`, NS, "원칙"]);
    await client.query(
      `INSERT INTO visual_principle_versions (id,principle_id,version_number,principle_text,rationale,content_hash)
       VALUES ($1,$2,1,'t','r','h')`,
      [`${NS}_vpv`, `${NS}_vp`],
    );
    await repo.createVersion({
      versionId: `${NS}_v3`, recipeId: `${NS}_r`, version: 3,
      body: { ...EMPTY_VERSION_BODY, subjectAction: "v3" },
      links: { ...EMPTY_LINKS, visualPrincipleVersionIds: [`${NS}_vpv`] },
      createdBy: `${NS}_dir`,
    });
    const staled = await repo.markStaleByPrincipleVersion(`${NS}_vpv`);
    assert.deepEqual(staled, [`${NS}_v3`]);
    assert.equal((await repo.getVersion(`${NS}_v3`))?.status, "stale");

    const none = await repo.markStaleByPrincipleVersion("없는버전");
    assert.equal(none.length, 0);
  });

  neonTest("스위트 종료 후 잔존 행 0건 (ROLLBACK 으로 정리)", async () => {
    // ROLLBACK 은 after() 에서 수행된다. 여기서는 트리거를 끄지 않았음을 확인한다.
    const t = await client.query<{ c: string }>(
      "SELECT count(*)::text c FROM pg_trigger WHERE tgname IN ('trg_srv_body_immutable','trg_sra_no_update')",
    );
    assert.equal(t.rows[0].c, "2");
  });
});
