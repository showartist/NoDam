// Mutation 테스트 — 배선 계약 테스트가 실제로 회귀를 잡는지 확인한다.
//
// "테스트가 추가됐다"는 통과했다는 뜻이 아니라, 끊었을 때 실패한다는 뜻이다.
// 이번에 실제로 발생한 회귀를 그대로 재현해 각각이 잡히는지 본다.
//
//   npm run test:mutation
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 경로에 한글이 있으면 URL.pathname 은 퍼센트 인코딩된다. fileURLToPath 를 쓴다.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PAGE = new URL("../app/m/[id]/page.tsx", import.meta.url);
const WB = new URL("../app/m/[id]/Workbench.tsx", import.meta.url);

/** 각 변이는 실제로 있었던(또는 있을 수 있는) 배선 사고 하나를 재현한다. */
const MUTATIONS = [
  {
    name: "page.tsx 가 intentCoverage 를 아예 전달하지 않음",
    file: PAGE,
    apply: (s) => s.replace(/\n\s*intentCoverage=\{bundle\.intentCoverage\}/, ""),
  },
  {
    name: "Workbench 가 intentCoverage 를 optional 로 되돌림",
    file: WB,
    apply: (s) => s.replace("intentCoverage: IntentCoverageViewModel;", "intentCoverage?: IntentCoverageViewModel;"),
  },
  {
    name: "흩어진 optional prop 이 되살아남",
    file: WB,
    apply: (s) =>
      s.replace(
        "  intentCoverage: IntentCoverageViewModel;",
        "  intentCoverage: IntentCoverageViewModel;\n  coverageReports?: unknown[];",
      ),
  },
  {
    name: "Intent Coverage 패널이 렌더되지 않음",
    file: WB,
    apply: (s) => s.replace('data-testid="intent-coverage-panel"', ""),
  },
  {
    name: "빈 상태와 오류 상태를 같은 UI 로 합침",
    file: WB,
    apply: (s) => s.replace('data-testid="intent-coverage-error"', 'data-testid="intent-coverage-empty"'),
  },
];

const runContract = () => {
  try {
    execFileSync("node", ["tests/wiring-contract.mjs", "--static-only"], {
      cwd: ROOT,
      stdio: "pipe",
    });
    return { passed: true };
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    const m = /AssertionError.*?: (.+)/.exec(out);
    return { passed: false, reason: m?.[1]?.trim() ?? "실패" };
  }
};

// 정상 상태에서 먼저 통과하는지 확인한다.
const baseline = runContract();
if (!baseline.passed) {
  console.error(`기준 상태에서 이미 실패합니다: ${baseline.reason}`);
  process.exit(2);
}
console.log("기준 상태 ✓ 통과\n");

let survived = 0;
for (const m of MUTATIONS) {
  const original = readFileSync(m.file, "utf8");
  const mutated = m.apply(original);
  if (mutated === original) {
    console.log(`  ✕ ${m.name}\n     변이가 적용되지 않았습니다 (대상 코드를 못 찾음).`);
    survived++;
    continue;
  }
  writeFileSync(m.file, mutated);
  const r = runContract();
  writeFileSync(m.file, original); // 항상 되돌린다

  if (r.passed) {
    console.log(`  ✕ ${m.name}\n     끊었는데 테스트가 통과했습니다. 계약이 비어 있습니다.`);
    survived++;
  } else {
    console.log(`  ✓ ${m.name}\n     잡힘: ${r.reason}`);
  }
}

console.log("");
if (survived === 0) {
  console.log(`변이 ${MUTATIONS.length}건 모두 검출됨 — 배선 계약이 실제로 작동합니다.`);
  process.exit(0);
}
console.log(`변이 ${survived}/${MUTATIONS.length}건이 살아남았습니다. 계약을 보강하세요.`);
process.exit(1);
