import { z } from "zod";
import { parseTranscript } from "../parse";

export const SOURCE_LABELS = { actual: "실제 회의 기록", fictional: "가상 대화·예시", planned: "예정된 진행 대본" } as const;
export const KIND_LABELS = { discussion: "일반 논의", brainstorm: "아이디어 발산", decision: "의사결정", review: "진행 점검·회고" } as const;
export const IntakeInput = z.object({
  requestId: z.string().uuid(),
  title: z.string().trim().min(1, "회의명을 입력해 주세요.").max(150),
  purpose: z.string().trim().min(1, "회의 목적을 입력해 주세요.").max(1000),
  kind: z.enum(["discussion", "brainstorm", "decision", "review"]),
  mode: z.enum(["live", "text", "audio"]),
  sourceType: z.enum(["actual", "fictional", "planned"]),
  projectId: z.string().max(100).nullable().default(null),
  text: z.string().max(100_000).default(""),
  sourceName: z.string().max(200).nullable().default(null),
}).superRefine((x, ctx) => {
  if (x.mode === "text" && !x.text.trim()) ctx.addIssue({ code: "custom", path: ["text"], message: "분석할 텍스트를 입력해 주세요." });
  if (x.mode !== "text" && x.text) ctx.addIssue({ code: "custom", path: ["text"], message: "음성 입력에는 텍스트를 함께 저장할 수 없습니다." });
  if (x.mode !== "text" && x.sourceType !== "actual") ctx.addIssue({ code: "custom", path: ["sourceType"], message: "음성 입력은 이번 단계에서 실제 회의만 지원합니다. 가상·예정 대본은 텍스트로 입력해 주세요." });
});
export type IntakeInput = z.infer<typeof IntakeInput>;
export type IntakeTurn = { uid: string; speaker: string | null; role: string | null; text: string; startMs: number | null; endMs: number | null };

/** One line is one record. Never inherit a speaker or silently discard an unlabelled line. */
export function previewText(text: string): { turns: IntakeTurn[]; warnings: string[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const turns = lines.map((line, idx): IntakeTurn => {
    const parsed = parseTranscript(line)[0];
    const stamp = parsed?.tsStart;
    const parts = stamp?.split(":").map(Number);
    const validTime = parts && parts[1] < 60;
    // Preserve unsupported time formats as unlabelled source text, not a person's name.
    const unsupportedTime = /^\[?\d{1,3}:\d{2}:\d{2}/.test(line) || line.includes("-->") || (stamp && !validTime);
    const known = parsed && !unsupportedTime;
    return { uid: `U${String(idx + 1).padStart(2, "0")}`, speaker: known ? parsed.speakerName : null,
      role: known ? parsed.role : null, text: known ? parsed.textRaw : line,
      startMs: known && validTime ? (parts[0] * 60 + parts[1]) * 1000 : null, endMs: null };
  });
  const warnings: string[] = [];
  if (turns.some(t => !t.speaker)) warnings.push("이름이 없는 줄은 미확인 화자로 보존합니다. 지문·제목도 포함될 수 있으니 분석 전에 확인해 주세요.");
  if (turns.some(t => t.startMs === null)) warnings.push("시간이 없는 발언에는 시간을 만들지 않습니다. 자막 시간 형식은 다음 단계에서 지원합니다.");
  return { turns, warnings };
}
