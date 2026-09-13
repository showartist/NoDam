/**
 * 조각 사이 화자 번호 잇기.
 *
 * STT 공급자의 화자 번호는 조각(파일)마다 새로 매겨진다. 조각 A 의 "화자 1" 과 조각 B 의 "화자 1" 은
 * 다른 사람일 수 있다. 사이드카(sidecar/)의 화자 임베딩으로 조각별·화자별 목소리 대표값(중심 벡터)을
 * 만들고, 회의 전체의 화자 목록(registry)과 코사인 유사도로 대조해 전역 화자 번호(SPEAKER_01…)를 붙인다.
 *
 * - 같은 조각 안의 서로 다른 로컬 화자는 같은 전역 화자로 합치지 않는다(cannot-link).
 * - 말한 시간이 너무 짧으면(minSpeechMs 미만) 목소리 대표값을 믿을 수 없으므로 low 로 표시한다.
 * - 사이드카가 꺼져 있으면 잇지 않고 조각별 번호에 조각 표시를 붙인다(가짜로 잇지 않는다).
 */
import { cosine } from "../llm/openrouter";
import { embed as sidecarEmbed, sidecarHealth } from "./sidecar";

/**
 * 같은 사람으로 볼 최소 코사인 유사도. 합성 회의 실측(sidecar README): 다른 목소리끼리 평균 최고 0.57,
 * 같은 목소리의 조각 사이는 0.74 이상. 그 사이인 0.62 를 기본값으로 둔다.
 */
export const DEFAULT_LINK_SIMILARITY = Number(process.env.SCENENOTE_SPEAKER_LINK_THRESHOLD ?? 0.62);

export type Registry = { id: string; centroid: number[]; speechMs: number }[];
export type LocalSegment = { local: string; startMs: number; endMs: number };
export type LinkResult = {
  mapping: Record<string, string>;
  confidence: Record<string, "high" | "low">;
  registry: Registry;
  method: "embedding" | "unlinked";
  similarities: { local: string; best: string | null; cos: number | null }[];
};

export async function sidecarAvailable(): Promise<boolean> {
  return sidecarHealth();
}

async function embedSegments(audioPath: string, segments: { start_ms: number; end_ms: number }[]): Promise<number[][]> {
  return (await sidecarEmbed(audioPath, segments)).map((e) => e ?? []);
}

function mean(vs: number[][], weights: number[]): number[] {
  const dim = vs.find((v) => v.length)?.length ?? 0;
  const out = new Array(dim).fill(0);
  let w = 0;
  vs.forEach((v, i) => {
    if (!v.length) return;
    for (let k = 0; k < dim; k++) out[k] += v[k] * weights[i];
    w += weights[i];
  });
  if (!w) return [];
  const n = Math.sqrt(out.reduce((a, x) => a + (x / w) ** 2, 0)) || 1;
  return out.map((x) => x / w / n);
}

/**
 * 한 조각의 로컬 화자들을 전역 화자에 붙인다. registry 는 갱신된 사본을 돌려준다.
 * threshold: 같은 사람으로 볼 최소 코사인 유사도(사이드카 README 의 실측값을 기본으로 쓴다).
 */
export async function linkChunk(opts: {
  audioPath: string;
  segments: LocalSegment[];
  registry: Registry;
  threshold?: number;
  minSpeechMs?: number;
  chunkIndex: number;
}): Promise<LinkResult> {
  const threshold = opts.threshold ?? DEFAULT_LINK_SIMILARITY;
  const minSpeech = opts.minSpeechMs ?? 1000;
  const locals = [...new Set(opts.segments.map((s) => s.local))];

  if (!(await sidecarAvailable())) {
    const mapping: Record<string, string> = {};
    const confidence: Record<string, "high" | "low"> = {};
    for (const l of locals) {
      mapping[l] = `C${opts.chunkIndex + 1}-${l}`;
      confidence[l] = "low";
    }
    return { mapping, confidence, registry: opts.registry, method: "unlinked", similarities: [] };
  }

  const segs = opts.segments.filter((s) => s.endMs - s.startMs >= 300);
  const embs = await embedSegments(
    opts.audioPath,
    segs.map((s) => ({ start_ms: s.startMs, end_ms: s.endMs })),
  );
  const cent = new Map<string, { c: number[]; ms: number }>();
  for (const l of locals) {
    const idx = segs.map((s, i) => (s.local === l ? i : -1)).filter((i) => i >= 0);
    const ms = idx.reduce((a, i) => a + (segs[i].endMs - segs[i].startMs), 0);
    cent.set(l, { c: mean(idx.map((i) => embs[i]), idx.map((i) => segs[i].endMs - segs[i].startMs)), ms });
  }

  // 말을 많이 한 로컬 화자부터 붙인다. 이미 이 조각에서 쓴 전역 화자는 다시 쓰지 않는다(cannot-link).
  const registry: Registry = opts.registry.map((r) => ({ ...r, centroid: [...r.centroid] }));
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  const confidence: Record<string, "high" | "low"> = {};
  const sims: LinkResult["similarities"] = [];
  const order = [...cent.entries()].sort((a, b) => b[1].ms - a[1].ms);
  for (const [local, { c, ms }] of order) {
    let best: { id: string; cos: number } | null = null;
    if (c.length) {
      for (const r of registry) {
        if (used.has(r.id) || !r.centroid.length) continue;
        const s = cosine(c, r.centroid);
        if (!best || s > best.cos) best = { id: r.id, cos: s };
      }
    }
    sims.push({ local, best: best?.id ?? null, cos: best?.cos ?? null });
    if (best && best.cos >= threshold) {
      mapping[local] = best.id;
      used.add(best.id);
      const r = registry.find((x) => x.id === best!.id)!;
      if (c.length && ms > 0) {
        // 누적 평균으로 대표값을 갱신한다(말한 시간 가중).
        const total = r.speechMs + ms;
        r.centroid = r.centroid.map((v, k) => (v * r.speechMs + c[k] * ms) / total);
        const n = Math.sqrt(r.centroid.reduce((a, x) => a + x * x, 0)) || 1;
        r.centroid = r.centroid.map((v) => v / n);
        r.speechMs = total;
      }
    } else {
      const id = `SPEAKER_${String(registry.length + 1).padStart(2, "0")}`;
      registry.push({ id, centroid: c, speechMs: ms });
      mapping[local] = id;
      used.add(id);
    }
    confidence[local] = ms >= minSpeech && c.length ? "high" : "low";
  }
  return { mapping, confidence, registry, method: "embedding", similarities: sims };
}
