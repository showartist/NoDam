// 직렬화된 필드 정규화 — 보고서 렌더을 위한 단일 진입점.
//
// evidence 는 런타임에 다음 형태로 들어올 수 있다.
//   string[]              (정상)
//   JSON 배열 문자열       "[\"U01\",\"U03\"]"  (DB 저장 형식 — SQLite 는 배열을 못 담아 문자열로 저장한다)
//   단일 U-ID 문자열       "U01"
//   null / undefined
//   깨진 JSON 문자열       "{broken"
//   예상 밖 타입           숫자, 객체
//
// 여러 곳에서 각자 처리하지 않고 이 함수 하나만 거친다.
// 잘못된 데이터를 조용히 지어내지 않는다 — 걸러내고 경고를 남긴다.

/** 실제 U-ID 형식. U + 숫자 2자리 이상. (U01 ~ U107 확인됨) */
const UID_PATTERN = /^U\d{2,}$/;

export type EvidenceWarning = {
  meetingId: string;
  recordId: string;
  field: string;
  reason: "malformed_json" | "not_an_array" | "non_string_item" | "invalid_uid_format";
  raw: unknown;
};

/**
 * 정규화 경고 훅. 기본은 console.warn 이지만 테스트에서 가로채 검증할 수 있도록
 * 교체 가능하게 둔다. 사용자에게는 절대 노출하지 않는다 — 서버 로그 전용이다.
 */
let warn: (w: EvidenceWarning) => void = (w) => {
  console.warn(
    `[evidence] ${w.reason} — meeting=${w.meetingId} record=${w.recordId} field=${w.field} raw=${JSON.stringify(w.raw)?.slice(0, 200)}`,
  );
};

export function setEvidenceWarningHandler(fn: typeof warn) {
  warn = fn;
}

export type EvidenceContext = { meetingId: string; recordId: string; field: string };

/**
 * evidence 를 유효한 U-ID 문자열 배열로 정규화한다.
 * 이상한 데이터는 존재하지 않는 U-ID를 만들어내지 않고 걸러낸 뒤 경고를 남긴다.
 * 중복은 조용히 제거한다 (이상 데이터가 아니라 정상적으로 발생할 수 있는 상태).
 */
export function normalizeEvidence(raw: unknown, ctx: EvidenceContext): string[] {
  let candidate: unknown = raw;

  if (raw == null) return [];

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (UID_PATTERN.test(trimmed)) {
      candidate = [trimmed];
    } else {
      try {
        candidate = JSON.parse(trimmed);
      } catch {
        warn({ ...ctx, reason: "malformed_json", raw });
        return [];
      }
    }
  }

  if (!Array.isArray(candidate)) {
    warn({ ...ctx, reason: "not_an_array", raw: candidate });
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of candidate) {
    if (typeof item !== "string") {
      warn({ ...ctx, reason: "non_string_item", raw: item });
      continue;
    }
    const t = item.trim();
    if (!UID_PATTERN.test(t)) {
      warn({ ...ctx, reason: "invalid_uid_format", raw: item });
      continue;
    }
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}
