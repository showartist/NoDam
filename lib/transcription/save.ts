/**
 * 전사 결과를 회의 발언으로 바꿔 넣는다(업로드 경로와 라이브 확정 경로가 같이 쓴다).
 *
 * 규칙(업로드 경로에서 옮김)
 *   - 교체는 트랜잭션 안에서만 한다. INSERT 가 하나라도 실패하면 롤백되어 기존 발언이 남는다.
 *   - 화자 정보가 없으면 speaker_id 는 NULL. 임의 화자를 만들지 않는다.
 *   - 새 전사가 들어오면 이전 화자 매핑은 맞지 않으므로 지운다.
 */
import { db, now, uid } from "../db";
import type { TranscriptResult } from "./types";
import { inferSpeakerNames } from "./speakerNames";

const msToClock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function replaceMeetingTranscript(meetingId: string, result: TranscriptResult, method: string): { runId: string } {
  const d = db();
  const ts = now();
  const runId = uid();
  d.exec("BEGIN IMMEDIATE");
  try {
    d.prepare(`DELETE FROM utterances WHERE meeting_id = ?`).run(meetingId);
    const ins = d.prepare(
      `INSERT INTO utterances
         (id, meeting_id, idx, uid, speaker_id, speaker_name, role,
          ts_start, ts_end, text_raw, text_clean,
          start_ms, end_ms, confidence, transcription_provider, transcription_model,
          source_file_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    result.utterances.forEach((u, i) => {
      ins.run(
        uid(), meetingId, i, `U-${String(i + 1).padStart(3, "0")}`,
        u.speakerId, u.speakerName, null,
        u.startMs != null ? msToClock(u.startMs) : null,
        u.endMs != null ? msToClock(u.endMs) : null,
        u.text, u.text,
        u.startMs, u.endMs, u.confidence,
        result.provider, result.model, result.sourceFileName, ts,
      );
    });
    d.prepare(
      `INSERT INTO transcription_runs
         (id, meeting_id, provider, model, language, source_file_name, duration_ms,
          diarization_status, speaker_count, utterance_count, method, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      runId, meetingId, result.provider, result.model, result.language,
      result.sourceFileName, result.durationMs, result.diarizationStatus,
      result.speakerCount, result.utterances.length, method, ts,
    );
    d.prepare(`DELETE FROM speaker_mappings WHERE meeting_id = ?`).run(meetingId);
    const names = result.diarizationStatus === "ok" ? inferSpeakerNames(result.utterances) : new Map<string, string>();
    for (const [speakerId, name] of names) {
      d.prepare(`INSERT INTO speaker_mappings (meeting_id, speaker_id, display_name, role, updated_at) VALUES (?,?,?,?,?)`)
        .run(meetingId, speakerId, name, null, ts);
    }
    d.exec("COMMIT");
  } catch (e) {
    try {
      d.exec("ROLLBACK");
    } catch {}
    throw e;
  }
  return { runId };
}
