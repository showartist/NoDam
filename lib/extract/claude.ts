import Anthropic from "@anthropic-ai/sdk";
import type { ParsedUtterance } from "../parse";
import { EXTRACTION_SCHEMA } from "../types";
import { SYSTEM_PROMPT, buildRetryPrompt, buildUserPrompt } from "./prompt";

const MODEL = process.env.SCENENOTE_MODEL ?? "claude-opus-5";

let _client: Anthropic | null = null;
const client = () => (_client ??= new Anthropic());

export async function callClaude(
  project: { title: string; domain: string; one_line: string | null },
  utterances: ParsedUtterance[],
  priorRaw: string | null,
  priorErrors: string[],
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildUserPrompt(project, utterances) },
  ];
  // 재시도: 직전 출력과 오류 목록을 대화에 붙여 수정을 요청한다.
  // (마지막 턴이 assistant 가 아니므로 prefill 제약에 걸리지 않는다.)
  if (priorRaw && priorErrors.length) {
    messages.push({ role: "assistant", content: priorRaw });
    messages.push({ role: "user", content: buildRetryPrompt(priorErrors) });
  }

  // Opus 5는 thinking이 기본 on이고 max_tokens가 thinking+본문을 함께 제한한다.
  // 큰 max_tokens는 스트리밍으로 받아야 HTTP 타임아웃에 걸리지 않는다.
  const stream = client().messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages,
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
    },
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("모델이 요청을 거절했습니다 (stop_reason: refusal).");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("출력이 max_tokens에서 잘렸습니다. 전사를 나눠서 분석하세요.");
  }

  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("응답에 텍스트 블록이 없습니다.");
  return text.text;
}
