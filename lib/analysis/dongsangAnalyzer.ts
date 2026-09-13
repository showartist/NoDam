/**
 * 동상이몽 분석 — OpenRouter LLM 호출.
 *
 * "몇 점이냐"를 묻지 않는다. 같은 표현을 서로 다른 뜻으로 쓴 지점을 찾고, 각 해석마다
 * 실제 발언 U-ID 를 붙이게 한다. 근거 없는 해석은 코드에서 버린다.
 *
 * ⚠️ 키가 없거나 호출이 실패하면 status:"failed" 를 반환한다. 픽스처로 대체하지 않는다.
 */
import {
  AnalysisError,
  type AlignmentIssueLlm,
  type AnalysisInputUtterance,
  type DongSangAnalysis,
  type ExplicitAgreement,
  type Interpretation,
} from "./types";

export { calculateDongsangIndex } from "./dongsangIndex";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_ANALYSIS_MODEL ?? "anthropic/claude-sonnet-5";

const SYSTEM_PROMPT = `당신은 회의 전사를 읽고 "같은 말을 서로 다르게 이해한 지점"을 찾는 분석기다.

찾아야 하는 것은 단 하나다.
  여러 참석자가 같은 표현(개념)을 쓰면서 서로 다른 대상·범위·방법을 뜻한 경우.

지켜야 할 규칙:
1. 발언에 없는 생각을 추측하지 마라. 근거가 없으면 그 해석을 만들지 마라.
2. 모든 해석에는 반드시 실제 U-ID 근거가 있어야 한다. 지어낸 U-ID 는 금지다.
3. 동상이몽이 없으면 issues 를 빈 배열로 두라. 억지로 갈등을 만들지 마라.
4. 단어가 다르다는 이유만으로 차이라고 판정하지 마라. 뜻이 실제로 갈려야 한다.
5. 같은 단어를 썼다는 이유만으로 합의라고 판정하지 마라.
6. 이미 명시적으로 정리된 차이는 issues 에 넣지 말고 agreements 에 넣어라.
7. 화자가 한 명뿐이면 서로 다른 해석이 성립하지 않는다. issues 는 빈 배열이다.
7-1. 같은 SPEAKER_xx 는 떨어져 있어도 한 사람이다. 그 사람의 발언들을 하나의 관점으로 묶어라.
     같은 사람이 나중에 정정했다면 그건 두 사람의 차이가 아니다.
7-2. "화자 미상"으로 표시된 발언은 화자를 알 수 없다는 뜻이다. 서로 다른 사람이라고 단정하지 마라.
8. 확실하지 않으면 confidence 를 낮추고, 그래도 애매하면 넣지 마라.

impact 기준:
  high   = 이대로 진행하면 결과물이 서로 다르게 나온다
  medium = 나중에 조정 가능하지만 확인이 필요하다
  low    = 표현 차이에 가깝다

반드시 아래 JSON 만 출력하라. 설명 문장을 붙이지 마라.
{
  "issues": [
    {
      "decision": "무엇에 대한 결정인가",
      "concept": "서로 다르게 이해된 표현",
      "status": "needs_confirmation" | "conflict",
      "interpretations": [
        { "speaker_id": "SPEAKER_01 또는 null", "speaker_name": "이름 또는 null",
          "meaning": "이 사람이 뜻한 것", "evidence_uids": ["U-001"] }
      ],
      "difference_summary": "무엇이 어떻게 갈렸는지 한 문장",
      "impact": "high" | "medium" | "low",
      "confidence": 0.0~1.0
    }
  ],
  "agreements": [
    { "topic": "합의된 주제", "summary": "무엇으로 정해졌는지", "evidence_uids": ["U-003"] }
  ]
}`;

