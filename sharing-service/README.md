# 동상이몽 · 팀 공유용 읽기 서비스

기존 공개 Sites에서 사용하는 실시간 스냅샷 API·읽기 화면·D1 저장 구조의 소스 사본입니다. 개발 이력의 원본은 별도 Sites 저장소에 있으며, 이 폴더는 팀원이 전체 시스템을 함께 검토하도록 포함했습니다.

- `worker/index.js`: 공유 ID별 스냅샷 조회·갱신·종료. 쓰기는 `SHARE_WRITE_KEY` 인증이 필요합니다.
- `public/live.html`, `public/live.js`: `/live/<공유 ID>` 읽기 전용 화면.
- `db/`, `drizzle/`: D1 스키마와 기존 마이그레이션.
- `scripts/build.mjs`: Worker 빌드.

```bash
cd sharing-service
npm ci
npm run build
node --experimental-strip-types --test worker/share.test.mjs
```

`.openai/hosting.json`은 기존 Sites 프로젝트 식별·논리 DB 바인딩만 담습니다. 인증키나 배포 권한은 포함하지 않습니다. 빌드만으로 공개 배포되지는 않습니다. 기존 Sites 프로젝트를 변경하려면 별도의 권한과 해당 배포 절차가 필요합니다.

개인 회의 원문과 분석 내용이 포함된 공개 회의 아카이브의 `data.js`, `share.js`, `index.html`은 이 코드 사본에 넣지 않았습니다. 따라서 이 폴더는 실시간 공유 API와 `/live/<공유 ID>` 경로를 위한 소스이며 `/`의 과거 회의 아카이브 화면은 제공하지 않습니다. 예시 데이터를 실제 전사인 것처럼 넣지 않았습니다.

현재 공유 서버 인증 설정과 실제 외부 전송 검증은 미완료입니다. 키가 없는 쓰기 요청은 실패하도록 구현되어 있습니다.
