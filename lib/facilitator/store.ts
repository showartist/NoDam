import { db, now } from "../db";
import { getMeetingUtterances } from "../alignment/store";
import { publish } from "../live/bus";
import { analyzeWindow } from "./analyze";
import { FacilitatorConfig, selectWindow, type Config, type Notification, type Assessed } from "./policy";

type Session = { session_id: string; meeting_id: string; goal: string; interval_ms: number; processed_ms: number; error: string | null; retry_after: number };
export type StoredReview = { id: number; fromMs: number; toMs: number; partial: boolean; assessed: Assessed; createdAt: string; sourceCount: number };
function database() {
  const d=db();
  d.exec(`CREATE TABLE IF NOT EXISTS facilitator_sessions(session_id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, goal TEXT NOT NULL, interval_ms INTEGER NOT NULL, processed_ms INTEGER NOT NULL DEFAULT 0, error TEXT, retry_after INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS facilitator_gaps(session_id TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL, PRIMARY KEY(session_id,from_ms));
    CREATE TABLE IF NOT EXISTS facilitator_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL, partial INTEGER NOT NULL, source_count INTEGER NOT NULL, result_json TEXT NOT NULL, attempts_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id,from_ms,to_ms));`);
  return d;
}
export function createFacilitatorSession(sessionId: string, meetingId: string, config: Config) {
  const c=FacilitatorConfig.parse(config);
  database().prepare("INSERT INTO facilitator_sessions(session_id,meeting_id,goal,interval_ms) VALUES(?,?,?,?)").run(sessionId,meetingId,c.goal,c.intervalMinutes*60_000);
}
export function recordAudioGap(sessionId:string,fromMs:number,toMs:number){if(toMs-fromMs>2000)database().prepare("INSERT OR IGNORE INTO facilitator_gaps VALUES(?,?,?)").run(sessionId,fromMs,toMs);}
function getSession(id: string) { return database().prepare("SELECT * FROM facilitator_sessions WHERE session_id=?").get(id) as Session | undefined; }
export function getFacilitatorState(meetingId: string) {
  const d=database();
  const session=d.prepare("SELECT f.* FROM facilitator_sessions f JOIN live_sessions l ON l.id=f.session_id WHERE f.meeting_id=? ORDER BY l.started_at DESC LIMIT 1").get(meetingId) as Session | undefined;
  if(!session)return null;
  const rows=d.prepare("SELECT * FROM facilitator_reviews WHERE session_id=? ORDER BY to_ms,id").all(session.session_id) as {id:number;from_ms:number;to_ms:number;partial:number;source_count:number;result_json:string;created_at:string}[];
  return {sessionId:session.session_id,goal:session.goal,intervalMinutes:session.interval_ms/60_000,processedMs:session.processed_ms,error:session.error,reviews:rows.map(r=>({id:r.id,fromMs:r.from_ms,toMs:r.to_ms,partial:!!r.partial,sourceCount:r.source_count,assessed:JSON.parse(r.result_json) as Assessed,createdAt:r.created_at}))};
}
const g=globalThis as unknown as {__facilitatorTasks?:Map<string,Promise<void>>};
const tasks=g.__facilitatorTasks??=new Map();
/** Serial analysis does not block transcription. Source text and successful windows persist in SQLite. */
export function advanceFacilitator(sessionId: string, throughMs: number, finish=false): Promise<void> {
  const task=(tasks.get(sessionId)??Promise.resolve()).then(async()=>{
    let session=getSession(sessionId); if(!session)return;
    if(session.retry_after>Date.now()&&!finish)return;
    while(session.processed_ms<throughMs){
      const fromMs=session.processed_ms;
      const toMs=Math.min(fromMs+session.interval_ms,throughMs);
      const partial=toMs-fromMs<session.interval_ms;
      if(partial&&!finish)break;
      const turns=getMeetingUtterances(session.meeting_id);
      const selected=selectWindow(turns,fromMs,toMs);
      const input={goal:session.goal,fromMs,toMs,partial,...selected};
      const previous=(getFacilitatorState(session.meeting_id)?.reviews??[]).flatMap(r=>r.assessed.notification?[{atMs:r.toMs,kind:r.assessed.notification.kind}]:[]) as {atMs:number;kind:Notification["kind"]}[];
      publish(session.meeting_id,{type:"status",stage:"analysis",label:"회의 목적과 최근 대화를 비교하는 중"});
      try {
        const result=await analyzeWindow(input,previous,session.interval_ms);
        const failed=database().prepare("SELECT COUNT(*) AS n FROM live_chunks WHERE session_id=? AND status='failed' AND offset_ms<? AND offset_ms+COALESCE(duration_ms,20000)>?").get(sessionId,toMs,fromMs) as {n:number};
        const gaps=database().prepare("SELECT COUNT(*) n FROM facilitator_gaps WHERE session_id=? AND from_ms<? AND to_ms>?").get(sessionId,toMs,fromMs) as {n:number};
        if(failed.n||gaps.n){result.assessed.notification=null;result.assessed.held.push("전사 실패 또는 녹음 중단 구간이 포함되어 자동 알림을 보류함");result.assessed.review.focus="uncertain";}
        const d=database();d.exec("BEGIN IMMEDIATE");
        try {
          d.prepare("INSERT INTO facilitator_reviews(session_id,from_ms,to_ms,partial,source_count,result_json,attempts_json,created_at) VALUES(?,?,?,?,?,?,?,?)").run(sessionId,fromMs,toMs,Number(partial),selected.current.length,JSON.stringify(result.assessed),JSON.stringify(result.attempts),now());
          d.prepare("UPDATE facilitator_sessions SET processed_ms=?,error=NULL,retry_after=0 WHERE session_id=?").run(toMs,sessionId);
          d.exec("COMMIT");
        }catch(e){d.exec("ROLLBACK");throw e;}
        publish(session.meeting_id,{type:"facilitator",state:getFacilitatorState(session.meeting_id)});
        session=getSession(sessionId)!;
      }catch(e){
        const message=(e as Error).message;
        database().prepare("UPDATE facilitator_sessions SET error=?,retry_after=? WHERE session_id=?").run(message,Date.now()+60_000,sessionId);
        publish(session.meeting_id,{type:"facilitator",state:getFacilitatorState(session.meeting_id)});
        break; // Retain failed boundary for retry; never label a missing analysis as quiet/success.
      }
    }
  });
  tasks.set(sessionId,task);
  void task.finally(()=>{if(tasks.get(sessionId)===task)tasks.delete(sessionId);}).catch(()=>{});
  return task;
}
