// Phase 7B 쓰기 계약 테스트.
//
// 이 파일이 지키려는 것은 "쓰기가 동작한다"가 아니라
// "실패를 성공처럼 보이게 만들지 않는다" 이다.
// 실행: npx tsx --test tests/project_visual_write_contract.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
/** 주석은 기능이 아니다. "없어야 한다" 검사는 코드 본문만 본다. */
const code = (src: string) => src.replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const mutations = read("app/m/[id]/project-visual/mutations.ts");
const hook = read("app/m/[id]/project-visual/useWriteAction.ts");
const action = read("app/m/[id]/project-visual/WriteAction.tsx");
const workspace = read("app/m/[id]/project-visual/ProjectVisualWorkspace.tsx");
const approvalPanel = read("app/m/[id]/project-visual/PrincipleApprovalPanel.tsx");
const referenceBar = read("app/m/[id]/project-visual/ReferenceWriteBar.tsx");
const decisionBar = read("app/m/[id]/project-visual/DecisionWriteBar.tsx");
const writeCtx = read("app/m/[id]/project-visual/WriteContext.tsx");
const all = [mutations, hook, action, workspace, approvalPanel, referenceBar, decisionBar, writeCtx].join("\n");

// ── 1. 저장 위치 ────────────────────────────────────────────
test("no_localstorage_or_memory_crud", () => {
  assert.doesNotMatch(code(all), /localStorage|sessionStorage|indexedDB/);
});

