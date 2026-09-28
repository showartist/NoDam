import {segmentBase} from "@/lib/live/segments";
import { getFacilitatorState } from "@/lib/facilitator/store";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAgreements, getCurrentRun, getMeetingUtterances, listIssues } from "@/lib/alignment/store";
import { activeSessionFor, getEngine } from "@/lib/live/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — 화면 첫 그림: 세션 상태, 발언, 현재 run 의 안건. 이후 변화는 events 로 받는다. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  let active = activeSessionFor(id);
  const last = db().prepare(`SELECT id, status, mode, source, link_method, started_at, stopped_at FROM live_sessions WHERE meeting_id = ? ORDER BY started_at DESC,rowid DESC LIMIT 1`).get(id) as Record<string, unknown> | undefined;
  if(!active&&last)active=getEngine(String(last.id));
  const failedFinish=last?.status==="stopped"&&!!db().prepare("SELECT r.id FROM alignment_v2_runs r JOIN live_sessions l ON l.run_id=r.id WHERE l.id=? AND r.status='failed'").get(last.id as string);
  const run = getCurrentRun(id, { includeRunning: true });
  return NextResponse.json({
    baseOffsetMs:last?segmentBase(String(last.id)):0,
    facilitator:getFacilitatorState(id),
    chunks:db().prepare("SELECT idx,offset_ms,status,error,stt_ms FROM live_chunks WHERE session_id=? ORDER BY idx").all(active?.sessionId??String(last?.id??"")),
    session: active ? { id: active.sessionId, status: active.stopping ? "stopping" : "recording", mode: active.mode, stoppedAt:last?.stopped_at, startedAt:last?.started_at } : last ? {...last,status:last.status==="recording"||last.status==="stopping"||failedFinish?"interrupted":last.status} : null,
    utterances: getMeetingUtterances(id).map((u) => ({ uid: u.uid, speakerId: u.speakerId, speakerName: u.speakerName, startMs: u.startMs, endMs: u.endMs, text: u.text })),
    run: run ? { id: run.id, mode: run.mode, status: run.status } : null,
    issues: run ? listIssues(id, run.id) : [],
    agreements: run ? getAgreements(id, run.id) : [],
  });
}
