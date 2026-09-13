# SceneNote 실시간 구현·검증 — 2026-09-12

정본: `/Users/emotioncontents/Downloads/NoDam`. 사용자 결정 B를 유지한다. 근거 없는 0–100 동상이몽 지수는 다시 넣지 않는다.

## 구현과 근본 원인

| 문제/근본 원인 | 변경 | 검증 |
|---|---|---|
| 녹음 완료 후에만 업로드하는 흐름으로는 진행 중 검토가 불가능 | 20초 독립 MediaRecorder 파일을 순차 업로드·Opus 변환·실제 Grok STT. 전사와 목적 검토 큐 분리 | 210초 가상 마이크 실행에서 종료 전 전사 22개·3분 검토 1회, 종료 후 23개·검토 2회 |
| 목적을 고정하지 않은 발언 수 창 분석 | 시작 전 목적 고정, 3/5/10분 창 선택, 매 호출 원문 기준 재주입 | 목적 검증 및 경계 테스트, 실제 전사 81발언 4창 재실행 |
| 단일 모델 후보를 바로 경보로 제시 | UID·원문 연속 인용 검증, 사례·농담 제외, 현재 구간 근거, 화자 조건, 90초 지속·최근 근거, 재질문 중복 억제. 후보가 통과할 때만 추가 모델 검수 | 정책 13개 합성 테스트 + 실제 API 합성 지속 이탈 대조군 |
| 새로고침·전송 오류 때 메모리만으로 녹음 유실 | 1초마다 IndexedDB 임시 저장. 조각 완료/접수 상태 저장. 원본 서버 저장 후 202. 재연결 시 원래 시작 시각 복원 | 12초 녹음 후 새로고침, 복구 후 7초 녹음. 조각 0/12243ms, 2개 전사, 검토 1회 |
| 실패 조각 뒤의 성공 조각이 순서를 앞지름·재전송 중복 | 앞선 실패가 있으면 대기, 같은 오프셋 해시 중복 제거, 성공 처리 DB 원자화, 서버 재시작 복구, 재시도/새 입력 경합 중복 방지 | 실패 주입 런타임: failed+queued, 종료 거부, 재시작 후 순서 유지, 복구 후 0/1000/2000ms 각 1회 |
| 전사가 실패해도 종료 완료로 보임 | 미처리 조각 존재 시 409와 복구 안내, 활성 세션 유지 | 런타임 stopSession 실패 재현 및 회복 검사 |
| 앱 상단에서 실시간 기능을 찾기 어려움 | 상단 실시간 회의 버튼, 목적·주기·전사·근거·복구 화면 연결 | 브라우저 실제 렌더링/조작 |
| 공유본은 정적 회의만 열람 | 공유 앱 디자인, 원문 검색·관점 비교·근거 이동. 명시적으로 켠 회의만 5초마다 서버 snapshot 전송, 팀원 화면 3초 갱신, 공유 종료 | 합성 권한·순서·삭제 테스트, 로컬 팀원 화면 23발언·2검토·검색·모바일 검사. **실제 외부 쓰기는 비밀키 승인 대기** |

## 실행 증거

모든 아래 로그는 `.data/verification/realtime-20260912/`에 보관했다. 실제 회의 원문과 원시 분석은 Git에 넣지 않는다.

- `npx tsc --noEmit` → exit 0 (`tsc.log`).
- `npm test` → exit 0. 각 Node 테스트 러너 합산 **296 tests / 283 pass / 13 skip / 0 fail** (`npm-test.log`). 기존 기준선269/256/13보다 통과 수 증가. 별도 자체 assert 스크립트도 성공했다.
- `npm run build` → exit 0 (`build.log`).
- `npx tsx --test tests/facilitator.test.ts tests/live_facilitator_runtime.test.ts tests/live_sharing_runtime.test.ts` → **15 pass / 0 fail**. API 응답을 주입한 **합성 런타임 검사**이며 모델 품질 검사가 아니다.
- 사이트에서 `node --test worker/share.test.mjs` → **1 pass / 0 fail**. 실제 SQLite에 생성된 SQL 적용, HTTP 핸들러 호출. D1 클라우드 자체 검증은 아니다.
- `node /tmp/scenenote-browser-periodic.cjs` → exit 0. **합성 한국어 음성을 Chrome 가상 마이크에 넣었으며 실제 MediaRecorder·ffmpeg·OpenRouter STT·Claude API를 실행했다. 물리 마이크 검사는 아니다.** 재사용 가능한 스크립트 사본도 보관했다.

```text
DURING_RECORDING: recording, utterances=22, completed chunks=10
AFTER_STOP: stopped, utterances=23, reviews=2,
  IndexedDB chunks=11, all complete=true and accepted=true, errors=[]
STT latency on first 10 chunks: 785–2245 ms (녹음 20초 및 전송 시간 별도)
```

- `node /tmp/scenenote-browser-recovery.cjs`의 수정 후 재실행 결과 (`scenenote-browser-recovery-retry.log`):

