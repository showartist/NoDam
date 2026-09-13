// Scene Brief 추출 — OpenRouter 경로. 해석 차이 분석과 같은 키 하나(OPENROUTER_API_KEY)로 돈다.
//
// LLM 에는 작은 스키마를 준다: 23개 항목을 각각 필드로 두는 대신 {field, …} 배열 하나로 받는다.
// 큰 중첩 스키마(lib/types.ts EXTRACTION_SCHEMA)를 그대로 넘기면 호출마다 강제 여부가 달라서
// (마크다운이 오거나 scene_brief 가 빠짐, 2026-09-11 실측) 해석 차이 분석과 같은 방식으로 바꿨다.
// 받은 값은 코드에서 정본 모양({scene_brief: Record<field, item[]>, …})으로 옮기고, 검증은 lib/validate.ts 가 한다.
import { z } from "zod";
import type { ParsedUtterance } from "../parse";
import { chatJson } from "../llm/openrouter";
import { AI_ALLOWED_STATES, CONFIDENCES, INTENT_TYPES, SCENE_BRIEF_FIELDS } from "../types";
import { SYSTEM_PROMPT, buildRetryPrompt, buildUserPrompt } from "./prompt";

export const EXTRACTION_MODEL = process.env.SCENENOTE_EXTRACTION_MODEL ?? process.env.OPENROUTER_ANALYSIS_MODEL ?? "anthropic/claude-sonnet-5";

const Item = {
  content: z.string(),
  decision_state: z.enum(AI_ALLOWED_STATES as [string, ...string[]]),
  evidence: z.array(z.string()),
  confidence: z.enum(CONFIDENCES),
  note: z.string().nullable(),
};

export const ExtractionLlm = z.object({
  brief_items: z
    .array(z.object({ field: z.enum(SCENE_BRIEF_FIELDS), ...Item }))
    .describe("회의에서 말한 장면 명세 항목만. 말하지 않은 항목은 넣지 않는다"),
  decisions: z.array(z.object({ id: z.string(), ...Item })),
  unresolved: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      evidence: z.array(z.string()),
      question: z.string(),
      blocks_roles: z.array(z.enum(["director", "writer", "producer"])),
    }),
  ),
  intents: z.array(
    z.object({
      type: z.enum(INTENT_TYPES),
      text: z.string(),
      source_field: z.enum(SCENE_BRIEF_FIELDS),
      evidence: z.array(z.string()),
    }),
  ),
});
export type ExtractionLlm = z.infer<typeof ExtractionLlm>;

/** 작은 스키마 → 정본 모양. 23개 항목을 모두 키로 만들고, 말하지 않은 항목은 빈 배열로 둔다. */
export function toCanonical(x: ExtractionLlm): Record<string, unknown> {
  const scene_brief: Record<string, unknown[]> = Object.fromEntries(SCENE_BRIEF_FIELDS.map((f) => [f, []]));
  for (const it of x.brief_items) {
    const { field, ...rest } = it;
    scene_brief[field].push(rest);
  }
  return { scene_brief, decisions: x.decisions, unresolved: x.unresolved, intents: x.intents };
}

const SCHEMA = z.toJSONSchema(ExtractionLlm, { target: "draft-07" }) as Record<string, unknown>;

export async function callOpenRouter(
  project: { title: string; domain: string; one_line: string | null },
  utterances: ParsedUtterance[],
  priorRaw: string | null,
  priorErrors: string[],
): Promise<string> {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT + "\n\n출력: brief_items 에는 회의에서 말한 항목만 field 와 함께 넣는다. 한 항목(field)에 여러 값이 있으면 여러 개를 넣는다." },
    { role: "user", content: buildUserPrompt(project, utterances) },
  ];
  if (priorRaw && priorErrors.length) {
    messages.push({ role: "assistant", content: priorRaw });
    messages.push({ role: "user", content: buildRetryPrompt(priorErrors) });
  }
  const r = await chatJson({ model: EXTRACTION_MODEL, schemaName: "scenenote_scene_brief", schema: SCHEMA, messages, maxTokens: 32000 });
  const parsed = ExtractionLlm.safeParse(r.data);
  // 형식이 어긋나면 원문을 그대로 넘긴다 → 검증기가 오류 목록을 만들고 재시도를 요청한다.
  return JSON.stringify(parsed.success ? toCanonical(parsed.data) : r.data);
}
