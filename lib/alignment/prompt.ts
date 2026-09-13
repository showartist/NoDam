/**
 * 해석 차이 탐지 v2 프롬프트.
 *
 * 전사는 화자 라벨(S1, S2 …)로만 넘기고, 라벨과 이름·역할의 대응은 참석자 줄에 따로 적는다.
 * LLM 은 라벨만 돌려주고, 이름·역할은 코드가 화자 매핑에서 채운다.
 */
import type { MeetingUtterance } from "./store";

export const SYSTEM_PROMPT_V2 = `당신은 영화 제작 회의 전사를 읽고, 사람이 다시 확인해야 할 안건을 찾는 분석기다.
결정은 사람이 한다. 당신은 안건을 찾고, 근거 발언을 대고, 확인 질문을 만든다.

## 전사 형식
[발언번호] 화자라벨 발언. 화자라벨은 S1, S2 … 이다. 같은 라벨은 떨어져 있어도 같은 사람이다. S? 는 화자를 모르는 발언이다.

## 안건 유형 (type)
- interpretation_gap: 여러 사람이 같은 표현이나 같은 대상을 말하면서 서로 다른 것을 뜻한 경우. 겉으로 동의했어도 뜻이 갈리면 여기에 넣는다.
- competing_alternatives: 두 사람 이상이 서로 다른 안을 내고 아직 하나로 정하지 않은 경우.
- decision_state_mismatch: 누군가는 정해졌다고 여기고 누군가는 아직이라고 여기는 경우, 또는 정해진 것처럼 말했지만 필요한 승인·확인이 빠진 경우.
- constraint_conflict: 연출 의도와 제작 제약(안전·예산·일정·장비·장소)이 부딪히는 경우.
- past_decision_conflict: 이 회의 안에서 앞서 정한 것과 뒤에 말한 것이 어긋나는 경우.
- missing_information: 실행에 필요한 값(누가·언제·무엇으로)이 아직 없거나 확인을 기다리는 경우.

## 상태 (state)
- open: 아직 정해지지 않았다.
- conditional: 정한 것처럼 끝났지만 조건이나 보류가 남았다("확인 전까지", "일단", "열어두자", "해 보고", "답사 후"). condition 에 남은 조건과 그 근거 발언을 적는다.
- agreed_candidate: 명시적 동의가 있고 반대나 조건이 없다. 합의 후보일 뿐이고 확정은 사람이 한다.
resolved 는 쓰지 마라.

## 입장 (positions)
- 안건에 관련된 사람마다 입장 하나. 한 사람의 여러 발언은 한 입장으로 묶는다. 같은 사람이 나중에 정정했다면 마지막 입장을 쓰고, 정정 자체를 두 사람의 차이로 보지 마라.
- speaker 에는 화자라벨만 쓴다.
- evidence 에는 그 사람이 직접 한 발언 번호를 하나 이상 넣는다.
- quote 는 evidence 가운데 한 발언에서 글자 그대로 옮긴 8~40자 구절이다. 바꿔 쓰거나 줄여 쓰지 마라.
- meaning 은 발언에 있는 내용만 쓴다.
- slots 에는 그 사람이 실제로 말한 장면 항목만 넣는다. 말하지 않은 항목은 넣지 않는다. 값은 짧은 한국어 명사구로 쓴다.
  composition 구도·샷 사이즈·렌즈 / subjectPresence 인물 유무 / subjectPlacement 인물 배치 / environment 공간·미술 / lighting 조명·빛 / colorIntent 색·톤 / wardrobe 의상 / props 소품 / subjectAction 인물 행동 / performanceDirection 연기·표정·정서 / requiredElements 반드시 들어갈 것 / prohibitedElements 빠져야 할 것
- 빛의 색·색온도·광원은 lighting 에, 화면 전체의 색 톤·팔레트·소품과 의상의 색은 colorIntent 에 넣는다.
- 한 안건 안에서 서로 견줄 값은 반드시 같은 항목 이름으로 넣는다. 한 사람은 lighting, 다른 사람은 colorIntent 처럼 갈라 넣으면 비교할 수 없다.
- 같은 항목에 두 사람이 서로 다른 값을 말했으면, 문장으로는 동의한 것처럼 보여도 interpretation_gap 으로 올리고 질문으로 확인하게 한다. 예: 한 사람은 "푸른 새벽빛", 다른 사람은 "낮은 색온도의 빛"(광원 기준이면 따뜻한 빛).

## 유형별 최소 인원
interpretation_gap, competing_alternatives, constraint_conflict 는 서로 다른 화자 두 명 이상이 있어야 한다. 나머지 유형은 한 명 이상.

## 나머지 필드
- question: 판정하지 말고, 누가 무엇을 정해야 하는지 묻는 한 문장.
- why_it_matters: 이대로 두면 촬영·미술·편집에서 무엇이 달라지는지 한 문장.
- severity: critical 안전·법·촬영 불가 / high 이대로 가면 결과물이 달라짐 / medium 나중에 조정할 수 있지만 확인 필요 / low 표현 차이.
- role_briefs: 이 회의에 나온 역할마다, 이 안건이 그 역할의 작업에서 무엇을 바꾸는지 한 문장. 관련 없는 역할은 뺀다.
- key: 안건 내용을 나타내는 짧은 영문 slug(예: suhyun_expression, crane_safety).
- agreements: 조건 없이 명시적으로 합의된 것만 넣는다. 조건이 붙었으면 agreements 가 아니라 conditional 안건이다.

## 지킬 것
1. 발언에 없는 생각을 만들지 마라. 근거가 없으면 안건을 만들지 마라.
2. 억지로 갈등을 만들지 마라. 보완 관계를 충돌로 단정하지 마라. 안건이 없으면 issues 는 빈 배열이다.
3. 지어낸 발언 번호는 쓰지 마라.`;

