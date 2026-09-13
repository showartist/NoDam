import { subscribe } from "@/lib/live/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — 서버 전송 이벤트(SSE). 조각 처리·새 발언·창 분석·안건 갱신을 흘려 보낸다. */
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const since = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {}
      };
      send(`: connected\n\n`);
      unsub = subscribe(id, (ev) => send(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`), since);
      beat = setInterval(() => send(`: ping\n\n`), 15000);
      req.signal.addEventListener("abort", () => {
        unsub?.();
        if (beat) clearInterval(beat);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      unsub?.();
      if (beat) clearInterval(beat);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
