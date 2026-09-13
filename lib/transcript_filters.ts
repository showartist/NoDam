// Transcript 화면의 역할 필터·키워드 검색·의미 기반 필터·근거 네비게이션·타이포그래피.
// app/m/[id]/Workbench.tsx 가 런타임에 쓴다 — 원래 lib/transcript_navigation_contract.test.ts 와
// lib/transcript_linkage_contract.test.ts 안에 있었으나 프로덕션 코드가 테스트 파일에 있으면 안 되므로 이동.

const ROLE_TO_KOREAN: Record<string, string> = {
  director: "감독",
  writer: "작가",
  producer: "제작PD",
  cinematographer: "촬영감독",
  art_director: "미술감독",
};

export function filterUtterancesByRole(rows: any[], targetRole: string): any[] {
  if (targetRole === "all") return rows;
  const korRole = ROLE_TO_KOREAN[targetRole] || targetRole;
  return rows.filter((r) => r.role === targetRole || r.role === korRole);
}

export function searchUtterancesByKeyword(rows: any[], keyword: string): any[] {
  if (!keyword.trim()) return rows;
  const q = keyword.toLowerCase();
  return rows.filter((r) => (r.textRaw || r.text_raw || "").toLowerCase().includes(q) || (r.speakerName || r.speaker_name || "").toLowerCase().includes(q));
}

export function getEvidenceIndex(evidenceUids: string[], currentUid: string): { index: number; total: number; prevUid: string | null; nextUid: string | null } {
  const idx = evidenceUids.indexOf(currentUid);
  if (idx === -1) return { index: -1, total: evidenceUids.length, prevUid: null, nextUid: null };
  return {
    index: idx + 1,
    total: evidenceUids.length,
    prevUid: idx > 0 ? evidenceUids[idx - 1] : null,
    nextUid: idx < evidenceUids.length - 1 ? evidenceUids[idx + 1] : null,
  };
}

export const TYPOGRAPHY_THEME = {
  textPrimary: "#0f172a",      // 장문 독서에 안정적인 진한 슬레이트
  textActive: "#0284c7",       // 선택·강조 텍스트
  textSecondary: "#475569",    // 보조 정보
  textMuted: "#64748b",        // 타임스탬프
  stageDirectionColor: "#475569", // 중립 회색 지문
  uidMonospaceBg: "#f1f5f9",   // U-ID 중립 모노스페이스 배경
  uidMonospaceColor: "#0f172a",// U-ID 중립 모노스페이스 텍스트
};

export type SemanticFilterType = "all" | "decision" | "unresolved" | "issue_evidence" | "shot_evidence";

/** goldIssues 파라미터는 이름과 달리 gold fixture 전용이 아니다 — 호출자가 넘기는 회의별 실제 issues 배열이면 된다. */
export function filterUtterancesBySemantic(rows: any[], filter: SemanticFilterType, goldIssues: any[], shots: any[]): any[] {
  if (filter === "all") return rows;

  const issueEvidenceUids = new Set<string>();
  goldIssues.forEach((i: any) => (i.evidence || []).forEach((u: string) => issueEvidenceUids.add(u)));

  const shotEvidenceUids = new Set<string>();
  shots.forEach((s: any) => {
    const ev = typeof s.evidence === "string" ? JSON.parse(s.evidence || "[]") : (s.evidence || []);
    ev.forEach((u: string) => shotEvidenceUids.add(u));
  });

  if (filter === "issue_evidence") {
    return rows.filter((r) => issueEvidenceUids.has(r.uid));
  }
  if (filter === "shot_evidence") {
    return rows.filter((r) => shotEvidenceUids.has(r.uid));
  }
  if (filter === "unresolved") {
    return rows.filter((r) => r.textRaw.includes("무표정") || r.textRaw.includes("웃음") || r.textRaw.includes("안전"));
  }
  if (filter === "decision") {
    return rows.filter((r) => r.textRaw.includes("확정") || r.textRaw.includes("잡아야") || r.textRaw.includes("결정"));
  }
  return rows;
}

/** goldIssues 파라미터는 filterUtterancesBySemantic 과 동일하게 호출자의 실제 issues 배열을 받는다. */
export function getUidLinkageNode(uid: string, goldIssues: any[], shots: any[], briefItems: any[]): { issues: string[]; shots: number[]; briefFields: string[] } {
  const linkedIssues: string[] = [];
  goldIssues.forEach((i: any) => {
    if ((i.evidence || []).includes(uid)) {
      linkedIssues.push(`${i.issue_id} (${i.subject})`);
    }
  });

  const linkedShots: number[] = [];
  shots.forEach((s: any) => {
    const ev = typeof s.evidence === "string" ? JSON.parse(s.evidence || "[]") : (s.evidence || []);
    if (ev.includes(uid)) {
      linkedShots.push(s.shot_number);
    }
  });

  const linkedBrief: string[] = [];
  briefItems.forEach((b: any) => {
    const ev = typeof b.evidence === "string" ? JSON.parse(b.evidence || "[]") : (b.evidence || []);
    if (ev.includes(uid)) {
      linkedBrief.push(b.field);
    }
  });

  return { issues: linkedIssues, shots: linkedShots, briefFields: linkedBrief };
}

export function formatCompactHeader(uid: string, tsStart: string, speakerName: string, roleLabel: string): string {
  return `${uid} · ${tsStart || "00:00"} · ${speakerName} · ${roleLabel}`;
}
