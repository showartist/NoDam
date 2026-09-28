import {z} from "zod";
import {db,now} from "../db";
import {getMeetingUtterances} from "../alignment/store";
import {IntakeError} from "./store";
const Input=z.object({uid:z.string().min(1).max(80),text:z.string().trim().min(1).max(10000),speakerName:z.string().trim().max(80).nullable(),expectedText:z.string(),expectedSpeakerName:z.string().nullable()});
export function editUtterance(meetingId:string,value:unknown){
 const input=Input.parse(value),d=db();
 d.exec("CREATE TABLE IF NOT EXISTS utterance_edits(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL,uid TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL)");
 d.exec("BEGIN IMMEDIATE");try{
 if(d.prepare("SELECT id FROM live_sessions WHERE meeting_id=? AND status IN ('recording','stopping')").get(meetingId))throw new IntakeError(409,"녹음과 종료 처리가 끝난 뒤 발언을 수정해 주세요.");
 const prior=getMeetingUtterances(meetingId).find(u=>u.uid===input.uid);if(!prior)throw new IntakeError(404,"이 회의의 발언을 찾을 수 없습니다.");
 if(prior.text!==input.expectedText||prior.speakerName!==input.expectedSpeakerName)throw new IntakeError(409,"다른 수정이 먼저 저장됐습니다. 새로고침 후 다시 확인해 주세요.");
 const name=input.speakerName||null;
 // A manual name is a person supplied label, not a voice identification result. Preserve the former id in the audit record.
 d.prepare("UPDATE utterances SET text_clean=?,speaker_name=?,role=?,speaker_id=NULL WHERE meeting_id=? AND uid=?").run(input.text,name,prior.role,meetingId,input.uid);
 d.prepare("INSERT INTO utterance_edits(meeting_id,uid,before_json,after_json,created_at) VALUES(?,?,?,?,?)").run(meetingId,input.uid,JSON.stringify(prior),JSON.stringify({text:input.text,speakerName:name,recordMode:"human_edited"}),now());
 d.exec("COMMIT");return {ok:true};
 }catch(e){d.exec("ROLLBACK");throw e;}
}

const Speakers=z.object({speakerName:z.string().trim().min(1).max(80),turns:z.array(z.object({uid:z.string().min(1).max(80),expectedText:z.string(),expectedSpeakerName:z.string().nullable(),expectedSpeakerKey:z.string().nullable()})).min(1).max(10000)});
export function editSpeakers(meetingId:string,value:unknown){
 const input=Speakers.parse(value),d=db();
 if(new Set(input.turns.map(u=>u.uid)).size!==input.turns.length)throw new IntakeError(400,"같은 발언을 중복 선택할 수 없습니다.");
 d.exec("CREATE TABLE IF NOT EXISTS utterance_edits(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL,uid TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,created_at TEXT NOT NULL)");
 d.exec("BEGIN IMMEDIATE");try{
  if(d.prepare("SELECT id FROM live_sessions WHERE meeting_id=? AND status IN ('recording','stopping')").get(meetingId))throw new IntakeError(409,"녹음과 종료 처리가 끝난 뒤 화자를 수정해 주세요.");
  const turns=new Map(getMeetingUtterances(meetingId).map(u=>[u.uid,u]));
  const selected=input.turns.map(u=>{const prior=turns.get(u.uid);if(!prior)throw new IntakeError(404,"이 회의의 발언을 찾을 수 없습니다.");if(prior.text!==u.expectedText||prior.speakerName!==u.expectedSpeakerName||prior.speakerKey!==u.expectedSpeakerKey)throw new IntakeError(409,"다른 수정이 먼저 저장됐습니다. 새로고침 후 다시 확인해 주세요.");return prior;});
  const stamp=now();
  for(const prior of selected){
   d.prepare("UPDATE utterances SET speaker_name=?,speaker_id=NULL,role=? WHERE meeting_id=? AND uid=?").run(input.speakerName,prior.role,meetingId,prior.uid);
   d.prepare("INSERT INTO utterance_edits(meeting_id,uid,before_json,after_json,created_at) VALUES(?,?,?,?,?)").run(meetingId,prior.uid,JSON.stringify(prior),JSON.stringify({text:prior.text,speakerName:input.speakerName,recordMode:"human_edited",operation:"speaker_batch"}),stamp);
  }
  d.exec("COMMIT");return {ok:true,updated:selected.length};
 }catch(e){d.exec("ROLLBACK");throw e;}
}
