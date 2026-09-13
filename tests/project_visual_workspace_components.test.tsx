import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assetUrl, VIEW_ITEMS } from "../app/m/[id]/project-visual/types";

const root=new URL("../",import.meta.url);
const source=(path:string)=>readFileSync(new URL(path,root),"utf8");
const workspace=source("app/m/[id]/project-visual/ProjectVisualWorkspace.tsx");
const states=source("app/m/[id]/project-visual/WorkspaceStates.tsx");
const workbench=source("app/m/[id]/Workbench.tsx");

test("workspace_loading_state",()=>{assert.match(states,/workspace-loading/);assert.match(states,/aria-busy="true"/);});
test("workspace_empty_state",()=>{assert.match(states,/workspace-empty/);assert.match(states,/아직 Project Visual 데이터가 없습니다/);});
test("workspace_database_not_configured_state",()=>{assert.match(states,/DATABASE_NOT_CONFIGURED/);assert.match(states,/SQLite나 fixture로 대체하지 않습니다/);});
test("workspace_api_error_state",()=>{assert.match(workspace,/WorkspaceRequestError/);assert.match(states,/다시 시도/);});
test("six_subviews_are_navigable",()=>{assert.equal(VIEW_ITEMS.length,6);assert.deepEqual(VIEW_ITEMS.map(v=>v.id),["spine","references","comparison","principles","characters","impact"]);});
test("visual_spine_renders_read_model",()=>{const value=source("app/m/[id]/project-visual/VisualSpineView.tsx");assert.match(value,/model\.references/);assert.match(value,/model\.decisionQuestions/);assert.match(value,/Creative Intent/i);assert.match(value,/Production Reality/i);});
test("references_render_real_ids_and_links",()=>{const value=source("app/m/[id]/project-visual/ReferencesView.tsx");assert.match(value,/data-reference-id/);assert.match(value,/ref\.sceneIds/);assert.match(value,/<IdTag>\{ref\.id\}/);});
test("role_comparison_separates_ai_and_human_decision",()=>{const value=source("app/m/[id]/project-visual/RoleComparisonView.tsx");assert.match(value,/AI ANALYSIS/);assert.match(value,/HUMAN DECISION/);assert.match(value,/decidedBy/);assert.match(value,/decidedAt/);});
test("principle_review_blocks_approval_with_blocking_issue",()=>{const value=source("app/m/[id]/project-visual/PrincipleReviewView.tsx");assert.match(value,/blocked=\{blocking\.length>0\}/);assert.match(value,/감독 active 승인 없음/);assert.match(value,/프로듀서 active 승인 없음/);});
test("character_bible_preserves_character_and_version_ids",()=>{const value=source("app/m/[id]/project-visual/CharacterBibleView.tsx");assert.match(value,/data-character-id/);assert.match(value,/data-character-version-id/);assert.match(value,/character\.characterId/);});
test("change_impact_renders_affected_unaffected_unknown",()=>{const value=source("app/m/[id]/project-visual/ChangeImpactView.tsx");for(const state of ["affected","unaffected","unknown"])assert.match(value,new RegExp(state));assert.match(value,/LegacyUnknown/);});
test("scene_development_remains_accessible",()=>{assert.match(workbench,/setMode\("scene_dev"\)/);assert.match(workbench,/tab === "shotboard"/);assert.match(workbench,/회의 전사/);});
test("no_fixture_fallback_on_api_error",()=>{assert.doesNotMatch(workbench,/project_dev_breath\.json/);assert.doesNotMatch(workspace,/fixture/i);assert.equal(assetUrl("file:///tmp/image.png"),null);});
test("no_iframe_used_for_project_visual_workspace",()=>{assert.doesNotMatch(workbench,/<iframe/i);assert.doesNotMatch(workspace,/<iframe/i);});
test("quick_summary_exposes_actionable_counts",()=>{const value=source("app/m/[id]/project-visual/ProjectVisualQuickSummary.tsx");for(const label of ["촬영 전 해결","미확정 결정","승인 대기","다시 확인","연결 Scene"])assert.match(value,new RegExp(label));});
test("mobile_images_expand_without_write_side_effect",()=>{const value=source("app/m/[id]/project-visual/ViewSupport.tsx");assert.match(value,/aria-modal="true"/);assert.match(value,/확대 보기/);assert.doesNotMatch(value,/fetch\(/);});
test("future_on_set_actions_remain_disabled",()=>{const value=source("app/m/[id]/project-visual/PlanningActionDock.tsx");for(const action of ["확인 완료","문제 있음","사진 추가","감독 확인 요청","촬영 보류","Shot 완료"])assert.match(value,new RegExp(action));assert.match(value,/disabled/);});
test("mobile_contract_includes_430_breakpoint_and_touch_targets",()=>{const value=source("app/m/[id]/project-visual/projectVisual.module.css");assert.match(value,/max-width:500px/);assert.match(value,/min-height:44px/);assert.match(value,/overflow-x:auto/);});
