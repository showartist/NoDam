"use client";

import { useCallback, useRef, useState } from "react";
import { MutationError } from "./mutations";
import type { WorkspaceApiError } from "./types";

/**
 * 쓰기 동작의 상태 기계.
 *
 *   idle → saving → saved      (서버가 성공을 응답한 뒤에만 saved 로 간다)
 *                 → error      (validation / conflict / approval blocked / network)
 *
 * optimistic 성공을 만들지 않는다. saved 는 서버 응답 이후에만 세팅된다.
 * 같은 동작이 진행 중이면 재요청을 막는다 (중복 제출 방지).
 */
export type WriteStatus = "idle" | "saving" | "saved" | "error";

export type WriteState = {
  status: WriteStatus;
  error: WorkspaceApiError | null;
  /** 서버가 돌려준 HTTP 상태. 409 계열을 conflict 로 구분하기 위해 보관한다. */
  httpStatus: number | null;
};

const IDLE: WriteState = { status: "idle", error: null, httpStatus: null };

export function useWriteAction(onSettled?: () => void | Promise<void>) {
  const [state, setState] = useState<WriteState>(IDLE);
  const inFlight = useRef(false);

  const run = useCallback(
    async (work: () => Promise<unknown>) => {
      if (inFlight.current) return false; // 중복 제출 방지
      inFlight.current = true;
      setState({ status: "saving", error: null, httpStatus: null });
      try {
        await work();
        // 서버가 성공을 확인한 뒤에만 화면 데이터를 다시 읽는다.
        await onSettled?.();
        setState({ status: "saved", error: null, httpStatus: null });
        return true;
      } catch (reason) {
        const payload =
          reason instanceof MutationError
            ? reason.payload
            : { code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." };
        const httpStatus = reason instanceof MutationError ? reason.status : null;
        setState({ status: "error", error: payload, httpStatus });
        return false;
      } finally {
        inFlight.current = false;
      }
    },
    [onSettled],
  );

  const reset = useCallback(() => setState(IDLE), []);
  return { state, run, reset, busy: state.status === "saving" };
}

/** 오류 코드를 현장에서 읽히는 한 줄로 옮긴다. 원본 코드는 함께 노출한다. */
export function describeWriteError(error: WorkspaceApiError, httpStatus: number | null): string {
  switch (error.code) {
    case "VALIDATION_ERROR":
      return "입력값이 계약을 만족하지 않습니다.";
    case "APPROVAL_INCOMPLETE":
      return "승인 조건이 충족되지 않아 차단되었습니다.";
    case "INVALID_STATE_TRANSITION":
      return "현재 상태에서 허용되지 않는 전환입니다.";
    case "CASCADE_CONTRACT_VIOLATION":
      return "변경 영향 조합이 계약을 위반합니다.";
    case "CONFLICT":
      return "다른 변경과 충돌했습니다. 새로고침 후 다시 시도하십시오.";
    case "NOT_FOUND":
      return "대상을 찾지 못했습니다.";
    case "DATABASE_NOT_CONFIGURED":
      return "영속 DB 연결이 필요합니다.";
    case "NETWORK_ERROR":
      return "서버에 연결하지 못했습니다.";
    default:
      return httpStatus === 409 ? "다른 변경과 충돌했습니다." : "요청을 처리하지 못했습니다.";
  }
}