```text
status=stopped; chunks: offset_ms 0,12243; both done;
utterances=2; reviews=1; errors=[]
```

- `node /tmp/scenenote-share-live-ui.cjs` → `PASS: synthetic share, 23 turns, 2 reviews, search, desktop/mobile, no browser errors`.
- `npx tsx .data/verification/realtime-20260912/eval.ts` → 실제 사용자가 승인한 81발언, 4창 처리, exit 0 (`final-actual.log`, `actual-results.json`).
- `npx tsx .data/verification/realtime-20260912/positive-eval.ts` → 합성 지속 이탈에 실제 API 호출, `topic_drift`와 중립적 복귀 질문 및 verifier supported, exit 0 (`final-positive.log`).

## 실제 원문 분석 결과와 한계

최종 실제 전사 실행은 05:00 알림 없음, 10:00 알림 없음, 15:00 수치화 의미를 확인하는 meaning_gap 질문, 16:29 종료 검토 알림 없음이었다. 이 4창 실행의 공급자 반환 비용 합계는 $0.064512. 이 결과를 정답률이나 보편적 회의 효율 향상으로 해석하지 않는다.

확인된 모델 한계: 요약에서 제안을 합의처럼 서술하거나, 끝부분의 본론 복귀를 off_topic으로 분류할 수 있다. 원문 인용이 정확해도 의미 해석은 틀릴 수 있다. UI는 요약을 `AI 구간 요약 · 합의 확정 아님`, 발견 항목을 `후보`로 표시하며 자동 합의 저장을 하지 않는다. 최초 검증 실패·이전 결과도 보존했다. 90초와 두 관찰 주기 중복 억제는 초기 운영 규칙이며 통계적으로 보정된 임계치가 아니다.

3분 녹음 검사 중 일부 한국어 TTS 구간이 영어로 전사된 공급자 결과도 있었다. 실제 다인 한국어 화자 분리·언어 정확도는 미검증이다. 화자 연결 근거가 없는 서로 다른 조각의 `C1-SPEAKER_01`/`C2-SPEAKER_01`을 서로 다른 사람으로 단정하지 않는다. 장치가 잠들거나 탭이 닫히면 새 음성은 수집할 수 없고, 마지막 1초 미만 미저장 음성은 보장하지 않는다.

## 실행 방법

기존 운영 DB 대신 이 검증에서 사용한 DB를 유지하려면:

```sh
cd /Users/emotioncontents/Downloads/NoDam
SCENENOTE_DB="$PWD/.data/capstone-reviewed-20260912/test.db" SCENENOTE_DATA_DIR="$PWD/.data/capstone-reviewed-20260912/data" npm run dev
```

기존 프로세스가 3210을 사용 중이면 중복 실행하지 않는다. 앱 상단 `실시간 회의` → `새 라이브 회의` → 목적 입력 → 주기 선택 → `마이크로 회의 시작`. 녹음 중 원문을 보며, 정지 시 마지막 조각과 분석 완료를 기다린다. 실패하면 저장된 녹음 재전송 후 종료한다. 마이크 입력은 브라우저 권한과 HTTPS 또는 localhost가 필요하다.

## 외부 공유의 남은 단계

기존 공개 앱: https://scenenote-meeting-20260912-01070f.emotioncontents.chatgpt.site

공유 사이트 소스는 작업실 `04_OUTPUTS/scenenote-meeting-share-20260912`에 있다. Node/ffmpeg 기반 녹음·AI 호출은 NoDam 로컬 서버가 수행하고, 공개 사이트는 선택한 회의의 원문·검토를 받아 보여준다. OpenRouter 키는 공개 사이트로 이전하지 않는다. 읽기 링크는 192비트 임의 식별자를 사용하며, 익명 쓰기는 서버가 거부한다.

**자동 승인 검토가 공유용 비밀키 생성·설정 작업을 거부했다.** 이유는 작업실의 인증정보 승인 요건 및 평문 출력 가능성이다. 실제 키 생성/설정은 수행하지 않았다. 이 기능을 완료했다고 보고하면 안 된다.

승인 후 할 일: 전용 `SHARE_WRITE_KEY` 생성 → 사용자 화면/소스 코드에 값을 표시하지 않고 NoDam `.data/sharing/config.json`(0600) 및 해당 Sites 프로젝트의 비밀 환경변수에 설정 → 같은 버전 재배포 → 합성 회의를 실제 서버로 공유·갱신·취소하는 종단 검사 → 실제 물리 마이크는 사용자 참석 하에 별도 확인. 사이트 project_id는 `appgprj_6aa4f152d4a08191bab1a76971602563`이며 새 사이트를 만들지 않는다.

공유 중에는 진행자 화면이 열려 있어야 한다. 팀원이 읽기 링크에서 직접 녹음하거나 원격으로 AI를 실행하는 별도 클라우드 호스트 기능은 포함하지 않았다.
