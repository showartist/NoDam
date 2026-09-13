/**
 * 생성 이미지 ↔ 레퍼런스 유사도. 오디오·비전 사이드카가 떠 있을 때만 잰다. 서버 전용.
 *
 *   GET  {sidecar}/health
 *   POST {sidecar}/image-sim  { image_path, reference_paths } → { model, similarities }
 *
 * 화면은 "요청한 반영 수준(핵심·부분·참고·제외) vs 잰 유사도"를 나란히 보여 준다.
 * 사이드카가 없으면 {"status":"not_checked"} 로 남긴다. 값을 추정해 채우지 않는다.
 */

/** 음성 쪽(lib/audio/sidecar.ts)과 같은 변수를 읽는다. SCENENOTE_SIDECAR_URL 은 예전 이름. */
export function sidecarUrl(): string {
  const url =
    process.env.SIDECAR_URL?.trim() ||
    process.env.SCENENOTE_SIDECAR_URL?.trim() ||
    `http://127.0.0.1:${process.env.SIDECAR_PORT?.trim() || 8790}`;
  return url.replace(/\/+$/, "");
}

export type SimilarityTarget = { id: string; adoption: string; attached: boolean; absPath: string };

export type SimilarityRecord =
  | {
      status: "checked";
      model: string | null;
      checked_at: string;
      items: Array<{ reference_id: string; adoption: string; attached: boolean; similarity: number | null }>;
    }
  | { status: "not_checked"; reason?: string }
  | { status: "failed"; error: string; checked_at: string };

function pick(similarities: unknown, i: number, p: string): number | null {
  if (Array.isArray(similarities)) {
    const v = similarities[i];
    if (typeof v === "number") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const s = o.similarity ?? o.score ?? o.value;
      return typeof s === "number" ? s : null;
    }
    return null;
  }
  if (similarities && typeof similarities === "object") {
    const v = (similarities as Record<string, unknown>)[p];
    return typeof v === "number" ? v : null;
  }
  return null;
}

export async function measureSimilarity(
  imageAbsPath: string,
  targets: SimilarityTarget[],
  opts: { healthTimeoutMs?: number; timeoutMs?: number } = {},
): Promise<SimilarityRecord> {
  if (targets.length === 0) return { status: "not_checked", reason: "no_reference_images" };
  const base = sidecarUrl();
  try {
    const h = await fetch(`${base}/health`, { signal: AbortSignal.timeout(opts.healthTimeoutMs ?? 1500) });
    if (!h.ok) return { status: "not_checked", reason: `sidecar_health_${h.status}` };
  } catch {
    return { status: "not_checked", reason: "sidecar_unreachable" };
  }

  const checked_at = new Date().toISOString();
  try {
    const res = await fetch(`${base}/image-sim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
      body: JSON.stringify({ image_path: imageAbsPath, reference_paths: targets.map((t) => t.absPath) }),
    });
    const text = await res.text();
    if (!res.ok) return { status: "failed", error: `HTTP ${res.status}: ${text.slice(0, 300)}`, checked_at };
    const json = JSON.parse(text) as { model?: string; similarities?: unknown };
    return {
      status: "checked",
      model: typeof json.model === "string" ? json.model : null,
      checked_at,
      items: targets.map((t, i) => ({
        reference_id: t.id,
        adoption: t.adoption,
        attached: t.attached,
        similarity: pick(json.similarities, i, t.absPath),
      })),
    };
  } catch (e) {
    return { status: "failed", error: (e as Error).message.slice(0, 300), checked_at };
  }
}
