# 동상이몽 MVP v2 공개 코드 전달 — 2026-09-28

로컬 개발 기준 `fd4c5bc`의 v2 변경을 공개 저장소의 `bd18188` 위에 선별해 반영했다. 로컬 전체 Git 이력은 원본 회의·기획 자료를 포함하므로 전송하지 않는다. app/lib/scripts/tests/sidecar/public/sharing-service의 공개 대상 소스가 로컬과 일치하는지 바이트 단위로 대조했다.

## 포함 범위

- 회의 준비, 텍스트·음성·마이크 입력, 원문 저장과 분석 연결
- 분석 실패 복구, 원문·화자 수정, 오래된 분석 표시, 녹음 종료 처리 재시도
- 참가자 개인 링크, 직접 해석·응답, 진행자 인증, 같은 회의 이어 녹음 및 종료 기록 보존
- 운영 설치 구성, DB 백업 도구, 테스트와 구현·검증 문서

API 키·운영 비밀번호·개인 DB·원문 회의·음성·영상·PDF·로컬 실행 로그는 추가하지 않았다. 비밀값 패턴 검사에 걸린 기존 테스트 한 곳은 example 호스트의 오류 응답 유출 방지용 가짜 DB URL이었다.

## 별도 공개 사본에서 재실행

```text
npm ci: exit 0, found 0 vulnerabilities
npm test: exit 0, tests 360 / pass 347 / skipped 13 / fail 0
npm run build: exit 0 (Next.js 16.3.6)
npx tsc --noEmit: exit 0
```

실제 API·브라우저 검증 기록과 한계: [팀 운영 검증](TEAM_OPERATIONS_VERIFICATION_20260928.md). 이번 업로드 과정에서는 유료 API 검사를 재실행하지 않았다.

외부 서버 배포 및 실제 다인 장시간 회의 품질 검증은 아직 남아 있다. GitHub에 코드를 올리는 것은 실행 서버 배포와 다르다. [설치 안내](TEAM_OPERATIONS.md)를 따른다.
