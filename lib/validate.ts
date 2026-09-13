// LLM 출력 검증 — 검증_기대출력.py 의 규칙을 백엔드 파이프라인으로 옮긴 것.
// JSON 파싱 → 스키마 검증 → U-ID 참조 검증 → 상태 규칙 검증 → 실패 시 자동 수정 요청.
import {
  AI_ALLOWED_STATES,
  CONFIDENCES,
  INTENT_TYPES,
  SCENE_BRIEF_FIELDS,
  type Confidence,
  type DecisionState,
  type Extracted,
  type ExtractedItem,
  type ExtractedIntent,
  type IntentType,
  type SceneBriefField,
} from "./types";

export type ValidationResult =
  | { ok: true; value: Extracted; warnings: string[] }
  | { ok: false; errors: string[] };

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function checkItem(
  raw: unknown,
  where: string,
  validUids: Set<string>,
  errors: string[],
  warnings: string[],
): ExtractedItem | null {
  if (typeof raw !== "object" || raw === null) {
    errors.push(`${where}: 객체가 아님`);
    return null;
  }
  const o = raw as Record<string, unknown>;

  if (!isStr(o.content)) errors.push(`${where}.content: 비어 있음`);

  const state = o.decision_state as DecisionState;
  if (!AI_ALLOWED_STATES.includes(state)) {
    errors.push(
      state === "confirmed"
        ? `${where}.decision_state: AI는 confirmed를 부여할 수 없다. candidate 까지만 가능하다.`
        : `${where}.decision_state: 허용되지 않는 값 '${String(o.decision_state)}'`,
    );
  }

  const evidence = Array.isArray(o.evidence) ? o.evidence.filter(isStr).map((s) => s.trim()) : [];
  if (!Array.isArray(o.evidence)) errors.push(`${where}.evidence: 배열이 아님`);
  const unknown = evidence.filter((u) => !validUids.has(u));
  if (unknown.length) {
    errors.push(`${where}.evidence: 전사에 없는 발언 ID ${unknown.join(", ")}`);
  }

  let confidence = o.confidence as Confidence;
  if (!CONFIDENCES.includes(confidence)) {
    errors.push(`${where}.confidence: 허용되지 않는 값 '${String(o.confidence)}'`);
    confidence = "low";
  }

  // 근거 없는 추론은 오류가 아니라 검토 대상으로 강등한다.
  let note = isStr(o.note) ? o.note : undefined;
  if (evidence.length === 0) {
    warnings.push(`${where}: 근거 발언이 없어 '추가 확인 필요'로 낮춤`);
    confidence = "low";
    note = note ? `${note} / 근거 발언 없음 — 검토 필요` : "근거 발언 없음 — 검토 필요";
  }

  if (errors.length) return null;
  return {
    content: String(o.content).trim(),
    decision_state: state,
    evidence: [...new Set(evidence)],
    confidence,
    note,
  };
}

