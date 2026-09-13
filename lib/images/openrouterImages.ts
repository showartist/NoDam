/**
 * OpenRouter 이미지 생성 클라이언트.
 *
 * POST https://openrouter.ai/api/v1/images   (2026-09-11 문서 확인 + 실호출 1회로 응답 형태 확인)
 *
 *   요청  { model, prompt,
 *           resolution?: "512" | "1K" | "2K" | "4K",          // 모델별 지원 값이 다르다
 *           aspect_ratio?: "16:9" …,
 *           quality?: "low" | "medium" | "high",               // gpt-image 계열만
 *           input_references?: [{ type: "image_url", image_url: { url: "data:image/png;base64,…" } }] }
 *   응답  { created, data: [{ b64_json, media_type }],
 *           usage: { prompt_tokens, completion_tokens, cost, cost_details, … } }
 *   오류  { error: { code, message } }                          // 401·402·404·429·5xx
 *         { success: false, error: { name: "ZodError", message } } // 파라미터 검증 400
 *
 *   모델별 지원 파라미터·참조 이미지 개수는 GET /api/v1/images/models 가 알려 준다(무인증).
 *   google/gemini-3.1-flash-image: resolution 512|1K|2K|4K, 비율 14종, input_references 최대 14장.
 *   과금은 all-or-nothing 이다. 실패·취소된 요청은 과금되지 않는다(OpenRouter 문서).
 *
 * 규칙
 *   - 키가 없으면 호출하지 않고 NOT_CONFIGURED 를 던진다. 픽스처 이미지로 대체하지 않는다.
 *   - 5xx·네트워크 오류만 한 번 재시도한다. 타임아웃은 재시도하지 않는다
 *     (우리가 끊어도 공급자는 끝까지 만들어 과금할 수 있다).
 *   - 비용은 응답 usage.cost 가 있을 때만 기록한다. 없으면 null. 단가표로 계산하지 않는다.
 */
import { ImageGenError } from "./errors";
import { imageSize, sniffMediaType, type ImageMediaType } from "./imageBytes";

export { ImageGenError, httpStatusFor, type ImageErrorCode } from "./errors";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const IMAGES_ENDPOINT = `${OPENROUTER_BASE}/images`;
export const IMAGE_MODELS_ENDPOINT = `${OPENROUTER_BASE}/images/models`;
export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-image";
export const DEFAULT_ASPECT_RATIO = "16:9";

export type ImageResolution = "draft" | "final";

/** draft 는 먼저 보여 주는 가벼운 판, final 은 요청할 때만 만드는 큰 판. */
export const RESOLUTION_TIER: Record<ImageResolution, string> = { draft: "1K", final: "2K" };
const QUALITY_TIER: Record<ImageResolution, string> = { draft: "low", final: "high" };
const DEFAULT_TIMEOUT_MS: Record<ImageResolution, number> = { draft: 120_000, final: 180_000 };

export function imageModel(): string {
  return process.env.SCENENOTE_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

function apiKey(): string | null {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  return k ? k : null;
}

export function isImageGenConfigured(): boolean {
  return apiKey() !== null;
}

// ── 모델별 지원 파라미터 ────────────────────────────────────────────────────

export type ModelCaps = {
  /** resolution 파라미터 값. null 이면 이 모델은 resolution 을 받지 않는다 */
  resolutions: string[] | null;
  aspectRatios: string[] | null;
  /** quality 파라미터 값 (gpt-image 계열) */
  qualities: string[] | null;
  maxReferences: number;
  source: "static" | "catalog" | "unknown";
};

const GEMINI_RATIOS = ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

/** 2026-09-11 GET /api/v1/images/models 에서 옮겨 적은 값. 여기 없는 모델은 카탈로그를 조회한다. */
const STATIC_CAPS: Record<string, Omit<ModelCaps, "source">> = {
  "google/gemini-3.1-flash-image": { resolutions: ["512", "1K", "2K", "4K"], aspectRatios: GEMINI_RATIOS, qualities: null, maxReferences: 14 },
  "google/gemini-3.1-flash-image-preview": { resolutions: ["512", "1K", "2K", "4K"], aspectRatios: GEMINI_RATIOS, qualities: null, maxReferences: 14 },
  "google/gemini-3-pro-image": {
    resolutions: ["1K", "2K", "4K"],
    aspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
    qualities: null,
    maxReferences: 14,
  },
  "openai/gpt-image-2": {
    resolutions: null,
    aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto"],
    qualities: ["auto", "low", "medium", "high"],
    maxReferences: 16,
  },
  "black-forest-labs/flux.2-pro": {
    resolutions: null,
    aspectRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "auto"],
    qualities: null,
    maxReferences: 8,
  },
};

