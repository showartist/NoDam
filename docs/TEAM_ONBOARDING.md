# 팀원 온보딩

## 1. 시작 전에 읽을 문서

다음 순서로 읽으면 프로젝트의 출처, 현재 상태, 작업 위치를 빠르게 이해할 수 있습니다.

1. [KAIST 제공 공식 기획안](기획안/4조_씬노트_기획서.md)
2. [프로젝트 배경](PROJECT_BACKGROUND.md)
3. [현재 구현 상태](CURRENT_STATUS.md)
4. [아키텍처](ARCHITECTURE.md)
5. [파트별 연동 가이드](PART_INTEGRATION_GUIDE.md)

## 2. 저장소 받고 실행하기

```bash
git clone https://github.com/muskccat/NoDam.git
cd NoDam
npm ci
cp .env.example .env.local     # OPENROUTER_API_KEY 를 채웁니다
npm run dev
```

**http://localhost:3210** 을 엽니다. (3000이 아닙니다.)

- **Node.js 22 이상** 이 필요합니다. 로컬 DB 가 Node 내장 `node:sqlite` 를 씁니다.
- 별도 DB 설치나 초기화 명령이 없습니다. 첫 접속 시 `.data/scenesync.db` 가 자동 생성되고 데모 회의가 시드됩니다.
- 키가 없어도 앱은 뜹니다. 전사·분석만 `NOT_CONFIGURED` 오류를 냅니다. 가짜 결과로 대체하지 않습니다.

```bash
npm test           # 현재 제품 계약
npm run test:spec  # 미구현 기능의 예정 스펙 (실패해도 exit 0)
npm run build
```

## 3. 내 작업 위치 찾기

| 담당 | 시작 위치 | 지금 그 자리를 채우고 있는 코드 |
| --- | --- | --- |
| STT·화자 분리 | `1-2_오디오_입력_전사_화자분리/` | `lib/transcription/providers/openrouter.ts` (동작 중) |
| 구조화·동상이몽 분석 | `3_동상이몽_신호_분석_엔진/` | `lib/analysis/dongsangAnalyzer.ts` (동작 중) |
| 경보·진단 | `4_경보_진단_로직/` | `lib/score.ts`, `lib/shot_approval.ts` |
| 이미지·콘티 생성 | `5_파일럿_생성/` | `lib/domain/imageGeneration/` (골격만, 미호출) |
| 대시보드 UI | `6_실시간_대시보드/` | `app/m/[id]/` |
| API·DB·배포 | `7_통합_인프라/` | `lib/db.ts`, `lib/repositories/` |

새로 짜기 전에 오른쪽 파일을 먼저 읽어보시면 입출력 형태를 빨리 파악할 수 있습니다.

## 4. 첫 작업 권장 순서

1. 담당 폴더 README 에 목표와 입력·출력 예시를 적습니다.
2. 작은 샘플 하나로 독립 실행되는 최소 코드를 만듭니다.
3. 성공 사례와 실패 사례를 테스트로 남깁니다.
4. [파트별 연동 가이드](PART_INTEGRATION_GUIDE.md) 의 공통 필드를 사용해 결과를 JSON 으로 출력합니다.
5. 새 브랜치에서 작업하고 Pull Request 로 공유합니다.

## 5. 첫 PR 완료 기준

- 설치와 실행 명령이 README 에 있음
- 샘플 입력과 예상 출력이 있음
- 최소 한 개의 자동 테스트 또는 재현 가능한 수동 검증 절차가 있음
- **API 키와 개인정보가 커밋되지 않음** — `.env.local` 은 `.gitignore` 에 있지만 `git add -A` 는 쓰지 말고 파일을 지정해서 add 하세요
- 사전 준비 데이터와 실제 API 결과가 구분되어 있음

## 6. 이 저장소에서 지키는 두 가지 규칙

두 규칙 모두 `npm test` 로 강제됩니다. 어기면 빌드가 아니라 테스트가 막습니다.

1. **없는 데이터를 있는 것처럼 채우지 않는다.**
   키가 없으면 샘플로 대체하지 않고 오류를 냅니다. 화자를 모르면 `null` 이며 임의 화자를 만들지 않습니다.
2. **화면이 상태를 지어내지 않는다.**
   DB 에서 읽은 값만 씁니다. 화면에서 계산해 만든 상태로 버튼을 열면 서버가 거부합니다.

과거에 업로드한 오디오를 버리고 고정 대사를 "전사 완료" 로 저장하던 코드가 있었고, 그 사고 때문에 생긴 규칙입니다.

협업 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md) 를 따릅니다.
