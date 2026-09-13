/**
 * Shot Recipe 영속 계층.
 *
 * 스키마: scripts/phase8/010_shot_recipe_a_up.sql (Canonical v1 — 37 fields)
 * 제약은 DB 가 최종 보장한다. 이 계층은 SQL 을 감싸기만 하고 규칙을 재구현하지 않는다.
 *
 * 관계형 ID 는 JSONB 가 아니라 링크 테이블에 저장한다.
 */
import type { QueryExecutor, TransactionExecutor } from "../projectVisual/db";
import type {
  ApprovalDecision,
  ApproverRole,
  ShotRecipeApprovalEvent,
  ShotRecipeLineage,
  ShotRecipeLinks,
  ShotRecipeStatus,
  ShotRecipeVersion,
  ShotRecipeVersionBody,
} from "../../domain/shotRecipe/types";

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);

const BODY_COLUMNS = [
  "narrative_purpose", "emotional_target", "framing", "shot_size", "lens_intent",
  "camera_position", "camera_movement", "subject_action", "performance_direction",
  "environment", "lighting", "color_intent", "wardrobe", "props",
  "start_state", "end_state", "duration_seconds", "motion_speed",
  "continuity_inputs", "allowed_elements", "prohibited_elements", "production_constraints",
] as const;

const BODY_FIELDS: Array<keyof ShotRecipeVersionBody> = [
  "narrativePurpose", "emotionalTarget", "framing", "shotSize", "lensIntent",
  "cameraPosition", "cameraMovement", "subjectAction", "performanceDirection",
  "environment", "lighting", "colorIntent", "wardrobe", "props",
  "startState", "endState", "durationSeconds", "motionSpeed",
  "continuityInputs", "allowedElements", "prohibitedElements", "productionConstraints",
];

const JSON_FIELDS = new Set(["continuityInputs", "allowedElements", "prohibitedElements", "productionConstraints"]);

function mapVersion(row: any, links: ShotRecipeLinks): ShotRecipeVersion {
  return {
    versionId: row.id,
    recipeId: row.recipe_id,
    version: row.version_no,
    status: row.status as ShotRecipeStatus,
    createdBy: row.created_by,
    createdAt: iso(row.created_at),
    narrativePurpose: row.narrative_purpose,
    emotionalTarget: row.emotional_target,
    framing: row.framing,
    shotSize: row.shot_size,
    lensIntent: row.lens_intent,
    cameraPosition: row.camera_position,
    cameraMovement: row.camera_movement,
    subjectAction: row.subject_action,
    performanceDirection: row.performance_direction,
    environment: row.environment,
    lighting: row.lighting,
    colorIntent: row.color_intent,
    wardrobe: row.wardrobe,
    props: row.props,
    startState: row.start_state,
    endState: row.end_state,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    motionSpeed: row.motion_speed,
    continuityInputs: row.continuity_inputs ?? [],
    allowedElements: row.allowed_elements ?? [],
    prohibitedElements: row.prohibited_elements ?? [],
    productionConstraints: row.production_constraints ?? [],
    links,
  };
}

export class ShotRecipeRepository {
  constructor(private readonly db: QueryExecutor & Partial<TransactionExecutor>) {}

  // ── 계보 ──────────────────────────────────────────────────
  async createLineage(input: ShotRecipeLineage): Promise<void> {
    await this.db.query(
      "INSERT INTO shot_recipes (id,project_id,scene_id,shot_id) VALUES ($1,$2,$3,$4)",
      [input.recipeId, input.projectId, input.sceneId, input.shotId],
    );
  }

  async getLineage(recipeId: string): Promise<ShotRecipeLineage | null> {
    const rows = await this.db.query<any>(
      "SELECT id,project_id,scene_id,shot_id,current_version_id FROM shot_recipes WHERE id=$1",
      [recipeId],
    );
    const r = rows[0];
    return r
      ? { recipeId: r.id, projectId: r.project_id, sceneId: r.scene_id, shotId: r.shot_id, currentVersionId: r.current_version_id }
      : null;
  }

  async getLineageByShot(shotId: string): Promise<ShotRecipeLineage | null> {
    const rows = await this.db.query<any>(
      "SELECT id,project_id,scene_id,shot_id,current_version_id FROM shot_recipes WHERE shot_id=$1",
      [shotId],
    );
    const r = rows[0];
    return r
      ? { recipeId: r.id, projectId: r.project_id, sceneId: r.scene_id, shotId: r.shot_id, currentVersionId: r.current_version_id }
      : null;
  }