let catalogCache: { at: number; byId: Map<string, ModelCaps> } | null = null;
const CATALOG_TTL_MS = 60 * 60 * 1000;

type CatalogParam = { type?: string; values?: unknown[]; min?: number; max?: number };

function capsFromCatalogEntry(sp: Record<string, CatalogParam> | undefined): ModelCaps {
  const vals = (p?: CatalogParam) => (Array.isArray(p?.values) ? p!.values!.map(String) : null);
  return {
    resolutions: vals(sp?.resolution),
    aspectRatios: vals(sp?.aspect_ratio),
    qualities: vals(sp?.quality),
    maxReferences: typeof sp?.input_references?.max === "number" ? sp.input_references.max : 0,
    source: "catalog",
  };
}

/**
 * 모델이 받는 파라미터. 정적 표 → 카탈로그(1시간 캐시) 순서로 찾는다.
 * 둘 다 실패하면 참조 이미지·resolution 을 보내지 않는 보수적 기본값을 쓴다.
 */
export async function getModelCaps(model: string, opts: { timeoutMs?: number } = {}): Promise<ModelCaps> {
  const fixed = STATIC_CAPS[model];
  if (fixed) return { ...fixed, source: "static" };

  if (!catalogCache || Date.now() - catalogCache.at > CATALOG_TTL_MS) {
    try {
      const res = await fetch(IMAGE_MODELS_ENDPOINT, { signal: AbortSignal.timeout(opts.timeoutMs ?? 8000) });
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string; supported_parameters?: Record<string, CatalogParam> }> };
        const byId = new Map<string, ModelCaps>();
        for (const m of json.data ?? []) byId.set(m.id, capsFromCatalogEntry(m.supported_parameters));
        catalogCache = { at: Date.now(), byId };
      }
    } catch {
      // 카탈로그를 못 읽어도 생성은 시도한다. 아래 보수적 기본값으로 간다.
    }
  }
  const found = catalogCache?.byId.get(model);
  if (found) return found;
  return { resolutions: null, aspectRatios: null, qualities: null, maxReferences: 0, source: "unknown" };
}

/** 테스트용: 카탈로그 캐시 비우기 */
export function _resetModelCapsCache(): void {
  catalogCache = null;
}

// ── 요청 조립 ───────────────────────────────────────────────────────────────

export type ReferenceImageInput = {
  /** meeting_references.id 또는 호출자가 붙인 식별자. 결과에 그대로 남는다 */
  id: string;
  /** data:image/png;base64,… 만 받는다. 외부 URL 을 공급자에게 넘기지 않는다 */
  dataUrl: string;
};

export type GenerateImageRequest = {
  prompt: string;
  model?: string;
  resolution?: ImageResolution;
  aspectRatio?: string;
  references?: ReferenceImageInput[];
  timeoutMs?: number;
  /** 5xx 재시도 전 대기(ms). 테스트에서 0 으로 둔다 */
  retryDelayMs?: number;
  signal?: AbortSignal;
  /** 모델 지원 파라미터를 이미 알면 넘긴다(중복 조회 방지) */
  caps?: ModelCaps;
};

export type SentParams = {
  model: string;
  resolution: string | null;
  quality: string | null;
  aspectRatio: string | null;
  referenceIds: string[];
  /** 모델이 받지 않아 보내지 않은 요청 값 */
  dropped: string[];
};

export type GenerateImageResult = {
  model: string;
  bytes: Buffer;
  mediaType: ImageMediaType;
  width: number | null;
  height: number | null;
  /** 응답 usage.cost (USD). 응답에 없으면 null */
  costUsd: number | null;
  usage: Record<string, unknown> | null;
  latencyMs: number;
  attempts: number;
  sent: SentParams;
};

