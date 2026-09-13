"use client";

/**
 * 회의 레퍼런스(계획서 3-1). 반영 수준은 퍼센트가 아니라 4단계(제품 원칙 3·7)이고,
 * 레퍼런스마다 "가져올 요소"와 "가져오지 않을 요소"를 함께 적는다.
 * 생성 입력으로는 팀이 올린 이미지만 쓴다(TMDB·Unsplash 약관이 AI 용도를 제한).
 */
import { useEffect, useState } from "react";
import s from "./v2.module.css";

type Ref = { id: string; title: string; source: string; adoption: "core" | "partial" | "reference" | "excluded"; adoptionLabel?: string; take: string[]; avoid: string[]; filePath: string | null; palette: { swatches?: { hex: string }[] } | null };

const ADOPTION: Record<Ref["adoption"], string> = { core: "핵심 반영", partial: "부분 반영", reference: "참고", excluded: "제외" };
const HOW: Record<Ref["adoption"], string> = {
  core: "참조 이미지로 넣고, 가져올 요소를 강하게 지시",
  partial: "참조 이미지로 넣고, 가져올 요소만 약하게 지시",
  reference: "이미지는 넣지 않고 설명만",
  excluded: "넣지 않고, 가져올 요소를 금지 요소로",
};

export function ReferencePanel(props: { meetingId: string }) {
  const [refs, setRefs] = useState<Ref[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch(`/api/meetings/${props.meetingId}/visual-references`);
    if (r.ok) setRefs((await r.json()).references ?? []);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.meetingId]);

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const r = await fetch(`/api/meetings/${props.meetingId}/visual-references`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? `올리지 못했습니다 (HTTP ${r.status})`);
      return;
    }
    (e.target as HTMLFormElement).reset();
    setOpen(false);
    await load();
  }

  return (
    <div className={s.section}>
      <h3 className={s.sectionTitle}>
        레퍼런스 {refs.length}개 <span className={s.muted}>그림을 그릴 때 모두 반영 수준대로 들어갑니다</span>
      </h3>
      {refs.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th>이미지</th>
              <th>레퍼런스</th>
              <th>반영</th>
              <th>가져올 요소</th>
              <th>가져오지 않을 요소</th>
            </tr>
          </thead>
          <tbody>
            {refs.map((r) => (
              <tr key={r.id}>
                <td style={{ width: 96 }}>
                  {r.filePath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/meetings/${props.meetingId}/visual-references/${r.id}/file`} alt={r.title} style={{ width: 88, height: 50, objectFit: "cover", borderRadius: 4 }} />
                  ) : (
                    <span className={s.muted}>설명만</span>
                  )}
                </td>
                <td>
                  <b>{r.title}</b>
                  <div className={s.muted}>{r.source}</div>
                  {r.palette?.swatches?.length ? (
                    <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
                      {r.palette.swatches.slice(0, 6).map((sw) => (
                        <span key={sw.hex} title={sw.hex} style={{ width: 14, height: 14, background: sw.hex, borderRadius: 3, border: "1px solid #e2e8f0" }} />
                      ))}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className={`${s.badge} ${r.adoption === "excluded" ? s.st_dismissed : r.adoption === "core" ? s.ok : ""}`} title={HOW[r.adoption]}>
                    {ADOPTION[r.adoption]}
                  </span>
                </td>
                <td>{r.take.join(", ") || <span className={s.chipMissing}>비어 있음</span>}</td>
                <td>{r.avoid.join(", ") || <span className={s.muted}>-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!open ? (
        <button className={s.linkBtn} onClick={() => setOpen(true)}>
          레퍼런스 올리기
        </button>
      ) : (
        <form onSubmit={upload} className={s.detail} style={{ marginTop: 8, display: "grid", gap: 8 }}>
          <label>
            이미지 <input type="file" name="file" accept="image/png,image/jpeg,image/webp" />
            <span className={s.muted}> 팀이 직접 찍었거나 권리를 확인한 이미지만</span>
          </label>
          <input className={s.input} name="title" placeholder="레퍼런스 이름 (예: 새벽 수영장 답사 사진)" required />
          <input className={s.input} name="source" placeholder="출처 (예: 미술팀 답사 2026-09-10)" required />
          <label>
            반영 수준{" "}
            <select className={s.input} name="adoption" style={{ width: "auto" }} defaultValue="partial">
              {(Object.keys(ADOPTION) as Ref["adoption"][]).map((k) => (
                <option key={k} value={k}>
                  {ADOPTION[k]} — {HOW[k]}
                </option>
              ))}
            </select>
          </label>
          <input className={s.input} name="take" placeholder="가져올 요소 (쉼표로: 청록 타일 반사, 새벽빛)" required />
          <input className={s.input} name="avoid" placeholder="가져오지 않을 요소 (쉼표로: 사람, 간판 글자)" />
          <input className={s.input} name="uploadedBy" placeholder="올린 사람 (예: 한소라 미술감독)" />
          {err && <div className={s.error}>{err}</div>}
          <div>
            <button className={`${s.btn} ${s.btnPrimary}`} type="submit" disabled={busy}>
              {busy ? "올리는 중" : "올리기"}
            </button>{" "}
            <button className={s.btn} type="button" onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