  // ── 버전 ──────────────────────────────────────────────────
  /** 버전 본문 + 링크를 한 트랜잭션으로 저장한다. */
  async createVersion(input: {
    versionId: string;
    recipeId: string;
    version: number;
    body: ShotRecipeVersionBody;
    links: ShotRecipeLinks;
    createdBy: string;
    /** 새 버전을 current 로 올릴지. 기본 true. */
    setAsCurrent?: boolean;
  }): Promise<void> {
    const run = async (tx: QueryExecutor) => {
      const values: unknown[] = [input.versionId, input.recipeId, input.version, input.createdBy];
      BODY_FIELDS.forEach((f) => {
        const v = input.body[f];
        values.push(JSON_FIELDS.has(f) ? JSON.stringify(v ?? []) : v);
      });
      const placeholders = values.map((_, i) => `$${i + 1}`).join(",");
      await tx.query(
        `INSERT INTO shot_recipe_versions (id,recipe_id,version_no,created_by,${BODY_COLUMNS.join(",")})
         VALUES (${placeholders})`,
        values,
      );
      await this.replaceLinksWith(tx, input.versionId, input.links);
      if (input.setAsCurrent !== false) {
        await tx.query("UPDATE shot_recipes SET current_version_id=$1, updated_at=now() WHERE id=$2", [
          input.versionId,
          input.recipeId,
        ]);
      }
    };
    await (this.db.transaction ? this.db.transaction(run) : run(this.db));
  }

  async getVersion(versionId: string): Promise<ShotRecipeVersion | null> {
    const rows = await this.db.query<any>("SELECT * FROM shot_recipe_versions WHERE id=$1", [versionId]);
    if (!rows[0]) return null;
    return mapVersion(rows[0], await this.getLinks(versionId));
  }

  async getCurrentVersion(recipeId: string): Promise<ShotRecipeVersion | null> {
    const rows = await this.db.query<any>(
      `SELECT v.* FROM shot_recipe_versions v
       JOIN shot_recipes r ON r.current_version_id = v.id
       WHERE r.id=$1`,
      [recipeId],
    );
    if (!rows[0]) return null;
    return mapVersion(rows[0], await this.getLinks(rows[0].id));
  }

  /** 버전 이력 (오래된 순). 본문은 불변이므로 그대로 감사 기록이 된다. */
  async listVersionHistory(recipeId: string): Promise<ShotRecipeVersion[]> {
    const rows = await this.db.query<any>(
      "SELECT * FROM shot_recipe_versions WHERE recipe_id=$1 ORDER BY version_no",
      [recipeId],
    );
    const out: ShotRecipeVersion[] = [];
    for (const r of rows) out.push(mapVersion(r, await this.getLinks(r.id)));
    return out;
  }

  async nextVersionNumber(recipeId: string): Promise<number> {
    const rows = await this.db.query<{ max: number | null }>(
      "SELECT max(version_no) AS max FROM shot_recipe_versions WHERE recipe_id=$1",
      [recipeId],
    );
    return (rows[0]?.max ?? 0) + 1;
  }

  /** status 만 바꾼다. 본문 변경은 DB 트리거가 막는다. */
  async setStatus(versionId: string, status: ShotRecipeStatus): Promise<void> {
    await this.db.query("UPDATE shot_recipe_versions SET status=$1 WHERE id=$2", [status, versionId]);
  }

