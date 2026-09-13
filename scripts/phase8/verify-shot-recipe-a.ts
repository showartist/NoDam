/**
 * Phase 8 — Shot Recipe Canonical v1 (37 fields) + Phase 8A characters 실증 검증 T-01 ~ T-38.
 *
 *   DATABASE_URL=... npx tsx scripts/phase8/verify-shot-recipe-a.ts
 *
 * 원칙:
 *   - 메인 브랜치이면 실행 거부. 연결 문자열 미출력.
 *   - 트리거를 비활성화하지 않는다. 단일 트랜잭션 + SAVEPOINT 로 만들고 ROLLBACK.
 *   - pg_trigger_depth 로 FK 를 우회하지 않는다.
 *   - "통과"가 아니라 "제약이 실제로 막는지"를 위반 시도로 증명한다.
 */
import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "@neondatabase/serverless";

const MAIN_BRANCH_ID = "br-royal-waterfall-ayi4b816";
const EXPECTED_TEST_BRANCH_ID = "br-dark-shape-ay26qwmp";
const NS = "p8a";
const BASE_TABLE_COUNT = 16;
const NEW_TABLE_COUNT = 9;   // shot_recipe* 9개
const CANONICAL_FIELD_COUNT = 37;

const sql = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
type Result = { id: string; label: string; ok: boolean; detail: string };

