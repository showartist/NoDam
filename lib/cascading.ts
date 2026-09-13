import type { DecisionState, IssueScope, Role } from "./types";

export type ProjectChange = {
  id: string;
  scope: IssueScope;
  target_id: string; // e.g. "c_01" (수현) or "pb_theme"
  target_name: string; // e.g. "수현 (캐릭터 Arc)"
  affected_characters?: string[]; // e.g. ["수현"]
  before_value: string;
  after_value: string;
  reason: string;
  evidence_uids: string[];
  changed_by: string;
  timestamp: string;
};

export type SceneTarget = {
  scene_id: string;
  scene_number: string;
  title: string;
  characters: string[]; // e.g. ["수현", "민규"]
  status: "approved" | "review_required" | "draft";
};

export type CascadeResult = {
  scene_id: string;
  scene_number: string;
  previous_status: string;
  new_status: "review_required" | "unchanged";
  is_affected: boolean;
  reason: string;
  change_impact: {
    target_name: string;
    before_value: string;
    after_value: string;
    evidence: string[];
  } | null;
};

/**
 * 선택적 Cascading Stale 전파 엔진
 * 상위 변경 사항의 대상 캐릭터/영역과 연관된 장면만 선택적으로 review_required 상태로 변경.
 * 연관이 없는 장면은 기존 상태를 100% 유지함.
 */
export function evaluateCascadingStale(
  change: ProjectChange,
  scenes: SceneTarget[],
): CascadeResult[] {
  return scenes.map((scene) => {
    let isAffected = false;
    let impactReason = "";

    // 1. 캐릭터 연관성 검사: 캐릭터 관련 변경인 경우 해당 캐릭터가 등장하는 장면만 영향을 받음
    if (change.scope === "character" && change.affected_characters && change.affected_characters.length > 0) {
      const hasCharacter = change.affected_characters.some((char) =>
        scene.characters.includes(char),
      );
      if (hasCharacter) {
        isAffected = true;
        impactReason = `등장 캐릭터 (${change.affected_characters.join(", ")})의 상위 설정 (${change.target_name}) 변경됨`;
      } else {
        isAffected = false;
        impactReason = `등장 캐릭터 (${change.affected_characters.join(", ")}) 미등장 장면 — 상태 유지`;
      }
    } else if (change.scope === "project" || change.scope === "story") {
      // 2. 작품 전체 테마/결망 방향 변경인 경우 모든 장면이 영향 받음
      isAffected = true;
      impactReason = `작품 전체 상위 결정 (${change.target_name}) 변경에 따른 영향`;
    } else {
      isAffected = false;
      impactReason = `상위 변경 영역 (${change.scope})과 해당 장면 설정 미연관 — 상태 유지`;
    }

    const newStatus = isAffected ? "review_required" : "unchanged";

    return {
      scene_id: scene.scene_id,
      scene_number: scene.scene_number,
      previous_status: scene.status,
      new_status: newStatus,
      is_affected: isAffected,
      reason: impactReason,
      change_impact: isAffected
        ? {
            target_name: change.target_name,
            before_value: change.before_value,
            after_value: change.after_value,
            evidence: change.evidence_uids,
          }
        : null,
    };
  });
}
