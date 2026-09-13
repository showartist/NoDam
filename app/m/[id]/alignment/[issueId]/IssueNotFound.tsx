import s from "../v2/v2.module.css";

/** 없는 안건이면 없다고 말한다. 다른 안건이나 예시 안건으로 채우지 않는다. */
export function IssueNotFound(props: { meetingId: string; issueId: string }) {
  return (
    <main className={s.page}>
      <div className={s.wrap}>
        <div className={s.notice}>
          <h2>안건을 찾을 수 없습니다</h2>
          <p>
            이 회의의 현재 분석에는 <b>{props.issueId}</b> 안건이 없습니다. 분석을 다시 돌렸다면 번호가 바뀌었을 수 있습니다.
          </p>
          <a className={s.btn} href={`/m/${props.meetingId}/alignment`}>
            다시 짚기 목록으로
          </a>
        </div>
      </div>
    </main>
  );
}
