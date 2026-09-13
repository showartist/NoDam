/**
 * Phase 7A 검증 전용 시드 — 테스트 Neon 브랜치에서만 실행한다.
 *
 *   npx tsx scripts/validate-project-visual-live-read.ts seed
 *   npx tsx scripts/validate-project-visual-live-read.ts clean
 *
 * 안전장치:
 *   - DATABASE_URL 이 없으면 거부한다 (SQLite 로 폴백하지 않는다).
 *   - 연결된 branch_id 가 메인이면 거부한다. 테스트 브랜치가 아니면 아무것도 쓰지 않는다.
 *   - 연결 문자열은 어떤 경우에도 출력하지 않는다.
 *   - production 빌드에 포함되지 않는다 (scripts/ 는 Next 라우트가 아니다).
 *   - 자격증명을 하드코딩하지 않는다.
 *
 * 이 스크립트가 만드는 데이터는 전부 PROJECT_ID 접두사를 가지며 clean 으로 완전히 제거된다.
 */
import { Pool } from "@neondatabase/serverless";

const MAIN_BRANCH_ID = "br-royal-waterfall-ayi4b816";
const EXPECTED_TEST_BRANCH_ID = "br-dark-shape-ay26qwmp";

const PROJECT_ID = process.env.PV_VALIDATION_PROJECT_ID ?? "pv_live_read";
const P = (suffix: string) => `${PROJECT_ID}_${suffix}`;

const ASSET = (name: string) => `/project-visual-workspace/assets/project_visual_workspace/${name}`;

async function main() {
  const mode = process.argv[2] ?? "seed";
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL 이 없습니다. 이 스크립트는 폴백하지 않습니다.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const q = (text: string, params: unknown[] = []) => pool.query(text, params);

  // ── 안전장치: 반드시 테스트 브랜치여야 한다 ─────────────────────
  const guard = await q("SELECT current_setting('neon.branch_id', true) AS branch");
  const branch = guard.rows[0]?.branch ?? null;
  if (!branch) {
    console.error("branch_id 를 확인할 수 없습니다. 중단합니다.");
    await pool.end();
    process.exit(1);
  }
  if (branch === MAIN_BRANCH_ID) {
    console.error(`메인 브랜치(${MAIN_BRANCH_ID})에 연결되었습니다. 쓰기를 거부합니다.`);
    await pool.end();
    process.exit(1);
  }
  if (branch !== EXPECTED_TEST_BRANCH_ID) {
    console.error(`예상한 테스트 브랜치가 아닙니다 (연결: ${branch}). 쓰기를 거부합니다.`);
    await pool.end();
    process.exit(1);
  }
  console.log(`branch: ${branch} (테스트 브랜치 확인)`);

  await clean(q);
  if (mode === "clean") {
    console.log("정리 완료.");
    await pool.end();
    return;
  }

  await seed(q);
  await pool.end();
}

async function clean(q: (t: string, p?: unknown[]) => Promise<unknown>) {
  const like = `${PROJECT_ID}%`;
  await q("DELETE FROM decision_lineage WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM cascade_impacts WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM character_visual_scene_links WHERE character_visual_bible_id LIKE $1", [like]);
  await q("DELETE FROM character_visual_bibles WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM principle_scene_links WHERE principle_version_id LIKE $1", [like]);
  await q("DELETE FROM principle_shot_links WHERE principle_version_id LIKE $1", [like]);
  await q("DELETE FROM visual_principle_approvals WHERE principle_version_id LIKE $1", [like]);
  await q("UPDATE visual_principles SET current_version_id=NULL WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM visual_principle_versions WHERE principle_id LIKE $1", [like]);
  await q("DELETE FROM visual_principles WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM decision_questions WHERE project_id=$1", [PROJECT_ID]);
  // 링크는 접두사가 아니라 프로젝트 소속으로 지운다.
  // UI/API 가 만든 Reference 는 UUID 라 접두사와 맞지 않는다.
  await q(
    "DELETE FROM visual_reference_scene_links WHERE reference_id IN (SELECT id FROM visual_references WHERE project_id=$1)",
    [PROJECT_ID],
  );
  await q("DELETE FROM visual_references WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM shots WHERE scene_id IN (SELECT id FROM scenes WHERE project_id=$1)", [PROJECT_ID]);
  await q("DELETE FROM shots WHERE id LIKE $1", [like]);
  await q("DELETE FROM scenes WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM participants WHERE project_id=$1", [PROJECT_ID]);
  await q("DELETE FROM projects WHERE id=$1", [PROJECT_ID]);
}

