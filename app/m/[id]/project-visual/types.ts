export type ViewId = "spine" | "references" | "comparison" | "principles" | "characters" | "impact";

export type ProjectVisualWorkspaceModel = {
  project: { id: string; title: string; domain: string; status: string; oneLine: string | null };
  /** 승인·결정 주체. 이름 문자열이 아니라 이 ID 로 지정한다. */
  participants: Array<{ id: string; projectId: string; name: string; role: string; createdAt: string }>;
  scenes: Array<{ id: string; sceneNumber: number; title: string; reviewStatus: "current" | "review_required" }>;
  shots: Array<{ id: string; sceneId: string | null; shotNumber: number; title: string; status: "proposed" | "approved" | "restale"; generatedImageState: "not_generated" | "generating" | "generated"; imageUri: string | null }>;
  references: Array<{ id: string; title: string; sourceMethod: string; contentType: string; adoptionLevel: "core" | "support" | "candidate" | "exclude"; referenceImageState: "not_uploaded" | "uploaded"; assetUri: string | null; take: unknown[]; drop: unknown[]; responsibleRole: string; evidence: unknown[]; versionLabel: string; sceneIds: string[] }>;
  principles: Array<{ id: string; title: string; status: "candidate" | "needs_review" | "confirmed" | "stale"; currentVersionId: string | null; currentVersion: null | { id: string; principleId: string; versionNumber: number; principleText: string; rationale: string; changeSummary: string | null; evidence: unknown[]; sourceQuestionId: string | null; createdBy: string | null; createdAt: string }; approvals: Array<{ id: string; principleVersionId: string; approverId: string; role: "director" | "producer"; status: "active" | "withdrawn"; evidenceUid: string | null; approvedAt: string; withdrawnAt: string | null }>; sceneIds: string[]; shotIds: string[] }>;
  decisionQuestions: Array<{ id: string; question: string; context: string | null; state: "open" | "discussion" | "decision_proposed" | "decided" | "reopened"; priority: number; decidedOption: string | null; decidedBy: string | null; decidedAt: string | null; evidence: unknown[] }>;
  characterVisuals: Array<{ id: string; characterId: string; characterName: string; versionNumber: number; status: "candidate" | "needs_review" | "confirmed" | "stale"; faceAssetUri: string | null; costumeAssetUri: string | null; fullbodyAssetUri: string | null; inspaceAssetUri: string | null; propAssetUri: string | null; continuityLock: Record<string, unknown>; allowed: unknown[]; prohibited: unknown[]; evidence: unknown[]; approvedBy: string | null; approvedAt: string | null; sceneIds: string[] }>;
  cascadeImpacts: Array<{ id: string; principleVersionId: string; changeType: "first_confirmation" | "version_update"; targetType: "scene" | "shot"; targetId: string; impactResult: "affected" | "unaffected" | "unknown"; targetNewStatus: "review_required" | "restale" | null; reason: string; evaluatedAt: string; appliedAt: string | null }>;
  decisionLineage: Array<{ id: string; sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; evidenceUid: string | null; createdAt: string }>;
};

export type WorkspaceApiError = { code: string; message: string };

export const VIEW_ITEMS: ReadonlyArray<{ id: ViewId; label: string; short: string }> = [
  { id: "spine", label: "Visual Spine", short: "Spine" },
  { id: "references", label: "References", short: "Refs" },
  { id: "comparison", label: "Role Comparison", short: "Roles" },
  { id: "principles", label: "Principle Review", short: "Review" },
  { id: "characters", label: "Character Bible", short: "Bible" },
  { id: "impact", label: "Change Impact", short: "Impact" },
];

export function evidenceLabels(values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const uid = item.uid ?? item.evidenceUid ?? item.id;
      return typeof uid === "string" ? [uid] : [];
    }
    return [];
  });
}

export function textList(values: unknown[]): string[] {
  return values.map((value) => typeof value === "string" ? value : JSON.stringify(value));
}

export function assetUrl(value: string | null): string | null {
  if (!value || /^(data|file):/i.test(value) || value.startsWith("/Users/") || value.startsWith("/mnt/")) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return value;
  return `/${value.replace(/^\.\//, "")}`;
}
