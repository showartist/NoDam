// 파이프라인 ① 발화 정리 — 전사 텍스트를 U-ID 단위 발언으로 쪼갠다.
// 이 단계에는 LLM이 개입하지 않는다. 근거 ID 체계의 기준점이므로 결정적이어야 한다.

export type ParsedUtterance = {
  uid: string;
  speakerName: string;
  role: string | null;
  tsStart: string | null;
  tsEnd: string | null;
  textRaw: string;
  textClean: string;
  stageDirection: string | null;
};

// **U01** `00:00` 최윤경(제작): 본문
const RE_MD = /^\*\*(U\d+)\*\*\s+`(\d{1,2}:\d{2})`\s+([^:]{1,40}):\s*(.+)$/;
// U01 00:00 최윤경: 본문
const RE_ID_TS = /^(U\d+)[.)\]]?\s+(\d{1,2}:\d{2})\s+([^:]{1,40}):\s*(.+)$/;
// U01 최윤경: 본문
const RE_ID = /^(U\d+)[.)\]]?\s+([^:]{1,40}):\s*(.+)$/;
// [00:12] 최윤경: 본문  /  00:12 최윤경: 본문
const RE_TS = /^\[?(\d{1,2}:\d{2})\]?\s+([^:]{1,40}):\s*(.+)$/;
// 최윤경: 본문
const RE_PLAIN = /^([^:]{1,40}):\s*(.+)$/;

const LEADING_DIRECTION = /^\(([^)]{1,40})\)\s*/;

/** 화자 자리에 마크다운 강조나 링크가 들어 있으면 발언 줄이 아니다. */
const looksLikeSpeaker = (field: string) => !/[*_[\]`]/.test(field);

function splitSpeaker(field: string): { name: string; role: string | null } {
  const m = field.match(/^([^(（]+)[(（]([^)）]+)[)）]\s*$/);
  if (m) return { name: m[1].trim(), role: m[2].trim() };
  return { name: field.trim(), role: null };
}

function toSeconds(ts: string): number {
  const [m, s] = ts.split(":").map(Number);
  return m * 60 + s;
}

function toTs(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

export function parseTranscript(raw: string): ParsedUtterance[] {
  const rows: Omit<ParsedUtterance, "tsEnd">[] = [];

  for (const line of raw.split("\n")) {
    const t = line.trim();
    // 제목·표·인용·목록 등 마크다운 장식 줄은 발언이 아니다.
    // ("- **테스트 A**: 설명" 같은 줄이 '화자: 대사'로 오인되는 것을 막는다.)
    if (!t || /^([#|>]|---|[-*+]\s)/.test(t)) continue;

    let uid: string | null = null;
    let ts: string | null = null;
    let speaker = "";
    let body = "";

    let m: RegExpMatchArray | null;
    if ((m = t.match(RE_MD)) || (m = t.match(RE_ID_TS))) {
      [, uid, ts, speaker, body] = m;
    } else if ((m = t.match(RE_ID))) {
      [, uid, speaker, body] = m;
    } else if ((m = t.match(RE_TS))) {
      [, ts, speaker, body] = m;
    } else if ((m = t.match(RE_PLAIN)) && looksLikeSpeaker(m[1])) {
      [, speaker, body] = m;
    } else {
      // 화자 라벨 없이 이어지는 줄은 직전 발언에 붙인다.
      if (rows.length) {
        const prev = rows[rows.length - 1];
        prev.textRaw = `${prev.textRaw} ${t}`;
        prev.textClean = `${prev.textClean} ${t}`;
      }
      continue;
    }

    const { name, role } = splitSpeaker(speaker);
    if (!name) continue;

    const textRaw = body.trim();
    const dir = textRaw.match(LEADING_DIRECTION);
    const textClean = (dir ? textRaw.slice(dir[0].length) : textRaw).replace(/\s+/g, " ").trim();

    rows.push({
      uid: uid ?? "",
      speakerName: name,
      role,
      tsStart: ts,
      textRaw,
      textClean: textClean || textRaw,
      stageDirection: dir ? dir[1] : null,
    });
  }

  // U-ID가 전사에 없으면 순번으로 부여한다. 하나라도 있으면 원본을 그대로 존중한다.
  const hasIds = rows.some((r) => r.uid);
  return rows.map((r, i) => {
    const nextTs = rows[i + 1]?.tsStart ?? null;
    return {
      ...r,
      uid: hasIds ? r.uid || `U${String(i + 1).padStart(2, "0")}` : `U${String(i + 1).padStart(2, "0")}`,
      // 종료 시각은 다음 발언 시작 시각으로 근사한 값이다. STT 연결 시 실측으로 대체한다.
      tsEnd: r.tsStart ? (nextTs ?? toTs(toSeconds(r.tsStart) + 8)) : null,
    };
  });
}
