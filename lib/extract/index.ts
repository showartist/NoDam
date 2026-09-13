// 파이프라인 ②③ — 구조화 추출.
//   JSON 파싱 → 스키마 검증 → U-ID 참조 검증 → 상태 규칙 검증
//   → 오류 있으면 자동 수정 요청 → 통과하면 화면 표시
import type { ParsedUtterance } from "../parse";
import { validateExtraction } from "../validate";
import type { Extracted } from "../types";
import { callClaude } from "./claude";
import { callFixture } from "./fixture";
import { callOpenRouter } from "./openrouter";

export type Provider = "openrouter" | "claude" | "fixture";

export type Attempt = {
  n: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type ExtractionRun =
  | { ok: true; provider: Provider; value: Extracted; attempts: Attempt[] }
  | { ok: false; provider: Provider; attempts: Attempt[]; message: string };

export function activeProvider(): Provider {
  if (process.env.SCENENOTE_PROVIDER === "fixture") return "fixture";
  // 해석 차이 분석·STT 와 같은 키 하나로 돈다. Anthropic 직접 키는 예전 경로로 남긴다.
  if (process.env.OPENROUTER_API_KEY?.trim()) return "openrouter";
  return process.env.ANTHROPIC_API_KEY ? "claude" : "fixture";
}

const MAX_ATTEMPTS = 3;

export async function runExtraction(
  project: { title: string; domain: string; one_line: string | null },
  utterances: ParsedUtterance[],
): Promise<ExtractionRun> {
  const provider = activeProvider();
  const validUids = new Set(utterances.map((u) => u.uid));
  const attempts: Attempt[] = [];
  let priorRaw: string | null = null;
  let priorErrors: string[] = [];

  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    let text: string;
    try {
      text =
        provider === "openrouter"
          ? await callOpenRouter(project, utterances, priorRaw, priorErrors)
          : provider === "claude"
            ? await callClaude(project, utterances, priorRaw, priorErrors)
            : await callFixture(n, validUids);
    } catch (e) {
      attempts.push({ n, ok: false, errors: [`호출 실패: ${(e as Error).message}`], warnings: [] });
      return { ok: false, provider, attempts, message: (e as Error).message };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      priorRaw = text;
      priorErrors = ["출력이 유효한 JSON이 아니다. JSON 하나만 출력하라."];
      attempts.push({ n, ok: false, errors: priorErrors, warnings: [] });
      continue;
    }

    const result = validateExtraction(parsed, validUids);
    if (result.ok) {
      attempts.push({ n, ok: true, errors: [], warnings: result.warnings });
      return { ok: true, provider, value: result.value, attempts };
    }

    priorRaw = text;
    priorErrors = result.errors;
    attempts.push({ n, ok: false, errors: result.errors, warnings: [] });
  }

  const hint =
    provider === "fixture"
      ? " 픽스처 모드는 fixtures/film/*.extraction.json 에 스텁이 있는 전사에서만 통과합니다. 새 전사는 OPENROUTER_API_KEY 를 설정해 실제 모델로 분석하세요."
      : "";
  return {
    ok: false,
    provider,
    attempts,
    message: `${MAX_ATTEMPTS}회 시도 후에도 검증을 통과하지 못했습니다.${hint}`,
  };
}
