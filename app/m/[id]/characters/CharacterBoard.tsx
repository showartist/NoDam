"use client";

/**
 * 캐릭터 컨셉 초안 화면.
 *
 * 인물마다 회의에서 모은 묘사(항목·값·출처)를 표로 보여 주고, 그 묘사로 그린 초안 판(v1, v2 …)을 나란히 둔다.
 * 묘사가 바뀌면 이전 판을 참조 이미지로 넣어 같은 사람을 유지한 채 바뀐 항목만 고친다. 채택은 사람이 이름을 적어 한다.
 */
import { useCallback, useEffect, useState } from "react";
import s from "../alignment/v2/v2.module.css";

const ASPECT_LABEL: Record<string, string> = {
  age: "나이대",
  face: "얼굴",
  hair: "머리",
  body: "체형",
  wardrobe: "의상",
  props: "소품",
  expression: "표정·분위기",
};
const ASPECTS = Object.keys(ASPECT_LABEL);

type Source =
  | { kind: "meeting"; meetingId: string; meetingTitle: string | null; evidence: string[]; status: "agreed" | "proposed" }
  | { kind: "decision"; meetingId: string; ledgerId: string; decision: string; decidedBy: string };
type Profile = {
  name: string;
  aspects: Record<string, { value: string; source: Source }>;
  contested: { aspect: string; value: string; meetingId: string; meetingTitle: string | null; evidence: string[] }[];
  history: { aspect: string; value: string; meetingId: string; meetingTitle: string | null; kind: string }[];
};
type Draft = {
  id: string;
  character: string;
  version: number;
  imageUrl: string;
  description: Record<string, string>;
  changes: { aspect: string; before: string | null; after: string | null }[];
  similarity_to_parent: number | null;
  adopted_by: string | null;
  created_at: string;
};
type View = { meetings: { id: string; title: string | null; utterances: number; read: boolean }[]; profiles: Profile[]; drafts: Draft[] };

function Evidence({ meetingId, uids }: { meetingId: string; uids: string[] }) {
  return (
    <>
      {uids.map((u) => (
        <a key={u} className={s.linkBtn} style={{ marginRight: 6 }} href={`/m/${meetingId}?tab=transcript#u_${u}`}>
          {u}
        </a>
      ))}
    </>
  );
}

