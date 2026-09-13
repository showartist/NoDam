// ⛔ DEPRECATED — Canonical B 과거 검증본. 실행 금지.
//    현재 정본은 Canonical A v1 (37 fields) 이며 ../../verify-shot-recipe-a.ts 를 쓴다.
//    자세한 사유는 이 디렉터리의 README.md 참조.
console.error(
  [
    "DEPRECATED: 이 러너는 Canonical B 과거 검증본입니다. 실행할 수 없습니다.",
    "현재 정본: Shot Recipe Canonical v1 — 37 fields",
    "대신 실행: npx tsx scripts/phase8/verify-shot-recipe-a.ts",
    "사유: scripts/phase8/deprecated/canonical-b/README.md",
  ].join("\n"),
);
process.exit(1);

/**
 * Phase 8 — Shot Recipe migration 실증 검증 (T-01 ~ T-20).
 *
 *   DATABASE_URL=... npx tsx scripts/phase8/verify-shot-recipe-migration.ts
 *
 * 삭제 정책 (확정):
 *   결정 1 — 참조 중인 visual_references 물리 삭제 금지 (프레임 FK = RESTRICT)
 *   결정 2 — 승인 이력이 있는 Version/Shot/Scene/Project 물리 삭제 금지 (승인 FK = RESTRICT)
 *
 * 설계 원칙:
 *   - 트리거를 비활성화해야만 정리되는 구조를 두지 않는다.
 *     검증 데이터는 단일 트랜잭션 + SAVEPOINT 로 만들고 마지막에 ROLLBACK 한다.
 *   - pg_trigger_depth 로 FK 동작을 우회하지 않는다.
 *   - 메인 브랜치이면 즉시 거부한다. 연결 문자열은 출력하지 않는다.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "@neondatabase/serverless";

const MAIN_BRANCH_ID = "br-royal-waterfall-ayi4b816";
const EXPECTED_TEST_BRANCH_ID = "br-dark-shape-ay26qwmp";
const NS = "p8v";
const BASE_TABLE_COUNT = 16;

const sql = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

type Result = { id: string; label: string; ok: boolean; detail: string };

async function runSuite(c: PoolClient, round: string): Promise<Result[]> {
  const out: Result[] = [];
  let sp = 0;
  const q = (t: string, p: unknown[] = []) => c.query(t, p);

  /** 각 검사를 SAVEPOINT 로 격리한다. 제약 위반은 트랜잭션 전체를 중단시키기 때문이다. */
  const isolate = async (work: () => Promise<unknown>) => {
    const name = `p8_sp_${++sp}`;
    await q(`SAVEPOINT ${name}`);
    try {
      await work();
      await q(`RELEASE SAVEPOINT ${name}`);
      return null;
    } catch (e) {
      await q(`ROLLBACK TO SAVEPOINT ${name}`);
      await q(`RELEASE SAVEPOINT ${name}`);
      return e instanceof Error ? e.message : String(e);
    }
  };

  const reject = async (id: string, label: string, work: () => Promise<unknown>, match?: RegExp) => {
    const err = await isolate(work);
    if (!err) out.push({ id, label, ok: false, detail: "거부되지 않고 통과됨" });
    else if (match && !match.test(err)) out.push({ id, label, ok: false, detail: `다른 오류: ${err.slice(0, 70)}` });
    else out.push({ id, label, ok: true, detail: "" });
  };

  const allow = async (id: string, label: string, work: () => Promise<unknown>) => {
    const err = await isolate(work);
    out.push({ id, label, ok: !err, detail: err ? err.slice(0, 80) : "" });
  };

  // ── 픽스처 ────────────────────────────────────────────────
  await q("INSERT INTO projects (id,title) VALUES ($1,$2)", [NS, `Phase8 검증 ${round}`]);
  await q("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,'director')", [`${NS}_dir`, NS, "검증감독"]);
  await q("INSERT INTO scenes (id,project_id,scene_number,title) VALUES ($1,$2,1,$3)", [`${NS}_sc`, NS, "검증씬"]);
  for (const n of [1, 2, 3]) {
    await q("INSERT INTO shots (id,scene_id,shot_number,title) VALUES ($1,$2,$3,$4)", [`${NS}_shot${n}`, `${NS}_sc`, n, `검증샷${n}`]);
  }
  for (const r of ["used", "unused"]) {
    await q(
      `INSERT INTO visual_references (id,project_id,title,source_method,content_type,adoption_level,responsible_role)
       VALUES ($1,$2,$3,'upload','environment','core','art_director')`,
      [`${NS}_ref_${r}`, NS, `검증 레퍼런스 ${r}`],
    );
  }

  const newRecipe = (id: string, shot: string) =>
    q("INSERT INTO shot_recipes (id,shot_id,project_id) VALUES ($1,$2,$3)", [id, shot, NS]);
  const newVersion = (id: string, recipe: string, no: number, extra: Record<string, unknown> = {}) => {
    const cols = ["id", "recipe_id", "version_no", "human_decision_owner", "created_by", ...Object.keys(extra)];
    const vals = [id, recipe, no, `${NS}_dir`, `${NS}_dir`, ...Object.values(extra)];
    return q(`INSERT INTO shot_recipe_versions (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
  };
  const approve = (id: string, version: string, decision: "approved" | "revoked") =>
    q("INSERT INTO shot_recipe_approvals (id,version_id,decision,approved_by,approved_at) VALUES ($1,$2,$3,$4,now())", [id, version, decision, `${NS}_dir`]);

  await newRecipe(`${NS}_r1`, `${NS}_shot1`);
  await newVersion(`${NS}_v1`, `${NS}_r1`, 1, { key_action: "원본 행동" });

  // ── T-01 ~ T-14 (기존) ───────────────────────────────────
  await reject("T-01", "동일 shot_id 레시피 중복", () => newRecipe(`${NS}_r1dup`, `${NS}_shot1`), /shot_recipes_shot_uq|duplicate key/i);
  await reject("T-02", "동일 (recipe, version_no) 중복", () => newVersion(`${NS}_v1dup`, `${NS}_r1`, 1), /srv_version_uq|duplicate key/i);
  await reject("T-03", "status='confirmed' 거부", () => newVersion(`${NS}_vbad`, `${NS}_r1`, 90, { status: "confirmed" }), /srv_status_chk|check constraint/i);
  await allow("T-04", "status 5종 허용 (approved 는 승인 후 T-08 에서 확인)", async () => {
    for (const [i, s] of ["draft", "proposed", "needs_review", "stale"].entries()) {
      await newVersion(`${NS}_vs${i}`, `${NS}_r1`, 100 + i, { status: s });
    }
  });
  await reject("T-05", "버전 본문 UPDATE 거부", () => q("UPDATE shot_recipe_versions SET key_action=$1 WHERE id=$2", ["바꾼 행동", `${NS}_v1`]), /불변|immutable/i);
  await allow("T-06", "status 만 UPDATE 허용", () => q("UPDATE shot_recipe_versions SET status='proposed' WHERE id=$1", [`${NS}_v1`]));
  await reject("T-07", "승인 기록 없이 approved 거부", () => q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_v1`]), /승인 기록|approvals/i);

  // T-08 이후 v1 은 승인 이력을 갖는다 (T-20 에서 사용).
  await allow("T-08", "승인 후 approved 허용", async () => {
    await approve(`${NS}_a1`, `${NS}_v1`, "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_v1`]);
  });
  await allow("T-09", "새 버전은 draft, 승인 미승계", async () => {
    await newVersion(`${NS}_v2`, `${NS}_r1`, 2, { key_action: "v2 행동" });
    const r = await q("SELECT status FROM shot_recipe_versions WHERE id=$1", [`${NS}_v2`]);
    if (r.rows[0].status !== "draft") throw new Error(`v2 status=${r.rows[0].status}`);
    const a = await q("SELECT count(*)::int c FROM shot_recipe_approvals WHERE version_id=$1", [`${NS}_v2`]);
    if (a.rows[0].c !== 0) throw new Error("승인이 승계됨");
  });
  await reject("T-10", "승인 이력 UPDATE 거부", () => q("UPDATE shot_recipe_approvals SET rationale='x' WHERE id=$1", [`${NS}_a1`]), /append-only/i);
  await reject("T-11", "승인 이력 DELETE 거부", () => q("DELETE FROM shot_recipe_approvals WHERE id=$1", [`${NS}_a1`]), /append-only/i);
  await allow("T-12", "철회→재승인 이력 3행 보존", async () => {
    await approve(`${NS}_a2`, `${NS}_v1`, "revoked");
    await approve(`${NS}_a3`, `${NS}_v1`, "approved");
    const r = await q("SELECT count(*)::int c FROM shot_recipe_approvals WHERE version_id=$1", [`${NS}_v1`]);
    if (r.rows[0].c !== 3) throw new Error(`이력 ${r.rows[0].c}행`);
  });
  await reject("T-13", "production_method 오값 거부", () => newVersion(`${NS}_vm`, `${NS}_r1`, 200, { production_method: "매우좋음" }), /srv_method_chk|check constraint/i);
  await reject("T-14", "존재하지 않는 frame reference 거부", () => newVersion(`${NS}_vf`, `${NS}_r1`, 201, { first_frame_reference_id: "없는레퍼런스" }), /srv_first_frame_fk|foreign key/i);

  // ── T-15 (개정) · T-17 ~ T-20 (신규) ─────────────────────
  // 참조를 실제로 만든다: v3 가 ref_used 를 프레임 참조로 잡는다.
  await q(
    `INSERT INTO shot_recipe_versions (id,recipe_id,version_no,human_decision_owner,created_by,first_frame_reference_id)
     VALUES ($1,$2,3,$3,$3,$4)`,
    [`${NS}_v3`, `${NS}_r1`, `${NS}_dir`, `${NS}_ref_used`],
  );

  await reject(
    "T-15",
    "사용 중인 Reference 삭제 RESTRICT",
    () => q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_used`]),
    /srv_first_frame_fk|srv_last_frame_fk|foreign key|still referenced/i,
  );

  await allow("T-17", "미참조 Reference 물리 삭제 가능", async () => {
    await q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_unused`]);
    const r = await q("SELECT count(*)::int c FROM visual_references WHERE id=$1", [`${NS}_ref_unused`]);
    if (r.rows[0].c !== 0) throw new Error("삭제되지 않음");
  });

  await reject(
    "T-18",
    "참조 중인 Reference 물리 삭제 거부",
    () => q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_used`]),
    /srv_first_frame_fk|srv_last_frame_fk|foreign key|still referenced/i,
  );

  // T-19: 승인 이력이 없는 Shot 은 CASCADE 로 정리된다.
  await allow("T-19", "승인 이력 없는 Shot 삭제 가능", async () => {
    await newRecipe(`${NS}_r2`, `${NS}_shot2`);
    await newVersion(`${NS}_v_draft`, `${NS}_r2`, 1, { key_action: "draft only" });
    await q("DELETE FROM shots WHERE id=$1", [`${NS}_shot2`]);
    const r = await q("SELECT count(*)::int c FROM shot_recipes WHERE id=$1", [`${NS}_r2`]);
    if (r.rows[0].c !== 0) throw new Error("레시피가 남음");
    const v = await q("SELECT count(*)::int c FROM shot_recipe_versions WHERE id=$1", [`${NS}_v_draft`]);
    if (v.rows[0].c !== 0) throw new Error("버전이 남음");
  });

  // T-20: 승인 이력이 있는 Shot 은 삭제가 막힌다 (shot1 은 T-08/T-12 로 승인 이력 보유).
  await reject(
    "T-20",
    "승인 이력 있는 Shot 삭제 거부",
    () => q("DELETE FROM shots WHERE id=$1", [`${NS}_shot1`]),
    /sra_version_fk|foreign key|still referenced/i,
  );

  return out;
}

async function tableCount(q: (t: string, p?: unknown[]) => Promise<any>, like: string, not = false) {
  const r = await q(
    `SELECT count(*)::int c FROM information_schema.tables
     WHERE table_schema='public' AND table_name ${not ? "NOT " : ""}LIKE $1`,
    [like],
  );
  return r.rows[0].c as number;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL 이 없습니다. 폴백하지 않습니다.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  const q = (t: string, p: unknown[] = []) => pool.query(t, p);

  const guard = await q("SELECT current_setting('neon.branch_id', true) AS b");
  const branch = guard.rows[0]?.b ?? null;
  if (!branch || branch === MAIN_BRANCH_ID || branch !== EXPECTED_TEST_BRANCH_ID) {
    console.error(`허용되지 않은 브랜치입니다 (연결: ${branch ?? "확인 불가"}). 실행을 거부합니다.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`branch: ${branch} (테스트 브랜치 확인)\n`);

  const snapshot = async () => {
    const t = ["projects", "participants", "scenes", "shots", "visual_references", "visual_principles", "cascade_impacts"];
    const o: Record<string, number> = {};
    for (const x of t) o[x] = (await q(`SELECT count(*)::int c FROM ${x}`)).rows[0].c;
    return o;
  };

  // T-16 이 판정에 쓸 관찰값. 하네스가 진행하며 채운다.
  const idem = {
    downOk: false,
    baseTablesAfterDown: -1,
    shotRecipeTablesAfterDown: -1,
    upAgainOk: false,
    dataUnchanged: false,
  };

  console.log("== 1. 기존 Phase 8 스키마 DOWN ==");
  await q(sql("./003_shot_recipe_down.sql"));
  console.log("== 2. 기존 테이블 복원 확인 ==");
  const baseAfterDown = await tableCount(q, "shot_recipe%", true);
  const shotRecipeAfterDown = await tableCount(q, "shot_recipe%");
  const before = await snapshot();
  console.log(`   기존 테이블 ${baseAfterDown}개 · Shot Recipe 테이블 ${shotRecipeAfterDown}개`);
  console.log(`   기존 데이터: ${JSON.stringify(before)}\n`);

  const rounds: Result[][] = [];
  for (const [i, round] of ["1회차", "2회차"].entries()) {
    console.log(`== ${i === 0 ? "3" : "7"}. 수정된 UP + trigger 적용 (${round}) ==`);
    await q(sql("./001_shot_recipe_up.sql"));
    await q(sql("./002_shot_recipe_triggers.sql"));
    const fks = await q(`
      SELECT con.conname, CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE con.confdeltype::text END AS rule
      FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid
      WHERE con.contype='f' AND rel.relname LIKE 'shot_recipe%' ORDER BY con.conname`);
    if (i === 0) {
      console.log("   FK delete rule:");
      fks.rows.forEach((r: any) => console.log(`     ${r.conname.padEnd(34)} ${r.rule}`));
    }

    console.log(`\n== ${i === 0 ? "4" : "8"}. T-01~T-20 실행 (${round}) ==`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      rounds.push(await runSuite(client, round));
      // 트리거를 끄지 않고 정리한다 — 만든 데이터를 전부 되돌린다.
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const left = (await q(
      "SELECT (SELECT count(*) FROM shot_recipes)+(SELECT count(*) FROM shot_recipe_versions)+(SELECT count(*) FROM shot_recipe_approvals) AS c",
    )).rows[0].c;
    console.log(`   Shot Recipe 잔존 행: ${left} (ROLLBACK 으로 정리, 트리거 비활성화 없음)`);

    if (i === 0) {
      console.log("\n== 5. 전체 DOWN ==");
      try {
        await q(sql("./003_shot_recipe_down.sql"));
        idem.downOk = true;
      } catch (e) {
        console.log("   DOWN 실패:", e instanceof Error ? e.message : e);
      }
      console.log("== 6. 기존 16개 테이블·데이터 무변경 확인 ==");
      const b2 = await tableCount(q, "shot_recipe%", true);
      const s2 = await tableCount(q, "shot_recipe%");
      const after = await snapshot();
      const same = JSON.stringify(before) === JSON.stringify(after);
      idem.baseTablesAfterDown = b2;
      idem.shotRecipeTablesAfterDown = s2;
      idem.dataUnchanged = same;
      console.log(`   기존 테이블 ${b2}개 (기대 ${BASE_TABLE_COUNT}) · Shot Recipe ${s2}개 (기대 0)`);
      console.log(`   기존 데이터 동일: ${same ? "예" : "아니오 → " + JSON.stringify(after)}\n`);
    } else {
      idem.upAgainOk = true; // 2회차 UP 이 예외 없이 끝났다
    }
  }

  console.log("\n== 결과 ==");
  const [r1, r2] = rounds;

  // T-16 — 멱등성. 하네스가 수행한 DOWN→복원→UP→재실행 관찰을 명시적 테스트로 기록한다.
  const sameResults = JSON.stringify(r1.map((x) => [x.id, x.ok])) === JSON.stringify(r2.map((x) => [x.id, x.ok]));
  const t16Checks: Array<[string, boolean]> = [
    ["전체 DOWN 성공", idem.downOk],
    [`기존 ${BASE_TABLE_COUNT}개 테이블 복원`, idem.baseTablesAfterDown === BASE_TABLE_COUNT && idem.shotRecipeTablesAfterDown === 0],
    ["UP 재적용 성공", idem.upAgainOk],
    ["동일 검증 결과", sameResults],
    ["기존 데이터 무변경", idem.dataUnchanged],
  ];
  const t16Ok = t16Checks.every(([, ok]) => ok);
  const t16Detail = t16Checks.filter(([, ok]) => !ok).map(([l]) => l).join(", ");

  // T-15 뒤, T-17 앞에 오도록 번호순으로 합친다.
  const merged: Result[] = [];
  for (const a of r1) {
    if (a.id === "T-17") merged.push({ id: "T-16", label: "롤백→재적용 멱등 (DOWN·복원·UP·동일결과·데이터무변경)", ok: t16Ok, detail: t16Detail });
    const b = r2.find((x) => x.id === a.id)!;
    merged.push({ id: a.id, label: a.label, ok: a.ok && b.ok, detail: a.ok ? b.detail : a.detail });
  }

  let pass = 0, fail = 0;
  merged.forEach((r) => {
    r.ok ? pass++ : fail++;
    console.log(`  ${r.ok ? "✅" : "❌"} ${r.id}  ${r.label}${r.ok ? "" : ` — ${r.detail}`}`);
  });
  console.log(`\n  통과 ${pass} / 실패 ${fail} · 전체 ${merged.length}개 (T-01~T-20, 2회차 동일 기준)`);

  const finalBase = await tableCount(q, "shot_recipe%", true);
  const finalRows = (await q(
    "SELECT (SELECT count(*) FROM shot_recipes)+(SELECT count(*) FROM shot_recipe_versions)+(SELECT count(*) FROM shot_recipe_approvals) AS c",
  )).rows[0].c;
  console.log(`  기존 테이블 수: ${finalBase} (기대 ${BASE_TABLE_COUNT})`);
  console.log(`  9. Shot Recipe 데이터 행: ${finalRows}`);

  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("실행 실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
