"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type P = { name: string; role: string };

const ROLE_OPTIONS = ["감독", "작가", "제작PD", "촬영감독", "미술감독"];

export default function NewMeeting() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [oneLine, setOneLine] = useState("");
  const [participants, setParticipants] = useState<P[]>([
    { name: "", role: "감독" },
    { name: "", role: "작가" },
    { name: "", role: "제작PD" },
  ]);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("");

  const set = (i: number, k: keyof P, v: string) =>
    setParticipants((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));

  async function submit() {
    setBusy(true);
    setError("");
    setStep("발언 정리 중…");

    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, domain: "film", oneLine, participants, transcript }),
    });
    const j = await r.json();
    if (!r.ok) {
      setBusy(false);
      setStep("");
      return setError(j.error ?? "저장에 실패했습니다.");
    }

    setStep(`발언 ${j.utteranceCount}개 정리 완료 · Scene Brief 추출 중…`);
    const e = await fetch(`/api/meetings/${j.meetingId}/extract`, { method: "POST" });
    const ej = await e.json();
    setBusy(false);
    if (!e.ok) {
      setStep("");
      setError(
        `${ej.error ?? "추출에 실패했습니다."}${
          ej.attempts?.length ? ` (시도 ${ej.attempts.length}회)` : ""
        }`,
      );
      return;
    }
    router.push(`/m/${j.meetingId}`);
  }

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">동</div>
          <span>
            동상이몽
          </span>
        </div>
        <nav className="sidebar-menu">
          <div className="sidebar-item" onClick={() => router.push("/")}>
            <span>📁</span> 프로젝트
          </div>
          <div className="sidebar-item active">
            <span>＋</span> 새 회의
          </div>
        </nav>
      </aside>

      <div className="main-wrapper" style={{ padding: 24, overflowY: "auto" }}>
        <h2 style={{ margin: 0 }}>새 회의 분석</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          한 장면의 프리프로덕션 회의 전사를 넣으면 Scene Brief · 연출 의도 · 결정 · 미결정을
          뽑습니다. Shot Board는 이후 Intent Coverage에서 만들어 갑니다.
        </p>

        <div style={{ maxWidth: 760 }}>
          <label htmlFor="t">작품명</label>
          <input id="t" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label htmlFor="o">장면 한 줄 설명</label>
          <input
            id="o"
            type="text"
            placeholder="SCENE 27. EXT. 폐교 운동장 – DAWN — 정하가 아버지를 두고 떠난다"
            value={oneLine}
            onChange={(e) => setOneLine(e.target.value)}
          />

          <label>참석자와 역할</label>
          {participants.map((p, i) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <input
                type="text"
                className="grow"
                placeholder="이름"
                value={p.name}
                onChange={(e) => set(i, "name", e.target.value)}
              />
              <select value={p.role} onChange={(e) => set(i, "role", e.target.value)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button
                className="small"
                onClick={() => setParticipants((ps) => ps.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="small"
            onClick={() => setParticipants((ps) => [...ps, { name: "", role: "감독" }])}
          >
            + 참석자 추가
          </button>

          <label htmlFor="tr">회의 전사</label>
          <p className="muted" style={{ margin: "0 0 6px" }}>
            “U01 00:00 이름(역할): 발언” 또는 “이름: 발언” 형식. 발언 ID가 없으면 순번으로 붙입니다.
          </p>
          <textarea
            id="tr"
            style={{ minHeight: 260 }}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />

          {error && <p className="err">{error}</p>}
          {step && !error && <p className="muted">{step}</p>}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary small" onClick={submit} disabled={busy || !title || !transcript}>
              {busy ? "분석 중…" : "분석 시작"}
            </button>
            <span className="muted">
              추출 결과는 검증(스키마 · 근거 ID · 상태 규칙)을 통과해야 저장됩니다.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
