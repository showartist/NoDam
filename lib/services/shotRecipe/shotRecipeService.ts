/**
 * Shot Recipe 서비스.
 *
 * 규칙은 도메인(lib/domain/shotRecipe)이 정의하고, DB 가 최종으로 강제한다.
 * 이 계층은 둘을 잇고 명확한 도메인 오류를 만든다. 규칙을 여기서 새로 만들지 않는다.
 *
 * 필수 규칙
 *   - 새 버전은 항상 draft, 이전 버전 승인 미승계
 *   - 본문 불변 (내용 변경은 새 버전)
 *   - 승인 이력 append-only
 *   - director 와 producer 의 "최신" 승인이 모두 있을 때만 approved
 *   - revoke 이후 approved 해제
 *   - stale Recipe 는 생성 대상으로 쓸 수 없음
 *   - 승인 이력이 있는 Shot / 참조 중 Reference 물리 삭제 금지 (DB RESTRICT)
 */
import { computeApproval, canRevoke } from "../../domain/shotRecipe/approval";
import {
  assertConsistentLinks,
  normalizeBody,
  normalizeLinks,
  requireDecision,
  requireId,
  requireRole,
  ShotRecipeValidationError,
} from "../../domain/shotRecipe/schema";
import { generationBlockReason, transition, type StatusTransition } from "../../domain/shotRecipe/status";
import { buildNextVersion, canCreateNextVersion } from "../../domain/shotRecipe/versioning";
import type {
  ApprovalReadModel,
  ApproverRole,
  ShotRecipeLinks,
  ShotRecipeVersion,
  ShotRecipeVersionBody,
} from "../../domain/shotRecipe/types";
import type { ShotRecipeRepository } from "../../repositories/shotRecipe/shotRecipeRepository";
import { ShotRecipeServiceError, toShotRecipeError } from "./errors";

/** project/scene/shot/character 일관성 확인에 필요한 최소 조회. */
export type ConsistencyLookup = {
  getShot(shotId: string): Promise<{ sceneId: string | null } | null>;
  getScene(sceneId: string): Promise<{ projectId: string } | null>;
  getCharacterProjects(characterIds: string[]): Promise<Record<string, string | null>>;
};

export type ShotRecipeDetail = {
  recipeId: string;
  projectId: string;
  sceneId: string;
  shotId: string;
  currentVersion: ShotRecipeVersion | null;
  approval: ApprovalReadModel;
  /** 생성에 쓸 수 있는가. stale/미승인이면 사유가 담긴다. */
  usableForGeneration: boolean;
  generationBlockedReason: string | null;
};

const guard = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (e) {
    if (e instanceof ShotRecipeValidationError) {
      throw new ShotRecipeServiceError("VALIDATION_ERROR", e.message, { field: e.field });
    }
    throw toShotRecipeError(e);
  }
};

