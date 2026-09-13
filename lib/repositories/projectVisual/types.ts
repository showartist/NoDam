import type {
  CascadeChangeType, CascadeImpactResult, CascadeTargetNewStatus, CascadeTargetType,
  DecisionQuestionState, GeneratedImageState, ReferenceImageState, SceneReviewStatus,
  ShotStatus, VisualPrincipleStatus,
} from "../../domain/projectVisual";

export type TimestampValue = string | Date;
export type ProjectRecord = { id:string; title:string; domain:string; status:string; oneLine:string|null; createdAt:string; updatedAt:string };
export type SceneRecord = { id:string; projectId:string; sceneNumber:number; title:string; reviewStatus:SceneReviewStatus; createdAt:string; updatedAt:string };
export type ShotRecord = { id:string; sceneId:string|null; shotNumber:number; title:string; status:ShotStatus; generatedImageState:GeneratedImageState; imageUri:string|null; approvedBy:string|null; approvedAt:string|null; createdAt:string; updatedAt:string };
export type VisualReferenceRecord = { id:string; projectId:string; title:string; sourceMethod:string; contentType:string; adoptionLevel:"core"|"support"|"candidate"|"exclude"; referenceImageState:ReferenceImageState; assetUri:string|null; take:unknown[]; drop:unknown[]; responsibleRole:string; evidence:unknown[]; versionLabel:string; createdAt:string; updatedAt:string };
export type VisualPrincipleRecord = { id:string; projectId:string; title:string; status:VisualPrincipleStatus; currentVersionId:string|null; createdAt:string; updatedAt:string };
export type VisualPrincipleVersionRecord = { id:string; principleId:string; versionNumber:number; principleText:string; rationale:string; changeSummary:string|null; evidence:unknown[]; sourceQuestionId:string|null; contentHash:string; createdBy:string|null; createdAt:string };
export type PrincipleApprovalRecord = { id:string; principleVersionId:string; approverId:string; role:"director"|"producer"; status:"active"|"withdrawn"; evidenceUid:string|null; approvedAt:string; withdrawnAt:string|null; withdrawalReason:string|null; createdAt:string };
export type DecisionQuestionRecord = { id:string; projectId:string; question:string; context:string|null; state:DecisionQuestionState; priority:number; decidedOption:string|null; decidedBy:string|null; decidedAt:string|null; evidence:unknown[]; createdAt:string; updatedAt:string };
export type CharacterVisualRecord = { id:string; projectId:string; characterId:string; characterName:string; versionNumber:number; status:VisualPrincipleStatus; faceAssetUri:string|null; costumeAssetUri:string|null; fullbodyAssetUri:string|null; inspaceAssetUri:string|null; propAssetUri:string|null; continuityLock:Record<string,unknown>; allowed:unknown[]; prohibited:unknown[]; evidence:unknown[]; approvedBy:string|null; approvedAt:string|null; createdAt:string; updatedAt:string };
export type CascadeImpactRecord = { id:string; projectId:string; principleVersionId:string; changeType:CascadeChangeType; targetType:CascadeTargetType; targetId:string; impactResult:CascadeImpactResult; targetNewStatus:CascadeTargetNewStatus; reason:string; evaluatedAt:string; appliedAt:string|null };
export type DecisionLineageRecord = { id:string; projectId:string; sourceType:string; sourceId:string; relation:string; targetType:string; targetId:string; evidenceUid:string|null; metadata:Record<string,unknown>; createdAt:string };

export function toIsoString(value:TimestampValue|null):string|null {
  if(value===null)return null;
  return value instanceof Date?value.toISOString():value;
}
