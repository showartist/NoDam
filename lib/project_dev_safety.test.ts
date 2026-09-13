import { AI_ALLOWED_STATES, type DecisionState, type VisualReferenceItem, type VisualPrincipleItem } from "./types";

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

console.log("🧪 Running Project Development AI Confirmation Safety Contract Tests...\n");

// Rule 1: AI_ALLOWED_STATES에 'confirmed'가 절대 포함되지 않음 검증
assertTrue(!AI_ALLOWED_STATES.includes("confirmed"), "Safety Rule 1-1: AI_ALLOWED_STATES 에 confirmed 미포함 확인");
assertTrue(AI_ALLOWED_STATES.includes("candidate"), "Safety Rule 1-2: AI_ALLOWED_STATES 에 candidate 포함 확인");

// Rule 2: AI 추출 결과의 decision_state 검증 함수
function validateAiDecisionState(state: DecisionState): boolean {
  if (state === "confirmed") {
    return false; // AI는 confirmed 부여 불가능
  }
  return AI_ALLOWED_STATES.includes(state);
}

assertTrue(validateAiDecisionState("proposed"), "Safety Rule 2-1: AI output 'proposed' 허용");
assertTrue(validateAiDecisionState("candidate"), "Safety Rule 2-2: AI output 'candidate' 허용");
assertTrue(!validateAiDecisionState("confirmed"), "Safety Rule 2-3: AI output 'confirmed' 차단 안전 검증");

// Rule 3: Visual Reference include/exclude 필수 포함 검증
function validateVisualReference(ref: VisualReferenceItem): { valid: boolean; warning?: string } {
  if (!ref.include_elements || ref.include_elements.length === 0) {
    return { valid: false, warning: "가져올 요소 (include_elements) 누락" };
  }
  if (ref.level !== "exclude" && (!ref.exclude_elements || ref.exclude_elements.length === 0)) {
    return { valid: false, warning: "배제할 요소 (exclude_elements) 누락" };
  }
  return { valid: true };
}

const validRef: VisualReferenceItem = {
  id: "R-01",
  title: "화양연화 복도",
  category: "world_tone",
  image_url: "/images/r01.png",
  uploaded_by: "한지우(감독)",
  level: "partial",
  include_elements: ["저채도 인물 압박감"],
  exclude_elements: ["1960년대 시대색"],
  role_interpretations: { director: "인물 간 물리적 압박감" },
  decision_state: "candidate",
  evidence: ["U21"],
};

const invalidRef: VisualReferenceItem = {
  ...validRef,
  exclude_elements: [], // exclude 누락
};

assertTrue(validateVisualReference(validRef).valid, "Safety Rule 3-1: include/exclude 모두 완비된 Visual Reference 승인 가능");
assertTrue(!validateVisualReference(invalidRef).valid, "Safety Rule 3-2: exclude 누락 시 승인 차단 및 경고 발생");

// Rule 4: Visual Principle 승인자 및 근거 U-ID 완전성 검증
function validateVisualPrinciple(vp: VisualPrincipleItem): boolean {
  if (!vp.references || vp.references.length === 0) return false;
  if (!vp.evidence || vp.evidence.length === 0) return false;
  if (!vp.principle || vp.principle.trim().length === 0) return false;
  return true;
}

const validVP: VisualPrincipleItem = {
  id: "VP-01",
  title: "제한된 인공 색채 원칙",
  principle: "무채색 저채도 공간 안에서 오직 청록/틸 톤의 네온 빛 하나만 승인한다.",
  rationale: "인물의 차가운 심리 톤 통일",
  applies_to: ["조명", "수영모"],
  references: ["R-01", "R-02"],
  evidence: ["U23", "U29"],
  status: "approved",
};

assertTrue(validateVisualPrinciple(validVP), "Safety Rule 4-1: 근거 레퍼런스와 U-ID가 포함된 Visual Principle만 승인 허용");

console.log("\n🎉 Project Development AI Confirmation Safety Contract Tests PASSED Successfully!\n");