export class ShotRecipeService {
  constructor(
    private readonly repo: ShotRecipeRepository,
    private readonly lookup: ConsistencyLookup,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // ── 생성 ──────────────────────────────────────────────────
  /**
   * Recipe 계보 + v1 을 만든다.
   * project/scene/shot 일관성을 먼저 확인해 DB 트리거보다 앞서 명확한 오류를 준다.
   */
  async createRecipe(input: {
    recipeId?: string;
    projectId: string;
    sceneId: string;
    shotId: string;
    body?: Partial<ShotRecipeVersionBody>;
    links?: Partial<ShotRecipeLinks>;
    createdBy: string;
  }): Promise<ShotRecipeDetail> {
    return guard(async () => {
      const projectId = requireId(input.projectId, "projectId");
      const sceneId = requireId(input.sceneId, "sceneId");
      const shotId = requireId(input.shotId, "shotId");
      const createdBy = requireId(input.createdBy, "createdBy");

      const existing = await this.repo.getLineageByShot(shotId);
      if (existing) {
        throw new ShotRecipeServiceError("CONFLICT", "이 Shot 에는 이미 Recipe 가 있습니다. 새 버전을 만드십시오.");
      }

      const shot = await this.lookup.getShot(shotId);
      const scene = shot?.sceneId ? await this.lookup.getScene(sceneId) : await this.lookup.getScene(sceneId);
      assertConsistentLinks({
        recipeProjectId: projectId,
        recipeSceneId: sceneId,
        shotSceneId: shot?.sceneId ?? null,
        sceneProjectId: scene?.projectId ?? null,
      });

      const links = normalizeLinks(input.links ?? {});
      await this.assertCharactersInProject(links.subjectIds, projectId);

      const recipeId = input.recipeId ?? this.newId();
      await this.repo.createLineage({ recipeId, projectId, sceneId, shotId, currentVersionId: null });
      await this.repo.createVersion({
        versionId: this.newId(),
        recipeId,
        version: 1,
        body: normalizeBody(input.body ?? {}),
        links,
        createdBy,
      });
      return this.getRecipe(recipeId);
    });
  }

  // ── 조회 ──────────────────────────────────────────────────
  async getRecipe(recipeId: string): Promise<ShotRecipeDetail> {
    return guard(async () => {
      const lineage = await this.repo.getLineage(requireId(recipeId, "recipeId"));
      if (!lineage) throw new ShotRecipeServiceError("NOT_FOUND", "Shot Recipe 를 찾을 수 없습니다.");

      const currentVersion = await this.repo.getCurrentVersion(recipeId);
      const events = currentVersion ? await this.repo.listApprovals(currentVersion.versionId) : [];
      const approval = computeApproval(events);
      const status = currentVersion?.status ?? "draft";

      return {
        recipeId: lineage.recipeId,
        projectId: lineage.projectId,
        sceneId: lineage.sceneId,
        shotId: lineage.shotId,
        currentVersion,
        approval,
        usableForGeneration: status === "approved",
        generationBlockedReason: generationBlockReason(status),
      };
    });
  }

  async listHistory(recipeId: string): Promise<ShotRecipeVersion[]> {
    return guard(() => this.repo.listVersionHistory(requireId(recipeId, "recipeId")));
  }

  // ── 상태 전이 ─────────────────────────────────────────────
  private async move(recipeId: string, action: StatusTransition): Promise<ShotRecipeDetail> {
    return guard(async () => {
      const detail = await this.getRecipe(recipeId);
      const version = detail.currentVersion;
      if (!version) throw new ShotRecipeServiceError("NOT_FOUND", "현재 버전이 없습니다.");

      const events = await this.repo.listApprovals(version.versionId);
      const result = transition(version.status, action, events);
      if (!result.ok) {
        // 승인이 모자란 것과 상태 기계상 불가한 것은 다른 문제다.
        // 예: draft → approve 는 승인 여부와 무관하게 전이 자체가 막힌다.
        const isApprovalGap = /최신 승인/.test(result.reason);
        throw new ShotRecipeServiceError(
          isApprovalGap ? "APPROVAL_INCOMPLETE" : "INVALID_STATE_TRANSITION",
          result.reason,
        );
      }
      await this.repo.setStatus(version.versionId, result.next);
      return this.getRecipe(recipeId);
    });
  }

  propose = (recipeId: string) => this.move(recipeId, "propose");
  requestReview = (recipeId: string) => this.move(recipeId, "request_review");

  /** 승인 확정. 승인 이벤트가 두 역할 모두 approved 여야 통과한다. */
  approve = (recipeId: string) => this.move(recipeId, "approve");

  // ── 승인 이벤트 ───────────────────────────────────────────
  /**
   * 역할별 승인 기록을 남긴다. 이벤트만 추가하고 상태는 바꾸지 않는다.
   * 두 역할이 모두 승인되면 approve() 로 상태를 올린다.
   */
  async recordApproval(input: {
    recipeId: string;
    approverRole: ApproverRole;
    approvedBy: string;
    rationale?: string;
    evidence?: string[];
  }): Promise<ApprovalReadModel> {
    return guard(async () => {
      const version = await this.requireCurrentVersion(input.recipeId);
      await this.repo.appendApproval({
        id: this.newId(),
        versionId: version.versionId,
        approverRole: requireRole(input.approverRole),
        decision: requireDecision("approved"),
        approvedBy: requireId(input.approvedBy, "approvedBy"),
        rationale: input.rationale ?? null,
        evidence: input.evidence ?? [],
      });
      return computeApproval(await this.repo.listApprovals(version.versionId));
    });
  }

  /**
   * 승인 철회. 기존 기록을 덮어쓰지 않고 revoked 이벤트를 덧붙인다.
   * 철회되면 approved 상태를 유지할 수 없으므로 needs_review 로 내린다.
   */
  async revokeApproval(input: {
    recipeId: string;
    approverRole: ApproverRole;
    approvedBy: string;
    reason: string;
  }): Promise<ShotRecipeDetail> {
    return guard(async () => {
      const version = await this.requireCurrentVersion(input.recipeId);
      const role = requireRole(input.approverRole);
      const events = await this.repo.listApprovals(version.versionId);

      const check = canRevoke(events, role);
      if (!check.ok) throw new ShotRecipeServiceError("INVALID_STATE_TRANSITION", check.reason!);

      await this.repo.appendApproval({
        id: this.newId(),
        versionId: version.versionId,
        approverRole: role,
        decision: requireDecision("revoked"),
        approvedBy: requireId(input.approvedBy, "approvedBy"),
        rationale: input.reason,
        evidence: [],
      });

      // 승인이 깨졌으므로 approved 를 유지하지 않는다.
      if (version.status === "approved") {
        await this.repo.setStatus(version.versionId, "needs_review");
      }
      return this.getRecipe(input.recipeId);
    });
  }

  // ── 새 버전 ───────────────────────────────────────────────
  /**
   * 새 버전을 만든다. 본문은 불변이므로 내용 변경은 언제나 이 경로다.
   * 새 버전은 draft 이며 이전 승인을 승계하지 않는다.
   */
  async createNewVersion(input: {
    recipeId: string;
    changes?: Partial<ShotRecipeVersionBody>;
    links?: Partial<ShotRecipeLinks>;
    createdBy: string;
  }): Promise<ShotRecipeDetail> {
    return guard(async () => {
      const detail = await this.getRecipe(input.recipeId);
      const previous = detail.currentVersion;

      const links = input.links ? normalizeLinks(input.links) : previous?.links;
      await this.assertCharactersInProject(links?.subjectIds ?? [], detail.projectId);

      const draft = buildNextVersion({
        previous,
        changes: input.changes ? normalizeBody({ ...(previous ?? {}), ...input.changes }) : undefined,
        links,
        createdBy: requireId(input.createdBy, "createdBy"),
      });

      const allowed = canCreateNextVersion({ previous, changes: draft.body, links, createdBy: input.createdBy });
      if (!allowed.ok) throw new ShotRecipeServiceError("VALIDATION_ERROR", allowed.reason!);

      await this.repo.createVersion({
        versionId: this.newId(),
        recipeId: detail.recipeId,
        version: await this.repo.nextVersionNumber(detail.recipeId),
        body: draft.body,
        links: draft.links,
        createdBy: draft.createdBy,
      });
      return this.getRecipe(input.recipeId);
    });
  }

  // ── stale 전파 ────────────────────────────────────────────
  /**
   * 상위 Visual Principle 버전이 바뀌면 명시적으로 링크된 Recipe 버전만 stale 로 만든다.
   * 이름 문자열로 추정하지 않는다.
   */
  async markStaleByPrincipleVersion(principleVersionId: string): Promise<string[]> {
    return guard(() => this.repo.markStaleByPrincipleVersion(requireId(principleVersionId, "principleVersionId")));
  }

  async markStaleByCharacterVisual(characterVisualBibleId: string): Promise<string[]> {
    return guard(() =>
      this.repo.markStaleByCharacterVisual(requireId(characterVisualBibleId, "characterVisualBibleId")),
    );
  }

  // ── 삭제 정책 ─────────────────────────────────────────────
  /** 승인 이력이 없는 draft 만 지운다. 그 외는 명확한 사유와 함께 거부한다. */
  async deleteDraftVersion(versionId: string): Promise<void> {
    return guard(async () => {
      const r = await this.repo.deleteUnapprovedDraft(requireId(versionId, "versionId"));
      if (!r.deleted) {
        const code = r.reason?.includes("찾을 수 없") ? "NOT_FOUND" : "DELETE_RESTRICTED";
        throw new ShotRecipeServiceError(code, r.reason ?? "삭제할 수 없습니다.");
      }
    });
  }

  // ── 내부 ──────────────────────────────────────────────────
  private async requireCurrentVersion(recipeId: string): Promise<ShotRecipeVersion> {
    const detail = await this.getRecipe(recipeId);
    if (!detail.currentVersion) throw new ShotRecipeServiceError("NOT_FOUND", "현재 버전이 없습니다.");
    return detail.currentVersion;
  }

  /** 다른 프로젝트 캐릭터를 연결하지 못하게 한다 (DB 트리거와 같은 규칙). */
  private async assertCharactersInProject(characterIds: string[], projectId: string): Promise<void> {
    if (characterIds.length === 0) return;
    const owners = await this.lookup.getCharacterProjects(characterIds);
    for (const id of characterIds) {
      const owner = owners[id];
      if (owner === undefined || owner === null) {
        throw new ShotRecipeServiceError("NOT_FOUND", `캐릭터를 찾을 수 없습니다: ${id}`);
      }
      if (owner !== projectId) {
        throw new ShotRecipeServiceError(
          "VALIDATION_ERROR",
          `다른 프로젝트의 캐릭터는 연결할 수 없습니다. (character=${id})`,
        );
      }
    }
  }
}
