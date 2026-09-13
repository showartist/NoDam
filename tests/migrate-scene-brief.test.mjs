// migrateSceneBriefV1ToV2 단위 테스트.
// 실행: node --experimental-strip-types tests/migrate-scene-brief.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migrateSceneBriefV1ToV2 } from "../lib/migrate-scene-brief.ts";
import { SCENE_BRIEF_FIELDS } from "../lib/types.ts";

let checks = 0;
const eq = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (cond, label) => {
  assert.ok(cond, label);
  checks++;
};

// ── AUTO 매핑 ──────────────────────────────────────────────
{
  const v1 = {
    brief: [["scene_number", "SCENE 12", "candidate", ["U01"], "high", null]],
    intents: [],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  const mapped = v2.brief.find((r) => r[0] === "SCENE_NUMBER");
  eq(mapped, ["SCENE_NUMBER", "SCENE 12", "candidate", ["U01"], "high", null], "AUTO 매핑: 값 보존");
  eq(v2.legacy_fields, {}, "AUTO 매핑만 있으면 legacy_fields 비어야 함");
}

// ── MERGE: emotion_start/turn/end → EMOTIONAL_ARC ───────────
{
  const v1 = {
    brief: [
      ["emotion_start", "무심함", "candidate", ["U07"], "high", null],
      ["emotion_turn", "이름을 부르는 순간", "candidate", ["U07"], "high", null],
      ["emotion_end", "절제된 참음", "candidate", ["U07", "U08"], "high", null],
    ],
    intents: [],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  ok(v2.brief.filter((r) => r[0] === "EMOTIONAL_ARC").length === 1, "세 emotion 필드가 하나의 EMOTIONAL_ARC 로 병합됨");
  const row = v2.brief.find((r) => r[0] === "EMOTIONAL_ARC");
  eq(row[0], "EMOTIONAL_ARC", "병합 필드명");
  ok(row[1].includes("무심함") && row[1].includes("이름을 부르는 순간") && row[1].includes("절제된 참음"), "세 값 모두 보존");
  eq(row[3], ["U07", "U08"], "evidence 합집합 + 중복 제거");
}

// ── MERGE: camera_direction + rhythm → SHOOTING_STYLE ────────
{
  const v1 = {
    brief: [
      ["camera_direction", "고정 와이드", "candidate", ["U38"], "high", null],
      ["rhythm", "롱테이크", "candidate", ["U22"], "high", null],
    ],
    intents: [],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  const shootingStyleRows = v2.brief.filter((r) => r[0] === "SHOOTING_STYLE");
  eq(shootingStyleRows.length, 1, "camera_direction+rhythm 이 하나로 병합됨");
  ok(shootingStyleRows[0][1].includes("고정 와이드") && shootingStyleRows[0][1].includes("롱테이크"));
}

// ── 승인된 재해석 매핑 ─────────────────────────────────────
{
  const v1 = {
    brief: [
      ["props", "낡은 운동화", "candidate", ["U35"], "high", null],
      ["location_condition", "세트 제작", "candidate", ["U30"], "high", null],
      ["order_deadline", "화요일 발주", "candidate", ["U39"], "high", null],
    ],
    intents: [{ type: "key_object", text: "가방", source_field: "props", evidence: ["U35"] }],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  const fields = v2.brief.map((r) => r[0]);
  ok(fields.includes("KEY_OBJECT"), "props → KEY_OBJECT 승인된 매핑 적용");
  ok(fields.includes("SPACE_CONCEPT"), "location_condition → SPACE_CONCEPT 승인된 매핑 적용");
  ok(fields.includes("OPEN_QUESTIONS"), "order_deadline → OPEN_QUESTIONS 승인된 매핑 적용");
  eq(v2.intents[0].source_field, "KEY_OBJECT", "intents[].source_field 도 함께 재작성됨");
}

// ── 신규 v2 필드는 근거 없이 채워지지 않는다 ──────────────────
{
  const v1 = { brief: [["scene_number", "SCENE 1", "candidate", ["U01"], "high", null]], intents: [] };
  const v2 = migrateSceneBriefV1ToV2(v1);
  const dramaticIntent = v2.brief.find((r) => r[0] === "DRAMATIC_INTENT");
  const continuityCheck = v2.brief.find((r) => r[0] === "CONTINUITY_CHECK");
  const technicalChecklist = v2.brief.find((r) => r[0] === "TECHNICAL_CHECKLIST");
  ok(dramaticIntent, "DRAMATIC_INTENT 필드가 존재는 함");
  eq(dramaticIntent[1], "", "DRAMATIC_INTENT 값은 비어 있어야 함 — 지어내지 않음");
  eq(dramaticIntent[2], "uncertain", "근거 없는 필드는 uncertain 상태");
  ok(dramaticIntent[5].includes("대응 데이터 없음"), "근거 없음이 note 에 명시됨");
  ok(continuityCheck && continuityCheck[1] === "", "CONTINUITY_CHECK 도 동일하게 비어 있음");
  ok(technicalChecklist && technicalChecklist[1] === "", "TECHNICAL_CHECKLIST 도 동일하게 비어 있음 (v1 대응 없음)");
}

// ── 대응되지 않는 v1 필드는 legacy_fields 로 보존 ─────────────
{
  const v1 = {
    brief: [
      ["scene_number", "SCENE 1", "candidate", ["U01"], "high", null],
      ["completely_unknown_field", "알 수 없는 값", "candidate", ["U99"], "low", null],
    ],
    intents: [],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  ok(v2.legacy_fields.completely_unknown_field, "미대응 필드가 legacy_fields 에 보존됨");
  eq(v2.legacy_fields.completely_unknown_field[1], "알 수 없는 값", "legacy_fields 값이 원본 그대로 보존됨");
  ok(!v2.brief.some((r) => r[0] === "completely_unknown_field"), "미대응 필드가 brief 배열에는 들어가지 않음");
}

// ── migration_warnings 기록 ──────────────────────────────────
{
  const v1 = {
    brief: [
      ["scene_number", "SCENE 1", "candidate", ["U01"], "high", null],
      ["props", "소품", "candidate", ["U02"], "high", null],
      ["mystery_field", "값", "candidate", ["U03"], "low", null],
    ],
    intents: [],
  };
  const v2 = migrateSceneBriefV1ToV2(v1);
  ok(v2.migration_warnings.length > 0, "경고가 기록됨");
  ok(v2.migration_warnings.some((w) => w.includes("props") && w.includes("KEY_OBJECT")), "승인 매핑 경고 포함");
  ok(v2.migration_warnings.some((w) => w.includes("mystery_field") && w.includes("legacy_fields")), "미대응 필드 경고 포함");
}

// ── 원본 v1 객체는 변경되지 않는다 ────────────────────────────
{
  const v1 = { brief: [["scene_number", "SCENE 1", "candidate", ["U01"], "high", null]], intents: [] };
  const v1Copy = JSON.parse(JSON.stringify(v1));
  migrateSceneBriefV1ToV2(v1);
  eq(v1, v1Copy, "migrateSceneBriefV1ToV2 는 입력을 변형하지 않음(순수 함수)");
}

// ── 실제 fixture 전체 변환: SCENE_BRIEF_FIELDS 23개가 전부 결과에 존재해야 한다 ──
// (신규 v2 필드 하나를 NEW_FIELDS_NO_SOURCE 목록에 추가하는 걸 잊으면 조용히 누락된다 — 실제로 한 번 그랬다.)
for (const name of ["scene12_motel_room", "scene34_empty_pool"]) {
  const v1 = JSON.parse(readFileSync(new URL(`../fixtures/film/${name}.json`, import.meta.url)));
  const v2 = migrateSceneBriefV1ToV2(v1);
  const fields = new Set(v2.brief.map((r) => r[0]));
  for (const f of SCENE_BRIEF_FIELDS) {
    ok(fields.has(f), `${name}: v2 필드 ${f} 가 변환 결과에 존재해야 함`);
  }
  eq(Object.keys(v2.legacy_fields).length, 0, `${name}: 실제 fixture 는 legacy_fields 가 없어야 함 (모든 v1 필드가 매핑됨)`);
}

console.log(`migrateSceneBriefV1ToV2 단위 테스트 통과 — ${checks}개 항목`);
