// Scene Brief v1(소문자, 구세대) → v2(대문자, lib/types.ts SCENE_BRIEF_FIELDS) 변환기.
// 근거: docs/scene_brief_schema_migration_v1_to_v2.md (매핑표, 승인 내역)
//
// 원본 v1 fixture 는 건드리지 않는다. 이 함수는 입력을 복사해 새 객체를 반환한다.
// 대응 근거가 없는 v2 필드에는 절대 내용을 지어내지 않는다 — legacy_fields 로 보존하거나 비운다.

export type BriefRow = [
  field: string,
  value: string,
  state: string,
  evidence: string[],
  confidence: string,
  note: string | null,
];

export type V1IntentFixture = {
  id?: string;
  type: string;
  text: string;
  source_field: string;
  evidence: string[];
};

export type V1Fixture = {
  brief: BriefRow[];
  intents?: V1IntentFixture[];
  [key: string]: unknown;
};

export type V2Fixture = Omit<V1Fixture, "brief" | "intents"> & {
  brief: BriefRow[];
  intents?: V1IntentFixture[];
  legacy_fields: Record<string, BriefRow>;
  migration_warnings: string[];
};

const MISSING_INFO_NOTE = "v1→v2 마이그레이션: 대응 데이터 없음";

// AUTO — 1:1 rename, 재해석 없음.
const AUTO_MAP: Record<string, string> = {
  scene_number: "SCENE_NUMBER",
  int_ext: "INT_EXT",
  location: "LOCATION",
  day_night: "TIME_OF_DAY",
  key_action: "KEY_ACTION",
  conflict: "CONFLICT_POINT",
};

// NEEDS APPROVAL — 승인된 매핑 (docs/scene_brief_schema_migration_v1_to_v2.md 승인 내역 반영).
const APPROVED_MAP: Record<string, string> = {
  props: "KEY_OBJECT",
  acting_direction: "ACTOR_DIRECTIONS",
  color: "ATMOSPHERE_MOOD",
  location_condition: "SPACE_CONCEPT",
  cast_count: "CHARACTERS",
  shoot_hours: "TIME_CONSTRAINTS",
  shoot_time: "TIME_CONSTRAINTS",
  cost: "BUDGET_CONSTRAINTS",
  cost_impact: "BUDGET_CONSTRAINTS",
  order_deadline: "OPEN_QUESTIONS",
  scene_unresolved: "OPEN_QUESTIONS",
  scene_function: "SCENE_FUNCTION",
  character_goals: "CHARACTER_GOALS",
  last_image: "LAST_IMAGE",
  safety: "SAFETY_CONSTRAINTS",
};

// MERGE — 여러 v1 필드를 하나의 v2 필드로. 값은 라벨을 붙여 손실 없이 결합한다.
const MERGE_GROUPS: { v2: string; parts: { field: string; label: string }[] }[] = [
  {
    v2: "EMOTIONAL_ARC",
    parts: [
      { field: "emotion_start", label: "시작" },
      { field: "emotion_turn", label: "전환" },
      { field: "emotion_end", label: "종결" },
    ],
  },
  {
    v2: "SHOOTING_STYLE",
    parts: [
      { field: "camera_direction", label: "카메라" },
      { field: "rhythm", label: "리듬" },
    ],
  },
];

// v1 대응이 전혀 없는 v2 신규 필드. 항상 비운다 — 근거 없는 내용을 만들지 않는다.
// TECHNICAL_CHECKLIST 는 location_condition/order_deadline 의 대안 후보였으나 승인되지 않아 여기 포함.
const NEW_FIELDS_NO_SOURCE = ["DRAMATIC_INTENT", "TECHNICAL_CHECKLIST", "CONTINUITY_CHECK"];

function dedupeEvidence(evidence: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const arr of evidence) {
    for (const e of arr) {
      if (!seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
  }
  return out;
}

export function migrateSceneBriefV1ToV2(v1: V1Fixture): V2Fixture {
  const warnings: string[] = [];
  const byField = new Map<string, BriefRow>();
  for (const row of v1.brief) byField.set(row[0], row);

  const consumed = new Set<string>();
  const brief: BriefRow[] = [];
  const legacy_fields: Record<string, BriefRow> = {};

  for (const [v1Field, v2Field] of Object.entries(AUTO_MAP)) {
    const row = byField.get(v1Field);
    if (!row) continue;
    consumed.add(v1Field);
    brief.push([v2Field, row[1], row[2], row[3], row[4], row[5]]);
  }

  for (const [v1Field, v2Field] of Object.entries(APPROVED_MAP)) {
    const row = byField.get(v1Field);
    if (!row) continue;
    consumed.add(v1Field);
    brief.push([v2Field, row[1], row[2], row[3], row[4], row[5]]);
    warnings.push(`승인된 재해석 매핑 적용: ${v1Field} → ${v2Field}`);
  }

  for (const group of MERGE_GROUPS) {
    const rows = group.parts
      .map((p) => ({ ...p, row: byField.get(p.field) }))
      .filter((p): p is { field: string; label: string; row: BriefRow } => !!p.row);
    if (rows.length === 0) continue;
    for (const r of rows) consumed.add(r.field);
    const value = rows.map((r) => `[${r.label}] ${r.row[1]}`).join(" ");
    const evidence = dedupeEvidence(rows.map((r) => r.row[3]));
    // state/confidence 는 병합된 필드 중 가장 보수적인 값을 취한다 (uncertain > candidate > confirmed 순으로 낮춰잡지 않고,
    // 기존 값 중 하나를 대표로 쓰되 note 에 병합 출처를 남긴다).
    const rep = rows[0].row;
    const mergedNote = [rep[5], `병합: ${rows.map((r) => r.field).join(" + ")} → ${group.v2}`]
      .filter(Boolean)
      .join(" / ");
    brief.push([group.v2, value, rep[2], evidence, rep[4], mergedNote]);
    warnings.push(`필드 병합: ${rows.map((r) => r.field).join(" + ")} → ${group.v2} (값 라벨 결합, evidence 합집합)`);
  }

  for (const field of NEW_FIELDS_NO_SOURCE) {
    brief.push([field, "", "uncertain", [], "low", MISSING_INFO_NOTE]);
    warnings.push(`신규 v2 필드 ${field} — v1 대응 데이터 없음, 비워둠`);
  }

  for (const [v1Field, row] of byField.entries()) {
    if (!consumed.has(v1Field)) {
      legacy_fields[v1Field] = row;
      warnings.push(`대응되지 않은 v1 필드 ${v1Field} — legacy_fields 로 보존`);
    }
  }

  const sourceFieldMap: Record<string, string> = { ...AUTO_MAP, ...APPROVED_MAP };
  const intents = (v1.intents ?? []).map((it) => {
    const mapped = sourceFieldMap[it.source_field];
    if (!mapped) {
      warnings.push(`의도 ${it.type} 의 source_field "${it.source_field}" 를 v2 로 매핑하지 못함 — 원본 유지`);
      return it;
    }
    return { ...it, source_field: mapped };
  });

  const { brief: _b, intents: _i, ...rest } = v1;
  return { ...rest, brief, intents, legacy_fields, migration_warnings: warnings };
}
