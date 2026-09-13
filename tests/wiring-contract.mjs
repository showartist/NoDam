// UI 배선 계약 테스트
//
// 이 테스트가 존재하는 이유:
//   page.tsx 가 Workbench 로 Intent Coverage 를 넘기지 않아도
//   타입 검사와 빌드가 통과하고 Shot Board 패널만 조용히 비어버린 회귀가 실제로 발생했다.
//   타입보다 한 단계 위인 "렌더 결과 계약"으로 막는다.
//
//   npm run test:wiring          # 정적 + 렌더 (서버 필요)
//   npm run test:wiring -- --static-only
//
// mutation 확인: npm run test:mutation
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const BASE = process.env.SCENENOTE_URL ?? "http://localhost:3210";
const STATIC_ONLY = process.argv.includes("--static-only");

let checks = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

const page = read("../app/m/[id]/page.tsx");
const workbench = read("../app/m/[id]/Workbench.tsx");
const intents = read("../lib/intents.ts");
const store = read("../lib/store.ts");

// ── 1. 조회 → 뷰모델 생성 ──────────────────────────────────────
ok(
  intents.includes("export function buildIntentCoverageViewModel"),
  "Intent Coverage 뷰모델을 만드는 전용 함수가 필요합니다.",
);
ok(
  store.includes("intentCoverage: buildIntentCoverageViewModel("),
  "store 가 뷰모델을 완성해 노출해야 합니다.",
);
for (const f of ["reports", "gaps", "productionImpacts", "loadError"]) {
  ok(intents.includes(`${f}:`), `뷰모델에 ${f} 가 필요합니다.`);
}

// ── 2. page.tsx → Workbench 전달 ───────────────────────────────
// page.tsx 는 810a056(cross-meeting fallback 오염 제거)에서 병합된 "finalBundle" 을
// 없애고 "bundle" 하나만 쓰도록 단순화됐다 — 변수명을 그 이후 어휘로 갱신한다.
ok(
  /intentCoverage=\{[^}]*bundle\.intentCoverage/.test(page),
  "page.tsx 가 Workbench 에 intentCoverage 를 전달해야 합니다.",
);

// ── 3. 필수 prop — optional 금지 ───────────────────────────────
ok(
  /intentCoverage: IntentCoverageViewModel;/.test(workbench),
  "Workbench props 에 intentCoverage 가 필수로 선언되어야 합니다.",
);
ok(
  !/intentCoverage\?:/.test(workbench),
  "intentCoverage 는 optional 이 될 수 없습니다. 배선이 끊겨도 빌드가 통과합니다.",
);
// 흩어진 옛 prop 이 되살아나면 다시 하나씩 빠뜨릴 수 있다.
for (const legacy of ["coverageReports?:", "coverageGaps?:", "productionImpacts?:"]) {
  ok(
    !workbench.includes(legacy),
    `흩어진 optional prop '${legacy}' 이 되살아났습니다. 뷰모델 하나로 유지하세요.`,
  );
}

