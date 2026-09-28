# 동상이몽 팀 운영 기능 검증 — 2026-09-28

## 변경한 이유와 결과

- 참가자 응답을 진행자가 대신 입력해야 했던 한계: 참가자별 만료·회수 가능한 개인 링크와 자신의 해석·응답만 수정하는 API를 추가했다. 직접 응답과 진행자 대리 입력을 구분한다. 링크 소지 권한이며 실명 인증은 아니다.
- 외부에서 관리 화면·원문·API가 열릴 위험: 팀 운영 모드에서 진행자 인증을 전체 경로에 적용했다. 공개 참가자 API는 별도 Bearer 권한으로 검사한다. 설정 누락 시 접근을 차단한다. HTTPS 배포 구성을 추가했다.
- 회의를 종료하면 같은 회의에서 새 녹음을 시작할 수 없었던 한계: 녹음 구간별 시간 기준과 화자 후보 번호를 이어 주며 종료 시점의 누적 기록을 별도 보존한다. 마지막 구간만으로 전체 전사를 덮어쓰는 작업은 차단한다.
- 운영 데이터 보존: SQLite 온라인 백업·무결성 검사 스크립트와 영속 볼륨 설치 지침을 추가했다. 음성 파일은 별도 전체 데이터 백업이 필요하다.
- 배포 패키지 검사에서 발견한 취약점: Next.js 16.3.6으로 업데이트하고 취약한 이미지 디코더 의존성을 제거했다. Sharp로 제한된 크기의 픽셀을 읽은 뒤 기존 Vibrant 색상 계산 알고리즘에 전달한다.

## 실행 명령과 실제 결과

### 전체 회귀 검사

`npm test` — exit 0. 여러 테스트 실행기의 합계:

```text
tests 360
pass 347
skipped 13
fail 0
```

기존 건너뜀 13개는 그대로이며 기대값을 완화하거나 테스트를 삭제하지 않았다. 새 운영 기능 검사에는 합성 DB와 장애 주입을 사용했다. 전체 로그: `.data/verification/team-operations-20260928/full-test.log`.

`npx tsx --test tests/images_pipeline.test.ts` — exit 0:

```text
tests 28
pass 28
fail 0
skipped 0
```

색상 추출 검사는 합성 두 색 PNG의 실제 픽셀에서 색상을 추출하고 저장한 결과를 확인한다.

`npx tsc --noEmit` — exit 0, 출력 없음.

`npm run build` — exit 0, Next.js 16.3.6, Proxy 및 참가자/회의 API 경로 생성 확인.

`npm audit --omit=dev --json` — exit 0:

```json
{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}
```

이는 실행 시점의 의존성 알려진 취약점 검사 결과이며 애플리케이션 보안 전체를 인증한 의미는 아니다.

### 실제 브라우저 3개 세션

`node /tmp/nodam-team-browser.cjs` — exit 0. 최종 빌드, 로컬 HTTPS 프록시, 진행자 및 두 참가자의 독립 Chrome 세션. 합성 회의 사용. 스크립트와 로그를 검증 폴더에 보존했다.

```text
PASS anonymous management denied; public join reveals no meeting data
PASS two isolated participant browsers save their own meanings; tokens removed from URL
PASS disagreement blocks confirmation
PASS individual responses reach a confirmed decision without facilitator impersonation
PASS foreign participant writes denied and revoked link immediately rejected
browserErrors [] meetingId bijz58hvpr15
```

### 실제 전사 API와 이어 녹음

`node /tmp/nodam-continue-browser.cjs` — exit 0. 합성 한국어 음성을 Chrome 가상 마이크로 입력하고 실제 OpenRouter API를 호출했다. 사람이 현장에서 말한 다인 회의 검증은 아니다.

```text
MEETING h30quc5cgfnj
PASS actual STT segment 1 cumulative turns 2 baseMs 0
PASS actual STT segment 2 cumulative turns 4 baseMs 23904
PASS earlier snapshot unchanged; browserErrors []
```

이 API 검사는 의존성 보안 업데이트 전 실행했다. 이후 화자 후보 번호 충돌 방지와 의존성 변경은 전체 회귀 검사 및 최종 빌드로 확인했다. 같은 유료 API 검사를 재실행했다고 주장하지 않는다.

## 현재 가동과 남은 운영 검증

- 최종 빌드를 localhost:3212에 재가동했다. 기존 회의 DB를 유지했고 교체 전 녹음 중인 세션이 없음을 확인했다.
- 외부 운영 서버·도메인은 아직 연결하지 않았다. Docker/Caddy가 이 Mac에 설치되어 있지 않아 컨테이너 실제 실행·공인 TLS 발급은 미검증이다.
- 서버 한 개, 한 팀 운영을 대상으로 한다. 다중 서버 분산 큐나 여러 회사의 계정 체계는 포함하지 않는다.
- 실제 팀원의 장시간 다인 회의에서 전사 정확도·화자 구분·해석 차이 오탐률과 네트워크 장애 복구를 최종 확인해야 한다.
- 자동 예약 백업은 등록하지 않았다. 운영 설치 후 별도 저장소의 백업·복원 절차가 필요하다.

설치와 데이터 보존 방법: [TEAM_OPERATIONS.md](TEAM_OPERATIONS.md).
