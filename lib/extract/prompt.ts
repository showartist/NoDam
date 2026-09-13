import type { ParsedUtterance } from "../parse";
import { SCENE_BRIEF_FIELDS, SCENE_BRIEF_LABEL } from "../types";

/**
 * Scene Brief 추출 프롬프트.
 *
 * 규칙은 제품 원칙 1·2 와 같다: AI 는 확정하지 않고, 모든 항목은 발언 번호를 근거로 단다.
 * Intent Coverage 검사가 이 출력의 intents 에서 시작하므로 핵심 행동·오브제·마지막 이미지를 반드시 뽑는다.
 */
export const SYSTEM_PROMPT = `당신은 영화 프리프로덕션 회의 전사를 읽고 장면 명세(Scene Brief)를 채우는 추출기다.
사람이 검토하고 승인한다. 당신은 후보만 낸다.

## 상태 (decision_state)
- proposed: 누군가 제안했지만 반응이 없다.
- candidate: 여러 사람이 동의해 확정 후보가 됐다.
- rejected: 명시적으로 기각됐다.
- superseded: 뒤의 발언이 앞의 값을 바꿨다.
- uncertain: 말은 나왔지만 뜻이 모호하거나 조건이 붙었다.
confirmed 는 절대 출력하지 않는다. 승인은 사람만 할 수 있다. "그걸로 가죠" 같은 동의가 있어도 candidate 까지만 쓴다.

## 근거
- 모든 항목의 evidence 에 실제 발언 번호를 넣는다. 지어낸 번호는 쓰지 않는다.
- 발언에 없는 값을 추측으로 채우지 않는다. 그 항목에 해당하는 발언이 없으면 빈 배열로 둔다.
- 근거가 약하면 confidence 를 low 로 하고 note 에 이유를 적는다. 없으면 note 는 null.

## 의도 (intents)
Intent Coverage 검사가 여기서 시작한다. 회의에서 말한 것이 있으면 아래 세 의도를 반드시 뽑는다. 유형마다 하나씩이다.
- key_action: 이 장면이 반드시 화면에 담아야 하는 핵심 물리 행동. source_field 는 KEY_ACTION.
- key_object: 이 장면의 핵심 상징 오브제. source_field 는 KEY_OBJECT.
- last_image: 장면이 끝날 때 남는 마지막 이미지. source_field 는 LAST_IMAGE.
- safety: 촬영 전에 반드시 확인해야 하는 안전 항목이 있으면 넣는다. source_field 는 SAFETY_CONSTRAINTS.
회의에서 말하지 않은 의도는 넣지 않는다.

## 결정·미결정
- decisions: 결정된 것처럼 말한 것(여전히 candidate 까지만). id 는 D-01, D-02 … 순서대로.
- unresolved: 아직 안 정해진 것. id 는 N-01, N-02 …. question 에는 누가 무엇을 정해야 하는지 묻는 한 문장을 쓴다.
  blocks_roles 에는 이 미결정 때문에 작업이 멈추는 역할(director, writer, producer)을 넣는다.`;

export function buildUserPrompt(
  projectOrUtterances: any,
  maybeUtterances?: ParsedUtterance[],
): string {
  const utterances: ParsedUtterance[] = Array.isArray(projectOrUtterances)
    ? projectOrUtterances
    : (maybeUtterances ?? []);
  const project = Array.isArray(projectOrUtterances) ? null : (projectOrUtterances as { title?: string; one_line?: string | null });

  const fields = SCENE_BRIEF_FIELDS.map((f) => `- ${f}: ${SCENE_BRIEF_LABEL[f]}`).join("\n");
  const transcriptText = utterances
    .map((u) => `[${u.uid}] ${[u.speakerName, u.role].filter(Boolean).join("·") || "화자 미상"}: ${u.textClean}`)
    .join("\n");

  return [
    project?.title ? `작품: ${project.title}` : null,
    project?.one_line ? `장면: ${project.one_line}` : null,
    `Scene Brief 항목:\n${fields}`,
    "",
    `전사:\n${transcriptText}`,
  ]
    .filter((x) => x !== null)
    .join("\n");
}

export function buildRetryPrompt(errorsOrUtterances: any): string {
  const errs = Array.isArray(errorsOrUtterances) ? errorsOrUtterances.join("\n- ") : String(errorsOrUtterances);
  return `직전 출력이 검증을 통과하지 못했다. 아래 오류를 모두 고친 JSON 하나만 다시 출력하라.\n- ${errs}`;
}
