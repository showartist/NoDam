/**
 * 회의별 이벤트 버스(서버 프로세스 안). SSE 경로가 구독하고, 라이브 세션이 발행한다.
 * 늦게 붙은 화면을 위해 최근 이벤트 몇 개를 들고 있다. 서버를 다시 띄우면 비워진다(상태는 DB 에 있다).
 */
export type LiveEvent =
  | { type: "facilitator"; state: unknown }
  | { type: "session"; sessionId: string; status: string; mode?: string; error?: string | null }
  | { type: "chunk"; sessionId: string; idx: number; offsetMs: number; sttMs: number | null; utterances: number; linkMethod: string; error?: string | null; status?:string }
  | { type: "utterances"; items: { uid: string; speakerId: string | null; speakerName: string | null; startMs: number | null; endMs: number | null; text: string; provisional: boolean }[] }
  | { type: "window"; from: string; to: string; newIds: string[]; updatedIds: string[]; latencyMs: number }
  | { type: "issue"; op: "new" | "update"; issue: unknown }
  | { type: "status"; stage: "stt" | "analysis" | "idle"; label: string };

type Listener = (e: LiveEvent & { seq: number; at: string }) => void;

type Channel = { seq: number; recent: (LiveEvent & { seq: number; at: string })[]; listeners: Set<Listener> };

const g = globalThis as unknown as { __scenenoteBus?: Map<string, Channel> };
const channels: Map<string, Channel> = (g.__scenenoteBus ??= new Map());

function channel(meetingId: string): Channel {
  let c = channels.get(meetingId);
  if (!c) {
    c = { seq: 0, recent: [], listeners: new Set() };
    channels.set(meetingId, c);
  }
  return c;
}

export function publish(meetingId: string, e: LiveEvent): void {
  const c = channel(meetingId);
  const ev = { ...e, seq: ++c.seq, at: new Date().toISOString() };
  c.recent.push(ev);
  if (c.recent.length > 200) c.recent.splice(0, c.recent.length - 200);
  for (const l of c.listeners) {
    try {
      l(ev);
    } catch {}
  }
}

export function subscribe(meetingId: string, l: Listener, sinceSeq = 0): () => void {
  const c = channel(meetingId);
  for (const ev of c.recent) if (ev.seq > sinceSeq) l(ev);
  c.listeners.add(l);
  return () => c.listeners.delete(l);
}