  /**
   * 상위 원칙·Bible 이 바뀌어 재검토가 필요한 버전을 stale 로 만든다.
   * 명시적 링크가 있는 버전만 대상으로 한다 — 이름 문자열로 추정하지 않는다.
   */
  async markStaleByPrincipleVersion(principleVersionId: string): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE shot_recipe_versions SET status='stale'
        WHERE status <> 'stale'
          AND id IN (SELECT version_id FROM shot_recipe_version_visual_principles WHERE principle_version_id=$1)
        RETURNING id`,
      [principleVersionId],
    );
    return rows.map((r) => r.id);
  }

  async markStaleByCharacterVisual(characterVisualBibleId: string): Promise<string[]> {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE shot_recipe_versions SET status='stale'
        WHERE status <> 'stale'
          AND id IN (SELECT version_id FROM shot_recipe_version_character_visuals WHERE character_visual_bible_id=$1)
        RETURNING id`,
      [characterVisualBibleId],
    );
    return rows.map((r) => r.id);
  }

  /**
   * 승인 이력이 없는 draft 만 삭제한다.
   * 승인 이력이 있으면 DB FK(RESTRICT)가 막으므로 여기서 먼저 걸러 명확한 신호를 준다.
   */
  async deleteUnapprovedDraft(versionId: string): Promise<{ deleted: boolean; reason?: string }> {
    const v = await this.db.query<any>("SELECT status FROM shot_recipe_versions WHERE id=$1", [versionId]);
    if (!v[0]) return { deleted: false, reason: "버전을 찾을 수 없습니다." };
    if (v[0].status !== "draft") return { deleted: false, reason: `draft 만 삭제할 수 있습니다 (현재 ${v[0].status}).` };

    const a = await this.db.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM shot_recipe_approvals WHERE version_id=$1",
      [versionId],
    );
    if ((a[0]?.c ?? 0) > 0) return { deleted: false, reason: "승인 이력이 있어 삭제할 수 없습니다." };

    await this.db.query("UPDATE shot_recipes SET current_version_id=NULL WHERE current_version_id=$1", [versionId]);
    await this.db.query("DELETE FROM shot_recipe_versions WHERE id=$1", [versionId]);
    return { deleted: true };
  }

  // ── 링크 ──────────────────────────────────────────────────
  async getLinks(versionId: string): Promise<ShotRecipeLinks> {
    const [subjects, visuals, principles, refs, evidence] = await Promise.all([
      this.db.query<any>("SELECT character_id FROM shot_recipe_version_subjects WHERE version_id=$1 ORDER BY character_id", [versionId]),
      this.db.query<any>("SELECT character_visual_bible_id FROM shot_recipe_version_character_visuals WHERE version_id=$1 ORDER BY character_visual_bible_id", [versionId]),
      this.db.query<any>("SELECT principle_version_id FROM shot_recipe_version_visual_principles WHERE version_id=$1 ORDER BY principle_version_id", [versionId]),
      this.db.query<any>("SELECT reference_id,role FROM shot_recipe_version_references WHERE version_id=$1 ORDER BY role,reference_id", [versionId]),
      this.db.query<any>("SELECT evidence_uid FROM shot_recipe_version_evidence WHERE version_id=$1 ORDER BY evidence_uid", [versionId]),
    ]);
    return {
      subjectIds: subjects.map((r) => r.character_id),
      characterVisualVersionIds: visuals.map((r) => r.character_visual_bible_id),
      visualPrincipleVersionIds: principles.map((r) => r.principle_version_id),
      references: refs.map((r) => ({ referenceId: r.reference_id, role: r.role })),
      evidenceIds: evidence.map((r) => r.evidence_uid),
    };
  }

  private async replaceLinksWith(tx: QueryExecutor, versionId: string, links: ShotRecipeLinks): Promise<void> {
    for (const [table, col, values] of [
      ["shot_recipe_version_subjects", "character_id", links.subjectIds],
      ["shot_recipe_version_character_visuals", "character_visual_bible_id", links.characterVisualVersionIds],
      ["shot_recipe_version_visual_principles", "principle_version_id", links.visualPrincipleVersionIds],
      ["shot_recipe_version_evidence", "evidence_uid", links.evidenceIds],
    ] as const) {
      await tx.query(`DELETE FROM ${table} WHERE version_id=$1`, [versionId]);
      for (const v of values) {
        await tx.query(`INSERT INTO ${table} (version_id,${col}) VALUES ($1,$2)`, [versionId, v]);
      }
    }
    await tx.query("DELETE FROM shot_recipe_version_references WHERE version_id=$1", [versionId]);
    for (const r of links.references) {
      await tx.query("INSERT INTO shot_recipe_version_references (version_id,reference_id,role) VALUES ($1,$2,$3)", [
        versionId, r.referenceId, r.role,
      ]);
    }
  }

  // ── 승인 이벤트 (append-only) ─────────────────────────────
  async appendApproval(input: {
    id: string;
    versionId: string;
    approverRole: ApproverRole;
    decision: ApprovalDecision;
    approvedBy: string;
    approvedAt?: string;
    rationale?: string | null;
    evidence?: string[];
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO shot_recipe_approvals (id,version_id,approver_role,decision,approved_by,approved_at,rationale,evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.id, input.versionId, input.approverRole, input.decision, input.approvedBy,
        input.approvedAt ?? new Date().toISOString(), input.rationale ?? null,
        JSON.stringify(input.evidence ?? []),
      ],
    );
  }

  /** 승인 이력. 오래된 순. 수정·삭제 경로는 제공하지 않는다 (append-only). */
  async listApprovals(versionId: string): Promise<ShotRecipeApprovalEvent[]> {
    const rows = await this.db.query<any>(
      "SELECT * FROM shot_recipe_approvals WHERE version_id=$1 ORDER BY approved_at, id",
      [versionId],
    );
    return rows.map((r) => ({
      id: r.id,
      versionId: r.version_id,
      approverRole: r.approver_role as ApproverRole,
      decision: r.decision as ApprovalDecision,
      approvedBy: r.approved_by,
      approvedAt: iso(r.approved_at),
      rationale: r.rationale,
      evidence: r.evidence ?? [],
    }));
  }
}
