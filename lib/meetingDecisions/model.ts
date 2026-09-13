import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const evidence = z.object({ uid: text(80), quote: text(5000) });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, "올바른 날짜를 입력해 주세요.").nullable();
export const Command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("participant"), name: text(80), role: z.string().trim().max(100) }),
  z.object({ action: z.literal("question"), question: text(500), evidence: z.array(evidence).min(1).max(8) }),
  z.object({ action: z.literal("import"), reviewId: z.number().int().positive(), findingIndex: z.number().int().min(0).max(3) }),
  z.object({ action: z.literal("comparison"), questionId: text(100), expression: text(200), decisionTarget: text(500) }),
  z.object({ action: z.literal("interpretation"), questionId: text(100), participantId: text(100), meaning: text(1000), example: z.string().trim().max(1000), conditions: z.string().trim().max(1000), confirmedByParticipant: z.literal(true) }),
  z.object({ action: z.literal("synthesis"), questionId: text(100), relation: z.enum(["same", "complementary", "choice", "unresolved"]), sharedConditions: text(1500), remainingDifferences: z.string().trim().max(1000) }),
  z.object({ action: z.literal("proposal"), questionId: text(100), proposal: text(2000), ownerId: text(100), dueDate: date, criteria: text(1000) }),
  z.object({ action: z.literal("response"), questionId: text(100), participantId: text(100), stance: z.enum(["agree", "agree_with_concerns", "disagree", "uncertain"]), understanding: text(1000), concern: z.string().trim().max(1000).default("") }),
  z.object({ action: z.literal("confirm"), questionId: text(100) }),
  z.object({ action: z.literal("task"), questionId: text(100), done: z.boolean() }),
  z.object({ action: z.literal("feedback"), questionId: text(100), verdict: z.enum(["valid", "false_alarm", "uncertain"]), reason: text(1000) }),
]).superRefine((command, ctx) => {
  if (command.action === "synthesis" && (command.relation === "choice" || command.relation === "unresolved") && !command.remainingDifferences) {
    ctx.addIssue({ code: "custom", path: ["remainingDifferences"], message: "남은 차이와 어떻게 다룰지 기록해 주세요." });
  }
  if (command.action === "response" && command.stance === "agree_with_concerns" && !command.concern) {
    ctx.addIssue({ code: "custom", path: ["concern"], message: "진행에 동의하면서 남기는 우려를 기록해 주세요." });
  }
});
export type CommandInput = z.infer<typeof Command>;
export type Participant = { id: string; name: string; role: string };
export type Comparison = {
  expression: string; decisionTarget: string;
  interpretations: { participantId: string; meaning: string; example: string; conditions: string; confirmedByParticipant: true; recordedAt: string }[];
  synthesis: { relation: "same" | "complementary" | "choice" | "unresolved"; sharedConditions: string; remainingDifferences: string } | null;
};
export type Question = {
  id: string; question: string; evidence: { uid: string; quote: string }[];
  source: { reviewId: number; findingIndex: number } | null;
  comparison?: Comparison;
  proposal: string; proposalRevision: number;
  responses: { participantId: string; stance: "agree" | "agree_with_concerns" | "disagree" | "uncertain"; understanding: string; concern?: string; proposalRevision: number; recordedAt: string }[];
  task: { ownerId: string; dueDate: string | null; criteria: string; done: boolean } | null;
  feedback: { verdict: "valid" | "false_alarm" | "uncertain"; reason: string } | null;
  confirmedAt: string | null; participantsAtConfirmation: Participant[];
};
export type Board = { participants: Participant[]; questions: Question[] };
export function confirmationBlockers(board: Board, question: Question): string[] {
  const reasons: string[] = [];
  if (!board.participants.length) reasons.push("참가자를 등록해 주세요.");
  if (!question.proposal) reasons.push("결정안을 작성해 주세요.");
  if (!question.task || !board.participants.some(p => p.id === question.task?.ownerId) || !question.task.criteria) reasons.push("실행 담당자와 완료 기준이 필요합니다.");
  for (const person of board.participants) {
    if (question.comparison && !question.comparison.interpretations.some(i => i.participantId === person.id && i.confirmedByParticipant)) reasons.push(`${person.name}: 본인 해석이 미확인입니다.`);
    const response = question.responses.find(r => r.participantId === person.id && r.proposalRevision === question.proposalRevision);
    if (!response) reasons.push(`${person.name}: 아직 확인하지 않았습니다.`);
    else if (response.stance === "agree_with_concerns" && !response.concern?.trim()) reasons.push(`${person.name}: 진행에 동의하면서 남기는 우려를 기록해 주세요.`);
    else if (response.stance !== "agree" && response.stance !== "agree_with_concerns") reasons.push(`${person.name}: ${response.stance === "disagree" ? "추가 논의 요청이" : "확인 필요가"} 남았습니다.`);
  }
  if (question.comparison && (!question.comparison.synthesis || question.comparison.synthesis.relation === "unresolved")) reasons.push("해석 비교 후 함께 확인할 조건을 정리해 주세요. 미확인 상태는 확정할 수 없습니다.");
  return reasons;
}
