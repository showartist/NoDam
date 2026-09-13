import {readFileSync} from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {db} from "../db";
import {getMeetingUtterances} from "../alignment/store";
import {getFacilitatorState} from "../facilitator/store";
function database(){const d=db();d.exec("CREATE TABLE IF NOT EXISTS live_public_shares(meeting_id TEXT PRIMARY KEY,share_id TEXT NOT NULL,enabled INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0,last_sync TEXT,error TEXT)");return d;}
function config(){
 const c=JSON.parse(readFileSync(path.join(process.cwd(),".data/sharing/config.json"),"utf8")) as {origin:string;writeKey:string};
 if(!/^https:\/\/[a-z0-9.-]+\.chatgpt\.site$/.test(c.origin)||!c.writeKey)throw new Error("공유 서버 설정을 확인해 주세요.");return c;
}
type Row={share_id:string;enabled:number;revision:number;last_sync:string|null;error:string|null};
export function shareState(meetingId:string){const row=database().prepare("SELECT * FROM live_public_shares WHERE meeting_id=?").get(meetingId) as Row|undefined;let c;try{c=config();}catch{return {configured:false,enabled:false,url:null,lastSync:null,error:null};}return {configured:true,enabled:!!row?.enabled,url:row?.enabled?`${c.origin}/live/${row.share_id}`:null,lastSync:row?.last_sync??null,error:row?.error??null};}
const global=globalThis as unknown as {__shareWrites?:Map<string,Promise<unknown>>};const writes=global.__shareWrites??=new Map();
export function updateShare(meetingId:string,action:"start"|"sync"|"stop"):Promise<ReturnType<typeof shareState>>{
 const task=(writes.get(meetingId)??Promise.resolve()).catch(()=>{}).then(async()=>{
  const d=database(),c=config();
  if(!d.prepare("SELECT id FROM meetings WHERE id=?").get(meetingId))throw new Error("회의를 찾을 수 없습니다.");
  if(action==="start")d.prepare("INSERT INTO live_public_shares(meeting_id,share_id,enabled) VALUES(?,?,1) ON CONFLICT(meeting_id) DO UPDATE SET enabled=1,error=NULL").run(meetingId,randomBytes(24).toString("hex"));
  const row=d.prepare("SELECT * FROM live_public_shares WHERE meeting_id=?").get(meetingId) as Row|undefined;if(!row||!row.enabled)return shareState(meetingId);
  try{
   const endpoint=`${c.origin}/api/shared/${row.share_id}`;
   if(action==="stop"){
    const response=await fetch(endpoint,{method:"DELETE",headers:{authorization:`Bearer ${c.writeKey}`},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`공유 종료 실패 (HTTP ${response.status})`);
    d.prepare("DELETE FROM live_public_shares WHERE meeting_id=?").run(meetingId);return shareState(meetingId);
   }
   const facilitator=getFacilitatorState(meetingId);
   const session=d.prepare("SELECT status FROM live_sessions WHERE meeting_id=? ORDER BY started_at DESC LIMIT 1").get(meetingId) as {status:string}|undefined;
   const revision=row.revision+1;
   const payload={revision,goal:facilitator?.goal??"회의 원문 함께 보기",intervalMinutes:facilitator?.intervalMinutes??null,status:session?.status??"stopped",utterances:getMeetingUtterances(meetingId).map(u=>({uid:u.uid,text:u.text,startMs:u.startMs,speakerId:u.speakerId,speakerName:u.speakerName})),reviews:facilitator?.reviews??[]};
   const response=await fetch(endpoint,{method:"PUT",headers:{authorization:`Bearer ${c.writeKey}`,"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`공유 갱신 실패 (HTTP ${response.status})`);
   d.prepare("UPDATE live_public_shares SET revision=?,last_sync=?,error=NULL WHERE meeting_id=?").run(revision,new Date().toISOString(),meetingId);
  }catch(e){d.prepare("UPDATE live_public_shares SET error=? WHERE meeting_id=?").run((e as Error).message,meetingId);throw e;}
  return shareState(meetingId);
 });writes.set(meetingId,task);void task.finally(()=>{if(writes.get(meetingId)===task)writes.delete(meetingId);}).catch(()=>{});return task;
}