export function buildImageRequestBody(
  req: GenerateImageRequest,
  caps: ModelCaps,
): { body: Record<string, unknown>; sent: SentParams } {
  const model = req.model ?? imageModel();
  const resolution = req.resolution ?? "draft";
  const aspect = req.aspectRatio ?? DEFAULT_ASPECT_RATIO;
  const refs = req.references ?? [];
  const dropped: string[] = [];

  const body: Record<string, unknown> = { model, prompt: req.prompt };
  const sent: SentParams = { model, resolution: null, quality: null, aspectRatio: null, referenceIds: [], dropped };

  if (caps.resolutions) {
    const want = RESOLUTION_TIER[resolution];
    const tier = caps.resolutions.includes(want)
      ? want
      : resolution === "draft"
        ? caps.resolutions[0]
        : caps.resolutions[caps.resolutions.length - 1];
    body.resolution = tier;
    sent.resolution = tier;
  } else if (caps.qualities) {
    const q = QUALITY_TIER[resolution];
    if (caps.qualities.includes(q)) {
      body.quality = q;
      sent.quality = q;
    }
  } else {
    dropped.push(`resolution=${resolution}`);
  }

  if (caps.aspectRatios?.includes(aspect)) {
    body.aspect_ratio = aspect;
    sent.aspectRatio = aspect;
  } else {
    dropped.push(`aspect_ratio=${aspect}`);
  }

  if (refs.length) {
    if (refs.length > caps.maxReferences) {
      throw new ImageGenError(
        "INVALID_INPUT",
        `${model} 는 참조 이미지를 최대 ${caps.maxReferences}장 받습니다. ${refs.length}장을 보내려 했습니다.`,
      );
    }
    for (const r of refs) {
      if (!r.dataUrl.startsWith("data:image/")) {
        throw new ImageGenError("INVALID_INPUT", `참조 이미지 ${r.id} 는 data URL 이어야 합니다. 외부 URL 은 보내지 않습니다.`);
      }
    }
    body.input_references = refs.map((r) => ({ type: "image_url", image_url: { url: r.dataUrl } }));
    sent.referenceIds = refs.map((r) => r.id);
  }

  return { body, sent };
}

// ── 호출 ────────────────────────────────────────────────────────────────────

type ProviderErrorBody = { error?: { code?: number | string; message?: string; metadata?: unknown; name?: string } | string; message?: string };

function providerMessage(text: string): string {
  try {
    const j = JSON.parse(text) as ProviderErrorBody;
    if (typeof j.error === "string") return j.error;
    const m = j.error?.message ?? j.message;
    if (m) return String(m).slice(0, 800);
  } catch {
    // JSON 이 아니면 본문 앞부분을 그대로 싣는다
  }
  return text.slice(0, 800) || "(빈 응답)";
}

function mapHttpError(status: number, text: string, retryAfter: string | null): ImageGenError {
  const msg = providerMessage(text);
  const detail: Record<string, unknown> = { providerMessage: msg };
  if (retryAfter) detail.retryAfter = retryAfter;
  if (status === 402) {
    return new ImageGenError("QUOTA_EXCEEDED", `OpenRouter 크레딧이 부족합니다: ${msg}`, {
      status,
      detail: { ...detail, scope: "provider_credits" },
    });
  }
  if (status === 429) {
    return new ImageGenError("QUOTA_EXCEEDED", `OpenRouter 요청 한도를 넘었습니다: ${msg}`, {
      status,
      detail: { ...detail, scope: "provider_rate_limit" },
    });
  }
  if (status === 408) return new ImageGenError("TIMEOUT", `공급자 쪽에서 시간이 초과되었습니다: ${msg}`, { status, detail });
  if (status === 401) return new ImageGenError("PROVIDER_ERROR", `OpenRouter 가 API 키를 거부했습니다: ${msg}`, { status, detail });
  if (status === 403) return new ImageGenError("PROVIDER_ERROR", `요청이 차단되었습니다(권한·검열): ${msg}`, { status, detail });
  return new ImageGenError("PROVIDER_ERROR", `이미지 생성 실패 (HTTP ${status}): ${msg}`, { status, detail });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function decodeImage(item: { b64_json?: string; url?: string; media_type?: string }, signal: AbortSignal): Promise<Buffer | null> {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item.url?.startsWith("data:")) {
    const comma = item.url.indexOf(",");
    return comma > 0 ? Buffer.from(item.url.slice(comma + 1), "base64") : null;
  }
  if (item.url && /^https:\/\//.test(item.url)) {
    // 공급자가 결과를 URL 로 줄 때만 받아 온다. 우리가 임의 URL 을 가져오는 경로가 아니다.
    const r = await fetch(item.url, { signal });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  }
  return null;
}

