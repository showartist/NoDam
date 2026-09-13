import type { MeetingImportInput, ParseResult, ParsedUtterance, ParticipantInfo } from "./types";

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `hash_${Math.abs(hash).toString(16)}`;
}

function inferRoleByName(name: string, participants: ParticipantInfo[]): ParticipantInfo["role"] {
  const matched = participants.find((p) => p.name === name || name.includes(p.name));
  if (matched) return matched.role;
  if (name.includes("감독")) return "director";
  if (name.includes("촬영")) return "cinematographer";
  if (name.includes("미술")) return "production_designer";
  if (name.includes("제작") || name.includes("PD")) return "producer";
  if (name.includes("작가")) return "writer";
  return "unknown";
}

/**
 * PHASE A — Meeting Transcript Parser Engine
 */
export function parseMeetingTranscript(input: MeetingImportInput): ParseResult {
  if (!input.transcriptRaw || !input.transcriptRaw.trim()) {
    return {
      ok: false,
      checksum: "",
      totalLines: 0,
      parsedCount: 0,
      failedLines: [],
      failureRate: 1.0,
      utterances: [],
      errors: ["transcriptRaw 가 없으면 회의를 저장할 수 없습니다. 요약본만으로 저장하는 것은 엄격히 금지됩니다."],
    };
  }

  const checksum = simpleHash(input.transcriptRaw.trim());
  const lines = input.transcriptRaw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const utterances: ParsedUtterance[] = [];
  const failedLines: { lineNumber: number; rawText: string; reason: string }[] = [];

  let uidCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Skip VTT/SRT headers & timestamps if present
    if (line.startsWith("WEBVTT") || line.match(/^\d+$/) || line.match(/\d{2}:\d{2}/)) {
      continue;
    }

    // Pattern 1: "U-014 감독: '...'" or "한지우(감독): '...'" or "감독: '...'"
    const speakerMatch = line.match(/^(?:U-\d+\s+)?([가-힣a-zA-A0-9_]+(?:\([가-힣a-zA-Z]+\))?)\s*:\s*(.+)$/);

    if (speakerMatch) {
      const rawName = speakerMatch[1].replace(/\(.*\)/, "").trim();
      const text = speakerMatch[2].trim().replace(/^["']|["']$/g, "");
      const role = inferRoleByName(rawName, input.participants);
      const uid = `U-${String(uidCounter++).padStart(3, "0")}`;

      utterances.push({
        uid,
        lineNumber,
        speakerName: rawName,
        speakerRole: role,
        rawText: text,
      });
    } else {
      failedLines.push({
        lineNumber,
        rawText: line,
        reason: "화자 이름과 대사 구분자(:)를 찾을 수 없습니다. 예: '감독: 내용'",
      });
    }
  }

  const totalLinesProcessed = utterances.length + failedLines.length;
  const failureRate = totalLinesProcessed > 0 ? failedLines.length / totalLinesProcessed : 1.0;
  const errors: string[] = [];

  if (utterances.length === 0) {
    errors.push("인식된 유효 대사(화자: 내용)가 0건입니다. 저장할 수 없습니다.");
  }

  if (failureRate > 0.3) {
    errors.push(`파싱 실패율이 ${Math.round(failureRate * 100)}% 로 허용치(30%)를 초과했습니다. 저장할 수 없습니다.`);
  }

  const ok = errors.length === 0;

  return {
    ok,
    checksum,
    totalLines: lines.length,
    parsedCount: utterances.length,
    failedLines,
    failureRate,
    utterances,
    errors,
  };
}
