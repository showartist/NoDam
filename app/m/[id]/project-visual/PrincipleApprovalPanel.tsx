"use client";

import type { ProjectVisualWorkspaceModel } from "./types";
import { WriteAction } from "./WriteAction";
import { participantFor, useWrite } from "./WriteContext";
import { approveVersion, createPrincipleVersion, runCascade, withdrawApproval } from "./mutations";
import { MissingRole } from "./WorkspaceStates";
import styles from "./projectVisual.module.css";

type Principle = ProjectVisualWorkspaceModel["principles"][number];

/**
 * 감독·제작 공동 승인 / 철회 / 새 버전 생성.
 *
 * 승인 규칙은 서버가 판정한다. 이 화면은 결과를 표시할 뿐 승인 여부를 계산하지 않는다.
 * 철회는 기존 승인 레코드를 덮어쓰지 않고 withdrawn 이력으로 남는다.
 */
export default function PrincipleApprovalPanel({
  principle,
  blocked,
  blockingReasons,
}: {
  principle: Principle;
  /** 감독·제작 active 승인이 모두 있기 전에는 공동 승인(확정 전파)을 막는다. */
  blocked: boolean;
  blockingReasons: string[];
}) {
  const { projectId, participants, reload } = useWrite();
  const version = principle.currentVersion;

  if (!version) {
    return <div className={styles.inlineEmpty}>현재 버전이 없어 승인을 진행할 수 없습니다.</div>;
  }

  const active = (role: "director" | "producer") =>
    principle.approvals.find((a) => a.role === role && a.status === "active") ?? null;

  const rows: Array<{ role: "director" | "producer"; label: string }> = [
    { role: "director", label: "감독" },
    { role: "producer", label: "제작" },
  ];

  return (
    <div className={styles.approvalPanel} data-testid="principle-approval-panel" data-version-id={version.id}>
      {rows.map(({ role, label }) => {
        const person = participantFor(participants, role);
        const approval = active(role);

        if (!person) {
          // 참여자가 없으면 승인자를 지어내지 않는다.
          return (
            <div key={role} className={styles.approvalRow}>
              <span>{label}</span>
              <MissingRole role={`${label} 참여자 미등록`} />
            </div>
          );
        }

        return (
          <div key={role} className={styles.approvalRow} data-role={role}>
            <span>
              {label} · {person.name}
            </span>
            {approval ? (
              <>
                <b data-testid={`approval-active-${role}`}>승인됨</b>
                <WriteAction
                  testId={`withdraw-${role}`}
                  label="승인 철회"
                  onSettled={reload}
                  onRun={() =>
                    withdrawApproval(projectId, principle.id, {
                      versionId: version.id,
                      approvalId: approval.id,
                      approverId: person.id,
                      reason: "화면에서 철회함",
                    })
                  }
                />
              </>
            ) : (
              <>
                <b data-testid={`approval-pending-${role}`}>승인 대기</b>
                <WriteAction
                  testId={`approve-${role}`}
                  label={`${label} 승인`}
                  onSettled={reload}
                  onRun={() =>
                    approveVersion(projectId, principle.id, {
                      versionId: version.id,
                      approverId: person.id,
                      role,
                    })
                  }
                />
              </>
            )}
          </div>
        );
      })}

      <div className={styles.approvalRow}>
        <span>공동 승인 · 확정 전파</span>
        <WriteAction
          testId="joint-approve"
          label="공동 승인 후 변경 영향 계산"
          blocked={blocked}
          blockedReason={blockingReasons.join(" · ")}
          onSettled={reload}
          onRun={() =>
            runCascade(projectId, principle.id, {
              version: {
                id: `${version.id}_confirmed_${version.versionNumber}`,
                versionNumber: version.versionNumber,
                principleText: version.principleText,
                rationale: version.rationale,
                contentHash: `${version.id}_confirmed`,
              },
            })
          }
        />
      </div>

      <div className={styles.approvalRow}>
        <span>새 버전</span>
        <WriteAction
          testId="create-version"
          label="새 Principle Version 생성"
          onSettled={reload}
          onRun={() =>
            createPrincipleVersion(projectId, principle.id, {
              versionNumber: version.versionNumber + 1,
              principleText: version.principleText,
              rationale: version.rationale,
              changeSummary: "화면에서 새 버전 생성",
              evidence: version.evidence,
              contentHash: `${version.id}_next_${version.versionNumber + 1}`,
              createdBy: participantFor(participants, "director")?.id ?? null,
            })
          }
        />
      </div>
    </div>
  );
}
