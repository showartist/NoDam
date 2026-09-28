import {randomBytes,createHash} from "node:crypto";
import {db,now} from "../db";
import {getDecisionBoard,changeDecisionBoard,DecisionError} from "./store";
import {isPracticeMeeting} from "../meetingIntake/store";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
function database(){const d=db();d.exec(`CREATE TABLE IF NOT EXISTS participant_access(token_hash TEXT PRIMARY KEY,meeting_id TEXT NOT NULL,participant_id TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL)`);return d;}
export function issueParticipantAccess(meetingId:string,participantId:string){
 if(isPracticeMeeting(meetingId))throw new DecisionError(409,"가상 자료에는 참가자 응답 링크를 만들 수 없습니다.");
 if(!getDecisionBoard(meetingId).participants.some(p=>p.id===participantId))throw new DecisionError(404,"참가자를 찾을 수 없습니다.");
 const d=database(),token=randomBytes(32).toString("base64url"),expiresAt=Date.now()+7*86400000;
 d.exec("BEGIN IMMEDIATE");try{d.prepare("UPDATE participant_access SET revoked_at=? WHERE meeting_id=? AND participant_id=? AND revoked_at IS NULL").run(now(),meetingId,participantId);d.prepare("INSERT INTO participant_access VALUES(?,?,?,?,NULL,?)").run(hash(token),meetingId,participantId,expiresAt,now());d.exec("COMMIT");}catch(e){d.exec("ROLLBACK");throw e;}
 return {token,expiresAt};
}
export function revokeParticipantAccess(meetingId:string,participantId:string){database().prepare("UPDATE participant_access SET revoked_at=? WHERE meeting_id=? AND participant_id=? AND revoked_at IS NULL").run(now(),meetingId,participantId);}
function identity(token:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new DecisionError(401,"초대 링크를 다시 확인해 주세요.");
 const row=database().prepare("SELECT meeting_id,participant_id FROM participant_access WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL").get(hash(token),Date.now()) as {meeting_id:string;participant_id:string}|undefined;
 if(!row)throw new DecisionError(401,"만료되거나 회수된 초대 링크입니다. 진행자에게 새 링크를 요청하세요.");return row;
}
export function participantView(token:string){
 const actor=identity(token),b=getDecisionBoard(actor.meeting_id),participant=b.participants.find(p=>p.id===actor.participant_id);
 if(!participant)throw new DecisionError(401,"참가자를 찾을 수 없습니다.");
 return {revision:b.revision,participant,goal:b.goal,participants:b.participants,questions:b.questions.map(q=>({id:q.id,question:q.question,evidence:q.evidence,proposal:q.proposal,comparison:q.comparison,confirmedAt:q.confirmedAt,sourceChanged:q.sourceChanged,response:q.responses.find(r=>r.participantId===actor.participant_id)??null}))};
}
export function participantCommand(token:string,revision:number,value:unknown){
 const actor=identity(token),c=value as Record<string,unknown>;
 if(!c||!["interpretation","response"].includes(String(c.action)))throw new DecisionError(403,"본인의 해석과 응답만 기록할 수 있습니다.");
 if(c.participantId&&c.participantId!==actor.participant_id)throw new DecisionError(403,"다른 참가자의 응답을 작성할 수 없습니다.");
 const b=getDecisionBoard(actor.meeting_id),q=b.questions.find(q=>q.id===c.questionId);
 if(!q)throw new DecisionError(404,"이 회의의 안건이 아닙니다.");
 if(q.sourceChanged)throw new DecisionError(409,"근거가 바뀌었습니다. 진행자가 다시 검토한 뒤 응답해 주세요.");
 changeDecisionBoard(actor.meeting_id,revision,{...c,participantId:actor.participant_id},{participantId:actor.participant_id});
 return participantView(token);
}
