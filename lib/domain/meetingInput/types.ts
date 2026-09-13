export type MeetingType = "script_read" | "concept_discussion" | "preproduction_dept" | "on_set_briefing";

export type ImportState =
  | "draft"
  | "preview_ready"
  | "imported"
  | "analysis_pending"
  | "review_required"
  | "completed"
  | "failed";

export interface ParticipantInfo {
  id: string;
  name: string;
  role: "director" | "cinematographer" | "production_designer" | "producer" | "writer" | "unknown";
}

export interface MeetingImportInput {
  projectId: string;
  sceneIds?: string[];
  meetingTitle: string;
  meetingType: MeetingType;
  meetingDate: string;
  participants: ParticipantInfo[];
  transcriptRaw: string;
  optionalSummary?: string;
}

export interface ParsedUtterance {
  uid: string; // U-001, U-002...
  lineNumber: number;
  speakerName: string;
  speakerRole: ParticipantInfo["role"];
  rawText: string;
  timestamp?: string;
}

export interface ParseResult {
  ok: boolean;
  checksum: string;
  totalLines: number;
  parsedCount: number;
  failedLines: { lineNumber: number; rawText: string; reason: string }[];
  failureRate: number; // 0.0 ~ 1.0
  utterances: ParsedUtterance[];
  errors: string[];
}
