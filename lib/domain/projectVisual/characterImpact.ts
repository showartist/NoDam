import type { CascadeImpact, CharacterVisualChangeInput } from "./contracts";

export function calculateCharacterVisualImpact(input: CharacterVisualChangeInput): CascadeImpact[] {
  const linked = new Set(input.linkedSceneIds);
  return input.candidateSceneIds.map((sceneId) => {
    if (input.linkedSceneIds.length === 0) {
      return {
        targetType: "scene", targetId: sceneId, impactResult: "unknown", targetNewStatus: null,
        reason: `${input.characterId}의 명시적 Scene 링크가 없어 인간 검토가 필요합니다.`,
      };
    }
    if (linked.has(sceneId)) {
      return {
        targetType: "scene", targetId: sceneId, impactResult: "affected", targetNewStatus: "review_required",
        reason: `${input.characterId}에 명시적으로 연결된 Scene입니다.`,
      };
    }
    return {
      targetType: "scene", targetId: sceneId, impactResult: "unaffected", targetNewStatus: null,
      reason: `${input.characterId}의 명시적 연결 범위 밖 Scene입니다.`,
    };
  });
}
