/**
 * 해석 차이 탐지 평가 세트.
 *
 * 팀 정답(fixtures/inputs + fixtures/gold)과 합성 회의(fixtures/eval/meetings)를 같은 모양으로 읽는다.
 * 정답의 historical_conflict 는 v2 유형 past_decision_conflict 로 맞춘다.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { parseTranscript } from "../parse";
import type { MeetingUtterance } from "../alignment/store";

export type GoldIssue = { key: string; type: string; subject: string; question: string; evidence: string[]; severity: string | null };
export type GoldNonIssue = { key: string; subject: string; reason: string; evidence: string[] };

export type EvalSet = {
  name: string;
  source: "team_gold" | "synthetic";
  reviewed: boolean;
  title: string;
  sceneLine: string | null;
  utts: MeetingUtterance[];
  gold: GoldIssue[];
  nonIssues: GoldNonIssue[];
};

const TYPE_MAP: Record<string, string> = { historical_conflict: "past_decision_conflict" };

function toUtts(rows: { uid: string; speaker: string; role: string | null; text: string }[]): MeetingUtterance[] {
  return rows.map((r, i) => ({
    uid: r.uid,
    idx: i,
    speakerKey: `N:${r.speaker}`,
    speakerId: null,
    speakerName: r.speaker,
    role: r.role,
    text: r.text,
    startMs: null,
    endMs: null,
  }));
}

function loadTeamGold(root: string, name: string, input: string, gold: string): EvalSet {
  const inp = JSON.parse(readFileSync(path.join(root, input), "utf8"));
  const g = JSON.parse(readFileSync(path.join(root, gold), "utf8"));
  const parsed = parseTranscript(String(inp.transcript));
  return {
    name,
    source: "team_gold",
    reviewed: true,
    title: inp.project?.title ?? name,
    sceneLine: inp.project?.one_line ?? inp.meta?.scene ?? null,
    utts: toUtts(parsed.map((u) => ({ uid: u.uid, speaker: u.speakerName, role: u.role ?? null, text: u.textClean }))),
    gold: (g.expected_issues ?? []).map((x: any) => ({
      key: x.subject_key,
      type: TYPE_MAP[x.issue_type] ?? x.issue_type,
      subject: x.subject,
      question: x.question ?? "",
      evidence: x.evidence ?? [],
      severity: x.severity ?? null,
    })),
    nonIssues: (g.expected_non_issues ?? []).map((x: any) => ({ key: x.subject_key, subject: x.subject, reason: x.reason ?? "", evidence: x.evidence ?? [] })),
  };
}

function loadSynthetic(file: string): EvalSet {
  const d = JSON.parse(readFileSync(file, "utf8"));
  return {
    name: d.meta?.name ?? path.basename(file, ".json"),
    source: "synthetic",
    reviewed: !!d.meta?.reviewed,
    title: d.title,
    sceneLine: d.slugline ?? null,
    utts: toUtts(d.transcript),
    gold: (d.expected_issues ?? []).map((x: any) => ({
      key: x.subject_key,
      type: TYPE_MAP[x.issue_type] ?? x.issue_type,
      subject: x.subject,
      question: x.question ?? "",
      evidence: x.evidence ?? [],
      severity: x.severity ?? null,
    })),
    nonIssues: (d.expected_non_issues ?? []).map((x: any) => ({ key: x.subject_key, subject: x.subject, reason: x.reason ?? "", evidence: x.evidence ?? [] })),
  };
}

export function loadEvalSets(root = process.cwd()): EvalSet[] {
  const sets: EvalSet[] = [
    loadTeamGold(root, "scene12_implicit", "fixtures/inputs/scene12_implicit.json", "fixtures/gold/scene12_implicit.gold.json"),
    loadTeamGold(root, "scene34_level3", "fixtures/inputs/scene34_empty_pool_level3.json", "fixtures/gold/scene34_empty_pool_level3.gold.json"),
  ];
  const dir = path.join(root, "fixtures/eval/meetings");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) sets.push(loadSynthetic(path.join(dir, f)));
  }
  return sets;
}
