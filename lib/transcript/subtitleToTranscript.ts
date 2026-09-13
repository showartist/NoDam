// SRT / VTT 자막을 parseTranscript 가 읽는 형식으로 변환한다.
//
// 왜 변환기가 필요한가:
//   parseTranscript 의 타임코드 정규식은 `\d{1,2}:\d{2}` — **MM:SS 만** 받는다.
//   SRT 는 `HH:MM:SS,mmm` 이라 그대로 넣으면 인식되지 않는다. 게다가 큐 번호와
//   `-->` 줄은 화자 라벨이 없어서 parseTranscript 가 "직전 발언에 이어지는 줄"로
//   보고 **본문 뒤에 붙여버린다.** 반드시 먼저 걷어내야 한다.
//
// 이 모듈은 LLM 을 쓰지 않는다. 근거 U-ID 체계의 앞단이므로 결정적이어야 한다.

export type SubtitleFormat = "srt" | "vtt";

export type SubtitleDiagnostic = {
  /** 원본 파일 기준 줄 번호 (1-base) */
  line: number;
  code:
    | "no_speaker_inherited"   // 화자 라벨이 없어 직전 화자를 승계함
    | "no_speaker_unresolved"  // 승계할 직전 화자도 없음
    | "timecode_overflow"      // 99:59 초과 — 타임코드 없이 내보냄
    | "empty_cue"              // 본문이 빈 큐
    | "malformed_cue";         // 타임코드 줄을 해석하지 못함
  detail: string;
  /** 사람이 미리보기에서 확인할 원문 */
  raw: string;
};

export type SubtitleConversion = {
  /** parseTranscript 에 그대로 넣을 수 있는 문자열 */
  transcript: string;
  format: SubtitleFormat;
  cueCount: number;
  /** 화자를 찾은 큐 수 */
  speakerResolvedCount: number;
  diagnostics: SubtitleDiagnostic[];
};

/** `HH:MM:SS,mmm` / `HH:MM:SS.mmm` / `MM:SS.mmm` 모두 허용. */
const TIMECODE = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})|(\d{1,3}):(\d{2})[,.](\d{1,3})/;
const CUE_ARROW = /-->/;
/** 화자 라벨: `이름:` 또는 `이름(역할):` — parseTranscript 의 40자 제한과 맞춘다. */
const SPEAKER = /^([^:]{1,40}):\s*(.+)$/;

/** parseTranscript 가 읽을 수 있는 최대 분(`\d{1,2}`). 초과분은 타임코드를 버린다. */
const MAX_MINUTES = 99;

export function detectSubtitleFormat(source: string): SubtitleFormat | null {
  const head = source.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT/i.test(head)) return "vtt";
  // 큐 번호 + 타임코드 화살표가 있으면 SRT 로 본다.
  if (CUE_ARROW.test(head) && TIMECODE.test(head)) return "srt";
  return null;
}

function toTotalSeconds(timecodePart: string): number | null {
  const m = timecodePart.match(TIMECODE);
  if (!m) return null;
  if (m[1] !== undefined) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return Number(m[5]) * 60 + Number(m[6]);
}

/** 총 초 → `MM:SS`. 시간 단위는 분으로 누적한다(01:05:30 → 65:30). */
function toMinuteSecond(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * SRT/VTT → `[MM:SS] 화자: 본문` 줄들로 변환한다.
 * 화자 라벨이 없는 큐는 직전 화자를 승계하되 진단에 남긴다 — 조용히 넘기지 않는다.
 */
export function convertSubtitleToTranscript(
  source: string,
  formatHint?: SubtitleFormat,
): SubtitleConversion {
  const clean = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const format = formatHint ?? detectSubtitleFormat(clean) ?? "srt";
  const lines = clean.split("\n");

  const out: string[] = [];
  const diagnostics: SubtitleDiagnostic[] = [];
  let cueCount = 0;
  let speakerResolvedCount = 0;
  let lastSpeaker: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const lineNo = i + 1;
    const line = lines[i].trim();

    // VTT 헤더 · NOTE 블록 · 빈 줄 · 큐 번호만 있는 줄은 건너뛴다.
    if (!line || /^WEBVTT/i.test(line) || /^NOTE\b/.test(line) || /^\d+$/.test(line)) {
      i += 1;
      continue;
    }

    if (!CUE_ARROW.test(line)) {
      // 타임코드 없이 떠 있는 본문 줄 — 앞선 큐에 이미 흡수되지 않았다면 버린다.
      i += 1;
      continue;
    }

    // ── 타임코드 줄 ──
    const startPart = line.split(CUE_ARROW)[0] ?? "";
    const startSeconds = toTotalSeconds(startPart);
    if (startSeconds === null) {
      diagnostics.push({
        line: lineNo, code: "malformed_cue",
        detail: "타임코드를 해석하지 못했습니다.", raw: line,
      });
      i += 1;
      continue;
    }

    // ── 본문 줄 수집 (다음 빈 줄 또는 다음 큐 전까지) ──
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const t = lines[j].trim();
      if (!t) break;
      if (CUE_ARROW.test(t)) break;
      // 다음 큐 번호를 만나면 멈춘다 (빈 줄이 없는 파일 방어)
      if (/^\d+$/.test(t) && j + 1 < lines.length && CUE_ARROW.test(lines[j + 1] ?? "")) break;
      body.push(t);
      j += 1;
    }
    i = j;

    cueCount += 1;
    const text = body.join(" ").replace(/\s+/g, " ").trim();
    if (!text) {
      diagnostics.push({
        line: lineNo, code: "empty_cue",
        detail: "본문이 비어 있는 큐입니다.", raw: line,
      });
      continue;
    }

    // ── 화자 판정 ──
    const speakerMatch = text.match(SPEAKER);
    let speaker: string | null = null;
    let spoken = text;
    if (speakerMatch && !/[*_[\]`]/.test(speakerMatch[1])) {
      speaker = speakerMatch[1].trim();
      spoken = speakerMatch[2].trim();
      lastSpeaker = speaker;
      speakerResolvedCount += 1;
    } else if (lastSpeaker) {
      speaker = lastSpeaker;
      diagnostics.push({
        line: lineNo, code: "no_speaker_inherited",
        detail: `화자 라벨이 없어 직전 화자 '${lastSpeaker}' 를 승계했습니다.`,
        raw: text,
      });
    } else {
      diagnostics.push({
        line: lineNo, code: "no_speaker_unresolved",
        detail: "화자를 찾지 못했고 승계할 직전 화자도 없습니다. 이 큐는 제외됩니다.",
        raw: text,
      });
      continue;
    }

    // ── 타임코드 표기 ──
    const minutes = Math.floor(startSeconds / 60);
    if (minutes > MAX_MINUTES) {
      // parseTranscript 는 분을 2자리까지만 읽는다. 잘못된 시각을 쓰느니 생략한다.
      diagnostics.push({
        line: lineNo, code: "timecode_overflow",
        detail: `${minutes}분은 표기 한도(${MAX_MINUTES}분)를 넘어 타임코드 없이 기록합니다.`,
        raw: text,
      });
      out.push(`${speaker}: ${spoken}`);
    } else {
      out.push(`[${toMinuteSecond(startSeconds)}] ${speaker}: ${spoken}`);
    }
  }

  return {
    transcript: out.join("\n"),
    format,
    cueCount,
    speakerResolvedCount,
    diagnostics,
  };
}
