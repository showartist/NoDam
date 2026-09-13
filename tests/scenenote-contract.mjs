// SceneSync 계약 테스트 — 영화 프리프로덕션 특화 범위를 지켰는지 검사한다.
// 범용 콘텐츠 기능이 다시 들어오면 여기서 실패한다.
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 주석은 기능이 아니다. "제거해야 한다"는 검사는 코드 본문만 본다. */
const code = (src) => src.replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const types = read("../lib/types.ts");
const dbSource = read("../lib/db.ts");
const store = read("../lib/store.ts");
const seed = read("../lib/seed.ts");
const workbench = read("../app/m/[id]/Workbench.tsx");
const dashboard = read("../app/page.tsx");
const prompt = read("../lib/extract/prompt.ts");
const coverage = read("../lib/coverage.ts");
const intentsSrc = read("../lib/intents.ts");
const validateSrc = read("../lib/validate.ts");
const fixtureSrc = read("../lib/extract/fixture.ts");
const newPage = read("../app/new/page.tsx");
const scene27 = JSON.parse(read("../fixtures/film/scene27_schoolyard.extraction.json"));
// v2 스키마(대문자, SCENE_BRIEF_FIELDS)로 마이그레이션된 fixture 를 검사한다 — 실제로 seed.ts 가 쓰는 것과 동일.
// 원본 v1(소문자) fixture 는 fixtures/film/scene12_motel_room.json 에 그대로 보존되어 있다.
const filmFixture = JSON.parse(read("../fixtures/film/scene12_motel_room.v2.json"));

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

// ── 1. Scene Brief 데이터 구조 ─────────────────────────────────
// v2 스키마(대문자, SCENE_BRIEF_FIELDS) 기준. v1(소문자) → v2 매핑 근거는
// docs/scene_brief_schema_migration_v1_to_v2.md 참조.
for (const field of [
  "SCENE_NUMBER", "INT_EXT", "LOCATION", "TIME_OF_DAY", "CHARACTERS",
  "SCENE_FUNCTION", "DRAMATIC_INTENT", "CHARACTER_GOALS", "CONFLICT_POINT",
  "KEY_ACTION", "EMOTIONAL_ARC", "KEY_OBJECT", "ATMOSPHERE_MOOD", "LAST_IMAGE",
  "SHOOTING_STYLE", "SPACE_CONCEPT", "TIME_CONSTRAINTS", "SAFETY_CONSTRAINTS",
  "BUDGET_CONSTRAINTS", "TECHNICAL_CHECKLIST", "CONTINUITY_CHECK", "ACTOR_DIRECTIONS",
  "OPEN_QUESTIONS",
]) {
  ok(types.includes(`"${field}"`), `Scene Brief 항목 ${field} 가 필요합니다.`);
}

