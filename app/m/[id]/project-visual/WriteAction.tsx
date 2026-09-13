"use client";

import { describeWriteError, useWriteAction } from "./useWriteAction";
import styles from "./projectVisual.module.css";

/**
 * 실제 쓰기 버튼. Phase 6 의 ReadOnlyAction 을 대체한다.
 *
 * 규칙:
 *   - 서버가 성공을 응답하기 전에는 "저장됨" 을 보여주지 않는다.
 *   - 진행 중에는 비활성화해 중복 제출을 막는다.
 *   - 실패하면 오류 코드와 함께 남기고, 다시 시도 경로를 준다.
 *   - blocked 이면 아예 호출하지 않는다 (차단 사유를 표시).
 */
export function WriteAction({
  label,
  onRun,
  onSettled,
  blocked,
  blockedReason,
  testId,
}: {
  label: string;
  onRun: () => Promise<unknown>;
  onSettled?: () => void | Promise<void>;
  blocked?: boolean;
  blockedReason?: string;
  testId?: string;
}) {
  const { state, run, reset, busy } = useWriteAction(onSettled);

  return (
    <div
      className={styles.writeActionWrap}
      data-testid={blocked ? (testId ? `${testId}-blocked` : "write-blocked") : (testId ?? "write-action")}
    >
      {blocked ? (
        <>
          <button className={styles.blockedAction} disabled aria-disabled="true">
            승인 차단 · {label}
          </button>
          {blockedReason && <small className={styles.writeBlockedReason}>{blockedReason}</small>}
        </>
      ) : (
        <button
          type="button"
          className={styles.writeAction}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void run(onRun)}
          data-status={state.status}
        >
          {busy ? "저장 중…" : label}
        </button>
      )}

      {/* 저장 결과는 차단 여부와 무관하게 보여준다.
          입력을 비우면 다시 blocked 가 되는 화면에서도 직전 저장 결과가 사라지면 안 된다. */}
      {state.status === "saved" && (
        <small className={styles.writeSaved} data-testid="write-saved" role="status">
          저장됨 · 서버 반영 확인
        </small>
      )}

      {state.status === "error" && state.error && (
        <div className={styles.writeError} role="alert" data-testid="write-error">
          <strong>{describeWriteError(state.error, state.httpStatus)}</strong>
          <code>{state.error.code}</code>
          <button type="button" onClick={reset}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
