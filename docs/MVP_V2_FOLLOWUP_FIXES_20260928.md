# 동상이몽 v2 추가 결함 수정 — 2026-09-28

기준 커밋 ef68655의 추가 검토에서 재현한 세 결함을 수정했다. 기존 원문·확정 결정은 덮어쓰지 않았다.

| 결함·원인 | 수정 | 검증 |
|---|---|---|
| 실시간 후보에는 화자·원문 변경 검사 없음 | 분석 입력 스냅샷을 review와 같은 트랜잭션으로 저장. 발언·화자·역할·시간 변경 검사. 가져오기 및 확정 차단. 이전 리뷰는 수정 이력으로 보수적으로 검사 | 다른 화자를 같은 이름으로 수정한 후보의 import/confirm 차단. 후속 발언 추가는 기존 범위에 영향 없음. 이미 확정한 기록은 유지하고 변경 경고 표시 |
| ffmpeg 오류 무시·누락 조각 제외 | 누락 조각은 오류 반환. ffmpeg 실패·시간 초과 처리. ffprobe로 결과가 읽히는지 확인한 뒤 파일 경로 저장 | 잘못된 WAV는 502, 결과 경로 미저장. 원본 조각 보존. 정상 파일 복구 후 종료 재시도 200. 누락 조각도 실패 |
| 마지막 분석 실패에도 세션 닫음 | 마지막 구간 처리 완료를 확인하고 종료. 실패 시 종료 시각 유지·재시도 가능 상태. 이전 버전에서 stopped+failed로 끝난 세션도 종료 처리 복구 | 실패 뒤 메모리 엔진 제거 → 저장 경계부터 재개 → 실패 구간만 1회 호출. 성공 구간 중복 없음. 종료 요청 반복해도 중복 없음 |

서버·브라우저 원문 수정 알림을 연결해 새로고침 없이 실시간 후보와 결정 화면도 갱신한다. 종료 복구는 마이크를 다시 시작하지 않는다. 기존 ‘종료된 회의에 새 발언 구간 추가’ 기능과는 별개다.

## 검증 명령과 결과

```text
npx tsx --test tests/v2_followup_runtime.test.ts tests/v2_recovery_runtime.test.ts tests/live_facilitator_runtime.test.ts tests/meeting_decisions_runtime.test.ts
41 tests / 41 pass / 0 fail / exit 0

npm test
354 tests / 341 pass / 13 skipped / 0 fail / exit 0

npx tsc --noEmit --incremental false
exit 0

npm run build
exit 0
```

이번 신규 오류 시험은 별도 DB와 합성 입력·모델 응답/통신 실패 주입을 사용했다. 실제 ffmpeg·ffprobe를 실행했지만 실제 사람 목소리 및 실제 유료 모델을 다시 검증한 것은 아니다. 전체 테스트 뒤 추가한 화면 갱신 연결은 타입·빌드를 재실행하고 브라우저에서 별도 확인한다.

검증 증거는 `.data/verification/mvp-v2-followup-fixes-20260928/`에 보존한다. 외부 배포·실제 다인 장시간 회의 품질·본인 인증·같은 회의 새 구간 재개는 이번 세 결함 수정 범위 밖이다. 복구 대상은 v2 기본 진행 보조 마이크 세션이며, 별도 작업 서버를 새로 구축한 것은 아니다.

## 최종 브라우저 확인

`node /tmp/nodam-followup-browser.cjs` (보존본: 위 증거 폴더 browser.cjs) — exit 0.

```text
source-edit 200 {"ok":true}
PASS source edit immediately refreshes live review warning and disables import without reload
PASS interrupted finish retry succeeds without microphone and persists reload
pageErrors []
```

실행 주소는 `http://localhost:3212/v2`. 기존 동일 출처 검사 때문에 `127.0.0.1` 별칭으로 수정 요청 시 403이 발생했으며, 정식 localhost 주소에서 검증했다. 이는 이번 세 결함 수정과 별개인 로컬 별칭 제약으로 남긴다.