/**
 * 이미지 한 장 생성. 성공하면 실제 바이트를 돌려준다. 그 밖의 경우는 모두 ImageGenError.
 */
export async function generateImage(req: GenerateImageRequest): Promise<GenerateImageResult> {
  const key = apiKey();
  if (!key) {
    throw new ImageGenError("NOT_CONFIGURED", "OPENROUTER_API_KEY 가 설정되지 않아 이미지를 생성할 수 없습니다.");
  }
  if (!req.prompt?.trim()) throw new ImageGenError("INVALID_INPUT", "프롬프트가 비어 있습니다.");

  const model = req.model ?? imageModel();
  const caps = req.caps ?? (await getModelCaps(model));
  const { body, sent } = buildImageRequestBody({ ...req, model }, caps);
  const resolution = req.resolution ?? "draft";
  const timeoutMs = req.timeoutMs ?? (Number(process.env.SCENENOTE_IMAGE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS[resolution]);
  const retryDelayMs = req.retryDelayMs ?? 1500;
  const payload = JSON.stringify(body);

  const started = Date.now();
  let attempts = 0;
  let lastError: ImageGenError | null = null;

  while (attempts < 2) {
    attempts++;
    const timer = new AbortController();
    const t = setTimeout(() => timer.abort(), timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timer.signal]) : timer.signal;

    let res: Response;
    try {
      res = await fetch(IMAGES_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          "x-title": "SceneNote",
        },
        body: payload,
        signal,
      });
    } catch (e) {
      clearTimeout(t);
      if (timer.signal.aborted) {
        throw new ImageGenError("TIMEOUT", `이미지 생성이 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`, {
          detail: { timeoutMs, attempts },
        });
      }
      if (req.signal?.aborted) throw new ImageGenError("PROVIDER_ERROR", "요청이 취소되었습니다.");
      lastError = new ImageGenError("PROVIDER_ERROR", `OpenRouter 에 연결하지 못했습니다: ${(e as Error).message}`);
      if (attempts < 2) {
        await sleep(retryDelayMs);
        continue;
      }
      throw lastError;
    }

    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      clearTimeout(t);
      if (timer.signal.aborted) {
        throw new ImageGenError("TIMEOUT", `이미지 응답을 ${Math.round(timeoutMs / 1000)}초 안에 받지 못했습니다.`, {
          detail: { timeoutMs, attempts },
        });
      }
      throw new ImageGenError("PROVIDER_ERROR", `응답을 읽지 못했습니다: ${(e as Error).message}`, { status: res.status });
    }

    if (!res.ok) {
      clearTimeout(t);
      lastError = mapHttpError(res.status, text, res.headers.get("retry-after"));
      if (res.status >= 500 && attempts < 2) {
        await sleep(retryDelayMs);
        continue;
      }
      throw lastError;
    }

    let json: { data?: Array<{ b64_json?: string; url?: string; media_type?: string; revised_prompt?: string }>; usage?: Record<string, unknown> };
    try {
      json = JSON.parse(text);
    } catch {
      clearTimeout(t);
      throw new ImageGenError("PROVIDER_ERROR", `응답이 JSON 이 아닙니다: ${text.slice(0, 200)}`, { status: res.status });
    }

    const item = json.data?.[0];
    let bytes: Buffer | null = null;
    try {
      bytes = item ? await decodeImage(item, signal) : null;
    } finally {
      clearTimeout(t);
    }
    const mediaType = bytes ? sniffMediaType(bytes) : null;
    if (!bytes || bytes.length === 0 || !mediaType) {
      const note = item?.revised_prompt ? ` (공급자 메모: ${String(item.revised_prompt).slice(0, 200)})` : "";
      throw new ImageGenError("NO_IMAGE", `응답에 이미지가 없습니다${note}.`, {
        status: res.status,
        detail: { dataLength: json.data?.length ?? 0, mediaType: item?.media_type ?? null },
      });
    }

    const size = imageSize(bytes);
    const cost = json.usage?.cost;
    return {
      model,
      bytes,
      mediaType,
      width: size?.width ?? null,
      height: size?.height ?? null,
      costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
      usage: json.usage ?? null,
      latencyMs: Date.now() - started,
      attempts,
      sent,
    };
  }
  throw lastError ?? new ImageGenError("PROVIDER_ERROR", "이미지 생성에 실패했습니다.");
}