async function seed(q: (t: string, p?: unknown[]) => Promise<unknown>) {
  const J = (v: unknown) => JSON.stringify(v);

  // ── Project / Participants ──────────────────────────────────
  await q(
    "INSERT INTO projects (id,title,domain,status,one_line) VALUES ($1,$2,'film','development',$3)",
    [PROJECT_ID, "빈 수영장", "동생의 흔적을 쫓는 언니가 폐쇄된 수영장에서 마지막 증거를 찾는다."],
  );
  await q("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,'director')", [P("director"), PROJECT_ID, "한지우"]);
  await q("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,'producer')", [P("producer"), PROJECT_ID, "박세라"]);
  await q("INSERT INTO participants (id,project_id,name,role) VALUES ($1,$2,$3,'cinematographer')", [P("dp"), PROJECT_ID, "정민호"]);

  // ── Scenes: 하나는 변경 범위 안, 하나는 명시적으로 범위 밖 ────
  await q("INSERT INTO scenes (id,project_id,scene_number,title,review_status) VALUES ($1,$2,34,$3,'current')", [P("scene34"), PROJECT_ID, "폐쇄된 실내수영장 — DAWN"]);
  await q("INSERT INTO scenes (id,project_id,scene_number,title,review_status) VALUES ($1,$2,12,$3,'current')", [P("scene12"), PROJECT_ID, "모텔방 — NIGHT (변경 범위 밖)"]);

  // ── Shots: approved / proposed / legacy(링크 없음) ───────────
  await q(
    "INSERT INTO shots (id,scene_id,shot_number,title,status,generated_image_state,image_uri,approved_by,approved_at) VALUES ($1,$2,3,$3,'approved','generated',$4,$5,now())",
    [P("shot_approved"), P("scene34"), "수영모 이름표를 뜯는 손 — MCU", "/images/scene34_shot3.png", P("director")],
  );
  await q(
    "INSERT INTO shots (id,scene_id,shot_number,title,status,generated_image_state,image_uri) VALUES ($1,$2,6,$3,'proposed','generated',$4)",
    [P("shot_proposed"), P("scene34"), "빈 수영장과 배수구 물 한 방울 — WS", "/images/scene34_shot6.png"],
  );
  await q(
    "INSERT INTO shots (id,scene_id,shot_number,title,status,generated_image_state) VALUES ($1,$2,1,$3,'proposed','not_generated')",
    [P("shot_legacy"), P("scene12"), "모텔방 도입 — WS (원칙 링크 없음)"],
  );

  // ── Visual References 6종 ────────────────────────────────────
  const refs: [string, string, string, string, string, string, string, string[], string[], string[]][] = [
    ["ref_space", "폐쇄된 수영장 전경", "upload", "environment", "core", "uploaded", ASSET("pool-wide-environment.png"),
      ["타일의 녹색 곰팡이", "바랜 안내판", "푸른 새벽빛"], ["호러 톤", "과장된 연기"], ["U28", "U30"]],
    ["ref_mood", "인물이 공간에 놓인 분위기", "upload", "mood", "core", "uploaded", ASSET("woman-pool-wide.png"),
      ["고립감", "인물과 공간의 거리"], ["감상적 조명"], ["U31"]],
    ["ref_face", "수현 얼굴 기준", "upload", "character_face", "core", "uploaded", ASSET("character-closeup-blue.png"),
      ["무표정 기준", "미세한 반응"], ["과장된 표정"], ["U08", "U09"]],
    ["ref_fullbody", "수현 전신·실루엣", "upload", "character_fullbody", "support", "uploaded", ASSET("character-fullbody-pool.png"),
      ["실루엣 비율", "젖은 옷의 무게감"], ["패션 화보 포즈"], ["U54"]],
    ["ref_prop", "수영모와 이름표", "upload", "prop", "core", "uploaded", ASSET("swim-cap-goggles-prop.png"),
      ["낡은 질감", "안쪽 이름표"], ["새 제품 광택"], ["U12", "U13", "U24"]],
    ["ref_negative", "광고식 매끈한 수영장 (제외)", "upload", "environment", "exclude", "uploaded", ASSET("negative-glossy-commercial-pool.png"),
      [], ["광고 톤", "매끈한 물", "상업적 조명"], ["U30"]],
  ];
  for (const [id, title, method, ctype, level, imgState, uri, take, drop, ev] of refs) {
    await q(
      "INSERT INTO visual_references (id,project_id,title,source_method,content_type,adoption_level,reference_image_state,asset_uri,take_json,drop_json,responsible_role,evidence_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [P(id), PROJECT_ID, title, method, ctype, level, imgState, uri, J(take), J(drop), "art_director", J(ev)],
    );
    await q("INSERT INTO visual_reference_scene_links (reference_id,scene_id) VALUES ($1,$2)", [P(id), P("scene34")]);
  }

  // ── Decision Questions: open 1 / decided 1 ───────────────────
  await q(
    "INSERT INTO decision_questions (id,project_id,question,context,state,priority,evidence_json) VALUES ($1,$2,$3,$4,'open',1,$5)",
    [P("q_open"), PROJECT_ID, "맨발 촬영을 할 것인가, 신발을 신길 것인가?",
      "타일 파손 확인 전까지 안전관리자 승인이 나오지 않았다.", J(["U34", "U37", "U98"])],
  );
  await q(
    "INSERT INTO decision_questions (id,project_id,question,context,state,priority,decided_option,decided_by,decided_at,evidence_json) VALUES ($1,$2,$3,$4,'decided',0,$5,$6,now(),$7)",
    [P("q_decided"), PROJECT_ID, "공간의 규모를 보여줄 것인가, 인물의 폐쇄감을 우선할 것인가?",
      "감독은 고립을, 촬영감독은 망원 압축을, 미술감독은 공간 깊이를 원했다.",
      "공간 규모를 먼저 보여준 뒤 마지막 컷에서 폐쇄감으로 닫는다.", P("director"), J(["U38", "U39", "U74"])],
  );

  // ── Visual Principles 2 (confirmed 1 / needs_review 1) ───────
  await q("INSERT INTO visual_principles (id,project_id,title,status) VALUES ($1,$2,$3,'confirmed')", [P("vp_space"), PROJECT_ID, "공간이 인물을 삼키게 둔다"]);
  await q("INSERT INTO visual_principles (id,project_id,title,status) VALUES ($1,$2,$3,'needs_review')", [P("vp_tone"), PROJECT_ID, "새벽빛은 차갑되 호러로 가지 않는다"]);

  await q(
    "INSERT INTO visual_principle_versions (id,principle_id,version_number,principle_text,rationale,change_summary,evidence_json,source_question_id,content_hash,created_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9)",
    [P("vp_space_v1"), P("vp_space"), "와이드에서 인물을 프레임 하단 1/5 이하에 두고, 빈 공간이 화면 대부분을 차지하게 한다.",
      "감독의 고립감과 미술감독의 공간 깊이를 동시에 만족시키는 절충안으로 회의에서 합의됨.",
      "최초 확정", J(["U38", "U74"]), P("q_decided"), "hash_space_v1", P("director")],
  );
  await q("UPDATE visual_principles SET current_version_id=$1 WHERE id=$2", [P("vp_space_v1"), P("vp_space")]);

  await q(
    "INSERT INTO visual_principle_versions (id,principle_id,version_number,principle_text,rationale,change_summary,evidence_json,content_hash,created_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8)",
    [P("vp_tone_v1"), P("vp_tone"), "푸른 새벽빛에 녹색 곰팡이를 살리되 채도를 낮추지 않는다.",
      "호러 톤 회피는 합의됐으나 채도 기준은 미결정.", "최초 후보", J(["U28"]), "hash_tone_v1", P("dp")],
  );
  await q("UPDATE visual_principles SET current_version_id=$1 WHERE id=$2", [P("vp_tone_v1"), P("vp_tone")]);

  // 명시적 링크 — 변경 영향은 이 링크로만 계산된다
  await q("INSERT INTO principle_scene_links (principle_version_id,scene_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4)",
    [P("vp_space_v1"), P("scene34"), "이 원칙이 규정하는 와이드 구도가 적용되는 장면", J(["U38"])]);
  await q("INSERT INTO principle_shot_links (principle_version_id,shot_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4)",
    [P("vp_space_v1"), P("shot_approved"), "승인된 쇼트 — 원칙 수정 시 재검토 대상", J(["U74"])]);
  await q("INSERT INTO principle_shot_links (principle_version_id,shot_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4)",
    [P("vp_space_v1"), P("shot_proposed"), "미승인 쇼트 — 상태는 유지하되 영향은 기록", J(["U75"])]);

  // ── Approvals: director active / producer active / 철회 이력 1 ──
  await q(
    "INSERT INTO visual_principle_approvals (id,principle_version_id,approver_id,role,status,evidence_uid) VALUES ($1,$2,$3,'director','active',$4)",
    [P("appr_dir"), P("vp_space_v1"), P("director"), "U38"],
  );
  await q(
    "INSERT INTO visual_principle_approvals (id,principle_version_id,approver_id,role,status,evidence_uid) VALUES ($1,$2,$3,'producer','active',$4)",
    [P("appr_prod"), P("vp_space_v1"), P("producer"), "U86"],
  );
  await q(
    "INSERT INTO visual_principle_approvals (id,principle_version_id,approver_id,role,status,evidence_uid,withdrawn_at,withdrawal_reason) VALUES ($1,$2,$3,'producer','withdrawn',$4,now(),$5)",
    [P("appr_prod_withdrawn"), P("vp_tone_v1"), P("producer"), "U86", "장소 추가 사용료 확인 전이라 승인을 철회함"],
  );

  // ── Character Visual Bible ───────────────────────────────────
  await q(
    `INSERT INTO character_visual_bibles
      (id,project_id,character_id,character_name,version_number,status,
       face_asset_uri,costume_asset_uri,fullbody_asset_uri,inspace_asset_uri,prop_asset_uri,
       continuity_lock_json,allowed_json,prohibited_json,evidence_json,approved_by,approved_at)
     VALUES ($1,$2,$3,$4,1,'confirmed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())`,
    [P("cvb_suhyun"), PROJECT_ID, P("char_suhyun"), "수현",
      ASSET("character-closeup-blue.png"), ASSET("costume-midshot-pool.png"),
      ASSET("character-fullbody-pool.png"), ASSET("woman-pool-wide.png"), ASSET("swim-cap-goggles-prop.png"),
      J({ face: "ref_face v1.0", costume: "젖은 회색 후드", prop: "낡은 수영모" }),
      J(["무표정 기준", "젖은 머리", "손에 쥔 이름표 조각"]),
      J(["화장 강조", "밝은 색 의상", "젖지 않은 머리"]),
      J(["U08", "U09", "U17"]), P("director")],
  );
  await q(
    "INSERT INTO character_visual_scene_links (character_visual_bible_id,scene_id,character_id,link_reason,evidence_json) VALUES ($1,$2,$3,$4,$5)",
    [P("cvb_suhyun"), P("scene34"), P("char_suhyun"), "수현이 등장하는 장면", J(["U17"])],
  );

  // ── Cascade Impacts 5종 (vp_space v1 → v2 수정 가정) ─────────
  const impacts: [string, "scene" | "shot", string, "affected" | "unaffected" | "unknown", string | null, string][] = [
    ["ci_scene_review", "scene", P("scene34"), "affected", "review_required", "수정된 원칙 버전에 명시적으로 연결된 Scene입니다."],
    ["ci_shot_restale", "shot", P("shot_approved"), "affected", "restale", "수정된 원칙 버전에 연결된 승인 Shot입니다."],
    ["ci_shot_null", "shot", P("shot_proposed"), "affected", null, "연결된 미승인 Shot이므로 상태를 유지합니다."],
    ["ci_scene_unaffected", "scene", P("scene12"), "unaffected", null, "명시적 변경 범위를 검토했으며 대상과 무관합니다."],
    ["ci_shot_unknown", "shot", P("shot_legacy"), "unknown", null, "명시적 legacy 링크가 없어 인간 검토가 필요합니다."],
  ];
  for (const [id, ttype, tid, result, newStatus, reason] of impacts) {
    await q(
      "INSERT INTO cascade_impacts (id,project_id,principle_version_id,change_type,target_type,target_id,impact_result,target_new_status,reason) VALUES ($1,$2,$3,'version_update',$4,$5,$6,$7,$8)",
      [P(id), PROJECT_ID, P("vp_space_v1"), ttype, tid, result, newStatus, reason],
    );
  }

  // ── Decision Lineage: Question → Principle → Version → Approval/Impact ──
  const lineage: [string, string, string, string, string, string, string | null][] = [
    ["ln_q_to_principle", "decision_question", P("q_decided"), "decided_into", "principle_version", P("vp_space_v1"), "U38"],
    ["ln_ref_to_principle", "visual_reference", P("ref_space"), "supports", "principle_version", P("vp_space_v1"), "U28"],
    ["ln_version_to_approval", "principle_version", P("vp_space_v1"), "approved_by", "approval", P("appr_dir"), "U38"],
    ["ln_version_to_impact", "principle_version", P("vp_space_v1"), "caused_impact", "cascade_impact", P("ci_shot_restale"), "U74"],
    ["ln_withdrawn", "principle_version", P("vp_tone_v1"), "approval_withdrawn", "approval", P("appr_prod_withdrawn"), "U86"],
  ];
  for (const [id, st, sid, rel, tt, tid, ev] of lineage) {
    await q(
      "INSERT INTO decision_lineage (id,project_id,source_type,source_id,relation,target_type,target_id,evidence_uid) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [P(id), PROJECT_ID, st, sid, rel, tt, tid, ev],
    );
  }

  console.log(`시드 완료 — projectId=${PROJECT_ID}`);
}

main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