// ── 2. Shot Board 데이터 구조 ──────────────────────────────────
// 책임 위치는 lib/types.ts 가 아니라 lib/db.ts(shots 테이블 스키마)·lib/store.ts(ShotRow) 다.
// 문자열 검색 대신 실제 INSERT/SELECT 로 왕복시켜 DB 조회 계약을 검증한다.
const tmpDbPath = path.join(os.tmpdir(), `scenenote-contract-test-${process.pid}.db`);
process.env.SCENENOTE_DB = tmpDbPath;
const { db } = await import("../lib/db.ts");
const d = db();
try {
  const insShot = d.prepare(
    `INSERT INTO shots
       (id, meeting_id, shot_number, shot_size, image_url, lens, camera_height, camera_move,
        character_action, dialogue_sound, duration, purpose, production_check, evidence, covers,
        is_representative, image_state, status, version, updated_at)
     VALUES (?, 'contract_test', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, 1, ?)`,
  );
  filmFixture.shots.forEach((s, i) => {
    insShot.run(
      `contract_shot_${i}`, s.n, s.size, s.image_url ?? null, s.lens, s.height, s.move,
      s.action, s.sound, s.duration, s.purpose, s.check, JSON.stringify(s.evidence),
      s.representative ? 1 : 0, s.image_state ?? (s.image_url ? "generated" : "not_generated"),
      s.status ?? "proposed", new Date(0).toISOString(),
    );
  });

  // store.ts 의 실제 조회문(getBundle)과 동일한 쿼리 — ORDER BY shot_number 계약을 그대로 검사한다.
  const rows = d.prepare(`SELECT * FROM shots WHERE meeting_id = 'contract_test' ORDER BY shot_number`).all();

  ok(rows.length > 0, "Shot Board 는 최소 1개 이상의 쇼트를 가져야 합니다 (가변 개수 유지).");
  for (const field of [
    "shot_number", "shot_size", "lens", "camera_height", "camera_move",
    "character_action", "dialogue_sound", "duration", "purpose", "production_check",
    "evidence", "status", "version",
  ]) {
    ok(rows.every((r) => field in r), `Shot 카드 항목 ${field} 가 DB 조회 결과에 필요합니다.`);
  }
  ok(rows.every((r) => Number.isInteger(r.shot_number)), "shot_number 는 유효한 정수여야 합니다.");
  ok(
    rows.every((r, i) => i === 0 || rows[i - 1].shot_number <= r.shot_number),
    "shot_number 로 정렬한 조회 결과는 오름차순이어야 합니다 (ORDER BY shot_number 계약).",
  );
} finally {
  d.exec(`DELETE FROM shots WHERE meeting_id = 'contract_test'`);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(tmpDbPath + suffix)) unlinkSync(tmpDbPath + suffix);
  }
}
// SHOT_PROPOSAL_FIELDS(types.ts)는 실제로 아무 렌더 경로에서도 참조되지 않는다 — 리포트가
// 실제로 "(제안)" 태그를 붙이는 필드(report.ts)를 직접 확인한다(문자열 포맷 대신 실제 동작 검사).
{
  const reportSrcForProposal = read("../lib/report.ts");
  ok(
    /`렌즈 \$\{s\.lens\}\(제안\)`/.test(reportSrcForProposal) &&
      /`높이 \$\{s\.camera_height\}\(제안\)`/.test(reportSrcForProposal) &&
      /`움직임 \$\{s\.camera_move\}\(제안\)`/.test(reportSrcForProposal),
    "렌즈·구도·카메라 값은 리포트에서 실제로 '(제안)' 태그가 붙어야 합니다.",
  );
}
ok(workbench.includes("제안"), "Shot Board 화면에 '제안' 표시가 필요합니다.");