async function runSuite(c: PoolClient): Promise<Result[]> {
  const out: Result[] = [];
  let sp = 0;
  const q = (t: string, p: unknown[] = []) => c.query(t, p);

  const isolate = async (work: () => Promise<unknown>) => {
    const n = `sp_${++sp}`;
    await q(`SAVEPOINT ${n}`);
    try {
      await work();
      await q(`RELEASE SAVEPOINT ${n}`);
      return null;
    } catch (e) {
      await q(`ROLLBACK TO SAVEPOINT ${n}`);
      await q(`RELEASE SAVEPOINT ${n}`);
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
    out.push({ id, label, ok: !err, detail: err ? err.slice(0, 90) : "" });
  };

  // ── 픽스처 ────────────────────────────────────────────────
  await q("INSERT INTO projects (id,title) VALUES ($1,$2)", [NS, "정본A 검증"]);
  await q("INSERT INTO projects (id,title) VALUES ($1,$2)", [`${NS}_other`, "다른 프로젝트"]);
  for (const [suf, role] of [["dir", "director"], ["prod", "producer"]] as const) {
    await q("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,$4)", [`${NS}_${suf}`, NS, suf, role]);
  }
  await q("INSERT INTO scenes (id,project_id,scene_number,title) VALUES ($1,$2,1,$3)", [`${NS}_sc`, NS, "씬1"]);
  await q("INSERT INTO scenes (id,project_id,scene_number,title) VALUES ($1,$2,2,$3)", [`${NS}_sc2`, NS, "씬2"]);
  await q("INSERT INTO scenes (id,project_id,scene_number,title) VALUES ($1,$2,9,$3)", [`${NS}_sc_other`, `${NS}_other`, "타프로젝트 씬"]);
  for (const n of [1, 2, 3]) {
    await q("INSERT INTO shots (id,scene_id,shot_number,title) VALUES ($1,$2,$3,$4)", [`${NS}_shot${n}`, `${NS}_sc`, n, `샷${n}`]);
  }
  for (const r of ["used", "unused"]) {
    await q(
      `INSERT INTO visual_references (id,project_id,title,source_method,content_type,adoption_level,responsible_role)
       VALUES ($1,$2,$3,'upload','environment','core','art_director')`,
      [`${NS}_ref_${r}`, NS, `레퍼런스 ${r}`],
    );
  }
  await q("INSERT INTO visual_principles (id,project_id,title) VALUES ($1,$2,$3)", [`${NS}_vp`, NS, "원칙"]);
  await q(
    `INSERT INTO visual_principle_versions (id,principle_id,version_number,principle_text,rationale,content_hash)
     VALUES ($1,$2,1,'t','r','h')`,
    [`${NS}_vpv`, `${NS}_vp`],
  );
  // Phase 8A: 캐릭터 정체성 정본. subjects 링크는 이 id 를 FK 로 참조한다.
  await q("INSERT INTO characters (id,project_id,name,character_type,created_by) VALUES ($1,$2,$3,'lead',$4)", [`${NS}_ch`, NS, "수현", `${NS}_dir`]);
  await q("INSERT INTO characters (id,project_id,name,character_type,created_by) VALUES ($1,$2,$3,'lead',$4)", [`${NS}_ch_other`, `${NS}_other`, "타작품 인물", `${NS}_dir`]);
  await q(
    `INSERT INTO character_visual_bibles (id,project_id,character_id,character_name,version_number)
     VALUES ($1,$2,$3,$4,1)`,
    [`${NS}_cvb`, NS, `${NS}_ch`, "수현"],
  );

  const recipe = (id: string, shot: string, scene = `${NS}_sc`, project = NS) =>
    q("INSERT INTO shot_recipes (id,project_id,scene_id,shot_id) VALUES ($1,$2,$3,$4)", [id, project, scene, shot]);
  const version = (id: string, rid: string, no: number, extra: Record<string, unknown> = {}) => {
    const cols = ["id", "recipe_id", "version_no", "created_by", ...Object.keys(extra)];
    const vals = [id, rid, no, `${NS}_dir`, ...Object.values(extra)];
    return q(`INSERT INTO shot_recipe_versions (${cols.join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
  };
  let evt = 0;
  const event = (vid: string, role: "director" | "producer", decision: "approved" | "revoked") =>
    q(
      "INSERT INTO shot_recipe_approvals (id,version_id,approver_role,decision,approved_by,approved_at) VALUES ($1,$2,$3,$4,$5,now()+($6||' ms')::interval)",
      [`${NS}_e${++evt}`, vid, role, decision, role === "director" ? `${NS}_dir` : `${NS}_prod`, String(evt)],
    );

  await recipe(`${NS}_r1`, `${NS}_shot1`);
  await version(`${NS}_v1`, `${NS}_r1`, 1, { subject_action: "원본 행동" });

  // ── T-01 ~ T-14 (개정) ───────────────────────────────────
  await reject("T-01", "동일 shot_id 레시피 중복", () => recipe(`${NS}_rdup`, `${NS}_shot1`), /shot_recipes_shot_uq|duplicate key/i);
  await reject("T-02", "동일 (recipe, version_no) 중복", () => version(`${NS}_vdup`, `${NS}_r1`, 1), /srv_version_uq|duplicate key/i);
  await reject("T-03", "status='confirmed' 거부", () => version(`${NS}_vbad`, `${NS}_r1`, 90, { status: "confirmed" }), /srv_status_chk|check constraint/i);
  await allow("T-04", "status 4종(draft/proposed/needs_review/stale) 허용", async () => {
    for (const [i, s] of ["draft", "proposed", "needs_review", "stale"].entries()) {
      await version(`${NS}_vs${i}`, `${NS}_r1`, 100 + i, { status: s });
    }
  });
  await reject("T-05", "버전 본문 UPDATE 거부", () => q("UPDATE shot_recipe_versions SET subject_action=$1 WHERE id=$2", ["변경", `${NS}_v1`]), /불변|immutable/i);
  await allow("T-06", "status 만 UPDATE 허용", () => q("UPDATE shot_recipe_versions SET status='proposed' WHERE id=$1", [`${NS}_v1`]));
  await reject("T-07", "승인 이벤트 없이 approved 거부", () => q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_v1`]), /감독·제작의 최신 승인/);
  await allow("T-08", "감독+제작 승인 후 approved 허용", async () => {
    await event(`${NS}_v1`, "director", "approved");
    await event(`${NS}_v1`, "producer", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_v1`]);
  });
  await allow("T-09", "새 버전은 draft, 승인 미승계", async () => {
    await version(`${NS}_v2`, `${NS}_r1`, 2, { subject_action: "v2" });
    const r = await q("SELECT status FROM shot_recipe_versions WHERE id=$1", [`${NS}_v2`]);
    if (r.rows[0].status !== "draft") throw new Error(`status=${r.rows[0].status}`);
    const a = await q("SELECT count(*)::int c FROM shot_recipe_approvals WHERE version_id=$1", [`${NS}_v2`]);
    if (a.rows[0].c !== 0) throw new Error("승인 승계됨");
  });
  await reject("T-10", "승인 이력 UPDATE 거부", () => q("UPDATE shot_recipe_approvals SET rationale='x' WHERE id=$1", [`${NS}_e1`]), /append-only/i);
  await reject("T-11", "승인 이력 DELETE 거부", () => q("DELETE FROM shot_recipe_approvals WHERE id=$1", [`${NS}_e1`]), /append-only/i);
  await allow("T-12", "철회→재승인 이력 보존", async () => {
    const before = (await q("SELECT count(*)::int c FROM shot_recipe_approvals WHERE version_id=$1", [`${NS}_v1`])).rows[0].c;
    await event(`${NS}_v1`, "director", "revoked");
    await event(`${NS}_v1`, "director", "approved");
    const after = (await q("SELECT count(*)::int c FROM shot_recipe_approvals WHERE version_id=$1", [`${NS}_v1`])).rows[0].c;
    if (after !== before + 2) throw new Error(`이력 ${before}→${after}`);
  });
  await reject("T-13", "production_method 오값 거부", async () => {
    await version(`${NS}_vgs`, `${NS}_r1`, 210);
    await q("INSERT INTO shot_recipe_generation_specs (version_id,production_method) VALUES ($1,$2)", [`${NS}_vgs`, "매우좋음"]);
  }, /srgs_method_chk|check constraint/i);
  await reject("T-14", "존재하지 않는 reference 링크 거부", async () => {
    await version(`${NS}_vfk`, `${NS}_r1`, 211);
    await q("INSERT INTO shot_recipe_version_references (version_id,reference_id) VALUES ($1,$2)", [`${NS}_vfk`, "없는것"]);
  }, /srvr_ref_fk|foreign key/i);

  // ── T-15 · T-17~T-20 (삭제 정책) ─────────────────────────
  await q("INSERT INTO shot_recipe_version_references (version_id,reference_id,role) VALUES ($1,$2,'first_frame')", [`${NS}_v1`, `${NS}_ref_used`]);
  await reject("T-15", "사용 중 Reference 삭제 RESTRICT", () => q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_used`]), /srvr_ref_fk|foreign key|still referenced/i);
  await allow("T-17", "미참조 Reference 물리 삭제 가능", async () => {
    await q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_unused`]);
  });
  await reject("T-18", "참조 중 Reference 물리 삭제 거부", () => q("DELETE FROM visual_references WHERE id=$1", [`${NS}_ref_used`]), /srvr_ref_fk|foreign key|still referenced/i);
  await allow("T-19", "승인 이력 없는 Shot 삭제 가능", async () => {
    await recipe(`${NS}_r2`, `${NS}_shot2`);
    await version(`${NS}_vd`, `${NS}_r2`, 1);
    await q("DELETE FROM shots WHERE id=$1", [`${NS}_shot2`]);
    const r = await q("SELECT count(*)::int c FROM shot_recipes WHERE id=$1", [`${NS}_r2`]);
    if (r.rows[0].c !== 0) throw new Error("레시피 잔존");
  });
  await reject("T-20", "승인 이력 있는 Shot 삭제 거부", () => q("DELETE FROM shots WHERE id=$1", [`${NS}_shot1`]), /sra_version_fk|foreign key|still referenced/i);

  // ── T-21 ~ T-26 승인 정책 ────────────────────────────────
  await recipe(`${NS}_r3`, `${NS}_shot3`);

  await reject("T-21", "status='approved' 직접 INSERT 거부", () => version(`${NS}_vins`, `${NS}_r3`, 300, { status: "approved" }), /감독·제작의 최신 승인/);

  await reject("T-22", "감독 단독 승인으로 approved 거부", async () => {
    await version(`${NS}_vdo`, `${NS}_r3`, 301);
    await event(`${NS}_vdo`, "director", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vdo`]);
  }, /감독·제작의 최신 승인/);

  await reject("T-23", "제작 단독 승인으로 approved 거부", async () => {
    await version(`${NS}_vpo`, `${NS}_r3`, 302);
    await event(`${NS}_vpo`, "producer", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vpo`]);
  }, /감독·제작의 최신 승인/);

  await allow("T-24", "두 역할 승인 후 approved 허용", async () => {
    await version(`${NS}_vboth`, `${NS}_r3`, 303);
    await event(`${NS}_vboth`, "director", "approved");
    await event(`${NS}_vboth`, "producer", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vboth`]);
  });

  await reject("T-25", "감독 철회 후 approved 거부 (과거 승인 재사용 금지)", async () => {
    await version(`${NS}_vrev`, `${NS}_r3`, 304);
    await event(`${NS}_vrev`, "director", "approved");
    await event(`${NS}_vrev`, "producer", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vrev`]);
    await event(`${NS}_vrev`, "director", "revoked");
    await q("UPDATE shot_recipe_versions SET status='stale' WHERE id=$1", [`${NS}_vrev`]);
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vrev`]);
  }, /감독·제작의 최신 승인/);

  await allow("T-26", "감독 재승인 후 approved 허용", async () => {
    await version(`${NS}_vre`, `${NS}_r3`, 305);
    await event(`${NS}_vre`, "director", "approved");
    await event(`${NS}_vre`, "producer", "approved");
    await event(`${NS}_vre`, "director", "revoked");
    await event(`${NS}_vre`, "director", "approved");
    await q("UPDATE shot_recipe_versions SET status='approved' WHERE id=$1", [`${NS}_vre`]);
  });

  // ── T-27 ~ T-29 링크 테이블 ──────────────────────────────
  await allow("T-27", "링크 테이블 5종 INSERT 가능", async () => {
    await version(`${NS}_vlink`, `${NS}_r3`, 306);
    await q("INSERT INTO shot_recipe_version_subjects (version_id,character_id) VALUES ($1,$2)", [`${NS}_vlink`, `${NS}_ch`]);
    await q("INSERT INTO shot_recipe_version_character_visuals (version_id,character_visual_bible_id) VALUES ($1,$2)", [`${NS}_vlink`, `${NS}_cvb`]);
    await q("INSERT INTO shot_recipe_version_visual_principles (version_id,principle_version_id) VALUES ($1,$2)", [`${NS}_vlink`, `${NS}_vpv`]);
    await q("INSERT INTO shot_recipe_version_references (version_id,reference_id,role) VALUES ($1,$2,'general')", [`${NS}_vlink`, `${NS}_ref_used`]);
    await q("INSERT INTO shot_recipe_version_evidence (version_id,evidence_uid) VALUES ($1,$2)", [`${NS}_vlink`, "U01"]);
  });
  await reject("T-28", "링크 중복 UNIQUE 거부", () => q("INSERT INTO shot_recipe_version_evidence (version_id,evidence_uid) VALUES ($1,$2)", [`${NS}_vlink`, "U01"]), /srve_pk|duplicate key/i);
  await reject("T-29", "참조 중 Principle Version 삭제 RESTRICT", () => q("DELETE FROM visual_principle_versions WHERE id=$1", [`${NS}_vpv`]), /srvvp_pv_fk|foreign key|still referenced/i);

  // ── T-30 ~ T-32 일관성 ───────────────────────────────────
  await reject("T-30", "scene 불일치 Recipe 거부", () => recipe(`${NS}_rbad1`, `${NS}_shot3`, `${NS}_sc2`), /scene_id 가 Shot 의 Scene 과 다릅니다/);
  await reject("T-31", "project 불일치 Recipe 거부", () => recipe(`${NS}_rbad2`, `${NS}_shot3`, `${NS}_sc`, `${NS}_other`), /project_id 가 Scene 의 Project 와 다릅니다/);
  await reject("T-32", "타 프로젝트 scene 조합 거부", () => recipe(`${NS}_rbad3`, `${NS}_shot3`, `${NS}_sc_other`, NS), /scene_id 가 Shot 의 Scene 과 다릅니다|project_id 가 Scene/);

  // ── T-33 ~ T-34 performanceDirection 정본 승격 ────────────
  await allow("T-33", "performanceDirection INSERT·read 가능", async () => {
    await version(`${NS}_vpd`, `${NS}_r3`, 310, {
      subject_action: "이름표를 뜯는다",
      performance_direction: "무표정 기준. 손끝만 또렷하게.",
    });
    const r = await q("SELECT subject_action, performance_direction FROM shot_recipe_versions WHERE id=$1", [`${NS}_vpd`]);
    if (r.rows[0].performance_direction !== "무표정 기준. 손끝만 또렷하게.") throw new Error("저장/조회 불일치");
    // subjectAction 과 분리되어 있어야 한다.
    if (r.rows[0].subject_action === r.rows[0].performance_direction) throw new Error("subjectAction 과 분리되지 않음");
  });
  await reject(
    "T-34",
    "performanceDirection 불변 (본문 UPDATE 거부)",
    () => q("UPDATE shot_recipe_versions SET performance_direction=$1 WHERE id=$2", ["바꿈", `${NS}_vpd`]),
    /불변|immutable/i,
  );

  // ── T-35 ~ T-38 characters 정본 (Phase 8A) ────────────────
  await version(`${NS}_vch`, `${NS}_r3`, 311);

  await allow("T-35", "같은 프로젝트 character 연결 가능", async () => {
    await q("INSERT INTO shot_recipe_version_subjects (version_id,character_id) VALUES ($1,$2)", [`${NS}_vch`, `${NS}_ch`]);
  });
  await reject(
    "T-36",
    "존재하지 않는 character 연결 거부",
    () => q("INSERT INTO shot_recipe_version_subjects (version_id,character_id) VALUES ($1,$2)", [`${NS}_vch`, "없는캐릭터"]),
    /srvs_character_fk|foreign key|다른 프로젝트의 캐릭터/,
  );
  await reject(
    "T-37",
    "다른 프로젝트 character 연결 거부",
    () => q("INSERT INTO shot_recipe_version_subjects (version_id,character_id) VALUES ($1,$2)", [`${NS}_vch`, `${NS}_ch_other`]),
    /다른 프로젝트의 캐릭터/,
  );
  await reject(
    "T-38",
    "사용 중 character 물리 삭제 RESTRICT",
    () => q("DELETE FROM characters WHERE id=$1", [`${NS}_ch`]),
    /srvs_character_fk|foreign key|still referenced/i,
  );

  return out;
}