export function CharacterBoard(props: { meetingId: string; projectTitle: string }) {
  const [v, setV] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/meetings/${props.meetingId}/characters`);
    if (r.ok) setV(await r.json());
  }, [props.meetingId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setErr(null);
    const r = await fetch(`/api/meetings/${props.meetingId}/characters`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) {
      setErr(j.error ?? `실패했습니다 (HTTP ${r.status})`);
      return;
    }
    setV(j);
  }

  const unread = v?.meetings.filter((m) => m.utterances > 0 && !m.read) ?? [];

  return (
    <>
      <div className={s.summary}>
        <div>
          <h1 className={s.title}>캐릭터 컨셉 초안 · {props.projectTitle}</h1>
          <p className={s.sub}>
            회의에서 말한 인물 묘사만 모아 초안을 그립니다. 묘사가 바뀌면 이전 판을 참조로 넣어 같은 사람을 유지하고 바뀐 항목만 고칩니다. 초안은 사람이 채택하기 전까지 제안입니다.
          </p>
        </div>
        <div className={s.actions} style={{ marginTop: 0 }}>
          <a className={s.btn} href={`/m/${props.meetingId}/alignment`}>
            다시 짚기로
          </a>
          <button className={`${s.btn} ${s.btnPrimary}`} disabled={!!busy} onClick={() => act({ action: "extract" }, "묘사 모으는 중")}>
            {busy === "묘사 모으는 중" ? "묘사 모으는 중" : unread.length ? `회의 ${unread.length}개에서 묘사 모으기` : "묘사 다시 확인"}
          </button>
        </div>
      </div>
      {err && <div className={s.error}>{err}</div>}
      {busy && busy !== "묘사 모으는 중" && (
        <div className={s.muted} role="status">
          {busy}
        </div>
      )}

      {!v ? (
        <p className={s.muted}>불러오는 중</p>
      ) : v.profiles.length === 0 ? (
        <div className={s.notice}>
          <h2>모은 인물 묘사가 없습니다</h2>
          <p>
            {unread.length
              ? "위의 버튼으로 회의 발언에서 극중 인물의 외형 묘사를 모읍니다."
              : "이 작품의 회의에서 극중 인물의 외형을 말한 대목을 찾지 못했습니다."}
          </p>
        </div>
      ) : (
        v.profiles.map((p) => {
          const drafts = v.drafts.filter((d) => d.character === p.name);
          const last = drafts[drafts.length - 1];
          const pending = last
            ? ASPECTS.filter((a) => (last.description[a] ?? null) !== (p.aspects[a]?.value ?? null))
            : ASPECTS.filter((a) => p.aspects[a]);
          return (
            <section key={p.name} className={s.detail} style={{ marginBottom: 18 }}>
              <div className={s.detailHead}>
                <h2 className={s.title} style={{ fontSize: 20, margin: 0 }}>
                  {p.name}
                </h2>
                {last && <span className={s.badge}>초안 v{last.version}</span>}
                {last?.adopted_by && <span className={`${s.badge} ${s.ok}`}>채택 · {last.adopted_by}</span>}
              </div>

              <div className={s.gridResolve}>
                <div>
                  <h3 className={s.sectionTitle}>회의에서 모은 묘사</h3>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>항목</th>
                        <th>값</th>
                        <th>출처</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ASPECTS.filter((a) => p.aspects[a]).map((a) => {
                        const x = p.aspects[a];
                        return (
                          <tr key={a}>
                            <td className={s.who}>{ASPECT_LABEL[a]}</td>
                            <td>
                              {x.value}
                              {x.source.kind === "meeting" && x.source.status === "proposed" && (
                                <span className={`${s.badge} ${s.warn}`} style={{ marginLeft: 6 }}>
                                  제안
                                </span>
                              )}
                              {pending.includes(a) && last && (
                                <span className={`${s.badge} ${s.badgeAi}`} style={{ marginLeft: 6 }}>
                                  v{last.version} 이후 바뀜
                                </span>
                              )}
                            </td>
                            <td className={s.muted}>
                              {x.source.kind === "decision" ? (
                                <>
                                  승인된 결정 "{x.source.decision}" · {x.source.decidedBy}
                                </>
                              ) : (
                                <>
                                  {x.source.meetingTitle ?? x.source.meetingId} · <Evidence meetingId={x.source.meetingId} uids={x.source.evidence} />
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {ASPECTS.some((a) => !p.aspects[a]) && (
                    <p className={s.muted} style={{ marginTop: 8 }}>
                      회의에서 말하지 않은 것: {ASPECTS.filter((a) => !p.aspects[a]).map((a) => ASPECT_LABEL[a]).join(", ")}. 초안에서 이 부분(성별·나이 포함)은
                      이미지 모델이 임의로 채운 것이라 결정이 아닙니다.
                    </p>
                  )}
                  {p.contested.length > 0 && (
                    <div className={s.section}>
                      <h3 className={s.sectionTitle}>의견이 갈려 그리지 않은 값</h3>
                      <ul className={s.muted}>
                        {p.contested.map((c, n) => (
                          <li key={n}>
                            {ASPECT_LABEL[c.aspect] ?? c.aspect}: {c.value} ({c.meetingTitle ?? c.meetingId} · <Evidence meetingId={c.meetingId} uids={c.evidence} />)
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className={s.actions}>
                    <button
                      className={`${s.btn} ${s.btnPrimary}`}
                      disabled={!!busy || (last !== undefined && pending.length === 0)}
                      onClick={() => act({ action: "draw", character: p.name }, `${p.name} 초안 그리는 중 (10초 남짓)`)}
                    >
                      {!last ? "초안 그리기" : pending.length ? `바뀐 ${pending.length}개 항목으로 v${last.version + 1} 그리기` : "바뀐 묘사 없음"}
                    </button>
                  </div>
                </div>

                <aside>
                  <h3 className={s.sectionTitle}>초안 판</h3>
                  {drafts.length === 0 ? (
                    <div className={s.imageBox}>
                      <span>아직 그리지 않았습니다</span>
                    </div>
                  ) : (
                    [...drafts].reverse().map((d) => (
                      <figure key={d.id} style={{ margin: "0 0 14px" }}>
                        <div className={s.imageBox}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={d.imageUrl} alt={`${p.name} 컨셉 초안 v${d.version} (생성 이미지)`} />
                        </div>
                        <figcaption className={s.imageMeta}>
                          <b>v{d.version}</b> · 생성 이미지 · {new Date(d.created_at).toLocaleString("ko-KR")}
                          {d.version > 1 && (
                            <>
                              {" "}
                              · 이전 판 참조
                              {d.similarity_to_parent !== null && <> · 이전 판과 유사도 {d.similarity_to_parent.toFixed(2)}</>}
                            </>
                          )}
                          <div>
                            {d.version === 1
                              ? "첫 판: 모은 묘사로 그림"
                              : `바뀐 것: ${d.changes.map((c) => `${ASPECT_LABEL[c.aspect] ?? c.aspect} ${c.before ?? "없음"} → ${c.after ?? "없음"}`).join(", ")}`}
                          </div>
                          {d.adopted_by ? (
                            <span className={`${s.badge} ${s.ok}`}>채택 · {d.adopted_by}</span>
                          ) : (
                            <button
                              className={s.linkBtn}
                              disabled={!!busy}
                              onClick={() => {
                                const by = window.prompt("이 판을 기준으로 채택하는 사람 이름");
                                if (by?.trim()) void act({ action: "adopt", draftId: d.id, by }, "채택 저장 중");
                              }}
                            >
                              이 판을 기준으로 채택
                            </button>
                          )}
                        </figcaption>
                      </figure>
                    ))
                  )}
                </aside>
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
