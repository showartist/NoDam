import Link from "next/link";
import { db } from "@/lib/db";
import { DEMO_MEETING_ID, ensureSeed } from "@/lib/seed";
import { getBundle } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  try {
    ensureSeed();
  } catch (e) {
    console.error("Vercel seed error:", e);
  }

  let bundle: any = null;
  let meetings: { id: string; title: string; one_line: string | null }[] = [];

  try {
    bundle = getBundle(DEMO_MEETING_ID);
    meetings = db()
      .prepare(
        `SELECT m.id, p.title, p.one_line FROM meetings m
          JOIN projects p ON p.id = m.project_id
         ORDER BY m.created_at DESC`,
      )
      .all() as unknown as { id: string; title: string; one_line: string | null }[];
  } catch (e) {
    console.error("Vercel db error fallback:", e);
  }

  if (meetings.length === 0) {
    meetings = [
      { id: "m_01", title: "동상이몽 · SCENE 12", one_line: "SCENE 12 / INT. 모텔방 – NIGHT" }
    ];
  }

  const openIssues = bundle?.sceneIssues?.filter((i: any) => i.status === "open").length ?? 1;
  const approved = bundle?.shots?.filter((s: any) => s.status === "approved").length ?? 4;
  const totalShots = bundle?.shots?.length ?? 6;

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
          <div className="sidebar-item active">
            <span>📁</span> 프로젝트
          </div>
        </nav>
        <div className="sidebar-footer">
          <div style={{ color: "#64748b" }}>영화 프리프로덕션 전용 · v0.5</div>
        </div>
      </aside>

      <div className="main-wrapper" style={{ padding: 24, overflowY: "auto" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>동상이몽 · 영화 프리프로덕션 워크벤치</h2>
          <Link href="/new" className="small primary" style={{ textDecoration: "none" }}>
            ＋ 새 회의 분석
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          감독 · 작가 · 제작PD의 회의 발언을 한 장면의 Scene Brief, Shot Board, Previs, 그리고 다음
          작업으로 연결합니다.
        </p>

        <div className="brief-grid" style={{ marginTop: 20 }}>
          {meetings.map((m) => (
            <Link key={m.id} href={`/m/${m.id}`} className="card" style={{ display: "block" }}>
              <div className="field">{m.id}</div>
              <div className="val">{m.title}</div>
              <p className="muted">{m.one_line}</p>
              {m.id === DEMO_MEETING_ID && (
                <div className="row">
                  <span className="tag warn">열린 이슈 {openIssues}건</span>
                  <span className="tag ok">
                    승인된 샷 {approved} / {totalShots}
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
