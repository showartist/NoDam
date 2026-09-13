"use client";

import { createContext, useContext } from "react";
import type { ProjectVisualWorkspaceModel } from "./types";

/**
 * 쓰기 동작이 필요한 뷰가 공유하는 것:
 *   projectId   — 어떤 프로젝트에 쓰는가
 *   participants — 승인·결정 주체. 이름 문자열이 아니라 이 ID 를 쓴다.
 *   reload      — 쓰기 성공 후 서버에서 다시 읽는다. UI 가 결과를 추정하지 않는다.
 */
export type WriteContextValue = {
  projectId: string;
  participants: ProjectVisualWorkspaceModel["participants"];
  reload: () => Promise<void>;
};

const Ctx = createContext<WriteContextValue | null>(null);

export const WriteProvider = Ctx.Provider;

export function useWrite(): WriteContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error("useWrite must be used inside WriteProvider");
  return value;
}

/** 역할별 참여자 1명을 고른다. 없으면 null — 없는 사람을 지어내지 않는다. */
export function participantFor(
  participants: WriteContextValue["participants"],
  role: string,
): { id: string; name: string } | null {
  const found = participants.find((p) => p.role === role);
  return found ? { id: found.id, name: found.name } : null;
}
