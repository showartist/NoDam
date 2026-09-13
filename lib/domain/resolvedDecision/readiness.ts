import type { ConsolidatedExplorationRecipe, SelectedVisualElement } from "../explorationRecipe/types";
import type { FinalResolutionAnswer, ResolutionReadiness } from "./types";

/**
 * SPRINT 3-A — Resolution Readiness Checker
 */
export function checkResolutionReadiness(
  consolidatedRecipe: ConsolidatedExplorationRecipe,
  finalAnswers: FinalResolutionAnswer[]
): ResolutionReadiness {
  const blockedReasons: string[] = [];
  const pendingHumanConfirmations: string[] = [];

  // 1. unresolvedFields check
  const unresolvedFields = [...consolidatedRecipe.unresolvedFields];
  for (const ans of finalAnswers) {
    const idx = unresolvedFields.indexOf(ans.field);
    if (idx !== -1) unresolvedFields.splice(idx, 1);
  }

  // 2. Check evidenceUids
  for (const el of consolidatedRecipe.selectedVisualElements) {
    if (!el.evidenceUids || el.evidenceUids.length === 0) {
      blockedReasons.push(`요소 [${el.category}]에 근거 발언(evidenceUids)이 없습니다.`);
    }
  }

  // 3. Logical compatibility check (subjectPresence vs subjectAction)
  const presenceEl = consolidatedRecipe.selectedVisualElements.find((e) => e.category === "subjectPresence");
  const actionEl = consolidatedRecipe.selectedVisualElements.find((e) => e.category === "subjectAction");

  if (
    presenceEl?.selectedValue.includes("부재") &&
    actionEl?.selectedValue &&
    !actionEl.selectedValue.includes("무행동") &&
    !actionEl.selectedValue.includes("정적")
  ) {
    blockedReasons.push(
      `[논리적 모순] 인물 부재 (subjectPresence=absent) 상태에서 이동 행동 (${actionEl.selectedValue})은 성립할 수 없습니다.`
    );
  }

  // 4. Inferred values confirmation check
  const hasUnconfirmedAiSuggestion = finalAnswers.some(
    (a) => a.answerType === "confirmed_ai_suggestion" && (!a.answeredBy || !a.answeredBy.trim())
  );
  if (hasUnconfirmedAiSuggestion) {
    blockedReasons.push("AI 추론 제안(confirmed_ai_suggestion)을 승인한 담당자(answeredBy)가 명시되지 않았습니다.");
  }

  let status: ResolutionReadiness["status"] = "ready";
  if (blockedReasons.length > 0) {
    status = "blocked";
  } else if (unresolvedFields.length > 0 || pendingHumanConfirmations.length > 0) {
    status = "needs_answer";
  }

  return {
    status,
    unresolvedFields,
    blockedReasons,
    pendingHumanConfirmations,
    evaluatedAt: new Date().toISOString(),
  };
}