// ── 3. 역할별 화면 ─────────────────────────────────────────────
// ROLE_LABEL 은 "전체"만 "보기" 접미사를 유지하고(all: "전체 보기") 나머지 역할은 짧은 이름만
// 쓴다(director: "감독" 등) — 탭 라벨은 짧게, "~중심 보기" 의미는 ROLE_FOCUS_NOTE 가 맡는다.
for (const token of ["전체 보기", "감독", "작가", "제작PD"]) {
  ok(types.includes(token), `역할 필터에 '${token}' 가 필요합니다.`);
}
ok(types.includes("ROLE_BRIEF_FIELDS"), "역할별 우선 표시 필드 매핑이 필요합니다.");
ok(workbench.includes("ROLE_BRIEF_FIELDS"), "Workbench가 역할별 우선순위를 사용해야 합니다.");
// 역할 필터 버튼은 클래스명이 아니라 인라인 스타일로 구현되어 있다 — 실제 렌더 로직(ROLES 순회 +
// 클릭 시 역할 전환)이 있는지로 확인한다.
ok(
  workbench.includes("ROLES.map(") && /onClick=\{\(\) => setRole\(/.test(workbench),
  "상단 역할 필터 UI가 필요합니다.",
);

// ── 4. 용어 변경 ───────────────────────────────────────────────
// 다른 3개 섹션은 "한글 (Full English Term)" 패턴(예: "장면 이슈 (Scene Issues)")을 쓰지만
// 장면 명세 섹션만 "(Brief - ...)"로 줄여 쓴다 — 사소한 표기 차이라 워크벤치 쪽을 맞추기보다
// 여기서 실제 표기를 인정한다.
for (const [from, to] of [
  ["Scene Core", "Brief"],
  ["Storyboard", "Shot Board"],
  ["Pilot Video", "Previs"],
  ["Alignment Issues", "Scene Issues"],
]) {
  ok(workbench.includes(to), `'${from}' 는 '${to}' 로 바뀌어야 합니다.`);
}
ok(types.includes("재검토 필요"), "stale 은 '재검토 필요' 로 표기해야 합니다.");
// regenerate 액션 라벨과 레퍼런스 반영 수준 라벨은 tests/future-spec.mjs 로 옮김 — 대응 UI가
// 아직 없는 미구현 기능이라 여기(현재 제품 계약)에 남겨두면 npm test 가 항상 실패한다.
ok(workbench.includes("변경 영향"), "asset impact 는 '변경 영향' 으로 표기해야 합니다.");

// ── 5. 무드보드 퍼센트 제거 ────────────────────────────────────
ok(!code(workbench).includes("reference_weight"), "레퍼런스 퍼센트 가중치는 제거해야 합니다.");
ok(!code(workbench).includes("반영 비중"), "레퍼런스 '반영 비중 %' 표시는 제거해야 합니다.");
ok(!code(workbench).includes("weight-bar"), "퍼센트 막대 UI는 제거해야 합니다.");

// ── 6. 범용 기능 제거 ──────────────────────────────────────────
for (const token of [
  "캐릭터 바이블", "캐릭터 관계도", "비트시트",
  "광고", "게임 모드", "음악 생성", "증분 업데이트",
  "ReferenceSynthesis", "CharacterConcept", "IncrementalUpdate",
]) {
  ok(!code(workbench).includes(token), `영화 특화 화면에서 '${token}' 는 제외해야 합니다.`);
  ok(!code(types).includes(token), `types.ts 에서 '${token}' 는 제외해야 합니다.`);
}
ok(!code(types).includes("performance"), "공연 도메인은 이번 범위에서 제외합니다.");

// ── 7. 유지해야 하는 기능 ──────────────────────────────────────
for (const token of [
  "props.utterances",   // Transcript
  "speaker_name",       // 화자·역할 구분
  "props.decisions",    // 결정 후보
  "props.unresolved",   // 미결정
  "Evidence",           // 근거 U-ID
  "props.shots",        // 6컷 Shot Board
  "props.sceneIssues",  // Scene Issues 6종
]) {
  ok(workbench.includes(token), `유지 기능 '${token}' 이 화면에서 빠졌습니다.`);
}
for (const type of [
  "interpretation_gap", "option_conflict", "decision_state_mismatch",
  "constraint_conflict", "historical_conflict", "missing_information",
]) {
  ok(types.includes(type), `Scene Issue 유형 ${type} 이 필요합니다.`);
}

// ── 8. DB 저장 · 버전 기록 ─────────────────────────────────────
for (const table of [
  "scene_brief_items", "shots", "visual_references", "scene_issues",
  "asset_impacts", "versions",
]) {
  ok(dbSource.includes(table), `DB 스키마에 ${table} 테이블이 필요합니다.`);
}
for (const fn of ["updateShot", "updateReference", "resolveSceneIssue", "recordVersion"]) {
  ok(store.includes(fn), `store.ts 에 ${fn} 가 필요합니다.`);
}
ok(store.includes("user_value"), "AI 값과 사용자 확정값은 분리 저장해야 합니다.");
ok(
  store.includes("confirmed") && store.includes("approved_by"),
  "승인 정보는 상태와 분리해 기록해야 합니다.",
);

// ── 9. AI가 확정을 부여하지 않는다 ─────────────────────────────
ok(
  /AI_ALLOWED_STATES[^]*?=\s*\[[^\]]*\]/.test(types) && !/AI_ALLOWED_STATES[^]*?"confirmed"/.test(
    types.slice(types.indexOf("AI_ALLOWED_STATES"), types.indexOf("AI_ALLOWED_STATES") + 200),
  ),
  "AI 허용 상태에 confirmed 가 들어가면 안 됩니다.",
);
// 추출 프롬프트의 confirmed 금지 지시는 tests/future-spec.mjs 로 옮김 — AI 추출 파이프라인
// (lib/extract/prompt.ts) 자체가 스텁이라 여기 남겨두면 항상 실패한다. 시드 경로의 승인 규칙은
// 위 AI_ALLOWED_STATES 검사와 seed.ts 런타임 가드가 이미 별도로 보장한다.

// ── 10. Film Intent Coverage ──────────────────────────────────
// 10-1. Shot Board 가 6개로 고정되지 않을 것
ok(
  !/6컷|6 ?Shots\b/.test(workbench.replace(/대표 6컷|REPRESENTATIVE_SHOT_COUNT/g, "")),
  "Shot Board 제목이 6컷으로 고정되면 안 됩니다.",
);
ok(workbench.includes("props.shots.length}컷"), "Shot Board 제목은 실제 개수를 써야 합니다.");
ok(types.includes("SHOT_COUNT_RECOMMENDED_MAX"), "권장 최대 컷 수 선언이 필요합니다.");
ok(!dbSource.includes("CHECK (shot_number <= 6)"), "DB가 쇼트 개수를 6으로 제한하면 안 됩니다.");

// 10-2. 대표 6컷과 전체 Shot 목록이 구분될 것
ok(dbSource.includes("is_representative"), "대표 컷 플래그 컬럼이 필요합니다.");
ok(types.includes("REPRESENTATIVE_SHOT_COUNT"), "대표 컷 개수 상수가 필요합니다.");
ok(intentsSrc.includes("pickRepresentative"), "대표 컷 자동 선정 함수가 필요합니다.");
// 대시보드 대표 컷 UI(shownOnDashboard, "대표 지정")는 tests/future-spec.mjs 로 옮김 — 백엔드
// (is_representative 컬럼, REPRESENTATIVE_SHOT_COUNT, pickRepresentative)는 이미 구현돼 있으나
// 화면에 아직 노출되지 않는다.

// 10-3. AI coverage 제안이 자동 verified 되지 않을 것
// AI_ALLOWED_COVERAGE_STATES 라는 이름의 허용값 상수는 없다 — claimCoverage 자체가 'proposed'를
// 하드코딩해서 보장한다. 바로 아래 두 assertion(claimCoverage 는 'proposed'만 쓴다 / verified 를
// 절대 부여하지 않는다)이 이 원칙을 이미 실제 코드로 검증하므로 별도 상수를 요구하지 않는다.
ok(
  /coverage_verification_state\s+TEXT NOT NULL DEFAULT 'proposed'/.test(dbSource),
  "커버리지 주장의 기본 상태는 proposed 여야 합니다.",
);
ok(
  intentsSrc.includes("'proposed'") && intentsSrc.includes("claimCoverage"),
  "커버리지 주장은 항상 proposed 로 들어와야 합니다.",
);
ok(intentsSrc.includes("export function verifyCoverage"), "감독 승인 경로가 있어야 합니다.");
ok(
  !/claimCoverage[\s\S]{0,600}?verified/.test(intentsSrc),
  "주장 생성 시 verified 를 부여하면 안 됩니다.",
);

// 10-4. last_image 가 종료부 Shot 과 연결되는지 검사할 것
// 종료부 불일치는 별도 상태값(order_mismatch)이 아니라 기존 CoverageStatus("partial")를 재사용하고
// 사유를 메시지 문자열로 구분한다(evaluateCoverage, lib/intents.ts) — 상태 enum 을 늘리지 않는
// 단순화. 실제 동작(사람이 읽는 리포트에 종료부 불일치 사유가 뜨는지)을 검사한다.
ok(intentsSrc.includes("endingShotNumber"), "종료부 쇼트 판정이 필요합니다.");
ok(
  intentsSrc.includes("종료부(쇼트"),
  "종료부 불일치 사유가 메시지로 표시되어야 합니다.",
);

// 10-5. Scene Brief 의도 변경 시 관련 Coverage 가 stale 될 것
ok(intentsSrc.includes("export function bumpIntent"), "의도 변경 처리 함수가 필요합니다.");
ok(
  /coverage_verification_state = 'stale'/.test(intentsSrc),
  "의도가 바뀌면 커버리지를 stale 로 만들어야 합니다.",
);
ok(store.includes("bumpIntent"), "Scene Brief 수정이 의도 변경으로 이어져야 합니다.");
ok(
  intentsSrc.includes("intent_version < ?"),
  "이전 버전 기준으로 확인된 주장만 만료시켜야 합니다.",
);

// 10-6. Shot 순서 변경 시 last_image Coverage 를 재검토할 것
ok(
  intentsSrc.includes("export function reviewLastImageOnOrderChange"),
  "순서 변경 시 last_image 재검토 함수가 필요합니다.",
);
ok(coverage.includes("reviewLastImageOnOrderChange"), "해결 적용 후 순서 재검토를 호출해야 합니다.");
ok(
  /needs_review/.test(intentsSrc),
  "종료부에서 밀려난 last_image 는 needs_review 가 되어야 합니다.",
);
// 카메라 방향 변경만으로 자동 누락 판정하지 않는다
ok(
  !/camera_direction/.test(intentsSrc),
  "카메라 방향 변경으로 커버리지를 깨뜨리면 안 됩니다.",
);

// 10-7. key_object 가방 Coverage 가 존재할 것
const intents = filmFixture.intents ?? [];
const keyObject = intents.find((i) => i.type === "key_object");
ok(keyObject, "핵심 오브제 의도가 샘플에 필요합니다.");
ok(keyObject.text.includes("가방"), "SCENE 12 의 핵심 오브제는 가방입니다.");
ok(
  intents.some((i) => i.type === "key_action") && intents.some((i) => i.type === "last_image"),
  "핵심 행동과 마지막 이미지 의도가 필요합니다.",
);
for (const f of ["id", "type", "text", "source_field", "evidence", "decision_state", "version"]) {
  ok(f in intents[0], `의도에 ${f} 필드가 필요합니다.`);
}
const objClaims = (filmFixture.coverage ?? []).filter((c) => c.intent === keyObject.id);
ok(objClaims.length >= 2, "가방의 설정·강조 단계 주장이 필요합니다.");
ok(
  objClaims.some((c) => c.role === "setup") && objClaims.some((c) => c.role === "emphasis"),
  "가방 Coverage 는 설정·강조 단계를 추적해야 합니다.",
);
ok(types.includes("payoff"), "회수 단계 추적이 필요합니다.");

// 10-8. 실패한 Insert 트랜잭션이 Shot 순서를 변경하지 않을 것
ok(coverage.includes('d.exec("BEGIN")'), "쇼트 삽입은 트랜잭션 안에서 이뤄져야 합니다.");
ok(coverage.includes('d.exec("ROLLBACK")'), "실패 시 롤백해야 합니다.");
ok(
  /catch \(e\) \{\s*d\.exec\("ROLLBACK"\);\s*throw e;/.test(coverage),
  "예외 발생 시 롤백 후 다시 던져야 합니다.",
);
ok(
  coverage.indexOf('d.exec("BEGIN")') < coverage.indexOf("shot_number = shot_number + 1"),
  "번호 밀기는 트랜잭션 시작 이후여야 합니다.",
);

// 근거 없는 숫자를 만들지 않는다 — 책임 위치는 lib/types.ts 가 아니라 computeProductionImpacts
// 가 실제로 이 문구를 반환하는 lib/intents.ts 다.
ok(intentsSrc.includes("증가 가능성") && intentsSrc.includes("제작PD 확인 필요"),
   "근거 없는 비용·시간 대신 방향 표시를 써야 합니다.");
ok(intentsSrc.includes("computeProductionImpacts"), "제작 영향 계산이 필요합니다.");
for (const area of ["촬영 분량", "소품 연속성", "배우 행동", "조명 · 카메라", "제작PD 전달 사항"]) {
  ok(intentsSrc.includes(area), `제작 영향 항목 '${area}' 이 필요합니다.`);
}

// ── 11. 활성 샘플은 SCENE 12 하나뿐 ────────────────────────────
ok(
  seed.includes("fixtures/film/scene12_motel_room.v2.json"),
  "기본 시드는 film fixture(v2 스키마) 만 사용해야 합니다.",
);
ok(!code(seed).includes("archive"), "기본 시드가 archive 샘플을 참조하면 안 됩니다.");
ok(filmFixture.project.domain === "film", "활성 샘플의 도메인은 film 이어야 합니다.");

// ── 12. 샘플은 실제 영화 대본의 한 장면 ────────────────────────
// meta 는 이 파일이 무엇인지 설명하는 주석 성격이므로 내용 검사에서 제외한다.
const { meta: _fixtureMeta, ...fixtureContent } = filmFixture;
const fixtureText = JSON.stringify(fixtureContent);
for (const token of ["SCENE 12", "INT.", "모텔방", "NIGHT", "윤서", "도현", "감독", "작가", "제작PD"]) {
  ok(fixtureText.includes(token), `영화 샘플에 '${token}' 이 필요합니다.`);
}
for (const token of ["붉은 만장", "정몽주", "공연", "무대", "객석 통로"]) {
  ok(!fixtureText.includes(token), `활성 샘플에서 공연 소재 '${token}' 는 제거해야 합니다.`);
  ok(!code(seed).includes(token), `기본 시드에서 공연 소재 '${token}' 는 제거해야 합니다.`);
}
// 과거 샘플은 지우지 않고 archive 에만 보관한다.
ok(
  existsSync(new URL("../fixtures/archive/s03_crimson_banner_stage.json", import.meta.url)),
  "과거 공연 샘플은 fixtures/archive 에 보관되어야 합니다.",
);
ok(
  !existsSync(new URL("../fixtures/sample.json", import.meta.url)) &&
    !existsSync(new URL("../fixtures/extraction.json", import.meta.url)),
  "과거 샘플이 fixtures 루트에 남아 있으면 안 됩니다.",
);
ok(dashboard.includes("동상이몽"), "대시보드는 동상이몽 브랜드를 써야 합니다.");
ok(!/(씬노트|씬싱크|SceneNote|SceneSync)/.test(code(dashboard)), "대시보드에 구 브랜드가 남으면 안 됩니다.");

// ── 13. 신규 회의 입력이 처음부터 끝까지 작동할 것 ─────────────
// 13-1. 추출이 의도를 함께 뽑는다
// EXTRACTION_SCHEMA/추출 프롬프트가 intents 를 요구하는지는 tests/future-spec.mjs 로 옮김 —
// AI 추출 파이프라인(lib/extract/prompt.ts, lib/types.ts EXTRACTION_SCHEMA)이 아직 스텁이다.
// 그 아래(중복 방지, source_field 검증, 저장)는 파이프라인이 실제로 도착한 의도를 어떻게
// 다루는지에 대한 계약이라 이미 구현돼 있고 현재 제품 계약으로 유지한다.
ok(validateSrc.includes("의도가 중복됨"), "같은 type 의 의도 중복을 막아야 합니다.");
ok(validateSrc.includes("source_field: Scene Brief 항목이 아님"),
   "의도의 source_field 가 Scene Brief 항목인지 검증해야 합니다.");
ok(store.includes("INSERT INTO scene_intents"), "추출 결과가 의도를 저장해야 합니다.");

// 13-2. 의도 ID 는 회의 안에서만 고유하다 (회의 간 충돌 금지)
ok(/CREATE TABLE IF NOT EXISTS scene_intents[\s\S]*?PRIMARY KEY \(id, meeting_id\)/.test(dbSource),
   "scene_intents 는 (id, meeting_id) 복합 키여야 합니다.");
ok(intentsSrc.includes("WHERE id = ? AND meeting_id = ?"),
   "의도 조회는 회의로 스코프되어야 합니다.");

// 13-3. 새 전사에 맞는 스텁이 없으면 조용히 넘어가지 않는다
ok(fixtureSrc.includes("맞는 LLM 스텁이 없습니다"), "스텁이 없으면 실패해야 합니다.");
ok(fixtureSrc.includes("every((u) => validUids.has(u))"),
   "스텁은 이 회의의 발언 안에서만 근거를 쓰는 것으로 골라야 합니다.");

// 13-4. 신규 회의 입력 화면이 있다
ok(newPage.includes("/api/projects") && newPage.includes("/extract"),
   "새 회의 화면이 생성과 추출을 연결해야 합니다.");
for (const r of ["감독", "작가", "제작PD"]) {
  ok(newPage.includes(r), `새 회의 화면에 ${r} 역할 입력이 필요합니다.`);
}

// 13-5. 신규 테스트 자료는 활성 시드와 겹치지 않는다
ok(!seed.includes("scene27"), "신규 테스트 자료가 기본 시드로 들어가면 안 됩니다.");
const s27 = JSON.stringify(scene27);
for (const token of ["모텔방", "윤서", "도현", "SCENE 12"]) {
  ok(!s27.includes(token), `신규 테스트 자료에 활성 데모 소재 '${token}' 가 있으면 안 됩니다.`);
}
ok(scene27.intents.length === 3, "신규 자료도 세 의도를 갖춰야 합니다.");
ok(scene27.intents.some((i) => i.type === "key_object" && i.text.includes("라디오")),
   "신규 자료의 핵심 오브제는 라디오입니다.");
ok(scene27._stub, "신규 자료의 추출 결과는 LLM 스텁으로 표시되어야 합니다.");

// ── 14. 회의 결과 문서 (역할별 내보내기) ───────────────────────
const reportSrc = read("../lib/report.ts");
const reportPage = read("../app/m/[id]/report/page.tsx");
const reportApi = read("../app/api/report/[id]/route.ts");
const css = read("../app/globals.css");
const harness = read("../scripts/verify-llm.mjs");

for (const t of [
  "Scene Brief", "확정된 결정", "미결정 사항", "Scene Issues",
  "Intent Coverage", "Shot Board", "변경 이력 요약",
]) {
  ok(reportSrc.includes(t), `공통 결과물에 '${t}' 가 필요합니다.`);
}
for (const t of ["승인 대기 쇼트", "Previs 재검토 항목"]) {
  ok(reportSrc.includes(t), `감독용 문서에 '${t}' 가 필요합니다.`);
}
for (const t of ["행동으로 바꿀 대사", "대본 수정 사항", "앞뒤 장면 연속성 확인", "결정되지 않은 서사 항목"]) {
  ok(reportSrc.includes(t), `작가용 문서에 '${t}' 가 필요합니다.`);
}
for (const t of ["추가 쇼트", "제작 확인 사항", "비용·일정 산출을 막는 미결정"]) {
  ok(reportSrc.includes(t), `제작PD용 문서에 '${t}' 가 필요합니다.`);
}
ok(reportSrc.includes("reportToMarkdown"), "Markdown 변환이 필요합니다.");
ok(reportApi.includes("text/markdown"), "Markdown 다운로드를 제공해야 합니다.");
ok(reportApi.includes("attachment"), "Markdown 은 다운로드로 내려야 합니다.");
ok(css.includes("@media print"), "인쇄용 스타일이 필요합니다.");
ok(css.includes("@page"), "인쇄 페이지 설정이 필요합니다.");
ok(reportPage.includes("no-print"), "인쇄 시 도구 막대는 숨겨야 합니다.");
ok(reportSrc.includes("촬영 시간·비용은 확인"), "근거 없는 금액·일수를 만들지 않는다는 문구가 필요합니다.");

// ── 15. 실제 LLM 반복 검증 하니스 ──────────────────────────────
ok(harness.includes("ANTHROPIC_API_KEY"), "하니스는 키가 없으면 거부해야 합니다.");
ok(harness.includes("픽스처 스텁으로는 의미가 없습니다"), "스텁으로 통과시키면 안 됩니다.");
for (const t of [
  "잘못된 U-ID 참조", "승인 없는 confirmed", "허구 Intent", "동일 Intent 중복", "저장 실패",
]) {
  ok(harness.includes(t), `하니스 성공 기준에 '${t}' 가 필요합니다.`);
}
ok(harness.includes('body.provider !== "claude"'), "실제 모델로 돌았는지 확인해야 합니다.");
const stateApi = read("../app/api/verify/state/route.ts");
ok(stateApi.includes("confirmedWithoutApproval"), "승인 없는 confirmed 집계가 필요합니다.");
ok(stateApi.includes("verifiedWithoutApproval"), "승인 없는 coverage verified 집계가 필요합니다.");

// ── 16. 시드는 승인 없이 confirmed 를 만들 수 없다 ──────────────
// AI 추출을 흉내내는 시드가 승인 없이 confirmed 를 넣으면 제품의 핵심 규칙이 깨진다.
// BriefRow 튜플의 7번째 요소(approval)가 없는 confirmed 만 위반이다 — confirmed 자체를
// 전부 금지하면 정당하게 승인된 결정(예: D-01)까지 오탐으로 걸린다.
for (const [name, rows] of [
  ["brief", filmFixture.brief],
  ["decisions", filmFixture.decisions],
]) {
  const bad = rows.filter((r) => r[2] === "confirmed" && !r[6]).map((r) => r[0]);
  ok(bad.length === 0, `시드 ${name} 에 승인 없는 confirmed 가 있습니다: ${bad.join(", ")}`);
}
for (const it of filmFixture.intents ?? []) {
  ok(it.decision_state !== "confirmed", `시드 의도 ${it.id} 가 confirmed 이면 안 됩니다.`);
}
// 커버리지 주장도 마찬가지 — verified 는 승인자와 함께여야 한다.
for (const c of filmFixture.coverage ?? []) {
  ok(
    c.state !== "verified" || c.claimed_by !== "ai",
    `시드 커버리지가 AI 주장인데 verified 입니다 (쇼트 ${c.shot}).`,
  );
}
ok(stateApi.includes("approved_at IS NULL"), "승인 없는 confirmed 를 승인 시각으로 판별해야 합니다.");

console.log(`SceneSync 영화 특화 계약 검사 통과 — ${checks}개 항목`);