export async function analyzeDongSang(
  utterances: AnalysisInputUtterance[],
  opts?: { model?: string; signal?: AbortSignal },
): Promise<DongSangAnalysis> {
  const model = opts?.model ?? DEFAULT_MODEL;

  if (utterances.length === 0) {
    throw new AnalysisError("NO_INPUT", "분석할 발언이 없습니다.");
  }
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new AnalysisError(
      "NOT_CONFIGURED",
      "OPENROUTER_API_KEY 가 설정되지 않아 동상이몽 분석을 실행할 수 없습니다.",
    );
  }

  const validUids = new Set(utterances.map((u) => u.uid));
  // 화자 식별자를 반드시 함께 넘긴다. 이게 빠지면 LLM 은 떨어져 있는 두 발언이
  // 같은 사람인지 알 수 없고, "세 사람이 다르게 이해했다"를 판정할 수 없다.
  const transcript = utterances
    .map((u) => {
      const who = u.speakerName ? `${u.speakerId ?? "화자 미상"} (${u.speakerName})` : (u.speakerId ?? "화자 미상");
      return `${u.uid} | ${who}\n${u.text}`;
    })
    .join("\n\n");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: opts?.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `회의 전사:\n${transcript}` },
        ],
      }),
    });
  } catch (e) {
    throw new AnalysisError("LLM_FAILED", `OpenRouter 호출 실패: ${(e as Error).message}`);
  }

  const payload = (await res.json().catch(() => null)) as any;
  if (!res.ok || !payload) {
    throw new AnalysisError(
      "LLM_FAILED",
      `OpenRouter 응답 오류: ${payload?.error?.message ?? `HTTP ${res.status}`}`,
    );
  }

  const content: string = payload?.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new AnalysisError("INVALID_OUTPUT", "LLM 응답이 비어 있습니다.");

  let parsed: any;
  try {
    parsed = JSON.parse(stripFence(content));
  } catch {
    throw new AnalysisError("INVALID_OUTPUT", "LLM 응답을 JSON 으로 읽지 못했습니다.");
  }

  return {
    status: "completed",
    provider: "openrouter",
    model,
    issues: normalizeIssues(parsed.issues, utterances),
    agreements: normalizeAgreements(parsed.agreements, validUids),
    error: null,
  };
}

/** 근거 없는 해석·존재하지 않는 U-ID 를 걸러낸다. LLM 출력을 그대로 믿지 않는다. */
function normalizeIssues(raw: unknown, utterances: AnalysisInputUtterance[]): AlignmentIssueLlm[] {
  const byUid = new Map(utterances.map(u => [u.uid, u]));
  const validUids = new Set(byUid.keys());
  if (!Array.isArray(raw)) return [];
  const out: AlignmentIssueLlm[] = [];

  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const interpretations: Interpretation[] = [];

    for (const i of Array.isArray(r.interpretations) ? r.interpretations : []) {
      const uids = keepValidUids(i?.evidence_uids, validUids);
      const meaning = str(i?.meaning);
      // 근거 없는 해석은 버린다. 이게 없으면 LLM 이 인상만으로 말할 수 있다.
      if (uids.length === 0 || !meaning) continue;
      const sources = uids.map(uid => byUid.get(uid)!);
      const speakerIds = new Set(sources.map(u => u.speakerId));
      if (speakerIds.size !== 1 || !sources[0].speakerId) continue;
      const source = sources[0];
      if (interpretations.some(p => p.speakerId === source.speakerId)) continue;
      interpretations.push({
        speakerId: source.speakerId,
        speakerName: source.speakerName,
        meaning,
        evidenceUids: uids,
      });
    }

    // 서로 다른 해석이 2개 이상일 때만 동상이몽이다.
    if (interpretations.length < 2) continue;

    out.push({
      decision: str(r.decision) || str(r.concept) || "미상",
      concept: str(r.concept) || "",
      status: r.status === "conflict" ? "conflict" : "needs_confirmation",
      interpretations,
      differenceSummary: str(r.difference_summary),
      impact: r.impact === "high" || r.impact === "low" ? r.impact : "medium",
      confidence: typeof r.confidence === "number" ? clamp01(r.confidence) : null,
    });
  }
  return out;
}

function normalizeAgreements(raw: unknown, validUids: Set<string>): ExplicitAgreement[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      topic: str(r.topic),
      summary: str(r.summary),
      evidenceUids: keepValidUids(r.evidence_uids, validUids),
    }))
    .filter((a) => a.topic && a.evidenceUids.length > 0);
}

const keepValidUids = (v: unknown, valid: Set<string>): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => valid.has(x));

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const stripFence = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
