import { evaluateCascadingStale, type ProjectChange, type SceneTarget } from "./cascading";

function assertEqual(actual: any, expected: any, testName: string) {
  if (actual === expected) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} — Expected: ${expected}, Got: ${actual}`);
    process.exit(1);
  }
}

function assertTrue(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName} — Condition evaluated to false`);
    process.exit(1);
  }
}

console.log("🧪 Running Selective Cascading Stale Engine Contract Tests...\n");

// 샘플 장면 2종 정의
const scenes: SceneTarget[] = [
  {
    scene_id: "m_01",
    scene_number: "SCENE 12",
    title: "INT. 모텔방 – NIGHT",
    characters: ["민규", "지훈"], // 수현 미등장
    status: "approved",
  },
  {
    scene_id: "m_02",
    scene_number: "SCENE 34",
    title: "INT. 폐쇄된 실내수영장 – DAWN",
    characters: ["수현", "민규"], // 수현 등장
    status: "approved",
  },
];

// 시나리오 1: 수현 인물 Arc 및 내면동기 변경
const characterArcChange: ProjectChange = {
  id: "chg_01",
  scope: "character",
  target_id: "c_01",
  target_name: "수현 (Character Arc & 내면 동기)",
  affected_characters: ["수현"],
  before_value: "죄책감과 억압된 감정 표현",
  after_value: "서늘하고 계산적인 냉소와 은폐 시도",
  reason: "작가 및 감독 3차 기획 회의에서 수현의 캐릭터 톤 수정",
  evidence_uids: ["U04", "U07", "U12"],
  changed_by: "박재인(감독)",
  timestamp: "2026-08-01T22:00:00Z",
};

const results = evaluateCascadingStale(characterArcChange, scenes);

// 검증 1: 결과 배열 개수
assertEqual(results.length, 2, "Test 1: 장면 2건에 대한 평가 결과 생성");

// 검증 2: 수현 미등장 SCENE 12는 영향 없음 (unchanged) 유지
const scene12Result = results.find((r) => r.scene_number === "SCENE 12");
assertTrue(scene12Result !== undefined, "Test 2-1: SCENE 12 결과 존재");
assertEqual(scene12Result?.new_status, "unchanged", "Test 2-2: SCENE 12는 무관하므로 status=unchanged 유지");
assertEqual(scene12Result?.is_affected, false, "Test 2-3: SCENE 12 is_affected=false 확인");

// 검증 3: 수현 등장 SCENE 34만 선택적으로 review_required 전파
const scene34Result = results.find((r) => r.scene_number === "SCENE 34");
assertTrue(scene34Result !== undefined, "Test 3-1: SCENE 34 결과 존재");
assertEqual(scene34Result?.new_status, "review_required", "Test 3-2: SCENE 34만 선택적으로 review_required 전파");
assertEqual(scene34Result?.is_affected, true, "Test 3-3: SCENE 34 is_affected=true 확인");

// 검증 4: 변경 영향 기록 (change_impact) 완벽 추적 검증
assertTrue(scene34Result?.change_impact !== null, "Test 4-1: SCENE 34 change_impact 기록 존재");
assertEqual(scene34Result?.change_impact?.target_name, "수현 (Character Arc & 내면 동기)", "Test 4-2: Target Name 일치");
assertEqual(scene34Result?.change_impact?.before_value, "죄책감과 억압된 감정 표현", "Test 4-3: Before Value 기록 일치");
assertEqual(scene34Result?.change_impact?.after_value, "서늘하고 계산적인 냉소와 은폐 시도", "Test 4-4: After Value 기록 일치");
assertEqual(scene34Result?.change_impact?.evidence.length, 3, "Test 4-5: 근거 발언 U-ID 3건 기록 일치");

console.log("\n🎉 Selective Cascading Stale Engine Contract Tests PASSED Successfully!\n");