/**
 * Canonical v1 37필드가 실제로 저장 구조를 갖는지 DB 에서 확인한다.
 * 컬럼 / 링크 테이블 / 승인 이벤트 중 하나에 반드시 대응해야 한다.
 */
const CANONICAL_V1: Array<[field: string, kind: "lineage" | "version" | "link" | "approval", target: string]> = [
  ["recipeId", "lineage", "id"], ["projectId", "lineage", "project_id"],
  ["sceneId", "lineage", "scene_id"], ["shotId", "lineage", "shot_id"],
  ["version", "version", "version_no"], ["status", "version", "status"],
  ["narrativePurpose", "version", "narrative_purpose"], ["emotionalTarget", "version", "emotional_target"],
  ["subjectIds", "link", "shot_recipe_version_subjects"],
  ["characterVisualVersionIds", "link", "shot_recipe_version_character_visuals"],
  ["visualPrincipleVersionIds", "link", "shot_recipe_version_visual_principles"],
  ["referenceIds", "link", "shot_recipe_version_references"],
  ["framing", "version", "framing"], ["shotSize", "version", "shot_size"],
  ["lensIntent", "version", "lens_intent"], ["cameraPosition", "version", "camera_position"],
  ["cameraMovement", "version", "camera_movement"], ["subjectAction", "version", "subject_action"],
  ["environment", "version", "environment"], ["lighting", "version", "lighting"],
  ["colorIntent", "version", "color_intent"], ["wardrobe", "version", "wardrobe"],
  ["props", "version", "props"], ["startState", "version", "start_state"],
  ["endState", "version", "end_state"], ["durationSeconds", "version", "duration_seconds"],
  ["motionSpeed", "version", "motion_speed"], ["continuityInputs", "version", "continuity_inputs"],
  ["allowedElements", "version", "allowed_elements"], ["prohibitedElements", "version", "prohibited_elements"],
  ["productionConstraints", "version", "production_constraints"],
  ["evidenceIds", "link", "shot_recipe_version_evidence"],
  ["createdBy", "version", "created_by"], ["createdAt", "version", "created_at"],
  ["approvedBy", "approval", "approved_by"], ["approvedAt", "approval", "approved_at"],
  ["performanceDirection", "version", "performance_direction"],
];

