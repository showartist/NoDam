import { createHash } from "node:crypto";
import { db, now, uid } from "../db";
import { IntakeInput, KIND_LABELS, SOURCE_LABELS, previewText } from "./model";

export type IntakeMetadata = { meeting_id: string; purpose: string; kind: keyof typeof KIND_LABELS; source_type: keyof typeof SOURCE_LABELS; input_mode: "live" | "text" | "audio"; source_name: string | null };
export class IntakeError extends Error { constructor(public status: number, message: string) { super(message); } }
export function getIntakeMetadata(meetingId: string) {
  return (db().prepare("SELECT meeting_id,purpose,kind,source_type,input_mode,source_name FROM meeting_intake WHERE meeting_id=?").get(meetingId) as IntakeMetadata | undefined) ?? null;
}
export function isPracticeMeeting(meetingId: string) {
  const info = getIntakeMetadata(meetingId);
  return !!info && info.source_type !== "actual";
}
export function intakeContext(info: IntakeMetadata) {
  return `회의 목적: ${info.purpose}\n회의 종류: ${KIND_LABELS[info.kind]}\n자료 유형: ${SOURCE_LABELS[info.source_type]}\n${info.kind === "brainstorm" ? "아이디어의 다양성만으로 해석 충돌이라고 판단하지 마세요.\n" : ""}${info.source_type !== "actual" ? "가상·예정 자료입니다. 실제 참석자의 발언이나 실제 합의로 표현하지 마세요." : "명시적인 확인이 없는 제안은 결정으로 표현하지 마세요."}`;
}
export function createIntake(value: unknown) {
  const input = IntakeInput.parse(value);
  const preview = input.mode === "text" ? previewText(input.text) : { turns: [], warnings: [] };
  if (input.mode === "text" && !preview.turns.length) throw new IntakeError(400, "저장할 텍스트가 없습니다.");
  if (preview.turns.length > 2000) throw new IntakeError(400, "이번 단계에서는 최대 2,000줄까지 입력할 수 있습니다.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const prior = d.prepare("SELECT i.fingerprint,i.meeting_id,m.project_id FROM meeting_intake i JOIN meetings m ON m.id=i.meeting_id WHERE request_id=?").get(input.requestId) as {fingerprint:string; meeting_id:string; project_id:string} | undefined;
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new IntakeError(409, "같은 저장 요청의 내용이 달라졌습니다. 새 요청으로 저장해 주세요.");
      d.exec("COMMIT");
      return { meetingId: prior.meeting_id, projectId: prior.project_id, utteranceCount: preview.turns.length, reused: true };
    }
    if (input.projectId && !d.prepare("SELECT id FROM projects WHERE id=?").get(input.projectId)) throw new IntakeError(404, "프로젝트를 찾을 수 없습니다.");
    const projectId = input.projectId ?? uid(), meetingId = uid(), stamp = now();
    if (!input.projectId) d.prepare("INSERT INTO projects(id,title,domain,one_line,created_at)VALUES(?,?, 'meeting',NULL,?)").run(projectId,input.title,stamp);
    d.prepare("INSERT INTO meetings(id,project_id,title,raw_transcript,created_at)VALUES(?,?,?,?,?)").run(meetingId,projectId,input.title,input.text,stamp);
    d.prepare("INSERT INTO meeting_intake(meeting_id,request_id,fingerprint,purpose,kind,source_type,input_mode,source_name)VALUES(?,?,?,?,?,?,?,?)").run(meetingId,input.requestId,fingerprint,input.purpose,input.kind,input.sourceType,input.mode,input.sourceName);
    const insert = d.prepare("INSERT INTO utterances(id,meeting_id,idx,uid,speaker_name,speaker_id,role,text_raw,text_clean,ts_start,ts_end,start_ms,end_ms,created_at)VALUES(?,?,?,?,?,NULL,?,?,?,NULL,NULL,?,NULL,?)");
    preview.turns.forEach((t, i) => insert.run(uid(),meetingId,i,t.uid,t.speaker,t.role,t.text,t.text,t.startMs,stamp));
    d.exec("COMMIT");
    return {meetingId,projectId,utteranceCount:preview.turns.length,reused:false};
  } catch (error) { d.exec("ROLLBACK"); throw error; }
}
