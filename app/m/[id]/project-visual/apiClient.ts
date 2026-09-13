import type { ProjectVisualWorkspaceModel, WorkspaceApiError } from "./types";

export class WorkspaceRequestError extends Error {
  constructor(readonly payload: WorkspaceApiError, readonly status: number) {
    super(payload.message);
    this.name = "WorkspaceRequestError";
  }
}

export async function fetchProjectVisualWorkspace(projectId: string, signal?: AbortSignal): Promise<ProjectVisualWorkspaceModel> {
  const response = await fetch(`/api/project-visual/projects/${encodeURIComponent(projectId)}/workspace`, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal,
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; data?: ProjectVisualWorkspaceModel; error?: WorkspaceApiError } | null;
  if (!response.ok || !body?.ok || !body.data) {
    throw new WorkspaceRequestError(body?.error ?? { code: "INTERNAL_ERROR", message: "Project Visual Workspace를 불러오지 못했습니다." }, response.status);
  }
  return body.data;
}
