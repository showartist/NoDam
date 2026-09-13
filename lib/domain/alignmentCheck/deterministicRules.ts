import { DEMO_KEYWORDS, DEMO_RULE_NOTICE, DEMO_COLOR_SPECIFIED, DEMO_EMOTION_SPECIFIED } from "./demoKeywordData";
import type { ParsedUtterance } from "../meetingInput/types";
import type { AlignmentAnalysisRun, AlignmentFinding, AlignmentIssue, ParticipantPosition } from "./types";

import { calculateDongsangIndex, INDEX_THRESHOLDS } from "../../analysis/dongsangIndex";
import type { AlignmentIssueV2 } from "../../alignment/schema";

/** @deprecated 과거 경보 회귀 테스트용. B안 UI는 이 점수/임계치를 사용하지 않는다. */
export function diagnoseAlignmentIssue(issue: AlignmentIssueV2) {
  const index = calculateDongsangIndex([issue]);
  const closed = issue.state === "resolved" || issue.state === "dismissed";
  return {
    index,
    alert: !closed && index.score !== null && index.score >= INDEX_THRESHOLDS.alert,
    reason: closed ? "처리 완료된 안건입니다." : index.score === null
      ? "근거·문맥이 확인된 화자 쌍 판정이 부족합니다."
      : `판정된 ${index.compared}쌍 중 ${index.different}쌍의 해석이 다릅니다. 미판정 ${index.unknown}쌍. 잠정 경보 기준 ${INDEX_THRESHOLDS.alert}점.`,
    evidenceUids: issue.evidence_all,
    question: issue.question || `${issue.decision}의 실행 기준을 어떤 내용으로 확정할까요?`,
  };
}

/**
 * Layer A — 시연 대본용 낱말 보조 검사 6개. 일반 회의 탐지기 아님.
 * 부정·문맥·다른 장면을 일반화하지 못한다. v2 판정 집계에는 사용하지 않는다.
 */
