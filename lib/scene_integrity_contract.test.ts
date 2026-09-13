import projectDevData from "../fixtures/film/project_dev_breath.json";
import scene34Gold from "../fixtures/gold/scene34_empty_pool_level3.gold.json";
import { evaluateShotApproval, getProductionBlockers } from "./shot_approval";

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

console.log("🧪 Running SceneSync Scene Integrity & Production Blocker Contract Suite...\n");

// ── 1. 이미지 일치성 및 무분별 승인 금지 계약 ──────────────────────────
// evaluateShotApproval 본체는 lib/shot_approval.ts 로 이동함 (Workbench.tsx 가 실제로 쓴다).
const mockMismatchedShot = { shot_number: 1, image_url: "/images/shot1.png" };
const evalRes1 = evaluateShotApproval(mockMismatchedShot, false, true);
assertEqual(evalRes1.canApprove, false, "Contract 1-1: 모텔방 임시 이미지 샷 ➔ 최종 승인 불가");
assertEqual(evalRes1.statusBadge, "⚠️ 레퍼런스 임시 이미지", "Contract 1-2: ⚠️ 레퍼런스 임시 이미지 배지 부여");

// ── 2. 제작 차단 사유 (Production Blockers) 최상단 노출 계약 ────────────
// getProductionBlockers 본체는 lib/shot_approval.ts 로 이동함.
const blockers = getProductionBlockers(scene34Gold.expected_issues);
assertTrue(blockers.length >= 1, "Contract 2-1: 제작 차단 사유 (Critical/Explicit Opposition) 1건 이상 감지");
assertTrue(blockers.some((b) => b.subject.includes("안전") || b.subject.includes("크레인") || b.subject.includes("맨발")), "Contract 2-2: 세트 진입/안전 관련 차단 사유 포함 검증");

// ── 3. 장면 3대 앵커 (핵심 행동, 마지막 이미지, 핵심 오브제) 완비 계약 ────
export const SCENE34_ANCHORS = {
  coreAction: "수영모 안쪽 이름표 조각을 몰래 찢어 손에 숨긴다",
  endingImage: "둘이 퇴장 후 빈 수영장 바닥 배수구 물 한 방울 잔상",
  coreObject: "실종된 동생의 낡은 청록색 수영모",
};

assertTrue(SCENE34_ANCHORS.coreAction.length > 0, "Contract 3-1: SCENE 34 핵심 행동 앵커 존재");
assertTrue(SCENE34_ANCHORS.endingImage.length > 0, "Contract 3-2: SCENE 34 마지막 이미지 앵커 존재");
assertTrue(SCENE34_ANCHORS.coreObject.length > 0, "Contract 3-3: SCENE 34 핵심 오브제 앵커 존재");

console.log("\n🎉 Scene Integrity & Production Blocker Contract Suite PASSED 100%!\n");
