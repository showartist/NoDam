/**
 * 한국어 슬롯 값의 영어 풀이. 서버 전용.
 *
 * 1. 결정적 사전(glossary.ts)으로 풀리면 그걸 쓴다.
 * 2. 안 풀린 값만 anthropic/claude-haiku-4.5 에 한 번에 묻는다 (OpenRouter chat completions).
 *    결과는 값의 sha256 으로 .data/cache/gloss/ 에 캐시한다. 같은 값은 다시 묻지 않는다.
 * 3. 키가 없거나 호출이 실패하면 풀이 없이 원문만 보낸다. 생성 자체를 막지 않는다.
 *    SCENENOTE_GLOSS_LLM=0 이면 2단계를 건너뛴다.
 *
 * 풀이는 원문 옆 괄호에 붙는 보조다. 원문을 대체하지 않는다.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { glossaryGloss } from "./glossary";
import { OPENROUTER_BASE } from "./openrouterImages";
import { dataDir } from "./paths";

export const GLOSS_MODEL = "anthropic/claude-haiku-4.5";

export type GlossSource = "glossary" | "llm" | "llm_cache";
export type GlossEntry = { text: string; source: GlossSource };
export type GlossResult = {
  map: Map<string, GlossEntry>;
  /** 풀이 없이 원문만 보내는 값 */
  missing: string[];
  /** LLM 을 부르지 못했거나 실패한 사유. 없으면 null */
  llmNote: string | null;
  llmModel: string | null;
};

function cacheFile(value: string): string {
  const h = createHash("sha256").update(`${GLOSS_MODEL}\n${value}`).digest("hex");
  return path.join(dataDir(), "cache", "gloss", `${h}.json`);
}

function readCache(value: string): string | null {
  try {
    const j = JSON.parse(readFileSync(cacheFile(value), "utf8")) as { value: string; gloss: string };
    return j.value === value && j.gloss ? j.gloss : null;
  } catch {
    return null;
  }
}

function writeCache(value: string, gloss: string): void {
  try {
    const f = cacheFile(value);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify({ value, gloss, model: GLOSS_MODEL, at: new Date().toISOString() }));
  } catch {
    // 캐시는 최적화일 뿐이다. 못 써도 풀이는 그대로 쓴다.
  }
}

const SYSTEM = `You translate short Korean film-production notes into short English glosses for an image model.
Rules:
- Translate only what is written. Do not add details, adjectives, style words or interpretation.
- Keep each gloss short (a noun phrase, at most 12 words).
- Keep proper nouns as they are (romanise if needed).
Return only JSON: {"glosses":[{"i":<index>,"en":"<gloss>"}]}`;

async function askLlm(values: string[], key: string, timeoutMs: number): Promise<Map<string, string>> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "SceneNote" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: GLOSS_MODEL,
      temperature: 0,
      max_tokens: 800,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(values.map((v, i) => ({ i, ko: v }))) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("JSON 이 없는 응답");
  const parsed = JSON.parse(content.slice(start, end + 1)) as { glosses?: Array<{ i?: number; en?: string }> };
  const out = new Map<string, string>();
  for (const g of parsed.glosses ?? []) {
    const v = typeof g.i === "number" ? values[g.i] : undefined;
    const en = typeof g.en === "string" ? g.en.replace(/\s+/g, " ").trim() : "";
    if (v && en && en.length <= 160) out.set(v, en);
  }
  return out;
}

export async function resolveGlosses(values: string[], opts: { allowLlm?: boolean; timeoutMs?: number } = {}): Promise<GlossResult> {
  const map = new Map<string, GlossEntry>();
  const pending: string[] = [];
  for (const v of new Set(values)) {
    const g = glossaryGloss(v);
    if (g) map.set(v, { text: g, source: "glossary" });
    else {
      const cached = readCache(v);
      if (cached) map.set(v, { text: cached, source: "llm_cache" });
      else pending.push(v);
    }
  }

  let llmNote: string | null = null;
  let llmModel: string | null = null;
  const allow = (opts.allowLlm ?? true) && process.env.SCENENOTE_GLOSS_LLM !== "0";
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (pending.length) {
    if (!allow) llmNote = "LLM 풀이를 끈 상태라 원문만 보냅니다.";
    else if (!key) llmNote = "OPENROUTER_API_KEY 가 없어 원문만 보냅니다.";
    else {
      try {
        const got = await askLlm(pending, key, opts.timeoutMs ?? 20_000);
        llmModel = GLOSS_MODEL;
        for (const [v, en] of got) {
          map.set(v, { text: en, source: "llm" });
          writeCache(v, en);
        }
      } catch (e) {
        llmNote = `LLM 풀이 실패(${(e as Error).message}) — 원문만 보냅니다.`;
      }
    }
  }
  const missing = pending.filter((v) => !map.has(v));
  return { map, missing, llmNote, llmModel };
}
