import {analysisSourceChanged} from "../alignment/jobs";
import { getIntakeMetadata, isPracticeMeeting } from "../meetingIntake/store";
import { db, now, uid } from "../db";
import { getMeetingUtterances, getRun, getCurrentRun, getIssue } from "../alignment/store";
import { getFacilitatorState, reviewSourceChanged } from "../facilitator/store";
import { Command, confirmationBlockers, type Board, type Question } from "./model";

export class DecisionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function database() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS meeting_decision_boards(meeting_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,state_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meeting_decision_events(id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(meeting_id,revision));`);
  return d;
}
function requireMeeting(id: string) {
  if (!database().prepare("SELECT id FROM meetings WHERE id=?").get(id)) throw new DecisionError(404, "회의를 찾을 수 없습니다.");
}
function readBoard(meetingId: string) {
  const row = database().prepare("SELECT revision,state_json FROM meeting_decision_boards WHERE meeting_id=?").get(meetingId) as {revision:number;state_json:string} | undefined;
  return { revision: row?.revision ?? 0, board: row ? JSON.parse(row.state_json) as Board : { participants: [], questions: [] } as Board };
}
export function getDecisionBoard(meetingId: string) {
  requireMeeting(meetingId);
  const { revision, board } = readBoard(meetingId);
  return {
    revision, ...board, goal: getIntakeMetadata(meetingId)?.purpose ?? getFacilitatorState(meetingId)?.goal ?? null,
    questions: board.questions.map(q => {
      const sourceChanged=q.source ? reviewSourceChanged(meetingId,q.source.reviewId) : q.analysisSource ? analysisSourceChanged(q.analysisSource.runId,meetingId) : false;
      return {...q,sourceChanged,blockers:q.confirmedAt?[]:[...confirmationBlockers(board,q),...(sourceChanged?["분석 근거가 수정되었습니다. 다시 분석한 후보로 확인해 주세요."]:[])]};
    }),
    evidence: getMeetingUtterances(meetingId).map(u => ({uid:u.uid,text:u.text,speaker:u.speakerName??u.speakerId??"화자 미확인"})),
    history: database().prepare("SELECT revision,action,detail_json,created_at FROM meeting_decision_events WHERE meeting_id=? ORDER BY revision DESC LIMIT 100").all(meetingId),
    recordMode: "facilitator_recorded_not_identity_verified" as const,
  };
}
export function changeDecisionBoard(meetingId: string, revision: number, value: unknown, actor?: {participantId:string}) {
  const command = Command.parse(value);
  if(actor&&(!["interpretation","response"].includes(command.action)||!("participantId" in command)||command.participantId!==actor.participantId))throw new DecisionError(403,"본인의 응답만 기록할 수 있습니다.");
  requireMeeting(meetingId);
  if (["confirm", "response", "interpretation"].includes(command.action) && isPracticeMeeting(meetingId)) throw new DecisionError(409,"가상·예정 자료에서 실제 참가자의 확인·동의를 기록할 수 없습니다.");
  const d = database();
  // Initialize the facilitator tables before opening the write transaction.
  const imported = command.action === "import" ? getFacilitatorState(meetingId)?.reviews.find(r => r.id === command.reviewId)?.assessed.review.findings[command.findingIndex] : null;
  d.exec("BEGIN IMMEDIATE");
  try {
    const current = readBoard(meetingId), board = current.board;
    if (current.revision !== revision) throw new DecisionError(409, "다른 변경이 먼저 저장됐습니다. 새로 불러온 내용을 확인한 뒤 다시 입력해 주세요.");
    const stamp = now();
    let audit: unknown = {...command,recordMode:actor?"participant_invite_holder":"facilitator_recorded_not_identity_verified",recordedBy:actor?.participantId??null};
    if (command.action === "participant") {
      if (board.participants.some(p => p.name === command.name)) throw new DecisionError(409, "같은 이름의 참가자가 있습니다. 구분할 이름을 입력해 주세요.");
      board.participants.push({id:uid(),name:command.name,role:command.role});
      for (const q of board.questions) if (q.comparison && !q.confirmedAt) {
        q.comparison.synthesis = null; q.responses = []; q.proposalRevision++;
      }
    } else if (command.action === "question" || command.action === "import" || command.action === "import_analysis") {
      if (command.action === "import" && !imported) throw new DecisionError(404, "이 회의의 AI 검토 후보를 찾을 수 없습니다.");
      if(command.action === "import" && reviewSourceChanged(meetingId,command.reviewId))throw new DecisionError(409,"실시간 분석 근거의 발언·화자가 수정되었습니다. 다시 분석한 후보로 확인해 주세요.");
      if (command.action === "import" && board.questions.some(q => q.source?.reviewId === command.reviewId && q.source.findingIndex === command.findingIndex)) {
        d.exec("ROLLBACK"); return getDecisionBoard(meetingId);
      }
      let analysis = null;
      if (command.action === "import_analysis") {
        const run = getRun(command.runId);
        if (!run || run.meeting_id !== meetingId) throw new DecisionError(404, "이 회의의 분석을 찾을 수 없습니다.");
        if (run.status !== "completed" || getCurrentRun(meetingId)?.id !== run.id) throw new DecisionError(409, "현재 완료된 분석에서 후보를 다시 선택해 주세요.");
        if(analysisSourceChanged(run.id,meetingId))throw new DecisionError(409,"발언 또는 화자가 수정되었습니다. 다시 분석한 후보를 가져와 주세요.");
        analysis = getIssue(meetingId, command.issueId, command.runId);
        if (!analysis) throw new DecisionError(404, "분석 후보를 찾을 수 없습니다.");
        if (board.questions.some(q => q.analysisSource?.runId === command.runId && q.analysisSource.issueId === command.issueId)) {
          d.exec("ROLLBACK"); return getDecisionBoard(meetingId);
        }
      }
      const turns = new Map(getMeetingUtterances(meetingId).map(u => [u.uid,u.text]));
      const refs = command.action === "question" ? command.evidence : analysis ? analysis.positions.map(p => {
        const id = p.evidence.find(id => p.quote.trim() && turns.get(id)?.includes(p.quote));
        if (!id) throw new DecisionError(409, "분석 인용과 현재 원문이 다릅니다. 원문을 확인하고 다시 분석해 주세요.");
        return {uid:id,quote:p.quote};
      }) : imported!.evidence.map(e => ({uid:e.uid,quote:e.quote}));
      if (!refs.length) throw new DecisionError(409, "원문 근거 없는 후보는 가져올 수 없습니다.");
      for (const e of refs) if (!turns.get(e.uid)?.includes(e.quote)) throw new DecisionError(400, `현재 회의 원문과 맞지 않는 근거: ${e.uid}`);
      const q: Question = {id:uid(),question:command.action === "question" ? command.question : analysis ? analysis.question : imported!.question,evidence:refs,source:command.action === "import" ? {reviewId:command.reviewId,findingIndex:command.findingIndex} : null,proposal:"",proposalRevision:0,responses:[],task:null,feedback:null,confirmedAt:null,participantsAtConfirmation:[]};
      if (command.action === "import_analysis") q.analysisSource = {runId:command.runId,issueId:command.issueId};
      if (analysis?.concept && refs.some(e=>e.quote.includes(analysis.concept))) q.comparison = {expression:analysis.concept,decisionTarget:analysis.decision,interpretations:[],synthesis:null};
      board.questions.push(q); audit = { ...command, savedQuestion: q };
    } else {
      const q = board.questions.find(q => q.id === command.questionId);
      if (!q) throw new DecisionError(404, "이 회의의 확인 안건을 찾을 수 없습니다.");
      if (q.confirmedAt && command.action !== "task" && command.action !== "feedback") throw new DecisionError(409, "확인 완료된 결정은 수정할 수 없습니다. 변경 근거로 새 안건을 등록해 주세요.");
      if (command.action === "comparison") {
        if (!q.evidence.some(e => e.quote.includes(command.expression))) throw new DecisionError(400, "비교할 표현은 이 안건의 원문 근거에서 선택해 주세요.");
        q.comparison = {expression:command.expression,decisionTarget:command.decisionTarget,interpretations:[],synthesis:null};
        q.responses = []; q.proposalRevision++;
      } else if (command.action === "interpretation") {
        if (!q.comparison) throw new DecisionError(409, "해석 비교를 먼저 시작해 주세요.");
        if (!board.participants.some(p => p.id === command.participantId)) throw new DecisionError(400, "등록된 참가자가 아닙니다.");
        q.comparison.interpretations = q.comparison.interpretations.filter(i => i.participantId !== command.participantId);
        q.comparison.interpretations.push({participantId:command.participantId,meaning:command.meaning,example:command.example,conditions:command.conditions,confirmedByParticipant:command.confirmedByParticipant,recordedVia:actor?"personal_link":"facilitator",recordedAt:stamp});
        q.comparison.synthesis = null; q.responses = []; q.proposalRevision++;
      } else if (command.action === "synthesis") {
        if (!q.comparison) throw new DecisionError(409, "해석 비교를 먼저 시작해 주세요.");
        if (!board.participants.length || board.participants.some(p => !q.comparison!.interpretations.some(i => i.participantId === p.id && i.confirmedByParticipant))) throw new DecisionError(409, "모든 참가자의 해석을 본인에게 확인한 뒤 정리해 주세요.");
        q.comparison.synthesis = {relation:command.relation,sharedConditions:command.sharedConditions,remainingDifferences:command.remainingDifferences};
        q.responses = []; q.proposalRevision++;
      } else if (command.action === "proposal") {
        if (!board.participants.some(p => p.id === command.ownerId)) throw new DecisionError(400, "이 회의의 참가자를 담당자로 선택해 주세요.");
        q.proposal = command.proposal; q.proposalRevision++; q.responses = [];
        q.task = {ownerId:command.ownerId,dueDate:command.dueDate,criteria:command.criteria,done:false};
      } else if (command.action === "response") {
        if (!q.proposal) throw new DecisionError(409, "결정안을 먼저 작성해 주세요.");
        if (!board.participants.some(p => p.id === command.participantId)) throw new DecisionError(400, "등록된 참가자가 아닙니다.");
        q.responses = q.responses.filter(r => r.participantId !== command.participantId);
        q.responses.push({participantId:command.participantId,stance:command.stance,understanding:command.understanding,concern:command.concern,proposalRevision:q.proposalRevision,recordedVia:actor?"personal_link":"facilitator",recordedAt:stamp});
      } else if (command.action === "confirm") {
        if(q.source&&reviewSourceChanged(meetingId,q.source.reviewId))throw new DecisionError(409,"실시간 분석 근거의 발언·화자가 수정되었습니다. 다시 분석하고 확인해 주세요.");
        if(q.analysisSource&&analysisSourceChanged(q.analysisSource.runId,meetingId))throw new DecisionError(409,"분석 근거의 발언·화자가 수정되었습니다. 다시 분석하고 확인해 주세요.");
        const currentText = new Map(getMeetingUtterances(meetingId).map(u => [u.uid,u.text]));
        if(q.evidence.some(e=>!currentText.get(e.uid)?.includes(e.quote))) throw new DecisionError(409,"근거 원문이 변경되었습니다. 현재 원문으로 새 안건을 등록해 주세요.");
        const blockers = confirmationBlockers(board,q);
        if (blockers.length) throw new DecisionError(409, blockers.join(" "));
        q.confirmedAt = stamp; q.participantsAtConfirmation = structuredClone(board.participants);
        audit = {...command,confirmedSnapshot:structuredClone(q),recordMode:"facilitator_recorded_not_identity_verified"};
      } else if (command.action === "task") {
        if (!q.confirmedAt || !q.task) throw new DecisionError(409,"공동 확인 완료 후 실행 상태를 변경할 수 있습니다.");
        q.task.done = command.done;
      } else if (command.action === "feedback") q.feedback = {verdict:command.verdict,reason:command.reason};
    }
    const next = revision + 1;
    d.prepare("INSERT INTO meeting_decision_boards VALUES(?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json").run(meetingId,next,JSON.stringify(board));
    d.prepare("INSERT INTO meeting_decision_events(meeting_id,revision,action,detail_json,created_at) VALUES(?,?,?,?,?)").run(meetingId,next,command.action,JSON.stringify(audit),stamp);
    d.exec("COMMIT");
    return getDecisionBoard(meetingId);
  } catch (error) { try {d.exec("ROLLBACK");} catch {} throw error; }
}
