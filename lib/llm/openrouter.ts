/**
 * OpenRouter 공용 클라이언트 (채팅·구조화 출력·임베딩).
 *
 * 규칙
 *   - 키가 없으면 NOT_CONFIGURED 를 던진다. 픽스처로 대체하지 않는다.
 *   - 구조화 출력은 json_schema strict 로 요청하고, provider.require_parameters 로
 *     그 기능을 지원하지 않는 엔드포인트를 뺀다. 응답은 호출한 쪽이 zod 로 다시 검증한다.
 *   - 사용량(토큰·비용)은 응답에 있는 값만 기록한다. 없으면 null 이다.
 */

const BASE = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";

export type LlmErrorCode = "NOT_CONFIGURED" | "PROVIDER_ERROR" | "TIMEOUT" | "INVALID_OUTPUT";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type Usage = {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
};

export function openRouterKey(): string | null {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  return k ? k : null;
}

function requireKey(): string {
  const k = openRouterKey();
  if (!k) throw new LlmError("NOT_CONFIGURED", "OPENROUTER_API_KEY 가 설정되지 않았습니다. 가짜 결과로 대체하지 않습니다.");
  return k;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * OpenRouter 는 오래 걸리는 요청에 200 헤더를 먼저 보내고 본문을 나중에 보낸다. 그래서 타임아웃이 본문을 읽는 중에
 * 걸릴 수 있다. 본문 읽기도 같은 try 안에 두어, 그 경우를 "HTTP 200" 이 아니라 TIMEOUT 으로 알린다.
 */
async function post(path: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ json: any; status: number; text: string }> {
  const key = requireKey();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "x-title": "SceneNote",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { json, status: res.status, text };
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) {
      throw new LlmError("TIMEOUT", `OpenRouter 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다.`);
    }
    throw new LlmError("PROVIDER_ERROR", `OpenRouter 호출 실패: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function toUsage(model: string, json: any, latencyMs: number): Usage {
  const u = json?.usage ?? {};
  return {
    model: json?.model ?? model,
    promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : null,
    completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : null,
    costUsd: typeof u.cost === "number" ? u.cost : null,
    latencyMs,
  };
}

const stripFence = (s: string) => s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

/**
 * 모델이 받는 인자 목록. 구조화 출력을 지원하는 엔드포인트들의 합집합이다.
 * 예: claude-sonnet-5 엔드포인트는 temperature 를 받지 않는다. require_parameters 와 함께
 * 보내면 "No endpoints found" 가 나므로, 받지 않는 인자는 빼고 보낸다.
 */
const paramCache = new Map<string, Promise<Set<string> | null>>();
export function supportedParams(model: string): Promise<Set<string> | null> {
  const hit = paramCache.get(model);
  if (hit) return hit;
  const p = (async () => {
    try {
      const res = await fetch(`${BASE}/models/${model}/endpoints`);
      const json: any = await res.json();
      const eps: any[] = json?.data?.endpoints ?? [];
      const structured = eps.filter((e) => (e.supported_parameters ?? []).includes("structured_outputs"));
      const pool = structured.length ? structured : eps;
      return new Set<string>(pool.flatMap((e) => e.supported_parameters ?? []));
    } catch {
      return null; // 조회 실패면 인자를 거르지 않는다
    }
  })();
  paramCache.set(model, p);
  return p;
}

/**
 * 구조화 출력 채팅. schema 는 JSON Schema(draft-07). 반환값은 파싱만 한 객체이며,
 * 호출한 쪽이 zod 로 검증한다. 5xx·타임아웃은 한 번 다시 시도한다.
 */
export async function chatJson(opts: {
  model: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ data: unknown; usage: Usage; raw: string }> {
  const { $schema: _drop, ...schema } = opts.schema as Record<string, unknown> & { $schema?: string };
  const supported = await supportedParams(opts.model);
  const accepts = (p: string) => !supported || supported.has(p);
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema },
    },
    provider: { require_parameters: true },
    usage: { include: true },
  };
  if (accepts("max_tokens")) body.max_tokens = opts.maxTokens ?? 16000;
  if (accepts("temperature")) body.temperature = opts.temperature ?? 0;

  // 긴 일괄 분석(107발언, Sonnet)은 200초를 넘기도 한다. 짧은 호출만 타임아웃 뒤 다시 시도한다(긴 호출을 두 번 기다리지 않는다).
  const timeoutMs = opts.timeoutMs ?? 300_000;
  let lastErr: LlmError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = Date.now();
    let res: { json: any; status: number; text: string };
    try {
      res = await post("/chat/completions", body, timeoutMs, opts.signal);
    } catch (e) {
      lastErr = e instanceof LlmError ? e : new LlmError("PROVIDER_ERROR", (e as Error).message);
      if (lastErr.code === "TIMEOUT" && attempt === 1 && timeoutMs <= 120_000) continue;
      throw lastErr;
    }
    const latencyMs = Date.now() - t0;
    if (res.status >= 500 && attempt === 1) {
      lastErr = new LlmError("PROVIDER_ERROR", `OpenRouter HTTP ${res.status}`);
      continue;
    }
    if (res.status < 400 && !res.json && attempt === 1) {
      lastErr = new LlmError("PROVIDER_ERROR", `OpenRouter 응답을 JSON 으로 읽지 못했습니다: ${res.text.slice(0, 200)}`);
      continue;
    }
    if (res.status >= 400 || !res.json) {
      throw new LlmError(
        "PROVIDER_ERROR",
        `OpenRouter 응답 오류: ${res.json?.error?.message ?? `HTTP ${res.status} ${res.text.slice(0, 200)}`}`,
        res.json,
      );
    }
    // 200 이지만 본문에 오류가 들어 있는 경우(공급자가 도중에 실패). 한 번 다시 시도한다.
    if (res.json.error && !res.json.choices?.length) {
      lastErr = new LlmError("PROVIDER_ERROR", `OpenRouter 공급자 오류: ${res.json.error.message ?? JSON.stringify(res.json.error).slice(0, 200)}`, res.json);
      if (attempt === 1) continue;
      throw lastErr;
    }
    const content: string = res.json?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new LlmError("INVALID_OUTPUT", "LLM 응답이 비어 있습니다.", res.json);
    try {
      return { data: JSON.parse(stripFence(content)), usage: toUsage(opts.model, res.json, latencyMs), raw: content };
    } catch {
      throw new LlmError("INVALID_OUTPUT", "LLM 응답을 JSON 으로 읽지 못했습니다.", content.slice(0, 500));
    }
  }
  throw lastErr ?? new LlmError("PROVIDER_ERROR", "알 수 없는 오류");
}

/** 임베딩. 기본 baai/bge-m3. 입력 순서대로 벡터를 돌려준다. */
export async function embed(
  texts: string[],
  opts: { model?: string; timeoutMs?: number } = {},
): Promise<{ vectors: number[][]; usage: Usage }> {
  const model = opts.model ?? process.env.SCENENOTE_EMBED_MODEL ?? "baai/bge-m3";
  if (texts.length === 0) return { vectors: [], usage: { model, promptTokens: 0, completionTokens: 0, costUsd: 0, latencyMs: 0 } };
  const t0 = Date.now();
  const res = await post("/embeddings", { model, input: texts }, opts.timeoutMs ?? 60_000);
  if (res.status >= 400 || !res.json?.data) {
    throw new LlmError("PROVIDER_ERROR", `임베딩 실패: ${res.json?.error?.message ?? `HTTP ${res.status}`}`, res.json);
  }
  const rows = [...res.json.data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
  return { vectors: rows.map((r: any) => r.embedding as number[]), usage: toUsage(model, res.json, Date.now() - t0) };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function sumUsage(us: Usage[]): { calls: number; promptTokens: number; completionTokens: number; costUsd: number | null; latencyMs: number } {
  const cost = us.every((u) => u.costUsd !== null) ? us.reduce((s, u) => s + (u.costUsd ?? 0), 0) : null;
  return {
    calls: us.length,
    promptTokens: us.reduce((s, u) => s + (u.promptTokens ?? 0), 0),
    completionTokens: us.reduce((s, u) => s + (u.completionTokens ?? 0), 0),
    costUsd: cost,
    latencyMs: us.reduce((s, u) => s + u.latencyMs, 0),
  };
}
