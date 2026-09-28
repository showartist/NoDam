import {db} from "../db";
import {createRun,finishRun,getMeetingUtterances,type MeetingUtterance} from "./store";
const LEASE_MS=45_000;
export class AnalysisBusyError extends Error {}
function database(){const d=db();d.exec(`CREATE TABLE IF NOT EXISTS analysis_jobs(run_id TEXT PRIMARY KEY,expires_ms INTEGER NOT NULL,source_json TEXT NOT NULL,through_uid TEXT,source_count INTEGER NOT NULL)`);return d;}
export function recoverAnalysisJobs(meetingId:string,at=Date.now()){
 const d=database();
 const rows=d.prepare(`SELECT r.id FROM alignment_v2_runs r LEFT JOIN analysis_jobs j ON j.run_id=r.id
 WHERE r.meeting_id=? AND r.mode='batch' AND r.status='running'
 AND ((j.run_id IS NOT NULL AND j.expires_ms<=?) OR (j.run_id IS NULL AND r.created_at<?))`).all(meetingId,at,new Date(at-600_000).toISOString()) as {id:string}[];
 for(const r of rows)finishRun(r.id,{status:"failed",error:"실행이 중단되어 분석을 마치지 못했습니다. 저장된 원문으로 다시 분석해 주세요."});
 return rows.length;
}
export function beginAnalysisJob(meetingId:string,model:string,judgeModel:string|null,source:MeetingUtterance[]){
 const d=database();d.exec("BEGIN IMMEDIATE");
 try{recoverAnalysisJobs(meetingId);
 if(d.prepare("SELECT id FROM alignment_v2_runs WHERE meeting_id=? AND mode='batch' AND status='running'").get(meetingId))throw new AnalysisBusyError("이미 전체 분석을 처리하고 있습니다. 잠시 후 결과를 확인해 주세요.");
 const id=createRun(meetingId,"batch",model,{judgeModel,utteranceCount:source.length});
 d.prepare("INSERT INTO analysis_jobs VALUES(?,?,?,?,?)").run(id,Date.now()+LEASE_MS,JSON.stringify(source),source.at(-1)?.uid??null,source.length);d.exec("COMMIT");return id;
 }catch(e){d.exec("ROLLBACK");throw e;}
}
export function renewAnalysisJob(id:string){const stamp=Date.now();return database().prepare("UPDATE analysis_jobs SET expires_ms=? WHERE run_id=? AND expires_ms>? AND EXISTS(SELECT 1 FROM alignment_v2_runs WHERE id=? AND status='running')").run(stamp+LEASE_MS,id,stamp,id).changes===1;}
export function assertAnalysisJob(id:string){if(!database().prepare("SELECT j.run_id FROM analysis_jobs j JOIN alignment_v2_runs r ON r.id=j.run_id WHERE j.run_id=? AND j.expires_ms>? AND r.status='running'").get(id,Date.now()))throw new Error("중단되거나 만료된 분석 결과는 저장하지 않습니다. 다시 분석해 주세요.");}
export function analysisScope(id:string){return database().prepare("SELECT through_uid,source_count FROM analysis_jobs WHERE run_id=?").get(id) as {through_uid:string|null;source_count:number}|undefined;}

export function analysisSourceChanged(runId:string,meetingId:string){
 const row=database().prepare("SELECT source_json FROM analysis_jobs WHERE run_id=?").get(runId) as {source_json:string}|undefined;
 if(!row){
  const d=database();if(!d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='utterance_edits'").get())return false;
  return !!d.prepare("SELECT id FROM utterance_edits WHERE meeting_id=? AND created_at>=(SELECT created_at FROM alignment_v2_runs WHERE id=?) LIMIT 1").get(meetingId,runId);
 }
 const current=new Map(getMeetingUtterances(meetingId).map(u=>[u.uid,u]));
 return (JSON.parse(row.source_json) as MeetingUtterance[]).some(u=>{const v=current.get(u.uid);return !v||u.text!==v.text||u.speakerKey!==v.speakerKey||u.speakerName!==v.speakerName||u.role!==v.role;});
}