// ── 4. 빈 배열 fallback 으로 장애를 숨기지 않는다 ────────────────
ok(
  !/intentCoverage=\{[^}]*\?\?\s*\{/.test(page.replace(/\s+/g, " ")) ||
    page.includes("loadError:"),
  "fallback 을 쓰더라도 loadError 로 장애를 구분해야 합니다.",
);
ok(
  workbench.includes("intent-coverage-error") && workbench.includes("intent-coverage-empty"),
  "빈 상태와 조회 실패를 다른 UI 로 구분해야 합니다.",
);

// ── 4-1. 렌더 앵커가 소스에 존재하는가 (정적) ───────────────────
// 렌더 검사는 서버가 필요하다. 앵커 자체가 지워지는 회귀는 정적으로도 잡는다.
for (const id of [
  "intent-coverage-panel",
  "coverage-report-",
  "coverage-verify-action",
  "production-impact-panel",
]) {
  ok(workbench.includes(id), `렌더 앵커 data-testid="${id}" 가 Workbench 에서 사라졌습니다.`);
}

// ── 4-2. 쇼트 최종 승인 배선 ────────────────────────────────────
// 실제로 났던 회귀 3건을 그대로 계약으로 박는다. 셋 다 타입 검사와 빌드를 통과했다.
//
//   (1) approveShot 이 정의만 되고 버튼에 연결되지 않아, 눌러도 아무 일도 없었다.
//   (2) 화면이 image_state 를 스스로 "generated" 로 만들어 승인 버튼을 열었다.
//       DB 는 not_generated 라서 서버(store.updateShot)가 400 을 돌려주므로,
//       버튼은 열려 있는데 누르면 실패하는 상태가 됐다.
//   (3) image_url 이 없을 때 /images/shot{n}.png 로 대체했는데 그 파일들은 다른 장면
//       사진이라, 수영장 콘티 설명 밑에 모텔방 사진이 붙었다.
ok(
  /onClick=\{\(\)\s*=>\s*approveShot\(/.test(workbench),
  "최종 승인 버튼이 approveShot 에 연결돼 있어야 합니다 (정의만 있고 호출부가 없던 회귀).",
);
ok(
  /const imageState\s*=\s*[^;]*\.image_state\b/.test(workbench),
  "imageState 는 DB 의 image_state 컬럼에서 읽어야 합니다.",
);
ok(
  !/const imageState\s*=\s*[^;]*\?\s*"generated"/.test(workbench),
  "image_state 를 화면에서 합성하면 안 됩니다. DB 값을 그대로 써야 승인 버튼과 서버 규칙이 일치합니다.",
);
ok(
  !workbench.includes("/images/shot${"),
  "이미지 없는 쇼트를 다른 장면의 정적 파일로 대체하면 안 됩니다.",
);

// ── 4-3. 가짜 성공 경로 금지 ────────────────────────────────────
// 실제로 났던 사고를 계약으로 박는다.
//   업로드한 오디오를 버리고 하드코딩된 수영장 회의 4줄을 "전사 완료"로 저장했고,
//   동상이몽 엔진은 실제 분석 결과를 지우고 고정 3건으로 덮었으며,
//   호출한 적 없는 Claude 모델명이 실행 기록에 남았다.
const sttRoute = read("../app/api/meetings/[id]/audio-transcribe/route.ts");
const detRules = read("../lib/domain/alignmentCheck/deterministicRules.ts");

ok(
  !/인물 없는 텅 빈 수영장|서민재\(촬영감독\)|오세라\(미술감독\)/.test(sttRoute),
  "전사 라우트에 하드코딩된 회의 대사가 있으면 안 됩니다.",
);
ok(
  /getTranscriptionProvider\(\)/.test(sttRoute) && /processAudioBatch\(job/.test(sttRoute)
    && /new OpenRouterTranscriptionProvider\(\)\.transcribe\(/.test(read("../lib/transcription/long.ts")),
  "전사 라우트는 실제 전사 공급자를 호출해야 합니다.",
);
ok(
  !/중간발표 데모용|issues\.length = 0/.test(detRules),
  "동상이몽 엔진이 실제 결과를 지우고 고정 안건을 주입하면 안 됩니다.",
);
ok(
  !/claude-[\w.-]*\s*\(Ready for/.test(detRules),
  "호출하지 않은 모델명을 실행 기록에 남기면 안 됩니다.",
);
const transcription = read("../lib/transcription/index.ts");
ok(
  /throw new TranscriptionError\(\s*\n?\s*"NOT_CONFIGURED"/.test(transcription),
  "키가 없으면 NOT_CONFIGURED 를 던져야 합니다.",
);
ok(
  !/^\s*import .*fixture/im.test(transcription),
  "전사 계층이 fixture 모듈을 import 하면 안 됩니다 (자동 대체 경로).",
);

// ── 4-4. 화자 정보가 동상이몽 분석까지 도달하는가 ────────────────
// speaker_id 를 빼고 분석하면 LLM 은 떨어진 두 발언이 같은 사람인지 알 수 없다.
const analyzer = read("../lib/analysis/dongsangAnalyzer.ts");
ok(
  /u\.speakerId/.test(analyzer) && /\$\{u\.uid\} \| \$\{who\}/.test(analyzer),
  "LLM 입력에 'U-001 | SPEAKER_01' 형태로 화자 식별자가 들어가야 합니다.",
);
ok(
  /SPEAKER_xx/.test(analyzer),
  "같은 SPEAKER 를 한 사람으로 묶으라는 지침이 프롬프트에 있어야 합니다.",
);

// ── 5. 렌더 계약 ───────────────────────────────────────────────
if (!STATIC_ONLY) {
  const shotboard = await fetch(`${BASE}/m/m_01?tab=shotboard`).then((r) => r.text());
  const previs = await fetch(`${BASE}/m/m_01?tab=previs`).then((r) => r.text());

  ok(shotboard.includes("intent-coverage-panel"), "Shot Board 에 Intent Coverage 패널이 렌더되어야 합니다.");
  ok(
    !shotboard.includes("intent-coverage-empty"),
    "SCENE 12 시드는 의도 3건을 가지므로 빈 상태가 나오면 안 됩니다.",
  );
  ok(!shotboard.includes("intent-coverage-error"), "조회 오류가 렌더되면 안 됩니다.");

  for (const id of ["INT-01", "INT-02", "INT-03"]) {
    ok(shotboard.includes(`coverage-report-${id}`), `${id} 커버리지 카드가 렌더되어야 합니다.`);
  }
  const reportCount = (shotboard.match(/coverage-report-INT-\d+/g) ?? []).length;
  ok(reportCount >= 3, `커버리지 카드가 3개 이상이어야 합니다 (현재 ${reportCount}).`);

  ok(
    shotboard.includes("coverage-verify-action"),
    "감독 확인 액션이 최소 1개 렌더되어야 합니다.",
  );
  ok(previs.includes("production-impact-panel"), "Previs 에 변경 영향 패널이 렌더되어야 합니다.");
}

console.log(
  `배선 계약 검사 통과 — ${checks}개 항목${STATIC_ONLY ? " (정적만)" : " (정적 + 렌더)"}`,
);
