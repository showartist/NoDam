#!/usr/bin/env node
// 실제 LLM 반복 검증 — 근거 정확도와 상태 안정성이 흔들리지 않는지 본다.
//
//   npm run verify:llm                 # 전체 자료 3회씩
//   npm run verify:llm -- --runs 5     # 회차 지정
//   npm run verify:llm -- --only scene27
//
// 성공 기준 (하나라도 어기면 실패)
//   잘못된 U-ID 참조   0건
//   승인 없는 confirmed 0건
//   허구 Intent 생성   0건   (근거 발언 없는 의도)
//   동일 Intent 중복   0건
//   저장 실패          0건
//   필수 Intent 누락   장면당 1건 이하
//
// 결과가 매번 달라질 수는 있다. 흔들리면 안 되는 것은 근거와 상태 규칙이다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE = process.env.SCENENOTE_URL ?? "http://localhost:3210";
const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const RUNS = Number(arg("runs", 3));
const ONLY = arg("only", null);
// --dry-run: 키 없이 하니스 자체(수집·판정·집계)가 도는지만 본다.
// 모델 품질 검증이 아니므로 통과해도 1단계를 마쳤다고 말하면 안 된다.
const DRY = args.includes("--dry-run");

if (!process.env.ANTHROPIC_API_KEY && !DRY) {
  console.error(
    "ANTHROPIC_API_KEY 가 없습니다.\n" +
      "이 검증은 실제 모델 호출이 목적이므로 픽스처 스텁으로는 의미가 없습니다.\n" +
      "app/.env.local 에 키를 넣고 dev 서버를 재시작한 뒤 다시 실행하세요.",
  );
  process.exit(2);
}

// ── 검증 자료 수집 ────────────────────────────────────────────
async function materials() {
  const dir = path.join(ROOT, "fixtures", "film");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".transcript.md"));
  const out = [];

  // 활성 시드(SCENE 12)도 자료에 포함한다.
  const seed = JSON.parse(await readFile(path.join(dir, "scene12_motel_room.json"), "utf8"));
  out.push({
    id: "scene12_motel_room",
    title: seed.project.title,
    oneLine: seed.project.one_line,
    participants: seed.project.participants,
    transcript: seed.transcript,
    expectIntents: ["key_action", "last_image", "key_object"],
  });

  for (const f of files) {
    const md = await readFile(path.join(dir, f), "utf8");
    const body = md.includes("## 회의 전사") ? md.split("## 회의 전사")[1].trim() : md;
    const meta = /<!--\s*verify:\s*(\{[\s\S]*?\})\s*-->/.exec(md);
    out.push({
      id: f.replace(".transcript.md", ""),
      title: /^#\s*(.+)$/m.exec(md)?.[1]?.trim() ?? f,
      oneLine: null,
      participants: [],
      transcript: body,
      ...(meta ? JSON.parse(meta[1]) : {}),
    });
  }
  return ONLY ? out.filter((m) => m.id.includes(ONLY)) : out;
}

