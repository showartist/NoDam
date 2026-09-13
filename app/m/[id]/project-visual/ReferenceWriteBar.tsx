"use client";

import { useState } from "react";
import type { ProjectVisualWorkspaceModel } from "./types";
import { WriteAction } from "./WriteAction";
import { useWrite } from "./WriteContext";
import { createReference, linkReferenceToScene, updateReference } from "./mutations";
import styles from "./projectVisual.module.css";

type Reference = ProjectVisualWorkspaceModel["references"][number];
type Scene = ProjectVisualWorkspaceModel["scenes"][number];

const LEVELS = ["core", "support", "candidate", "exclude"] as const;

/** Reference 한 장의 반영 수준 변경 + Scene 링크. 저장은 서버 응답 후에만 확정된다. */
export function ReferenceRowActions({ reference, scenes }: { reference: Reference; scenes: Scene[] }) {
  const { projectId, reload } = useWrite();
  const [level, setLevel] = useState(reference.adoptionLevel);
  const [sceneId, setSceneId] = useState<string>("");

  const unlinked = scenes.filter((s) => !reference.sceneIds.includes(s.id));

  return (
    <div className={styles.refWriteBar} data-testid={`reference-actions-${reference.id}`}>
      <label>
        <span>반영 수준</span>
        <select value={level} onChange={(e) => setLevel(e.target.value as Reference["adoptionLevel"])}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <WriteAction
        testId={`reference-update-${reference.id}`}
        label="반영 수준 저장"
        onSettled={reload}
        onRun={() =>
          // updateReference 는 부분 수정이 아니라 전체 교체 계약이다.
          // 바꾸지 않는 값도 현재 값 그대로 함께 보낸다 (계약을 바꾸지 않는다).
          updateReference(projectId, reference.id, {
            title: reference.title,
            sourceMethod: reference.sourceMethod,
            contentType: reference.contentType,
            adoptionLevel: level,
            referenceImageState: reference.referenceImageState,
            assetUri: reference.assetUri,
            take: reference.take,
            drop: reference.drop,
            responsibleRole: reference.responsibleRole,
            evidence: reference.evidence,
            versionLabel: reference.versionLabel,
          })
        }
      />

      {unlinked.length > 0 && (
        <>
          <label>
            <span>Scene 링크</span>
            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
              <option value="">선택</option>
              {unlinked.map((s) => (
                <option key={s.id} value={s.id}>
                  SCENE {s.sceneNumber}
                </option>
              ))}
            </select>
          </label>
          <WriteAction
            testId={`reference-link-${reference.id}`}
            label="Scene 연결"
            blocked={!sceneId}
            blockedReason={!sceneId ? "연결할 Scene 을 먼저 고르십시오." : undefined}
            onSettled={reload}
            onRun={() => linkReferenceToScene(projectId, reference.id, sceneId)}
          />
        </>
      )}
    </div>
  );
}

/** 신규 Reference 등록. 근거 없는 값을 자동으로 채우지 않는다. */
export function ReferenceCreateBar() {
  const { projectId, reload } = useWrite();
  const [title, setTitle] = useState("");

  return (
    <div className={styles.refCreateBar} data-testid="reference-create">
      <input
        value={title}
        placeholder="새 Reference 제목"
        onChange={(e) => setTitle(e.target.value)}
        aria-label="새 Reference 제목"
      />
      <WriteAction
        testId="reference-create-action"
        label="Reference 등록"
        blocked={!title.trim()}
        blockedReason={!title.trim() ? "제목을 입력하십시오." : undefined}
        onSettled={async () => {
          setTitle("");
          await reload();
        }}
        onRun={() =>
          createReference(projectId, {
            title: title.trim(),
            sourceMethod: "upload",
            contentType: "environment",
            adoptionLevel: "candidate",
            referenceImageState: "not_uploaded",
            assetUri: null,
            take: [],
            drop: [],
            responsibleRole: "art_director",
            evidence: [],
            versionLabel: "1.0",
          })
        }
      />
    </div>
  );
}