export function validateExtraction(raw: unknown, validUids: Set<string>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["최상위가 객체가 아님"] };
  const o = raw as Record<string, unknown>;

  const core = (o.scene_brief ?? o.scene_core) as Record<string, unknown> | undefined;
  const scene_brief = {} as Record<SceneBriefField, ExtractedItem[]>;
  if (typeof core !== "object" || core === null) {
    errors.push("scene_brief: 객체가 아님");
  } else {
    for (const f of SCENE_BRIEF_FIELDS) {
      const arr = core[f];
      if (!Array.isArray(arr)) {
        errors.push(`scene_brief.${f}: 배열이 아님`);
        scene_brief[f] = [];
        continue;
      }
      scene_brief[f] = arr
        .map((it, i) => checkItem(it, `scene_brief.${f}[${i}]`, validUids, errors, warnings))
        .filter((x): x is ExtractedItem => x !== null);
    }
  }

  const decisions: Extracted["decisions"] = [];
  if (!Array.isArray(o.decisions)) {
    errors.push("decisions: 배열이 아님");
  } else {
    const seen = new Set<string>();
    o.decisions.forEach((d, i) => {
      const id = (d as Record<string, unknown>)?.id;
      if (!isStr(id)) errors.push(`decisions[${i}].id: 비어 있음`);
      else if (seen.has(id)) errors.push(`decisions[${i}].id: 중복 '${id}'`);
      else seen.add(id);
      const item = checkItem(d, `decisions[${i}]`, validUids, errors, warnings);
      if (item && isStr(id)) decisions.push({ id, ...item });
    });
  }

  const unresolved: Extracted["unresolved"] = [];
  if (!Array.isArray(o.unresolved)) {
    errors.push("unresolved: 배열이 아님");
  } else {
    o.unresolved.forEach((u, i) => {
      const x = u as Record<string, unknown>;
      const where = `unresolved[${i}]`;
      if (!isStr(x?.id)) errors.push(`${where}.id: 비어 있음`);
      if (!isStr(x?.subject)) errors.push(`${where}.subject: 비어 있음`);
      // 규칙: 모든 미결정 항목에는 해결 질문이 있어야 한다.
      if (!isStr(x?.question)) errors.push(`${where}.question: 미결정 항목에 해결 질문이 없음`);
      const evidence = Array.isArray(x?.evidence) ? x.evidence.filter(isStr) : [];
      const bad = evidence.filter((e) => !validUids.has(e));
      if (bad.length) errors.push(`${where}.evidence: 전사에 없는 발언 ID ${bad.join(", ")}`);
      if (isStr(x?.id) && isStr(x?.subject) && isStr(x?.question) && !bad.length) {
        const blocks = Array.isArray(x?.blocks_roles)
          ? x.blocks_roles.filter(
              (r): r is "director" | "writer" | "producer" =>
                r === "director" || r === "writer" || r === "producer",
            )
          : [];
        unresolved.push({
          id: x.id,
          subject: x.subject,
          question: x.question,
          evidence: [...new Set(evidence)],
          blocks_roles: blocks,
        });
      }
    });
  }

  // 의도 — Intent Coverage 검사의 출발점.
  const intents: ExtractedIntent[] = [];
  if (!Array.isArray(o.intents)) {
    errors.push("intents: 배열이 아님");
  } else {
    const seenTypes = new Set<string>();
    o.intents.forEach((raw, i) => {
      const x = raw as Record<string, unknown>;
      const where = `intents[${i}]`;
      const type = x?.type as IntentType;
      if (!INTENT_TYPES.includes(type)) {
        errors.push(`${where}.type: 허용되지 않는 값 '${String(x?.type)}'`);
        return;
      }
      if (seenTypes.has(type)) {
        errors.push(`${where}.type: '${type}' 의도가 중복됨`);
        return;
      }
      seenTypes.add(type);
      if (!isStr(x?.text)) errors.push(`${where}.text: 비어 있음`);
      if (!SCENE_BRIEF_FIELDS.includes(x?.source_field as SceneBriefField)) {
        errors.push(`${where}.source_field: Scene Brief 항목이 아님 '${String(x?.source_field)}'`);
      }
      const evidence = Array.isArray(x?.evidence) ? x.evidence.filter(isStr) : [];
      const bad = evidence.filter((e) => !validUids.has(e));
      if (bad.length) errors.push(`${where}.evidence: 전사에 없는 발언 ID ${bad.join(", ")}`);
      if (evidence.length === 0) {
        warnings.push(`${where}: 근거 발언이 없는 의도`);
      }
      if (isStr(x?.text) && !bad.length) {
        intents.push({
          type,
          text: x.text.trim(),
          source_field: x.source_field as SceneBriefField,
          evidence: [...new Set(evidence)],
        });
      }
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { scene_brief, decisions, unresolved, intents }, warnings };
}