export function runDemoKeywordChecks(
  meetingId: string,
  projectId: string,
  sceneIds: string[],
  utterances: ParsedUtterance[],
  options: { minConfidence?: number } = {}
): { findings: AlignmentFinding[]; issues: AlignmentIssue[]; analysisRun: AlignmentAnalysisRun } {
  const threshold = options.minConfidence ?? 0.8; // 임의 컷오프. 실제 회의 품질로 보정한 확률 아님.
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("minConfidence must be between 0 and 1");
  const findings: AlignmentFinding[] = [];
  const issues: AlignmentIssue[] = [];
  let issueCounter = 1;

  const getPositions = (
    posKeywords: string[],
    basis: "explicit" | "inferred" = "explicit",
    confidence: number = 0.95 // 임의 규칙 일치 강도. 통계적 확률이 아니다.
  ): ParticipantPosition[] => {
    const positions: ParticipantPosition[] = [];
    for (const u of utterances) {
      const text = u.rawText;
      const matched = posKeywords.find((k) => text.includes(k));
      if (matched) {
        positions.push({
          participantId: `${u.speakerRole}:${u.speakerName}`,
          participantName: u.speakerName,
          participantRole: u.speakerRole,
          interpretation: text,
          visualElements: [matched],
          evidenceUids: [u.uid],
          basis,
          confidence,
        });
      }
    }
    return positions;
  };

  // 같은 발언/화자의 표현 변화는 사람 사이 충돌로 세지 않는다.
  const differentSpeakers = (a: ParticipantPosition[], b: ParticipantPosition[]) =>
    !a.some(x => b.some(y => x.participantId === y.participantId)) &&
    a.some(x => b.some(y => x.participantId !== y.participantId && x.participantName !== "미상" && y.participantName !== "미상"));

  // Rule 1: 동일 요소 존재/부재 충돌
  const emptyPositions = getPositions(DEMO_KEYWORDS.emptySpace);
  const keepPositions = getPositions(DEMO_KEYWORDS.keepPerson);

  if (emptyPositions.length > 0 && keepPositions.length > 0 && differentSpeakers(emptyPositions, keepPositions)) {
    issues.push({
      id: `issue_det_${issueCounter++}`,
      meetingId,
      projectId,
      sceneIds,
      issueType: "conflict",
      severity: "blocking",
      topic: "인물 존재 여부 및 공간 배치 충돌",
      summary: "감독/스태프 간 인물 배치(텅 빈 공간 vs 인물 배치)가 직접 충돌합니다.",
      participantPositions: [...emptyPositions, ...keepPositions],
      evidenceUids: [...emptyPositions.flatMap((p) => p.evidenceUids), ...keepPositions.flatMap((p) => p.evidenceUids)],
      whyItMatters: "공간에 인물이 존재하는지 여부는 샷 앵글 및 프레이밍 레시피를 근본적으로 바꿉니다.",
      suggestedQuestion: "인물이 화면에 아예 등장하지 않는 텅 빈 공간인가요, 아니면 멀리 서 있는 인물을 남기나요?",
      status: "detected",
      createdAt: new Date().toISOString(),
    });
  }

  // Rule 2: 시간대 충돌 (낮 vs 밤)
  const dayPositions = getPositions(DEMO_KEYWORDS.day);
  const nightPositions = getPositions(DEMO_KEYWORDS.night);
  if (dayPositions.length > 0 && nightPositions.length > 0 && differentSpeakers(dayPositions, nightPositions)) {
    issues.push({
      id: `issue_det_${issueCounter++}`,
      meetingId,
      projectId,
      sceneIds,
      issueType: "conflict",
      severity: "blocking",
      topic: "시간대 (Day/Night) 충돌",
      summary: "장면의 시간대가 낮(주간)과 밤(야간)으로 모순됩니다.",
      participantPositions: [...dayPositions, ...nightPositions],
      evidenceUids: [...dayPositions.flatMap((p) => p.evidenceUids), ...nightPositions.flatMap((p) => p.evidenceUids)],
      whyItMatters: "조명 레시피 및 톤앤매너 설정을 결정하기 위해 시간대 확정이 필수적입니다.",
      suggestedQuestion: "이 씬의 조명 기준 시간대는 낮인가요, 밤인가요?",
      status: "detected",
      createdAt: new Date().toISOString(),
    });
  }

  // Rule 3: 공간 상태 및 질감 모호함 (Finding vs Issue 분리)
  const ruinPositions = getPositions(DEMO_KEYWORDS.ruin);
  const cleanPositions = getPositions(DEMO_KEYWORDS.cleanTiles);
  if (ruinPositions.length > 0 && cleanPositions.length > 0 && differentSpeakers(ruinPositions, cleanPositions)) {
    issues.push({
      id: `issue_det_${issueCounter++}`,
      meetingId,
      projectId,
      sceneIds,
      issueType: "ambiguity",
      severity: "comparison_recommended",
      topic: "공간 노후도 및 타일 질감 표현 차이",
      summary: "'폐허처럼 보이는 공간'과 '젖은 타일 반사 강조' 간의 미술 질감 표현 차이가 있습니다.",
      participantPositions: [...ruinPositions, ...cleanPositions],
      evidenceUids: [...ruinPositions.flatMap((p) => p.evidenceUids), ...cleanPositions.flatMap((p) => p.evidenceUids)],
      whyItMatters: "미술 디테일 및 질감(Texture) 레퍼런스 확정이 필요합니다.",
      suggestedQuestion: "공간이 버려진 폐허 스타일인가요, 아니면 물기가 강조된 타일 스타일인가요?",
      status: "detected",
      createdAt: new Date().toISOString(),
    });
  }

  // Rule 4: 모호한 시각 표현 ("차가운 느낌")
  const coldPositions = getPositions(DEMO_KEYWORDS.coldTone, "inferred", 0.8).filter(p => !DEMO_COLOR_SPECIFIED.test(p.interpretation));
  if (coldPositions.length > 0) {
    issues.push({
      id: `issue_det_${issueCounter++}`,
      meetingId,
      projectId,
      sceneIds,
      issueType: "ambiguity",
      severity: "comparison_recommended",
      topic: "'차가운 톤'의 시각적 표현 방식 모호함",
      summary: "'차갑게 가자'라는 표현이 블루톤 색온도인지, 그림자가 짙은 contrast 조명인지 모호합니다.",
      participantPositions: coldPositions,
      evidenceUids: coldPositions.flatMap((p) => p.evidenceUids),
      whyItMatters: "색보정(Color Intent)과 조명 스타일을 명확히 정의해야 합니다.",
      suggestedQuestion: "'차가운 느낌'은 블루톤 색온도인가요, 아니면 그림자가 짙은 조명 스타일인가요?",
      status: "detected",
      createdAt: new Date().toISOString(),
    });
  }

  // Rule 5: 필수 시각 정보 누락 (행동만 있고 연기/정서 미지정)
  const actionPositions = getPositions(DEMO_KEYWORDS.physicalAction, "inferred", 0.8).filter(p => !DEMO_EMOTION_SPECIFIED.test(p.interpretation));
  if (actionPositions.length > 0) {
    issues.push({
      id: `issue_det_${issueCounter++}`,
      meetingId,
      projectId,
      sceneIds,
      issueType: "missing",
      severity: "informational",
      topic: "인물 연기/표정 정서 지시 누락",
      summary: "인물의 물리적 행동만 언급되고, 연기 톤이나 내면 정서 지시가 누락되어 있습니다.",
      participantPositions: actionPositions,
      evidenceUids: actionPositions.flatMap((p) => p.evidenceUids),
      whyItMatters: "인물 샷의 감정 레이아웃 및 연기 지시(performanceDirection)가 필요합니다.",
      suggestedQuestion: "이 행동을 할 때 인물의 표정이나 내면 정서는 어떤 상태인가요?",
      status: "detected",
      createdAt: new Date().toISOString(),
    });
  }

  // Rule 6: 합의된 Finding (Agreement Finding)
  const agreePositions = getPositions(DEMO_KEYWORDS.agreement);
  if (agreePositions.length > 0) {
    findings.push({
      id: `finding_agree_${findings.length + 1}`,
      meetingId,
      projectId,
      sceneIds,
      findingType: "agreement",
      topic: "스태프 간 공통 합의 항목",
      summary: "스태프 간 이견 없이 공통적으로 승인된 정서 및 시각 기준입니다.",
      participantPositions: agreePositions,
      evidenceUids: agreePositions.flatMap((p) => p.evidenceUids),
      createdAt: new Date().toISOString(),
    });
  }


  for (let i = issues.length - 1; i >= 0; i--) {
    const issue = issues[i];
    // 0.95(명시)와 0.8(추론)은 시연용 임의 상수다.
    const confidence = Math.min(...issue.participantPositions.map(p => p.confidence));
    if (confidence < threshold) { issues.splice(i, 1); continue; }
    issue.evidenceUids = [...new Set(issue.evidenceUids)];
    issue.diagnostic = {
      confidence, threshold,
      reason: `규칙 일치 강도 ${confidence} ≥ 임계치 ${threshold}. ` + issue.participantPositions
        .map(p => `${p.participantName} [${p.evidenceUids.join(", ")}]: ${p.interpretation}`).join(" / "),
    };
  }
  const analysisRun: AlignmentAnalysisRun = {
    id: `run_analysis_${Date.now()}`,
    meetingId,
    projectId,
    deterministicRulesCount: 6,
    llmCandidatesCount: 0,
    validatedIssuesCount: issues.length,
    findingsCount: findings.length,
    runStatus: "completed",
    executedAt: new Date().toISOString(),
    // 호출하지 않은 모델명을 실행 기록에 남기지 않는다. 이 함수는 LLM 을 부르지 않는다.
    llmPayloadPreview: {
      model: "none (deterministic rules only)",
      promptTemplate: "",
      messagesPreview: `${DEMO_RULE_NOTICE} 발언 ${utterances.length}건을 규칙만으로 검사했습니다. LLM 호출 없음.`,
    },
  };

  return { findings, issues, analysisRun };
}

/**
 * Layer B — LLM Candidate Validator (LLM 결과 검수 엔진)
 * LLM 이 제안한 후보는 반드시 다음 검수 규칙을 통과해야 저장됨.
 */
export function validateLlmAlignmentCandidate(candidate: Partial<AlignmentIssue>): { ok: boolean; reason?: string } {
  if (!candidate.evidenceUids || candidate.evidenceUids.length === 0) {
    return { ok: false, reason: "근거 발언(evidenceUids)이 없는 LLM 제안은 배척됩니다." };
  }
  if (!candidate.participantPositions || candidate.participantPositions.length === 0) {
    return { ok: false, reason: "화자별 해석(participantPositions)이 없는 이슈는 저장할 수 없습니다." };
  }
  if (candidate.issueType === ("agreement" as any)) {
    return { ok: false, reason: "agreement 는 AlignmentIssue 가 아니라 AlignmentFinding 으로 분리되어야 합니다." };
  }
  return { ok: true };
}

/** @deprecated 기존 호출 호환용. 일반 탐지기가 아닌 시연 낱말 검사다. */
export const runDeterministicAlignmentRules = runDemoKeywordChecks;