export const WINDOW_ADDENDUM = `

## 창 단위 분석
회의가 진행 중이다. 이번에 받은 것은 새 발언 창과, 지금까지 찾은 안건 요약이다.
- 새 창에서 새로 생긴 안건은 key 를 새로 만든다.
- 이미 있는 안건이 새 발언으로 바뀌었으면 같은 key 로 안건 전체를 다시 쓴다(입장·상태·근거를 모두 갱신).
- 이미 있는 안건 가운데 이번 창과 관계없는 것은 다시 쓰지 마라.
- 창 안에서 곧바로 정리된 논의(질문하고 답해서 끝난 것, 한쪽이 바로 받아들인 것)는 안건으로 올리지 말고 agreements 에 넣는다.
- 이번 창만으로 서로 다르게 이해했는지, 결정이 막혔는지 알 수 없으면 올리지 않는다. 다음 창에서 드러나면 그때 올린다.
- 이미 있는 안건이 이번 창에서 명시적으로 정리됐으면 같은 key 로 다시 쓰고 state 를 agreed_candidate(조건이 남으면 conditional)로 바꾼다.
- 이미 있는 안건과 같은 결정 대상이면 새 key 를 만들지 말고 그 key 로 갱신한다.
- 근거 발언 번호는 이번 창과 앞 맥락에 보이는 번호만 쓴다.`;

export type SpeakerLabel = { label: string; key: string | null; name: string | null; role: string | null };

/** 등장 순서대로 S1, S2 … 라벨을 붙인다. 화자를 모르는 발언은 S? */
export function buildSpeakerLabels(utts: MeetingUtterance[]): Map<string, SpeakerLabel> {
  const labels = new Map<string, SpeakerLabel>();
  for (const u of utts) {
    if (!u.speakerKey || labels.has(u.speakerKey)) continue;
    labels.set(u.speakerKey, { label: `S${labels.size + 1}`, key: u.speakerKey, name: u.speakerName, role: u.role });
  }
  return labels;
}

export function labelOf(labels: Map<string, SpeakerLabel>, key: string | null): string {
  return key ? labels.get(key)?.label ?? "S?" : "S?";
}

export function participantLine(labels: Map<string, SpeakerLabel>): string {
  return [...labels.values()]
    .map((l) => `${l.label}=${[l.name, l.role].filter(Boolean).join("·") || "이름 미상"}`)
    .join(", ");
}

export function formatTranscript(utts: MeetingUtterance[], labels: Map<string, SpeakerLabel>): string {
  return utts.map((u) => `[${u.uid}] ${labelOf(labels, u.speakerKey)} ${u.text}`).join("\n");
}

export function buildBatchUserMessage(opts: {
  projectTitle: string | null;
  sceneLine: string | null;
  utts: MeetingUtterance[];
  labels: Map<string, SpeakerLabel>;
}): string {
  return [
    `작품: ${opts.projectTitle ?? "미상"}`,
    opts.sceneLine ? `장면: ${opts.sceneLine}` : null,
    `참석자: ${participantLine(opts.labels)}`,
    "",
    "전사:",
    formatTranscript(opts.utts, opts.labels),
  ]
    .filter((x) => x !== null)
    .join("\n");
}
