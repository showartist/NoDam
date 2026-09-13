/**
 * 해석 거리.
 *
 * 한 안건에서 두 사람 이상이 값을 말한 항목(슬롯)만 비교한다. 비교한 항목 가운데 값이 서로 다른
 * 항목의 비율이 해석 거리다. 비교할 항목이 없으면 null 이다. 숫자를 만들지 않는다(제품 원칙 3·8).
 *
 * 사람마다 같은 대상을 다른 항목 이름으로 적기 쉬운 짝(조명↔색, 인물 행동↔연기 방향)은, 한 사람은 한쪽에만,
 * 다른 사람은 다른 쪽에만 값을 적었을 때 두 항목을 한 줄로 비교한다(RELATED_SLOTS). 어느 한 항목을 이미
 * 두 사람 이상이 말했으면 그 항목끼리만 비교한다.
 *
 * 값이 같은지는 두 단계로 본다.
 *   1. 정규화한 문자열이 같으면 same (basis: exact)
 *   2. 판정 모델이 미리 매긴 짝 판정이 있으면 그 값 (basis: judge). 판정이 없거나 unclear 면 differs
 *      — 확실하지 않으면 사람에게 묻는 쪽으로 기운다.
 */
import { SLOT_KEYS, SLOT_LABEL, type Distance, type PositionV2, type SlotDiff, type SlotKey } from "./schema";
import { normalizeForMatch } from "./checks";

export type PairVerdict = "same" | "different" | "unclear";

/** 같은 대상을 서로 다른 항목에 적기 쉬운 짝. 첫 항목이 대표(비교 줄의 slot, 승인 때 원장 항목)다. */
export const RELATED_SLOTS: readonly (readonly [SlotKey, SlotKey])[] = [
  ["lighting", "colorIntent"],
  ["performanceDirection", "subjectAction"],
];

/** 비교 줄의 이름. 두 항목을 묶은 줄이면 "조명·색". */
export function diffLabel(d: { slot: SlotKey; slots?: SlotKey[] }): string {
  return (d.slots ?? [d.slot]).map((k) => SLOT_LABEL[k]).join("·");
}

/** 짝 판정 캐시 키. 순서와 무관하게 같은 키가 나온다. */
export function pairKey(slot: SlotKey, a: string, b: string): string {
  const [x, y] = [normalizeForMatch(a), normalizeForMatch(b)].sort();
  return `${slot}|${x}|${y}`;
}

function valuesFor(positions: PositionV2[], slots: readonly SlotKey[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of positions) {
    const key = p.speaker.key ?? p.speaker.name ?? "?";
    if (key in values) continue;
    const v = slots.map((s) => p.slots[s]?.trim()).find(Boolean);
    if (v) values[key] = v;
  }
  return values;
}

export function computeSlotDiff(positions: PositionV2[], verdicts: Map<string, PairVerdict> = new Map()): SlotDiff[] {
  const out: SlotDiff[] = [];
  const groups: { slot: SlotKey; slots?: SlotKey[]; values: Record<string, string> }[] = [];
  const grouped = new Set<SlotKey>();
  for (const [a, b] of RELATED_SLOTS) {
    const va = valuesFor(positions, [a]);
    const vb = valuesFor(positions, [b]);
    if (Object.keys(va).length >= 2 || Object.keys(vb).length >= 2) continue;
    const both = valuesFor(positions, [a, b]);
    if (Object.keys(both).length < 2) continue;
    groups.push({ slot: a, slots: [a, b], values: both });
    grouped.add(a).add(b);
  }
  for (const slot of SLOT_KEYS) {
    if (grouped.has(slot)) {
      const g = groups.find((x) => x.slot === slot);
      if (g) compare(g.slot, g.values, g.slots);
      continue;
    }
    const values = valuesFor(positions, [slot]);
    if (Object.keys(values).length >= 2) compare(slot, values);
  }
  return out;

  function compare(slot: SlotKey, values: Record<string, string>, slots?: SlotKey[]) {
    const keys = Object.keys(values);
    let allSame = true;
    let basis = "exact";
    const pairs: NonNullable<SlotDiff["pairs"]> = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = values[keys[i]];
        const b = values[keys[j]];
        if (normalizeForMatch(a) === normalizeForMatch(b)) {
          pairs.push({ a: keys[i], b: keys[j], verdict: "same" });
          continue;
        }
        const v = verdicts.get(pairKey(slot, a, b));
        pairs.push({ a: keys[i], b: keys[j], verdict: v ?? "unclear" });
        if (v === "same") {
          basis = "judge";
          continue;
        }
        allSame = false;
        basis = v ? "judge" : "exact";
      }
    }
    out.push({ slot, ...(slots ? { slots } : {}), values, pairs, state: allSame ? "same" : "differs", basis });
  }
}

/** scope: 비교한 항목을 가리키는 말. 과거 결정 충돌은 "지난 결정과 이번 회의가 함께 다룬" 을 넘긴다. */
export function computeDistance(diff: SlotDiff[], scope = "두 사람 이상이 말한"): Distance {
  const compared = diff.length;
  const differing = diff.filter((d) => d.state === "differs");
  if (compared === 0) {
    return { differs: 0, compared: 0, value: null, basis: `${scope} 항목이 없어 거리를 재지 않음` };
  }
  const names = (ds: SlotDiff[]) => ds.map((d) => diffLabel(d)).join(", ");
  const basis =
    differing.length === 0
      ? `${scope} 항목 ${compared}개(${names(diff)})의 값이 모두 같음`
      : `${scope} 항목 ${compared}개(${names(diff)}) 중 ${differing.length}개가 다름: ${names(differing)}`;
  return { differs: differing.length, compared, value: Math.round((differing.length / compared) * 1000) / 1000, basis };
}
