"use client";

import { useState } from "react";
import type { ProjectVisualWorkspaceModel } from "./types";
import { WriteAction } from "./WriteAction";
import { participantFor, useWrite } from "./WriteContext";
import { decideQuestion } from "./mutations";
import styles from "./projectVisual.module.css";

type Question = ProjectVisualWorkspaceModel["decisionQuestions"][number];

/**
 * 결정 질문 확정. AI 가 아니라 사람이 고른다.
 * 결정자는 참여자 ID 로 기록한다 — 이름 문자열로 관계를 만들지 않는다.
 */
export default function DecisionWriteBar({ question }: { question: Question }) {
  const { projectId, participants, reload } = useWrite();
  const [option, setOption] = useState("");
  const director = participantFor(participants, "director");

  if (question.state === "decided") {
    return (
      <div className={styles.decisionDecided} data-testid={`question-decided-${question.id}`}>
        <b>결정됨</b>
        <span>{question.decidedOption}</span>
        <small>
          {question.decidedBy ?? "결정자 미기록"} · {question.decidedAt ?? "시각 미기록"}
        </small>
      </div>
    );
  }

  return (
    <div className={styles.decisionWriteBar} data-testid={`question-decide-${question.id}`}>
      <input
        value={option}
        placeholder="사람이 고른 결정 내용"
        onChange={(e) => setOption(e.target.value)}
        aria-label="결정 내용"
      />
      <WriteAction
        testId={`question-decide-action-${question.id}`}
        label="결정 확정"
        blocked={!option.trim() || !director}
        blockedReason={
          !director ? "감독 참여자가 없어 결정자를 지정할 수 없습니다." : !option.trim() ? "결정 내용을 입력하십시오." : undefined
        }
        onSettled={async () => {
          setOption("");
          await reload();
        }}
        onRun={() =>
          decideQuestion(projectId, question.id, {
            decidedOption: option.trim(),
            decidedBy: director!.id,
          })
        }
      />
    </div>
  );
}
