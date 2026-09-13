import React from "react";
import { notFound } from "next/navigation";
import { HeaderNavStepper } from "@/app/components/HeaderNavStepper";
import { loadAlignmentPageData } from "@/lib/alignment/pageData";
import { projectHistory } from "@/lib/consistency/history";
import s from "../alignment/v2/v2.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 결정 이력: 같은 작품의 회의마다 사람이 승인한 결정과, 이전 회의 대비 바뀐 값.
 * 원장에 들어가는 것은 합의 화면에서 승인한 값뿐이다(AI 가 넣지 않는다).
 */
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = loadAlignmentPageData(id);
  if (!data) notFound();
  const { steps, current } = projectHistory(data.projectId);

  return (
    <main className={s.page}>
      <HeaderNavStepper
        projectId={data.projectId}
        meetingId={id}
        currentStep="production"
        sceneNumber={data.scene.sceneNumber ?? undefined}
        slugline={data.scene.slugline ?? undefined}
        oneLiner={data.scene.oneLiner ?? undefined}
      />
      <div className={s.wrap}>
        <div className={s.summary}>
          <div>
            <h1 className={s.title}>결정 이력 · {data.projectTitle}</h1>
            <p className={s.sub}>합의 화면에서 사람이 승인한 값만 쌓입니다. 회의가 바뀔 때마다 무엇이 누구 승인으로 바뀌었는지 보여 줍니다.</p>
          </div>
          <a className={s.btn} href={`/m/${id}/alignment`}>
            다시 짚기로
          </a>
        </div>

        {steps.length === 0 ? (
          <div className={s.notice}>
            <h2>아직 승인된 결정이 없습니다</h2>
            <p>관점 비교에서 값을 고르고 합의 화면에서 승인하면 여기에 쌓입니다.</p>
          </div>
        ) : (
          <div className={s.gridResolve}>
            <div>
              {steps.map((st, n) => (
                <section key={st.meetingId} className={s.detail} style={{ marginBottom: 14 }}>
                  <div className={s.detailHead}>
                    <span className={s.issueId}>{n + 1}번째 회의</span>
                    <a className={s.linkBtn} href={`/m/${st.meetingId}/alignment`}>
                      {st.meetingTitle ?? st.meetingId}
                    </a>
                    <span className={s.muted}>{new Date(st.createdAt).toLocaleDateString("ko-KR")}</span>
                  </div>
                  {st.changes.length === 0 ? (
                    <p className={s.muted}>이전 회의와 달라진 결정이 없습니다(같은 값을 다시 승인).</p>
                  ) : (
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>결정 항목</th>
                          <th>이전</th>
                          <th>이번</th>
                          <th>승인</th>
                          <th>근거</th>
                        </tr>
                      </thead>
                      <tbody>
                        {st.changes.map((c) => (
                          <tr key={c.key}>
                            <td className={s.who}>{c.label}</td>
                            <td>{c.before ?? <span className={s.muted}>새 결정</span>}</td>
                            <td className={c.before ? s.diffDiffers : undefined}>{c.after}</td>
                            <td>{c.by}</td>
                            <td>
                              <span className={s.chips}>
                                {c.evidence.map((u) => (
                                  <a key={u} className={s.chip} href={`/m/${st.meetingId}?tab=transcript#u_${u}`}>
                                    {u}
                                  </a>
                                ))}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ))}
            </div>
            <aside className={s.detail}>
              <h3 className={s.sectionTitle}>지금 기준 값</h3>
              <ul className={s.briefs}>
                {Object.entries(current).map(([k, v]) => (
                  <li key={k}>
                    <span className={s.briefRole}>{k}</span>
                    <span>
                      {v.value} <span className={s.muted}>({v.by})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
