import type { SpeakerRole } from "../visualSynthesis/types";

export type AlignmentIssueType = "conflict" | "ambiguity" | "missing" | "unconfirmed";

export type Severity = "blocking" | "comparison_recommended" | "informational";

export type IssueStatus = "detected" | "needs_review" | "resolved" | "dismissed" | "deferred";

export interface ParticipantPosition {
  participantId: string;
  participantName: string;
  participantRole: SpeakerRole;
  interpretation: string;
  visualElements: string[];
  evidenceUids: string[];
  basis: "explicit" | "inferred";
  confidence: number; // 0.0 ~ 1.0
}

/**
 * Finding: 합의(agreement) 또는 단순 시각 관찰 결과
 */
export interface AlignmentFinding {
  id: string;
  meetingId: string;
  projectId: string;
  sceneIds: string[];
  findingType: "agreement" | "visual_observation";
  topic: string;
  summary: string;
  participantPositions: ParticipantPosition[];
  evidenceUids: string[];
  createdAt: string;
}

/**
 * Issue: 동상이몽 (conflict / ambiguity / missing / unconfirmed)
 */
export interface AlignmentIssue {
  id: string;
  meetingId: string;
  projectId: string;
  sceneIds: string[];
  issueType: AlignmentIssueType;
  severity: Severity;
  topic: string;
  summary: string;
  participantPositions: ParticipantPosition[];
  evidenceUids: string[];
  diagnostic?: { confidence: number; threshold: number; reason: string };
  whyItMatters: string;
  suggestedQuestion: string;
  status: IssueStatus;
  createdAt: string;
}

export interface AlignmentAnalysisRun {
  id: string;
  meetingId: string;
  projectId: string;
  deterministicRulesCount: number;
  llmCandidatesCount: number;
  validatedIssuesCount: number;
  findingsCount: number;
  runStatus: "completed" | "failed";
  executedAt: string;
  llmPayloadPreview?: {
    model: string;
    promptTemplate: string;
    messagesPreview: string;
  };
}

export interface IssueResolution {
  id: string;
  issueId: string;
  resolutionType: "direct_answer" | "element_comparison" | "dismissed" | "deferred";
  answerText?: string;
  resolvedBy: string;
  resolvedAt: string;
}
