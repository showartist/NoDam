/**
 * 결정 이력 (계획서 3-4, 중간보고서 기술 8번: 시계열 버전 관리·변경 이력).
 *
 * 원장(decision_ledger)을 회의 순서대로 모아, 회의가 끝날 때마다의 결정 스냅샷(항목 → 값)을 만들고
 * jsondiffpatch 로 이웃 스냅샷을 비교해 "무엇이 언제 누구 승인으로 바뀌었는지"를 적는다.
 */
import { create } from "jsondiffpatch";
import { db } from "../db";
import { SLOT_LABEL, type SlotKey } from "../alignment/schema";
import { listLedger, type LedgerEntry } from "./ledger";

const diffpatch = create({ objectHash: (o: unknown) => JSON.stringify(o) });

export type HistoryStep = {
  meetingId: string;
  meetingTitle: string | null;
  createdAt: string;
  decisions: LedgerEntry[];
  changes: { key: string; label: string; before: string | null; after: string | null; by: string; evidence: string[] }[];
};

/** 항목 키: 결정 대상 + 슬롯. 같은 대상의 같은 항목이면 같은 키다. */
function keyOf(e: LedgerEntry): string {
  return `${e.decision.trim()} · ${SLOT_LABEL[e.slot as SlotKey] ?? e.slot}`;
}

export function projectHistory(projectId: string): { steps: HistoryStep[]; current: Record<string, { value: string; meetingId: string; by: string }> } {
  const ledger = listLedger(projectId);
  const meetings = db()
    .prepare(`SELECT id, title, created_at FROM meetings WHERE project_id = ? ORDER BY created_at`)
    .all(projectId) as { id: string; title: string | null; created_at: string }[];

  // 원장 행을 대체 관계로 이으면, 과거 결정 충돌을 정리한 행이 옛 행의 키를 물려받는다.
  const rootKey = new Map<string, string>();
  for (const e of ledger) {
    let root = e;
    // 이 행이 대체한 옛 행을 따라 올라가 첫 행의 키를 쓴다.
    for (let guard = 0; guard < 20; guard++) {
      const prev = ledger.find((x) => x.superseded_by === root.id);
      if (!prev) break;
      root = prev;
    }
    rootKey.set(e.id, keyOf(root));
  }

  const steps: HistoryStep[] = [];
  let snapshot: Record<string, string> = {};
  const current: Record<string, { value: string; meetingId: string; by: string }> = {};
  for (const m of meetings) {
    const decisions = ledger.filter((e) => e.meeting_id === m.id).sort((a, b) => a.decided_at.localeCompare(b.decided_at));
    if (!decisions.length) continue;
    const next = { ...snapshot };
    for (const e of decisions) {
      const k = rootKey.get(e.id) ?? keyOf(e);
      next[k] = e.value;
      current[k] = { value: e.value, meetingId: m.id, by: e.decided_by };
    }
    const delta = diffpatch.diff(snapshot, next) as Record<string, unknown> | undefined;
    const changes: HistoryStep["changes"] = [];
    for (const [k, d] of Object.entries(delta ?? {})) {
      const arr = d as unknown[];
      const before = arr.length === 2 ? String(arr[0]) : null; // [old, new] = 변경, [new] = 추가
      const after = arr.length === 2 ? String(arr[1]) : arr.length === 1 ? String(arr[0]) : null;
      const e = decisions.find((x) => (rootKey.get(x.id) ?? keyOf(x)) === k)!;
      changes.push({ key: k, label: k, before, after, by: e?.decided_by ?? "", evidence: e?.evidence ?? [] });
    }
    steps.push({ meetingId: m.id, meetingTitle: m.title, createdAt: m.created_at, decisions, changes });
    snapshot = next;
  }
  return { steps, current };
}