// ── 한 회차 ───────────────────────────────────────────────────
async function runOnce(m) {
  const violations = [];
  const create = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `[검증] ${m.title}`,
      domain: "film",
      oneLine: m.oneLine ?? "",
      participants: m.participants ?? [],
      transcript: m.transcript,
    }),
  });
  if (!create.ok) {
    violations.push(`저장 실패: 회의 생성 ${create.status}`);
    return { violations, uids: 0 };
  }
  const { meetingId, utteranceCount } = await create.json();

  const ex = await fetch(`${BASE}/api/meetings/${meetingId}/extract`, { method: "POST" });
  const body = await ex.json();
  if (!ex.ok) {
    violations.push(`저장 실패: 추출 ${ex.status} — ${body.error ?? ""}`);
    return { violations, uids: utteranceCount, meetingId };
  }
  if (!DRY && body.provider !== "claude") {
    violations.push(`실제 모델이 아닌 ${body.provider} 로 실행됨`);
    return { violations, uids: utteranceCount, meetingId };
  }

  // 저장된 결과를 다시 읽어 규칙을 검사한다.
  const rep = await fetch(`${BASE}/api/report/${meetingId}?role=all&format=json`);
  if (!rep.ok) {
    violations.push(`저장 실패: 결과 조회 ${rep.status}`);
    return { violations, uids: utteranceCount, meetingId };
  }
  const report = await rep.json();
  const flat = JSON.stringify(report);

  // 1) 잘못된 U-ID 참조 — 전사 범위를 벗어난 근거
  const referenced = [...flat.matchAll(/\bU(\d{1,3})\b/g)].map((x) => Number(x[1]));
  const bad = [...new Set(referenced.filter((n) => n < 1 || n > utteranceCount))];
  if (bad.length) violations.push(`잘못된 U-ID 참조: ${bad.map((n) => "U" + n).join(", ")}`);

  // 2) 승인 없는 confirmed
  const cov = await fetch(`${BASE}/api/verify/state?meetingId=${meetingId}`);
  if (cov.ok) {
    const st = await cov.json();
    if (st.confirmedWithoutApproval > 0)
      violations.push(`승인 없는 confirmed ${st.confirmedWithoutApproval}건`);
    if (st.verifiedWithoutApproval > 0)
      violations.push(`승인 없는 coverage verified ${st.verifiedWithoutApproval}건`);
    if (st.duplicateIntentTypes > 0)
      violations.push(`동일 Intent 중복 ${st.duplicateIntentTypes}건`);
    if (st.intentsWithoutEvidence > 0)
      violations.push(`허구 Intent(근거 없음) ${st.intentsWithoutEvidence}건`);

    // 3) 필수 Intent 누락 — 장면당 1건 이하
    const expected = m.expectIntents ?? ["key_action", "last_image"];
    const missing = expected.filter((t) => !st.intentTypes.includes(t));
    if (missing.length > 1) violations.push(`필수 Intent 누락 ${missing.length}건: ${missing.join(", ")}`);
    return { violations, uids: utteranceCount, meetingId, intents: st.intentTypes, missing };
  }
  violations.push("상태 검사 엔드포인트를 호출하지 못했습니다.");
  return { violations, uids: utteranceCount, meetingId };
}

// ── 실행 ──────────────────────────────────────────────────────
const mats = await materials();
if (!mats.length) {
  console.error("검증 자료가 없습니다 (fixtures/film/*.transcript.md).");
  process.exit(2);
}

console.log(
  DRY
    ? `[DRY-RUN] 하니스 점검만 합니다. 모델 품질 검증이 아닙니다.\n검증 자료 ${mats.length}건 × ${RUNS}회 — ${BASE}\n`
    : `검증 자료 ${mats.length}건 × ${RUNS}회 — ${BASE}\n`,
);
let totalFail = 0;

for (const m of mats) {
  console.log(`■ ${m.id}`);
  for (let i = 1; i <= RUNS; i++) {
    let r;
    try {
      r = await runOnce(m);
    } catch (e) {
      r = { violations: [`예외: ${e.message}`] };
    }
    const ok = r.violations.length === 0;
    if (!ok) totalFail++;
    console.log(
      `  ${i}회차 ${ok ? "✓ 통과" : "✕ 실패"}` +
        (r.intents ? ` · 의도 ${r.intents.join("/")}` : "") +
        (r.missing?.length ? ` · 누락 ${r.missing.join(",")}` : ""),
    );
    for (const v of r.violations) console.log(`     - ${v}`);
  }
  console.log("");
}

const total = mats.length * RUNS;
console.log(
  totalFail === 0
    ? `전체 통과 — ${total}회차 모두 근거·상태 규칙을 지켰습니다.`
    : `실패 ${totalFail} / ${total}회차. 위 위반 항목을 확인하세요.`,
);
if (DRY) {
  console.log(
    "\n[DRY-RUN] 이 결과는 하니스 점검용입니다. 스텁이 없는 자료는 실패로 나오는 것이 정상입니다.",
  );
  console.log("실제 검증: .env.local 에 ANTHROPIC_API_KEY 를 넣고 dev 서버 재시작 후");
  console.log("  npm run verify:llm -- --runs 3");
}
process.exit(totalFail === 0 ? 0 : 1);
