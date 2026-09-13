/**
 * 실제 이미지 1장 생성 스모크 테스트 (OpenRouter 과금 발생).
 *
 *   npx tsx scripts/smoke-image.ts             # draft(1K) 1장 생성
 *   npx tsx scripts/smoke-image.ts --dry-run   # 프롬프트만 출력, 호출 없음
 *   npx tsx scripts/smoke-image.ts --final     # final(2K)
 *
 * 손으로 만든 입장 하나(SCENE 34 새벽의 빈 실내 수영장)로 lib/images 의 실제 경로(runGeneration)를 탄다.
 * 개발 DB 를 더럽히지 않도록 SCENENOTE_DB 가 없으면 .data/smoke-images.db 를 쓴다.
 * 생성 상한(대상당 2장·회의당 6장)이 그대로 걸린다. 풀려면 SCENENOTE_IMAGE_QUOTA_OVERRIDE=1.
 */
import path from "node:path";

async function main() {
  process.env.SCENENOTE_DB ??= path.join(process.cwd(), ".data", "smoke-images.db");
  const dryRun = process.argv.includes("--dry-run");
  const resolution = process.argv.includes("--final") ? "final" : "draft";

  const { recipeFromPosition, renderImagePrompt } = await import("../lib/images/recipeFromPosition");
  const { runGeneration } = await import("../lib/images/pipeline");
  const { ImageGenError } = await import("../lib/images/errors");
  const { imageModel } = await import("../lib/images/openrouterImages");
  const { SCHEMA_VERSION } = await import("../lib/alignment/schema");

  const ts = new Date().toISOString();
  const issue = {
    schema: SCHEMA_VERSION,
    issue_id: "smoke_iss_pool_dawn",
    key: "smoke-pool-dawn",
    meeting_id: "smoke_scene34",
    analysis_run_id: "smoke_run",
    data_mode: "fixture" as const,
    window: null,
    type: "interpretation_gap" as const,
    decision: "SCENE 34 새벽 수영장의 모습",
    concept: "텅 빈",
    state: "open" as const,
    condition: null,
    positions: [
      {
        speaker: { key: "SPEAKER_01", name: null, role: "감독" },
        meaning: "아무도 없는 새벽 수영장, 오래 방치된 흔적",
        quote: "아무도 없는 새벽 수영장",
        evidence: ["U03", "U05"],
        slots: {
          environment: "텅 빈 실내 수영장",
          lighting: "푸른 새벽빛",
          subjectPresence: "인물 없음",
          requiredElements: "타일의 녹색 곰팡이와 바랜 안내판",
          prohibitedElements: "사람 그림자",
        },
        checks: { speaker: "ok" as const, quote: "ok" as const, context: "not_checked" as const, contextNote: null },
      },
    ],
    slot_diff: [],
    distance: { differs: 0, compared: 0, value: null, basis: "exact" },
    question: "",
    why_it_matters: "",
    severity: "medium" as const,
    role_briefs: {},
    evidence_all: ["U03", "U05"],
    dropped: [],
    audit: [],
    past_decisions: [],
    created_at: ts,
    updated_at: ts,
  };
  const context = { slugline: "SCENE 34 · INT. 실내 수영장 – DAWN", oneLiner: null, projectTitle: "숨을 세는 사람" };
  const recipe = recipeFromPosition(issue as never, 0, context);

  if (dryRun) {
    console.log(`model: ${imageModel()} · resolution: ${resolution}\n`);
    console.log(renderImagePrompt(recipe, { aspectRatio: "16:9" }).prompt);
    return;
  }

  try {
    const out = await runGeneration({ recipe, resolution, references: [] });
    console.log(JSON.stringify(
      {
        row: { ...out.image, prompt: undefined },
        prompt: out.prompt,
        sent: out.sent,
        latencyMs: out.latencyMs,
        attempts: out.attempts,
        warnings: out.warnings,
        gloss: out.gloss,
      },
      null,
      2,
    ));
  } catch (e) {
    if (e instanceof ImageGenError) {
      console.error(`실패 ${e.code}: ${e.message}${e.imageId ? ` (행 ${e.imageId})` : ""}`);
      if (e.detail) console.error(JSON.stringify(e.detail));
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

main();
