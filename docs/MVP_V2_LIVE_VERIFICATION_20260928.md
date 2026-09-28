# 동상이몽 v2 실제 연결 검증 — 2026-09-28

## 범위와 원인

기존 v2는 입력·저장과 분석 버튼까지만 제공했고, 마이크·오디오·뜻 확인은 이전 화면으로 이동했다. 회의 전체 AI 결과를 뜻 확인 카드로 옮기는 서버 명령도 없었다. 따라서 화면을 여러 번 옮기고 질문·근거를 다시 입력해야 했다.

## 변경

- v2 마이크 회의에 기존 MediaRecorder·IndexedDB·실시간 전사·관찰 엔진을 직접 연결했다. 종료 처리 성공 후 저장된 전사와 결과를 새로 읽는다.
- v2 녹음 업로드에 실제 multipart 업로드 → 전사 조각 처리 → DB 저장을 연결했다. 진행률, 실패 내용과 저장된 작업 이어서 처리를 표시한다.
- 전체 분석 후보를 질문·원문 인용과 함께 뜻 확인 카드로 가져온다. 회의/분석 소유 관계, 완료 여부, 최신성, 현재 원문 일치를 검사하고 같은 후보의 중복 등록을 막는다.
- 인용에 실제로 있는 공통 표현만 비교 대상으로 준비한다. 참가자의 뜻·동의·확정은 자동 입력하지 않는다. 가상 자료의 실제 확인 차단도 유지한다.
- 실시간 후보는 같은 페이지 아래에 뜻 확인 화면을 연다. 페이지 이동으로 녹음 컴포넌트를 제거하지 않는다.
- 녹음 중 전체 분석과 중복 전체 분석 요청을 서버에서 거절한다. 실행 중 분석은 화면에서 주기적으로 상태를 새로 읽는다.

## 실제 API 검증

모든 검증 자료는 합성 텍스트와 macOS Yuna 합성 음성이다. 실제 참석자의 회의·동의가 아니다. API 응답 자체는 목업이 아니다. 별도 검증 DB를 사용했으며 기존 회의 원문을 덮어쓰지 않았다.

### 텍스트 분석

`POST /api/meetings/8cncdvq17r4d/analyze-v2`, 실제 OpenRouter 호출:

```text
elapsedSeconds: 51.42
status: completed
model: anthropic/claude-sonnet-5
issues: 3
calls: 4
promptTokens: 10542
completionTokens: 5261
costUsd: 0.066142
```

기능 축소와 인력 추가로 갈린 ‘빠른 출시’의 뜻, 결제 기능 포함 여부, 추가 인력 예산 미확인을 반환했다. 이는 이 합성 입력 한 건의 결과이며 일반 정확도 수치가 아니다.

정식 빌드에서도 `node /tmp/nodam-production-check.cjs`로 v2의 분석 버튼을 직접 눌러 실제 호출 → 후보 가져오기 → 해석 비교 카드 → 새로고침을 검증했다.

```text
status: PASS
actualApi: true
model: anthropic/claude-sonnet-5
issues: 3
elapsedSeconds: 56.612
calls: 4
costUsd: 0.070833
errors: []
```

결과: `/v2/m/8cncdvq17r4d/decisions?question=stf4on8ww7f1`. API 검증과 브라우저 버튼 검증은 별도 두 번의 실제 요청이다. 응답 원본은 `text-analysis.json`, `production-analysis.json`에 보관한다.

### 녹음 업로드

`node /tmp/nodam-v2-browser.cjs`로 v2 파일 선택 → 업로드·전사 버튼을 조작했다.

```text
Actual file transcription: PASS x1im3v66mddb 1
provider: openrouter
model: x-ai/grok-stt-1.0
duration_ms: 29533
utterance_count: 1
diarization_status: unsupported
method: chunked+none
```

처음 만든 음성 파일은 PCM 데이터가 없어 업로드가 400으로 실패했다. 시스템 음성 엔진 접근을 허용해 29.533초 파일을 다시 생성한 후 위 결과를 얻었다. 실패 응답을 성공으로 대체하지 않았다.

`unsupported`는 이 처리 결과에서 회의 전체의 화자 구분을 확정하지 않았다는 뜻이다. 전사 모델 자체가 화자분리를 전혀 지원하지 않는다는 뜻은 아니다. 자동 화자 ID·실명 정확도는 이 시험으로 검증하지 않았다.

### 가상 마이크, 실제 실시간 처리

같은 브라우저 스크립트에서 Chrome의 가상 마이크에 합성 음성을 반복 공급했다. 실제 `getUserMedia` → MediaRecorder → 조각 업로드 → 전사 API → 관찰 분석 경로를 실행했다. 사람의 물리적 마이크 시험이 아니다.

```text
Virtual microphone started: xbe7qj9imfbt
Periodic real AI review during recording: PASS recording 1
Virtual microphone real API: PASS
turns: 17
chunks: 11, 모두 done
reviews: 2
Horizontal overflow false
page errors: []
```

- 종료 전 상태가 `recording`일 때 첫 검토가 저장됨: 0~180000ms, `partial=false`, 새 발언 15개.
- 종료 검토: 180000~210387ms, `partial=true`, 새 발언 2개.
- 첫 검토는 출시 범위·예산 확인에 관한 요약을 반환했고, 확인 후보는 0건이었다. 한 목소리의 반복 시험을 서로 다른 실제 사람의 갈등 탐지 성공으로 해석하지 않는다.
- 3분 주기를 실제 경과시킨 검증이다. 5분·10분 주기는 이번에 각각 경과 시험하지 않았다.

### 녹음을 유지하는 UI 연결

`node /tmp/nodam-inline-check.cjs`는 **합성 후보와 응답을 주입한 UI 한정 회귀 시험**이다. 위 실제 API 시험과 구분한다.

```text
PASS: synthetic UI-only candidate opens inline, URL unchanged,
recorder component retained, page errors=0.
This test does not verify live microphone input.
```

## 코드 검증

```text
npx tsc --noEmit --incremental false
exit 0

npx tsx --test tests/meeting_decisions_runtime.test.ts tests/v2_analysis_import_runtime.test.ts
tests 30 / pass 30 / fail 0

npm test
tests 337 / pass 324 / skipped 13 / fail 0
exit 0

npm run build
exit 0
```

전체 테스트 수는 14개 TAP 출력 그룹의 합계다. 이전 331개/318통과/13건너뜀에서 6개 검증이 추가됐다. 원문 변경, 타 회의의 분석, 미완료·과거 분석, 중복 등록, 동의 자동 생성 방지, 녹음·중복 분석의 서버 차단을 검사한다. 저장된 AI 출력 기반 테스트는 합성 데이터이고 네트워크를 호출하지 않는다.

## 증거 위치와 남은 범위

로컬 `.data/verification/mvp-v2-live-20260928/`에 실제 응답, 종료 전후 상태, 브라우저 실행 스크립트·로그, 화면 캡처, 타입·전체 테스트·빌드 로그를 보관한다. 원문·음성·응답을 공개 저장소에 올리지 않는다.

실제 다인 회의의 장시간 안정성, 물리적 마이크·브라우저별 권한, 화자 구분·실명·탐지 정확도, 참가자 본인 인증, v2 외부 배포는 미검증 또는 후속 범위다. 현재 실행 주소는 `http://localhost:3212/v2`이며 외부 공개 사이트와 같지 않다.
