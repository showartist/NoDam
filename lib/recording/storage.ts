/** 녹음 조각은 각 IndexedDB 트랜잭션 완료 뒤에만 저장된 것으로 표시한다. */
export type SavedRecording = { id: string; meetingId: string; mime: string; startedAt: number; savedAt: number; bytes: number; chunks: number; complete: boolean };
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("scenenote-recordings", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("chunks", { keyPath: ["id", "index"] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode); let result: T;
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error("녹음 저장 실패")); };
    action(tx, value => { result = value; });
  });
}
export async function createRecording(meetingId: string, mime: string) {
  const now = Date.now();
  const session: SavedRecording = { id: crypto.randomUUID(), meetingId, mime, startedAt: now, savedAt: now, bytes: 0, chunks: 0, complete: false };
  await transaction<void>(["sessions"], "readwrite", tx => { tx.objectStore("sessions").add(session); });
  return session;
}
export async function appendRecordingChunk(session: SavedRecording, blob: Blob) {
  const next = { ...session, bytes: session.bytes + blob.size, chunks: session.chunks + 1, savedAt: Date.now() };
  await transaction<void>(["sessions", "chunks"], "readwrite", tx => {
    tx.objectStore("chunks").add({ id: session.id, index: session.chunks, blob });
    tx.objectStore("sessions").put(next);
  });
  return next;
}
export async function completeRecording(session: SavedRecording) {
  const next = { ...session, complete: true };
  await transaction<void>(["sessions"], "readwrite", tx => { tx.objectStore("sessions").put(next); });
  return next;
}
export async function listRecordings(meetingId: string) {
  const all = await transaction<SavedRecording[]>(["sessions"], "readonly", (tx, done) => {
    const r = tx.objectStore("sessions").getAll(); r.onsuccess = () => done(r.result);
  });
  return all.filter(s => s.meetingId === meetingId && s.bytes > 0).sort((a, b) => b.savedAt - a.savedAt);
}
export async function restoreRecording(session: SavedRecording): Promise<File> {
  const chunks = await transaction<{ blob: Blob }[]>(["chunks"], "readonly", (tx, done) => {
    const r = tx.objectStore("chunks").getAll(IDBKeyRange.bound([session.id, 0], [session.id, Number.MAX_SAFE_INTEGER]));
    r.onsuccess = () => done(r.result);
  });
  const ext = session.mime.includes("mp4") ? "m4a" : session.mime.includes("ogg") ? "ogg" : "webm";
  return new File(chunks.map(c => c.blob), `meeting-${session.startedAt}.${ext}`, { type: session.mime });
}
