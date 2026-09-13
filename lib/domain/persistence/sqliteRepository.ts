import { db } from "@/lib/db";
import type { AlignmentIssue } from "../alignmentCheck/types";
import type { ParticipantExplorationRecipe, ConsolidatedExplorationRecipe } from "../explorationRecipe/types";
import type { ResolvedDecision } from "../resolvedDecision/types";
import type { ProductionImageRecipe } from "../productionRecipe/types";

/**
 * 💾 SQLite Persistence Repository Engine (Sprint 1, 2, 3)
 */
export function saveAlignmentIssue(issue: AlignmentIssue): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO alignment_issues_v2 (
        id, meeting_id, project_id, scene_ids, issue_type, severity, topic, summary,
        participant_positions, evidence_uids, why_it_matters, suggested_question, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      issue.id,
      issue.meetingId,
      issue.projectId,
      JSON.stringify(issue.sceneIds),
      issue.issueType,
      issue.severity,
      issue.topic,
      issue.summary,
      JSON.stringify(issue.participantPositions),
      JSON.stringify(issue.evidenceUids),
      issue.whyItMatters,
      issue.suggestedQuestion,
      issue.status,
      issue.createdAt
    );
}

export function getAlignmentIssues(meetingId: string): AlignmentIssue[] {
  const rows = db()
    .prepare(`SELECT * FROM alignment_issues_v2 WHERE meeting_id = ?`)
    .all(meetingId) as any[];

  return rows.map((r) => ({
    id: r.id,
    meetingId: r.meeting_id,
    projectId: r.project_id,
    sceneIds: JSON.parse(r.scene_ids),
    issueType: r.issue_type,
    severity: r.severity,
    topic: r.topic,
    summary: r.summary,
    participantPositions: JSON.parse(r.participant_positions),
    evidenceUids: JSON.parse(r.evidence_uids),
    whyItMatters: r.why_it_matters,
    suggestedQuestion: r.suggested_question,
    status: r.status,
    createdAt: r.created_at,
  }));
}

export function saveExplorationRecipe(recipe: ParticipantExplorationRecipe): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO exploration_recipes_v2 (
        id, issue_id, participant_id, participant_name, participant_role, interpretation,
        evidence_uids, basis, confidence, composition, subject_presence, subject_placement,
        environment, lighting, color_intent, wardrobe, props, subject_action, performance_direction,
        required_elements, prohibited_elements, version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      recipe.id,
      (recipe as any).alignmentIssueId ?? (recipe as any).issueId ?? "",
      recipe.participantId,
      recipe.participantName,
      recipe.participantRole,
      recipe.interpretation,
      JSON.stringify(recipe.evidenceUids),
      recipe.basis,
      recipe.confidence,
      recipe.composition ?? null,
      recipe.subjectPresence ?? null,
      recipe.subjectPlacement ?? null,
      recipe.environment ?? null,
      recipe.lighting ?? null,
      recipe.colorIntent ?? null,
      recipe.wardrobe ?? null,
      recipe.props ?? null,
      recipe.subjectAction ?? null,
      recipe.performanceDirection ?? null,
      JSON.stringify(recipe.requiredElements ?? []),
      JSON.stringify(recipe.prohibitedElements ?? []),
      (recipe as any).version ?? 1,
      (recipe as any).status ?? "draft",
      (recipe as any).createdAt ?? new Date().toISOString()
    );
}

export function saveConsolidatedRecipe(recipe: ConsolidatedExplorationRecipe): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO consolidated_recipes_v2 (
        id, source_issue_id, source_recipe_ids, selected_visual_elements, unresolved_fields,
        evidence_uids, compiled_prompt, created_by, created_at, version, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      recipe.id,
      recipe.sourceIssueId,
      JSON.stringify(recipe.sourceRecipeIds),
      JSON.stringify(recipe.selectedVisualElements),
      JSON.stringify(recipe.unresolvedFields),
      JSON.stringify(recipe.evidenceUids),
      recipe.compiledPrompt,
      recipe.createdBy,
      recipe.createdAt,
      recipe.version,
      recipe.status
    );
}

export function saveResolvedDecision(decision: ResolvedDecision): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO resolved_decisions_v2 (
        id, project_id, meeting_id, scene_ids, source_issue_ids, source_exploration_recipe_ids,
        source_consolidated_recipe_id, selected_visual_elements, final_answers, evidence_uids,
        decision_summary, resolved_by, resolved_at, version, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      decision.id,
      decision.projectId,
      decision.meetingId,
      JSON.stringify(decision.sceneIds),
      JSON.stringify(decision.sourceIssueIds),
      JSON.stringify(decision.sourceExplorationRecipeIds),
      decision.sourceConsolidatedRecipeId,
      JSON.stringify(decision.selectedVisualElements),
      JSON.stringify(decision.finalAnswers),
      JSON.stringify(decision.evidenceUids),
      decision.decisionSummary,
      decision.resolvedBy,
      decision.resolvedAt,
      decision.version,
      decision.status
    );
}

export function saveProductionImageRecipe(recipe: ProductionImageRecipe): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO production_image_recipes_v2 (
        id, project_id, scene_ids, source_resolved_decision_id, source_shot_recipe_id,
        version, status, composition, subject_presence, subject_placement, environment,
        lighting, color_intent, wardrobe, props, subject_action, performance_direction,
        required_elements, prohibited_elements, evidence_uids, reference_ids, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      recipe.id,
      recipe.projectId,
      JSON.stringify(recipe.sceneIds),
      recipe.sourceResolvedDecisionId,
      recipe.sourceShotRecipeId ?? null,
      recipe.version,
      recipe.status,
      recipe.composition ?? null,
      recipe.subjectPresence ?? null,
      recipe.subjectPlacement ?? null,
      recipe.environment ?? null,
      recipe.lighting ?? null,
      recipe.colorIntent ?? null,
      recipe.wardrobe ?? null,
      recipe.props ?? null,
      recipe.subjectAction ?? null,
      recipe.performanceDirection ?? null,
      JSON.stringify(recipe.requiredElements ?? []),
      JSON.stringify(recipe.prohibitedElements ?? []),
      JSON.stringify(recipe.evidenceUids),
      JSON.stringify(recipe.referenceIds),
      recipe.createdBy,
      recipe.createdAt
    );
}
