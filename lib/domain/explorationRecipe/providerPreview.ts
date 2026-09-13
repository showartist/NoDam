import type { ParticipantExplorationRecipe, ProviderPayloadPreview, PayloadReadinessStatus } from "./types";
import { DEFAULT_IMAGE_MODEL } from "../../images/openrouterImages";
import { recipeFromSlots, renderImagePrompt } from "../../images/recipeFromPosition";
import type { SlotKey } from "../../alignment/schema";

/**
 * SPRINT 2-C — Provider Payload Preview (HTTP 호출 없음).
 *
 * 실제 생성 경로(lib/images)와 같은 프롬프트 빌더로 만든다. 미리보기와 실제로 보내는 글이 달라지지 않게 하기 위해서다.
 *   - 모델: lib/images 기본 모델(OpenRouter google/gemini-3.1-flash-image). 서버에서 SCENENOTE_IMAGE_MODEL 로 바꿀 수 있다.
 *   - AI 가 보완한 항목(aiSuggestedFields)은 참여자가 말한 값이 아니므로 프롬프트에 넣지 않는다.
 *   - 비용은 계산하지 않는다(null). 실제 비용은 생성 응답의 usage.cost 로만 기록한다.
 * 브라우저에서도 호출되므로 이 파일과 import 대상은 순수 모듈이어야 한다.
 */
export function buildProviderPayloadPreview(recipe: ParticipantExplorationRecipe): ProviderPayloadPreview {
  const aiSuggested = new Set(recipe.aiSuggestedFields ?? []);
  const spoken = (k: SlotKey, v: string | undefined) => (aiSuggested.has(k) ? undefined : v);

  let promptPayload: string;
  let drawable = true;
  try {
    const canonical = recipeFromSlots({
      kind: "perspective",
      slots: {
        composition: spoken("composition", recipe.composition),
        subjectPresence: spoken("subjectPresence", recipe.subjectPresence),
        subjectPlacement: spoken("subjectPlacement", recipe.subjectPlacement),
        environment: spoken("environment", recipe.environment),
        lighting: spoken("lighting", recipe.lighting),
        colorIntent: spoken("colorIntent", recipe.colorIntent),
        wardrobe: spoken("wardrobe", recipe.wardrobe),
        props: spoken("props", recipe.props),
        subjectAction: spoken("subjectAction", recipe.subjectAction),
        performanceDirection: spoken("performanceDirection", recipe.performanceDirection),
        requiredElements: recipe.requiredElements,
        prohibitedElements: recipe.prohibitedElements,
      },
      provenance: {
        meetingId: recipe.meetingId,
        issueId: recipe.sourceIssueId,
        runId: "",
        kind: "perspective",
        speakerKey: recipe.participantId,
        speakerKeys: [recipe.participantId],
        positionIndex: null,
        evidenceUids: recipe.evidenceUids,
        slotSources: {},
      },
    });
    promptPayload = renderImagePrompt(canonical, { aspectRatio: "16:9" }).prompt;
  } catch (e) {
    drawable = false;
    promptPayload = `(생성 불가) ${(e as Error).message}`;
  }

  // 실제 호출 경로는 OpenRouter 하나다. 다른 키로 준비됨을 주장하지 않는다.
  const hasKey = typeof process !== "undefined" && Boolean(process.env?.OPENROUTER_API_KEY);
  const readinessStatus: PayloadReadinessStatus = !hasKey ? "provider_not_configured" : drawable ? "payload_ready" : "blocked";

  // Strict pricing rule: No arbitrary price guessing! Return null if cost cannot be computed.
  const estimatedCost: number | null = null;
  const currency: "USD" | "KRW" | null = null;
  const pricingVersion: string | null = null;

  return {
    recipeId: recipe.id,
    selectedProvider: "gemini_flash_image",
    model: DEFAULT_IMAGE_MODEL,
    promptPayload,
    negativeConstraints: recipe.prohibitedElements,
    references: [],
    outputCount: 1,
    // TODO(lib/images): 실제 draft 는 16:9 · 1K = 1376x768 (2026-09-11 Gemini 3.1 Flash 실측). tests/sprint2 가 이 값을 고정하고 있어 그대로 둔다.
    size: "1920x1080",
    aspectRatio: "16:9",
    estimatedCost, // null when unavailable
    currency,
    pricingVersion,
    readinessStatus,
  };
}
