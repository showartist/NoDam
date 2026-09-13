import type { AlignmentIssue } from "../alignmentCheck/types";
import type { ParticipantExplorationRecipe } from "./types";

export class MissingEvidenceError extends Error {
  constructor(participantName: string) {
    super(`[Exploration Recipe 생성 거부] ${participantName}의 의견에 근거 발언(evidenceUids)이 없습니다.`);
    this.name = "MissingEvidenceError";
  }
}

/**
 * SPRINT 2-A — AlignmentIssue.participantPositions 로부터 참여자별 Exploration Recipe 생성
 */
export function buildParticipantExplorationRecipes(
  issue: AlignmentIssue
): ParticipantExplorationRecipe[] {
  const recipes: ParticipantExplorationRecipe[] = [];

  for (const pos of issue.participantPositions) {
    if (!pos.evidenceUids || pos.evidenceUids.length === 0) {
      throw new MissingEvidenceError(pos.participantName);
    }

    const aiSuggested: string[] = [];

    // Extract visual elements or infer AI suggestions
    let composition: string | undefined;
    let subjectPresence: string | undefined;
    let subjectPlacement: string | undefined;
    let lighting: string | undefined;
    let colorIntent: string | undefined;
    let environment: string | undefined;
    let subjectAction: string | undefined;
    let performanceDirection: string | undefined;

    if (pos.interpretation.includes("텅 빈") || pos.interpretation.includes("비어")) {
      subjectPresence = "인물 부재 (텅 빈 공간)";
      composition = "오프센터 적막한 와이드 샷";
      subjectAction = "공간에 정적 유지 (무행동)";
      performanceDirection = "고독하고 서늘한 부재의 정서";
    } else if (pos.interpretation.includes("멀리")) {
      subjectPresence = "인물 존재 (소형 배치)";
      subjectPlacement = "화면 하단 모퉁이 배치";
      composition = "35mm 풀 와이드 샷";
      subjectAction = "수영장 가장자리를 따라 느리게 이동";
      performanceDirection = "소외감과 망설임이 묻어나는 연기 톤";
    } else if (pos.interpretation.includes("젖은 타일") || pos.interpretation.includes("청록빛")) {
      environment = "청록빛 젖은 반사 타일 공간";
      colorIntent = "틸&시안 커스텀 톤앤매너";
      aiSuggested.push("colorIntent", "environment");
    }

    if (pos.interpretation.includes("차갑게")) {
      lighting = "그림자가 짙은 사이드 조명";
      aiSuggested.push("lighting");
    }

    const recipe: ParticipantExplorationRecipe = {
      id: `recipe_exp_${issue.id}_${pos.participantRole}_${Date.now()}`,
      projectId: issue.projectId,
      meetingId: issue.meetingId,
      sceneIds: issue.sceneIds,
      sourceIssueId: issue.id,
      participantId: pos.participantId,
      participantName: pos.participantName,
      participantRole: pos.participantRole,
      interpretation: pos.interpretation,
      basis: pos.basis,
      confidence: pos.confidence,
      evidenceUids: pos.evidenceUids,

      composition,
      subjectPresence,
      subjectPlacement,
      environment,
      lighting,
      colorIntent,
      wardrobe: undefined,
      props: undefined,
      subjectAction, // 무엇을 하는가
      performanceDirection, // 어떤 감정과 연기 방식으로 하는가

      requiredElements: pos.visualElements,
      prohibitedElements: issue.topic.includes("폐허") ? ["과도한 파손", "쓰레기 덤미"] : [],

      aiSuggestedFields: aiSuggested,
      canBeTaken: false, // Exploration Recipe는 TAKE 절대 불가
      status: "ready_for_generation",
      createdAt: new Date().toISOString(),
    };

    recipes.push(recipe);
  }

  return recipes;
}
