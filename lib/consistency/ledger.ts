/**
 * 결정 원장과 과거 회의 검색(RAG)의 임베딩.
 *
 * 원장(decision_ledger)은 사람이 합의 화면에서 승인한 항목 값만 담는다. 회의 간 일관성 검사와
 * 변경 이력의 기준이다. 임베딩은 OpenRouter baai/bge-m3 로 만들고 행에 JSON 으로 둔다
 * (개인 프로젝트 규모라 SQLite 에서 코사인을 직접 계산해도 충분하다).
 */
import { db, now } from "../db";
import { cosine, embed } from "../llm/openrouter";
import { SLOT_LABEL, type SlotKey } from "../alignment/schema";

export type LedgerEntry = {
  id: string;
  project_id: string;
  meeting_id: string;
  run_id: string | null;
  issue_id: string | null;
  decision: string;
  slot: SlotKey;
  value: string;
  evidence: string[];
  decided_by: string;
  decided_at: string;
  superseded_by: string | null;
  embedding: number[] | null;
};

type Row = Omit<LedgerEntry, "evidence" | "embedding"> & { evidence: string; embedding: string | null };

export function ledgerText(e: { decision: string; slot: string; value: string }): string {
  return `${e.decision} / ${SLOT_LABEL[e.slot as SlotKey] ?? e.slot}: ${e.value}`;
}

export function listLedger(projectId: string, opts: { excludeMeetingId?: string; activeOnly?: boolean } = {}): LedgerEntry[] {
  const rows = db()
    .prepare(`SELECT * FROM decision_ledger WHERE project_id = ? ORDER BY decided_at`)
    .all(projectId) as unknown as Row[];
  return rows
    .filter((r) => (!opts.excludeMeetingId || r.meeting_id !== opts.excludeMeetingId) && (!opts.activeOnly || !r.superseded_by))
    .map((r) => ({ ...r, evidence: JSON.parse(r.evidence), embedding: r.embedding ? JSON.parse(r.embedding) : null }));
}

/** 임베딩이 없는 원장 행을 채운다. */
export async function ensureLedgerEmbeddings(entries: LedgerEntry[]): Promise<LedgerEntry[]> {
  const missing = entries.filter((e) => !e.embedding);
  if (!missing.length) return entries;
  const { vectors } = await embed(missing.map(ledgerText));
  const upd = db().prepare(`UPDATE decision_ledger SET embedding = ? WHERE id = ?`);
  missing.forEach((e, i) => {
    e.embedding = vectors[i];
    upd.run(JSON.stringify(vectors[i]), e.id);
  });
  return entries;
}

/** 새 결정이 같은 항목의 옛 결정을 대신하면 옛 행에 표시한다(변경 이력). */
export function supersede(oldId: string, newId: string): void {
  db().prepare(`UPDATE decision_ledger SET superseded_by = ? WHERE id = ?`).run(newId, oldId);
}

// ── 과거 회의 검색 (RAG) ──────────────────────────────────────────────────

export function ensureUtteranceEmbeddingTable(): void {
  db().exec(`CREATE TABLE IF NOT EXISTS utterance_embeddings (
    meeting_id TEXT NOT NULL, uid TEXT NOT NULL, text_hash TEXT NOT NULL, model TEXT NOT NULL,
    embedding TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (meeting_id, uid))`);
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

/** 한 회의 발언의 임베딩을 채운다(바뀐 발언만 다시 만든다). */
export async function ensureMeetingEmbeddings(meetingId: string): Promise<number> {
  ensureUtteranceEmbeddingTable();
  const d = db();
  const utts = d.prepare(`SELECT uid, text_clean FROM utterances WHERE meeting_id = ? ORDER BY idx`).all(meetingId) as { uid: string; text_clean: string }[];
  const have = new Map(
    (d.prepare(`SELECT uid, text_hash FROM utterance_embeddings WHERE meeting_id = ?`).all(meetingId) as { uid: string; text_hash: string }[]).map((r) => [r.uid, r.text_hash]),
  );
  const todo = utts.filter((u) => have.get(u.uid) !== hash(u.text_clean) && u.text_clean.trim().length >= 4);
  for (let i = 0; i < todo.length; i += 96) {
    const batch = todo.slice(i, i + 96);
    const { vectors, usage } = await embed(batch.map((u) => u.text_clean));
    const ins = d.prepare(`INSERT OR REPLACE INTO utterance_embeddings (meeting_id, uid, text_hash, model, embedding, created_at) VALUES (?,?,?,?,?,?)`);
    batch.forEach((u, k) => ins.run(meetingId, u.uid, hash(u.text_clean), usage.model, JSON.stringify(vectors[k]), now()));
  }
  return todo.length;
}

export type SearchHit = { meetingId: string; meetingTitle: string | null; uid: string; speaker: string | null; text: string; score: number };

/**
 * 같은 작품의 다른 회의에서 질의와 가까운 발언을 찾는다(중간보고서 기술 10번).
 * 임베딩이 없는 회의는 먼저 채운다.
 */
export async function searchPastMeetings(projectId: string, query: string, opts: { excludeMeetingId?: string; k?: number } = {}): Promise<SearchHit[]> {
  const d = db();
  const meetings = d
    .prepare(`SELECT id, title FROM meetings WHERE project_id = ? ${opts.excludeMeetingId ? "AND id <> ?" : ""}`)
    .all(...([projectId, opts.excludeMeetingId].filter(Boolean) as string[])) as { id: string; title: string | null }[];
  if (!meetings.length) return [];
  for (const m of meetings) await ensureMeetingEmbeddings(m.id);
  const { vectors } = await embed([query]);
  const q = vectors[0];
  const hits: SearchHit[] = [];
  for (const m of meetings) {
    const rows = d
      .prepare(
        `SELECT e.uid, e.embedding, u.text_clean, COALESCE(sm.display_name, u.speaker_name, u.speaker_id) AS speaker
           FROM utterance_embeddings e JOIN utterances u ON u.meeting_id = e.meeting_id AND u.uid = e.uid
           LEFT JOIN speaker_mappings sm ON sm.meeting_id = u.meeting_id AND sm.speaker_id = u.speaker_id
          WHERE e.meeting_id = ?`,
      )
      .all(m.id) as { uid: string; embedding: string; text_clean: string; speaker: string | null }[];
    for (const r of rows) hits.push({ meetingId: m.id, meetingTitle: m.title, uid: r.uid, speaker: r.speaker, text: r.text_clean, score: cosine(q, JSON.parse(r.embedding)) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, opts.k ?? 8);
}
