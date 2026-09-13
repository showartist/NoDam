import Link from "next/link";
import { notFound } from "next/navigation";
import { buildReport, type ReportRole } from "@/lib/report";
import { ROLES, ROLE_LABEL } from "@/lib/types";
import PrintButton from "./PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLE_TITLE: Record<ReportRole, string> = {
  all: "전체 결과 문서",
  director: "감독용 결과 문서",
  writer: "작가용 결과 문서",
  producer: "제작PD용 결과 문서",
  cinematographer: "촬영감독용 결과 문서",
  art_director: "미술감독용 결과 문서",
};

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string }>;
}) {
  const { id } = await params;
  const { role: roleParam } = await searchParams;
  const role = ((ROLES as readonly string[]).includes(roleParam ?? "")
    ? roleParam
    : "all") as ReportRole;

  let r;
  try {
    r = buildReport(id, role);
  } catch (e) {
    // evidence 는 normalizeEvidence 가 이미 걸러내므로 여기까지 오면 다른 원인이다.
    // 화면에는 스택을 보여주지 않고 서버 로그에만 근거를 남긴다.
    console.error(`[report] buildReport 실패 meeting=${id} role=${role}:`, e);
    return (
      <div className="report-page">
        <div className="report-toolbar no-print">
          <Link href={`/m/${id}`} className="small">
            ‹ 워크벤치
          </Link>
        </div>
        <article className="report">
          <p className="report-empty">보고서를 생성하지 못했습니다. 잠시 후 다시 시도하세요.</p>
        </article>
      </div>
    );
  }
  if (!r) notFound();

  return (
    <div className="report-page">
      {/* 화면에서만 보이는 도구 막대 — 인쇄 시 사라진다 */}
      <div className="report-toolbar no-print">
        <Link href={`/m/${id}`} className="small">
          ‹ 워크벤치
        </Link>
        <div className="row">
          {ROLES.map((x) => (
            <Link
              key={x}
              href={`/m/${id}/report?role=${x}`}
              className={`role-pill ${role === x ? "active" : ""}`}
            >
              {ROLE_LABEL[x]}
            </Link>
          ))}
        </div>
        <div className="row">
          <a className="small" href={`/api/report/${id}?role=${role}&format=md`}>
            ⤓ Markdown
          </a>
          <PrintButton />
        </div>
      </div>

      <article className="report">
        <header>
          <h1>{r.project}</h1>
          <div className="report-slug">{r.slugline}</div>
          {r.oneLine && <p className="report-oneline">{r.oneLine}</p>}
          <div className="report-badge">{ROLE_TITLE[role]}</div>
          <table className="report-meta">
            <tbody>
              <tr>
                <th>회의 일시</th>
                <td>{r.date ? new Date(r.date).toLocaleString("ko-KR") : "미기록"}</td>
              </tr>
              <tr>
                <th>참여자</th>
                <td>
                  {r.participants
                    .map((p) => `${p.name}${p.role ? `(${p.role})` : ""}`)
                    .join(", ") || "미기록"}
                </td>
              </tr>
              <tr>
                <th>발언 수</th>
                <td>{r.utteranceCount}</td>
              </tr>
            </tbody>
          </table>
        </header>

        {r.actionItems.length > 0 && (
          <section className="report-actions">
            <h2>회의 후 확인할 것</h2>
            <ul>
              {r.actionItems.map((a, i) => (
                <li key={i}>
                  <b>{a.label}</b> {a.value}
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.roleSections.map((s) => (
          <Section key={s.title} title={s.title} note={s.note} lines={s.lines} />
        ))}
        {r.roleSections.length > 0 && <hr />}
        {r.common.map((s) => (
          <Section key={s.title} title={s.title} note={s.note} lines={s.lines} />
        ))}

        <footer className="report-footer">
          이 문서는 회의 발언에서 추출한 내용과 사람이 승인한 값만 담습니다. 촬영 시간·비용은 확인
          전까지 산출하지 않습니다.
        </footer>
      </article>
    </div>
  );
}

function Section({
  title,
  note,
  lines,
}: {
  title: string;
  note?: string;
  lines: { label: string; value: string; meta?: string }[];
}) {
  return (
    <section className="report-section">
      <h2>{title}</h2>
      {note && <p className="report-note">{note}</p>}
      {lines.length === 0 ? (
        <p className="report-empty">해당 항목 없음</p>
      ) : (
        <dl>
          {lines.map((l, i) => (
            <div key={i} className="report-row">
              <dt>{l.label}</dt>
              <dd>
                {l.value}
                {l.meta && <span className="report-meta-line">{l.meta}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
