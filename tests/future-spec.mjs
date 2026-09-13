// 미구현 기능 사양 테스트 — 아직 짓지 않은 기능을 미리 적어둔 계약이다.
//
// tests/scenenote-contract.mjs(현재 제품 계약)와 분리하는 이유:
//   미구현 기능 때문에 npm test 가 항상 실패하면, "진짜 회귀"와 "아직 안 지은 기능"을
//   구분할 수 없어진다. 여기 있는 assertion 은 실패해도 이 스위트 자체는 실패로 끝내지
//   않는다(pending) — 대신 어떤 게 아직 pending 인지, 혹시 이미 구현돼서 통과하기
//   시작했는지(승격 대상)를 보고한다.
//
// 규칙:
//   - 여기로 옮긴 assertion 의 조건문·메시지는 원본(tests/scenenote-contract.mjs 커밋 이력)
//     그대로 둔다. 통과시키려고 조건을 약화하지 않는다.
//   - 기능이 실제로 구현되면 해당 pending() 을 tests/scenenote-contract.mjs 로 다시 옮기고
//     ok() 로 승격한다.
//   - 여기서 "예상대로 아직 실패"는 정상이다. "예상과 달리 통과"가 나오면 승격 대상 신호다.
//
//   npm run test:spec
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const types = read("../lib/types.ts");
const workbench = read("../app/m/[id]/Workbench.tsx");
const prompt = read("../lib/extract/prompt.ts");

const PENDING = [];
let total = 0;
/** feature: 승격/보고 시 묶어서 볼 그룹 키. cond/label 은 원본 assertion 을 그대로 옮긴 것. */
const pending = (feature, cond, label) => {
  total++;
  PENDING.push({ feature, cond: !!cond, label });
};

// ── regenerate 액션 UI (인수인계 "Real-time DB Mutation" 작업의 일부) ──────────
// keep/request_revision/regenerate 는 API(lib/store.ts, resolveSceneIssue)에만 있고
// 화면에 선택 UI가 없다.
pending(
  "regenerate-action-ui",
  types.includes("새 버전 생성"),
  "regenerate 는 '새 버전 생성' 으로 표기해야 합니다.",
);

// ── 레퍼런스 반영 수준 4단계 (무드보드 퍼센트 제거의 대체 기능) ───────────────
// 퍼센트 가중치는 이미 제거됐다(tests/scenenote-contract.mjs 에 남아 통과 중). 그 자리를
// 대체하기로 했던 정성적 4단계 라벨은 아직 어디에도 없다 — 이 기능을 유지할지 제품 결정 필요.
for (const token of ["핵심 반영", "부분 반영", "참고", "제외"]) {
  pending(
    "reference-adoption-level",
    types.includes(token),
    `레퍼런스 반영 상태 '${token}' 가 필요합니다.`,
  );
}

// ── AI 추출 파이프라인 (인수인계 "AI Extractor 엔진") ──────────────────────────
// lib/extract/prompt.ts, lib/types.ts EXTRACTION_SCHEMA 가 전부 스텁이다.
pending(
  "ai-extraction-pipeline",
  prompt.includes("절대 출력하지 않는다"),
  "추출 프롬프트가 confirmed 출력을 금지해야 합니다.",
);
pending(
  "ai-extraction-pipeline",
  types.includes('required: ["scene_brief", "decisions", "unresolved", "intents"]'),
  "추출 스키마가 intents 를 요구해야 합니다.",
);
pending(
  "ai-extraction-pipeline",
  prompt.includes("key_object"),
  "프롬프트가 세 의도를 지시해야 합니다.",
);
for (const t of ["key_action", "last_image", "key_object"]) {
  pending("ai-extraction-pipeline", prompt.includes(t), `프롬프트에 ${t} 지시가 필요합니다.`);
}

// ── 대시보드 대표 컷 UI ────────────────────────────────────────────────────
// 백엔드(is_representative 컬럼, REPRESENTATIVE_SHOT_COUNT, pickRepresentative)는 이미
// 구현돼 있으나 화면에 대표 여부를 보여주거나 지정하는 UI가 없다.
pending(
  "dashboard-representative-shot-ui",
  workbench.includes("shownOnDashboard"),
  "대시보드 대표 컷과 전체 목록을 구분해야 합니다.",
);
pending(
  "dashboard-representative-shot-ui",
  workbench.includes("대표 지정"),
  "사용자가 대표 여부를 지정할 수 있어야 합니다.",
);

// ── 보고 ──────────────────────────────────────────────────────────────────
const stillPending = PENDING.filter((p) => !p.cond);
const unexpectedlyPassing = PENDING.filter((p) => p.cond);
const features = [...new Set(PENDING.map((p) => p.feature))];

console.log(`미구현 기능 사양 — ${total}개 항목, ${features.length}개 기능\n`);
for (const feature of features) {
  const items = PENDING.filter((p) => p.feature === feature);
  const donePending = items.filter((i) => !i.cond).length;
  console.log(`  [${feature}] ${items.length - donePending}/${items.length} 이미 충족`);
}
console.log("");

if (stillPending.length) {
  console.log(`⏳ 예상대로 아직 pending (${stillPending.length}건):`);
  stillPending.forEach((p) => console.log(`   - [${p.feature}] ${p.label}`));
}
if (unexpectedlyPassing.length) {
  console.log(`\n🎉 예상과 달리 이미 통과함 — tests/scenenote-contract.mjs 로 승격 검토 (${unexpectedlyPassing.length}건):`);
  unexpectedlyPassing.forEach((p) => console.log(`   - [${p.feature}] ${p.label}`));
}

// pending 은 실패로 취급하지 않는다 — 이 스위트는 항상 0으로 끝난다.
// (미구현이 있다는 사실 자체가 이 명령의 실패 조건이 되면 "미구현=회귀"와 다시 섞인다.)
process.exit(0);
