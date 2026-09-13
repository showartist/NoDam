# 진행 동의와 의견 일치 분리 — 2026-09-13

## 근본 원인
기존 공동 결정은 agree 이외의 모든 응답을 차단해, 의견이나 우려가 남아 있어도 진행에는 동의하는 경우를 표현하지 못했다. 사용자가 제공한 01:12 발언과 후속 ‘보완해’ 지시에 따라 진행 동의와 생각의 일치를 구분했다.

## 변경
- 진행 동의 / 우려를 남기고 진행 동의 / 추가 논의 필요 / 판단 보류·확인 필요를 표시한다.
- 우려를 남긴 동의에는 별도의 우려 입력이 필수이며 서버도 공백 입력을 거부한다.
- 전원이 현재 결정안에 진행 동의 또는 우려를 남긴 진행 동의를 기록하면 확정할 수 있다. 미응답·추가 논의·판단 보류는 여전히 차단한다.
- 우려는 참가자 응답, 확정 스냅샷, 실행 과제 화면, 변경 이력과 JSON 내보내기에 보존한다.
- 결정안 변경 시 기존 응답은 재확인이 필요하며 이전 우려는 변경 이력에 남는다.
- 기존 agree/disagree/uncertain 데이터를 자동 동의로 바꾸거나 삭제하지 않는다. 기존 데이터에는 concern이 없어도 읽을 수 있다.

## 실제 검증
```text
npx tsx --test tests/meeting_decisions_runtime.test.ts
  tests 16 / pass 16 / fail 0, exit 0
npx tsc --noEmit
  exit 0
npm test
  합계 312 tests / 299 pass / 13 skip / 0 fail, exit 0
npm run build
  exit 0
node /tmp/scenenote-concerns-ui.cjs decision-check-1789288502802
  {"meetingId":"decision-check-1789288502802","revision":11,"participants":2,"questions":1,"taskDone":true,"errors":[],"mobileOverflow":false}
```
이전 309/296/13/0에서 3개 테스트가 추가됐으며 기존 검사를 삭제하거나 완화하지 않았다.
브라우저에서 합성 참가자 A 동의·B 추가 논의 차단 → 결정안 수정 → A 동의·B 우려를 남긴 동의 → 확정 → 과제 완료 → 새로고침 → 우려의 화면·내보내기 보존을 확인했다. 모바일 가로 넘침과 브라우저 오류가 없었다.
원출력·스크립트·스크린샷·JSON: `.data/verification/concerns-20260913/`.

## 범위
이번 검증은 합성 회의이며 외부 AI를 호출하지 않았다. 실제 참가자의 이해나 자발적 동의를 인증하는 기능이 아니다. 진행자가 기록한다. 변경은 로컬 NoDam 앱에 적용했으며 외부 실시간 연결과 현장 품질 검증은 여전히 남아 있다.