test("no_fixture_fallback_in_write_path", () => {
  assert.doesNotMatch(code(all), /fixtures\//);
  assert.doesNotMatch(code(all), /require\(.*fixture/i);
});

// ── 2. optimistic 가짜 성공 금지 ────────────────────────────
test("saved_state_only_after_server_response", () => {
  // saved 로의 전이가 await work() 뒤에만 존재해야 한다.
  const runBody = hook.slice(hook.indexOf("const run"), hook.indexOf("const reset"));
  const awaitIndex = runBody.indexOf("await work()");
  const savedIndex = runBody.indexOf('status: "saved"');
  assert.ok(awaitIndex > 0, "쓰기 호출을 await 해야 합니다.");
  assert.ok(savedIndex > awaitIndex, "saved 는 서버 응답 이후에만 설정되어야 합니다.");
});

test("error_state_is_reachable_and_typed", () => {
  assert.match(hook, /status: "error"/);
  assert.match(hook, /APPROVAL_INCOMPLETE/);
  assert.match(hook, /CONFLICT/);
  assert.match(hook, /VALIDATION_ERROR/);
  assert.match(hook, /INVALID_STATE_TRANSITION/);
});

// ── 3. 중복 제출 방지 ───────────────────────────────────────
test("duplicate_submission_is_blocked", () => {
  assert.match(hook, /inFlight/);
  assert.match(hook, /if\s*\(inFlight\.current\)\s*return/);
  assert.match(action, /disabled=\{busy\}/);
});

// ── 4. 오류를 삼키지 않는다 ─────────────────────────────────
test("mutation_client_throws_on_error_response", () => {
  assert.match(mutations, /if\s*\(!response\.ok\s*\|\|\s*!parsed\?\.ok\)/);
  assert.match(mutations, /throw new MutationError/);
  // 네트워크 실패도 성공으로 위장하지 않는다.
  assert.match(mutations, /NETWORK_ERROR/);
});

test("write_failure_does_not_reload_or_claim_success", () => {
  // onSettled(=reload) 는 성공 경로에서만 호출되어야 한다.
  const runBody = hook.slice(hook.indexOf("const run"), hook.indexOf("const reset"));
  const settledIndex = runBody.indexOf("onSettled?.()");
  const catchIndex = runBody.indexOf("catch");
  assert.ok(settledIndex > 0 && settledIndex < catchIndex, "reload 는 catch 이전(성공 경로)에 있어야 합니다.");
});

// ── 5. UI 가 서버 판정을 대신하지 않는다 ────────────────────
test("ui_reloads_from_server_after_write", () => {
  assert.match(workspace, /const reload=useCallback/);
  assert.match(workspace, /fetchProjectVisualWorkspace\(projectId\)/);
});

test("ui_does_not_recompute_cascade", () => {
  // 변경 영향 계산은 서버 몫이다. UI 쪽 쓰기 경로에 분류 로직이 있으면 안 된다.
  assert.doesNotMatch(all, /calculateCascadeImpact/);
  assert.match(mutations, /runCascade/);
});

// ── 6. 관계는 ID 로 만든다 (이름 문자열 금지) ────────────────
test("approver_is_participant_id_not_name", () => {
  assert.match(writeCtx, /participantFor/);
  assert.match(approvalPanel, /approverId: person\.id/);
  assert.doesNotMatch(approvalPanel, /approverId:\s*person\.name/);
  assert.match(decisionBar, /decidedBy: director!\.id/);
});

test("missing_participant_is_not_invented", () => {
  // 참여자가 없으면 승인자를 만들어내지 않고 Missing 상태를 보여준다.
  assert.match(approvalPanel, /if \(!person\)/);
  assert.match(approvalPanel, /MissingRole/);
});

// ── 7. 승인 이력 보존 ───────────────────────────────────────
test("withdrawal_keeps_history_and_does_not_overwrite", () => {
  assert.match(mutations, /action: "withdraw"/);
  // 철회는 PATCH 이며 승인 레코드를 삭제하지 않는다.
  assert.doesNotMatch(mutations, /method:\s*"DELETE"/);
  assert.match(approvalPanel, /approvalId: approval\.id/);
});

// ── 8. 승인 차단이 실제로 막는다 ────────────────────────────
test("joint_approval_blocked_until_both_roles_active", () => {
  assert.match(approvalPanel, /blocked: boolean/);
  assert.match(approvalPanel, /blocked=\{blocked\}/);
  const review = read("app/m/[id]/project-visual/PrincipleReviewView.tsx");
  assert.match(review, /blocked=\{blocking\.length>0\}/);
});

test("blocked_action_does_not_call_server", () => {
  // blocked 분기에는 onClick 이 없어야 한다.
  const blockedBranch = action.slice(action.indexOf("blocked ? ("), action.indexOf(") : ("));
  assert.doesNotMatch(blockedBranch, /onClick/);
});

// ── 9. Reference / Question 쓰기 경로 ───────────────────────
test("reference_write_paths_exist", () => {
  for (const fn of ["createReference", "updateReference", "linkReferenceToScene"]) {
    assert.match(mutations, new RegExp(`export const ${fn}`), `${fn} 이 필요합니다.`);
  }
  assert.match(referenceBar, /updateReference\(projectId, reference\.id/);
});

// updateReference 는 부분 수정이 아니라 전체 교체다. 일부 필드만 보내면 서버가 400 을 준다.
// Preview 배포에서 실제로 이 오류가 났었다. 필수 필드를 전부 보내는지 정적으로 막는다.
test("reference_update_sends_full_replacement_payload", () => {
  const call = referenceBar.slice(referenceBar.indexOf("updateReference(projectId, reference.id"));
  for (const field of [
    "title:",
    "sourceMethod:",
    "contentType:",
    "adoptionLevel:",
    "referenceImageState:",
    "responsibleRole:",
  ]) {
    assert.ok(call.includes(field), `updateReference 호출에 ${field} 가 빠지면 서버가 거부합니다.`);
  }
});

test("question_decide_path_exists", () => {
  assert.match(mutations, /export const decideQuestion/);
  assert.match(mutations, /action: "decide"/);
  assert.match(decisionBar, /decideQuestion\(projectId, question\.id/);
});

test("principle_create_and_version_paths_exist", () => {
  assert.match(mutations, /export const createPrinciple\b/);
  assert.match(mutations, /export const createPrincipleVersion/);
  assert.match(approvalPanel, /createPrincipleVersion\(projectId, principle\.id/);
});

console.log("Project Visual 쓰기 계약 검사 완료");