async function auditFieldMapping(q: (t: string, p?: unknown[]) => Promise<any>) {
  const cols = await q(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('shot_recipes','shot_recipe_versions','shot_recipe_approvals')`,
  );
  const has = (t: string, c: string) => cols.rows.some((r: any) => r.table_name === t && r.column_name === c);
  const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  const hasTable = (t: string) => tables.rows.some((r: any) => r.table_name === t);

  const missing: string[] = [];
  for (const [field, kind, target] of CANONICAL_V1) {
    const ok =
      kind === "lineage" ? has("shot_recipes", target)
      : kind === "version" ? has("shot_recipe_versions", target)
      : kind === "approval" ? has("shot_recipe_approvals", target)
      : hasTable(target);
    if (!ok) missing.push(`${field}(${kind}:${target})`);
  }
  return { total: CANONICAL_V1.length, missing };
}

async function tableCount(q: (t: string, p?: unknown[]) => Promise<any>, like: string, not = false) {
  const r = await q(
    `SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public' AND table_name ${not ? "NOT " : ""}LIKE $1`,
    [like],
  );
  return r.rows[0].c as number;
}

async function main() {
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error("DATABASE_URL 이 없습니다."); process.exit(1); }
  const pool = new Pool({ connectionString: cs });
  const q = (t: string, p: unknown[] = []) => pool.query(t, p);

  const g = await q("SELECT current_setting('neon.branch_id', true) AS b");
  const branch = g.rows[0]?.b ?? null;
  if (!branch || branch === MAIN_BRANCH_ID || branch !== EXPECTED_TEST_BRANCH_ID) {
    console.error(`허용되지 않은 브랜치 (연결: ${branch ?? "확인 불가"}). 실행 거부.`);
    await pool.end(); process.exit(1);
  }
  console.log(`branch: ${branch} (테스트 브랜치 확인)\n`);

  const snapshot = async () => {
    const o: Record<string, number> = {};
    for (const t of ["projects", "participants", "scenes", "shots", "visual_references", "visual_principles", "visual_principle_versions", "character_visual_bibles", "cascade_impacts"]) {
      o[t] = (await q(`SELECT count(*)::int c FROM ${t}`)).rows[0].c;
    }
    return o;
  };

  console.log("== 1. 기존 Phase 8 스키마 DOWN ==");
  await q(sql("./021_characters_down.sql")).catch(() => {});
  await q(sql("./012_shot_recipe_a_down.sql")).catch(() => {});
  console.log("== 2. 기존 16개 테이블·데이터 확인 ==");
  const base0 = await tableCount(q, "shot_recipe%", true);
  const before = await snapshot();
  console.log(`   기존 테이블 ${base0}개 · Shot Recipe ${await tableCount(q, "shot_recipe%")}개`);
  console.log(`   기존 데이터: ${JSON.stringify(before)}\n`);

  const idem = { downOk: false, baseAfterDown: -1, srAfterDown: -1, upAgainOk: false, dataUnchanged: false };
  const rounds: Result[][] = [];

  for (const [i, label] of ["1회차", "2회차"].entries()) {
    console.log(`== ${i === 0 ? "3" : "7"}. 수정된 UP + trigger 적용 (${label}) ==`);
    await q(sql("./010_shot_recipe_a_up.sql"));
    await q(sql("./011_shot_recipe_a_triggers.sql"));
    await q(sql("./020_characters_up.sql"));
    const nt = await tableCount(q, "shot_recipe%");
    const hasCharacters = (await q(`SELECT count(*)::int c FROM information_schema.tables WHERE table_schema='public' AND table_name='characters'`)).rows[0].c === 1;
    console.log(`   신규 테이블 shot_recipe* ${nt}개 (기대 ${NEW_TABLE_COUNT}) · characters ${hasCharacters ? "생성됨" : "없음"} · 전체 ${await tableCount(q, "%")}개`);
    if (i === 1) idem.upAgainOk = nt === NEW_TABLE_COUNT && hasCharacters;

    if (i === 0) {
      const audit = await auditFieldMapping(q);
      console.log(`   Canonical v1 필드 매핑: ${audit.total - audit.missing.length}/${audit.total}${audit.missing.length ? " — 누락: " + audit.missing.join(", ") : " ✅"}`);
      const fk = await q(`SELECT conname FROM pg_constraint WHERE conname='srvs_character_fk'`);
      console.log(`   subjects.character_id FK: ${fk.rows.length ? "characters(id) RESTRICT ✅" : "❌ 미설정"}`);
    }

    console.log(`\n== ${i === 0 ? "4" : "8"}. T-01~T-38 실행 (${label}) ==`);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      rounds.push(await runSuite(c));
      await c.query("ROLLBACK");
    } finally { c.release(); }
    const leftover = (await q("SELECT (SELECT count(*) FROM shot_recipes)+(SELECT count(*) FROM shot_recipe_versions)+(SELECT count(*) FROM shot_recipe_approvals) c")).rows[0].c;
    console.log(`   Shot Recipe 잔존 행: ${leftover} (ROLLBACK 정리, 트리거 비활성화 없음)`);

    if (i === 0) {
      console.log("\n== 5. 전체 DOWN ==");
      try { await q(sql("./021_characters_down.sql")); await q(sql("./012_shot_recipe_a_down.sql")); idem.downOk = true; }
      catch (e) { console.log("   DOWN 실패:", e instanceof Error ? e.message : e); }
      console.log("== 6. 기존 16개 테이블·데이터 무변경 확인 ==");
      idem.baseAfterDown = await tableCount(q, "shot_recipe%", true);
      idem.srAfterDown = await tableCount(q, "shot_recipe%");
      const after = await snapshot();
      idem.dataUnchanged = JSON.stringify(before) === JSON.stringify(after);
      console.log(`   기존 테이블 ${idem.baseAfterDown}개 (기대 ${BASE_TABLE_COUNT}) · Shot Recipe ${idem.srAfterDown}개 (기대 0)`);
      console.log(`   기존 데이터 동일: ${idem.dataUnchanged ? "예" : "아니오 → " + JSON.stringify(after)}\n`);
    }
  }

  const [r1, r2] = rounds;
  const same = JSON.stringify(r1.map((x) => [x.id, x.ok])) === JSON.stringify(r2.map((x) => [x.id, x.ok]));
  const t16 = [
    ["전체 DOWN 성공", idem.downOk],
    [`기존 ${BASE_TABLE_COUNT}개 테이블 복원`, idem.baseAfterDown === BASE_TABLE_COUNT && idem.srAfterDown === 0],
    ["UP 재적용 성공", idem.upAgainOk],
    ["동일 검증 결과", same],
    ["기존 데이터 무변경", idem.dataUnchanged],
  ] as Array<[string, boolean]>;
  const t16Ok = t16.every(([, ok]) => ok);

  const merged: Result[] = [];
  for (const a of r1) {
    if (a.id === "T-17") merged.push({ id: "T-16", label: "롤백→재적용 멱등 (DOWN·복원·UP·동일결과·데이터무변경)", ok: t16Ok, detail: t16.filter(([, o]) => !o).map(([l]) => l).join(", ") });
    const b = r2.find((x) => x.id === a.id)!;
    merged.push({ id: a.id, label: a.label, ok: a.ok && b.ok, detail: a.ok ? b.detail : a.detail });
  }

  console.log("\n== 결과 ==");
  let pass = 0, fail = 0;
  merged.forEach((r) => { r.ok ? pass++ : fail++; console.log(`  ${r.ok ? "✅" : "❌"} ${r.id}  ${r.label}${r.ok ? "" : ` — ${r.detail}`}`); });
  console.log(`\n  통과 ${pass} / 실패 ${fail} · 전체 ${merged.length}개 (2회차 동일 기준)`);
  console.log(`  기존 테이블 수: ${(await tableCount(q, "shot_recipe%", true)) - 1} (기대 ${BASE_TABLE_COUNT}, characters 제외)`);
  console.log(`  신규 테이블 수: ${await tableCount(q, "shot_recipe%")} (기대 ${NEW_TABLE_COUNT})`);
  console.log(`  9. Shot Recipe 데이터 행: ${(await q("SELECT (SELECT count(*) FROM shot_recipes)+(SELECT count(*) FROM shot_recipe_versions)+(SELECT count(*) FROM shot_recipe_approvals) c")).rows[0].c}`);

  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("실행 실패:", e instanceof Error ? e.message : e); process.exit(1); });
