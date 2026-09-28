/**
 * 해석 차이 탐지 v2 규칙 검사. LLM 을 부르지 않는 순수 함수만 둔다.
 *
 *   화자 근거 검사 — 입장의 근거 발언 중에 그 화자가 직접 한 발언이 있는가
 *   인용 검사     — quote 가 근거 발언 원문에 실제로 있는가 (바꿔 쓴 인용은 떨어뜨린다)
 *   상태 조정     — 합의 후보인데 근거 발언에 조건·보류 표현이 있으면 조건부 합의로 내린다
 */
import type { MeetingUtterance } from "./store";

/** 비교용 정규화: 공백·문장부호를 지우고 NFC 로 맞춘다. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s.,!?…~·"'“”‘’()[\]{}:;\-–—/\\]/g, "")
    .toLowerCase();
}

/** 가장 긴 공통 부분 문자열의 길이. 발언은 수백 자라 O(n·m) 로 충분하다. */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * 인용 검사. 정규화한 quote 가 근거 발언 하나에 통째로 있으면 ok.
 * STT 띄어쓰기·조사 차이를 흡수하려고, 공통 부분 문자열이 quote 의 85% 이상이면 ok 로 본다.
 */
export function quoteFound(quote: string, texts: string[], minRatio = 0.85): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < 4) return false;
  for (const t of texts) {
    const n = normalizeForMatch(t);
    if (n.includes(q)) return true;
    if (longestCommonSubstring(q, n) >= Math.ceil(q.length * minRatio)) return true;
  }
  return false;
}

export type SpeakerCheck = "ok" | "mismatch" | "unknown_speaker";

/** 근거 발언 중 이 화자가 직접 한 발언이 하나 이상 있어야 ok. */
export function checkSpeakerEvidence(
  speakerKey: string | null,
  evidence: string[],
  byUid: Map<string, MeetingUtterance>,
): { result: SpeakerCheck; own: string[] } {
  if (!speakerKey) return { result: "unknown_speaker", own: [] };
  const own = evidence.filter((e) => byUid.get(e)?.speakerKey === speakerKey);
  return { result: own.length > 0 ? "ok" : "mismatch", own };
}

/** 조건·보류 표현. 합의 후보 판정을 내리는 데만 쓴다(안건을 새로 만들지는 않는다). */
export const CONDITION_PATTERNS: RegExp[] = [
  /확인\s*(전|후|되면|해\s*보고)/,
  /전까지/,
  /열어\s*(두|둡|놓)/,
  /보류/,
  /해\s*보고/,
  /답사\s*(때|후|전|에서)/,
  /테스트(해|를|하)/,
  /나중에/,
  /임시로/,
  /가능하(면|다는)/,
  /안\s*되면/,
  /보고\s*(정|결정|바꾸)/,
  /(오면|나오면)\s*그때/,
];

export function conditionPhrase(text: string): string | null {
  for (const re of CONDITION_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}
