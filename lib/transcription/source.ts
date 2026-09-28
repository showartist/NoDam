import {realpathSync,statSync} from "node:fs";
import path from "node:path";
import {db} from "../db";
import type {AudioReviewFlag} from "./review";
export type AudioSource = {file:string;flags:AudioReviewFlag[]};
function database(){const d=db();d.exec("CREATE TABLE IF NOT EXISTS transcription_sources(run_id TEXT PRIMARY KEY,file TEXT NOT NULL,flags_json TEXT NOT NULL)");return d;}
export function sourceFile(file:string){
 const root=realpathSync(path.resolve(process.env.SCENENOTE_DATA_DIR??".data","transcription-jobs")),resolved=realpathSync(file),relative=path.relative(root,resolved);
 if(!relative||relative.startsWith(".."+path.sep)||relative===".."||path.isAbsolute(relative)||!statSync(resolved).isFile())throw new Error("저장된 전사 오디오가 아닙니다.");
 return resolved;
}
export function saveAudioSource(runId:string,source:AudioSource){
 const file=sourceFile(source.file);
 database().prepare("INSERT INTO transcription_sources(run_id,file,flags_json) VALUES(?,?,?)").run(runId,file,JSON.stringify(source.flags));
}
export function getAudioSource(meetingId:string):AudioSource|null{
 const row=database().prepare(`SELECT s.file,s.flags_json FROM transcription_sources s
 WHERE s.run_id=(SELECT id FROM transcription_runs WHERE meeting_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1)`).get(meetingId) as {file:string;flags_json:string}|undefined;
 return row?{file:row.file,flags:JSON.parse(row.flags_json)}:null;
}
