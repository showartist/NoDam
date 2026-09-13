/**
 * 시연 데이터 준비. 앱과 같은 DB(.data/scenesync.db 또는 SCENENOTE_DB)에 쓴다.
 *
 *   npx tsx scripts/prepare-demo.ts            # 없는 것만 만든다
 *   npx tsx scripts/prepare-demo.ts --force    # 처음부터 다시
 *   npx tsx scripts/prepare-demo.ts --only cafe   # 과거 결정 충돌 시연만 (scene34 | cafe)
 *
 * 1. SCENE 34 회의(m_01): 시드 → 해석 차이 탐지 v2 일괄 분석(Sonnet 5 + 문맥 검사, 약 3~4분).
 * 2. 과거 결정 충돌 시연(합성 골목 카페 작품, 회의 2개):
 *    1차 회의를 분석하고 코트 색 안건을 "남색"으로 승인해 원장에 넣은 뒤, 카멜색 코트를 말하는 2차 회의를 분석한다.
 *    1차 회의 승인은 시연을 위해 이 스크립트가 대신 누른 것이므로, 승인자 이름에 그 사실을 적는다.
 *    이어서 두 회의의 인물 묘사를 모으고, 의상이 승인된 결정에서 온 인물(여주인공)의 캐릭터 초안 v1 을 그린다.
 *    시연에서 2차 회의 충돌을 "카멜색"으로 승인한 뒤 캐릭터 화면에서 v2 를 그리면 같은 사람에 코트만 바뀐다.
 *
 * 외부 호출은 모두 OpenRouter 다(키 필요). 비용은 끝에 보고값으로 적는다.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
if (ONLY && ONLY !== "scene34" && ONLY !== "cafe") throw new Error(`--only 는 scene34 또는 cafe 입니다: ${ONLY}`);
// next dev 는 .env.local 을 읽지만 tsx 는 읽지 않는다.
if (!process.env.OPENROUTER_API_KEY && existsSync(".env.local")) process.loadEnvFile(".env.local");
const CAFE_PROJECT = "p_demo_cafe";
const CAFE_1 = "m_demo_cafe_1";
const CAFE_2 = "m_demo_cafe_2";
const APPROVER = "윤도현 (감독, 시연 준비 스크립트가 대신 입력)";

const CAFE_2_TRANSCRIPT = [
  {
    uid: "U01",
    speaker: "오민지",
    role: "제작PD",
    text: "다음 주 촬영 준비 상황 공유드릴게요.",
  },
  {
    uid: "U02",
    speaker: "마준호",
    role: "미술감독",
    text: "의상팀에서 여주인공 카멜색 롱코트 두 벌 준비 끝났습니다.",
  },
  {
    uid: "U03",
    speaker: "윤도현",
    role: "감독",
    text: "좋아요. 창가 조명은 지난번대로 텅스텐으로 갑니다.",
  },
  {
    uid: "U04",
    speaker: "서가은",
    role: "촬영감독",
    text: "네, 핸드헬드는 그대로 유지하겠습니다.",
  },
  {
    uid: "U05",
    speaker: "한별",
    role: "작가",
    text: "대본 수정본은 오늘 밤에 보내 드릴게요.",
  },
  {
    uid: "U06",
    speaker: "오민지",
    role: "제작PD",
    text: "카페는 밤 11시부터 쓸 수 있다고 확정 받았습니다.",
  },
];

type Row = { uid: string; speaker: string; role: string; text: string };

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) throw new Error("OPENROUTER_API_KEY 가 없습니다. .env.local 이나 셸에 넣고 다시 실행하세요.");
  const { db, now } = await import("../lib/db");
  const { ensureSeed, reseed, DEMO_MEETING_ID } = await import("../lib/seed");
  const { runBatchAnalysis } = await import("../lib/alignment/analyze");
  const { getCurrentRun } = await import("../lib/alignment/store");
  const { resolveIssue } = await import("../lib/alignment/resolution");
  const { josa } = await import("../lib/text/josa");
  const { extractCharacterNotes, characterProfiles, drawCharacterDraft } = await import("../lib/characters");
  const d = db();
  const costs: string[] = [];
  const t0 = Date.now();

  // ── 1. SCENE 34 ─────────────────────────────────────────────
  if (ONLY !== "cafe") {
    if (FORCE) reseed(DEMO_MEETING_ID);
    else ensureSeed(DEMO_MEETING_ID);
    const m01 = FORCE ? null : getCurrentRun(DEMO_MEETING_ID);
    if (m01) {
      console.log(`SCENE 34(${DEMO_MEETING_ID}): 분석 결과가 이미 있습니다 (${m01.id}). 건너뜁니다.`);
    } else {
      console.log(`SCENE 34(${DEMO_MEETING_ID}): 일괄 분석 시작 (Sonnet 5 + 문맥 검사, 몇 분 걸립니다)`);
      const r = await runBatchAnalysis(DEMO_MEETING_ID);
      console.log(`  안건 ${r.issues.length}개 · 합의 ${r.agreements.length}개 · ${(r.latencyMs / 1000).toFixed(0)}초`);
      costs.push(`SCENE 34 $${r.usage.costUsd?.toFixed(3) ?? "?"}`);
    }
  }

  // ── 2. 과거 결정 충돌 시연 ───────────────────────────────────
  if (ONLY !== "scene34") {
    const hasLedger = (d.prepare(`SELECT COUNT(*) AS n FROM decision_ledger WHERE project_id = ?`).get(CAFE_PROJECT) as { n: number }).n > 0;
    if (hasLedger && !FORCE) {
      console.log(`과거 결정 충돌 시연(${CAFE_PROJECT}): 이미 준비돼 있습니다. 건너뜁니다.`);
    } else {
      clearCafe(d);
      const week = 7 * 24 * 3600 * 1000;
      d.prepare(`INSERT INTO projects (id, title, domain, one_line, created_at) VALUES (?,?,?,?,?)`).run(
        CAFE_PROJECT,
        "골목 카페 (합성 회의)",
        "film",
        "SCENE 18. INT. 골목 카페 – NIGHT",
        now(),
      );
      const cafe = JSON.parse(readFileSync(path.join(process.cwd(), "fixtures/eval/meetings/synth_cafe_planted.json"), "utf8"));
      addMeeting(d, CAFE_1, "1차 회의 · 톤과 의상", cafe.transcript as Row[], new Date(Date.now() - week).toISOString());

      console.log(`1차 회의(${CAFE_1}) 분석`);
      const a = await runBatchAnalysis(CAFE_1);
      costs.push(`카페 1차 $${a.usage.costUsd?.toFixed(3) ?? "?"}`);
      const coat = a.issues.find((i) => /코트/.test(`${i.decision} ${i.concept}`));
      if (!coat) throw new Error("1차 회의에서 코트 색 안건이 나오지 않았습니다. --force 로 다시 실행해 보세요.");
      const pos = coat.positions.find((p) => Object.values(p.slots).some((v) => /남색/.test(v ?? "")));
      const entry = pos && Object.entries(pos.slots).find(([, v]) => /남색/.test(v ?? ""));
      if (!pos || !entry) throw new Error(`코트 안건(${coat.issue_id})에 "남색" 값을 말한 입장이 없습니다.`);
      const [slot, value] = entry as [import("../lib/alignment/schema").SlotKey, string];
      resolveIssue({
        meetingId: CAFE_1,
        runId: a.runId,
        issueId: coat.issue_id,
        projectId: CAFE_PROJECT,
        selected: [
          {
            slot,
            value,
            speakerKey: pos.speaker.key ?? null,
            evidence: pos.evidence,
            source: "selected",
          },
        ],
        summary: `여주인공 코트는 ${value}`,
        resolvedBy: APPROVER,
      });
      console.log(`  ${coat.issue_id} "${coat.decision}" → ${josa(value, "(으)로")} 승인해 원장에 넣음`);

      addMeeting(d, CAFE_2, "2차 회의 · 촬영 준비", CAFE_2_TRANSCRIPT, now());
      console.log(`2차 회의(${CAFE_2}) 분석`);
      const b = await runBatchAnalysis(CAFE_2);
      costs.push(`카페 2차 $${b.usage.costUsd?.toFixed(3) ?? "?"}`);
      const past = b.issues.filter((i) => i.type === "past_decision_conflict");
      console.log(`  과거 결정 충돌 안건 ${past.length}개: ${past.map((i) => `${i.issue_id} ${i.decision}`).join(", ") || "없음"}`);
      console.log(`  일관성 검사: ${JSON.stringify(b.stats.consistency)}`);

      console.log("캐릭터 묘사 모으기");
      for (const m of [CAFE_1, CAFE_2]) {
        const r = await extractCharacterNotes(m);
        if (r.usage?.costUsd) costs.push(`인물 묘사 $${r.usage.costUsd.toFixed(3)}`);
        console.log(`  ${m}: 묘사 ${r.notes}개 (${r.characters.join(", ") || "인물 없음"})`);
      }
      const heroine = characterProfiles(CAFE_PROJECT).find((p) => p.aspects.wardrobe?.source.kind === "decision");
      if (heroine) {
        const d = await drawCharacterDraft({ projectId: CAFE_PROJECT, character: heroine.name, meetingId: CAFE_2 });
        costs.push(`캐릭터 v1 $${d.costUsd?.toFixed(3) ?? "?"}`);
        console.log(`  ${heroine.name} 초안 v1 (${Object.values(d.draft.description).join(", ")})`);
      } else {
        console.log("  의상이 승인된 결정에서 온 인물이 없어 초안은 그리지 않음");
      }
    }
  }

  console.log(`\n끝 (${((Date.now() - t0) / 1000).toFixed(0)}초). 비용(OpenRouter 보고값): ${costs.join(" · ") || "새 호출 없음"}`);
  console.log("열어 볼 곳 (npm run dev 또는 bash scripts/start-demo-mac.sh 로 서버를 띄운 뒤):");
  console.log(`  http://localhost:3210/m/${DEMO_MEETING_ID}/alignment`);
  console.log(`  http://localhost:3210/m/${CAFE_2}/alignment      (과거 결정 충돌)`);
  console.log(`  http://localhost:3210/m/${CAFE_2}/history        (결정 이력)`);
  console.log(`  http://localhost:3210/m/${CAFE_2}/characters     (캐릭터 초안)`);
}

function addMeeting(d: import("node:sqlite").DatabaseSync, id: string, title: string, rows: Row[], createdAt: string) {
  d.prepare(`INSERT INTO meetings (id, project_id, title, raw_transcript, created_at) VALUES (?,?,?,?,?)`).run(
    id,
    CAFE_PROJECT,
    title,
    rows.map((r) => `${r.speaker}: ${r.text}`).join("\n"),
    createdAt,
  );
  const ins = d.prepare(
    `INSERT INTO utterances (id, meeting_id, idx, uid, speaker_id, speaker_name, role, text_raw, text_clean, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  rows.forEach((r, i) => ins.run(`${id}_${i}`, id, i, r.uid, null, r.speaker, r.role, r.text, r.text, createdAt));
}

/** 카페 시연 데이터만 지운다. 다른 회의는 건드리지 않는다. */
function clearCafe(d: import("node:sqlite").DatabaseSync) {
  const ids = [CAFE_1, CAFE_2];
  const ph = ids.map(() => "?").join(",");
  const tables = (
    d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
      name: string;
    }[]
  ).map((t) => t.name);
  for (const t of tables) {
    const cols = (d.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    if (t !== "meetings" && cols.includes("meeting_id")) d.prepare(`DELETE FROM ${t} WHERE meeting_id IN (${ph})`).run(...ids);
  }
  d.prepare(`DELETE FROM meetings WHERE id IN (${ph})`).run(...ids);
  d.prepare(`DELETE FROM decision_ledger WHERE project_id = ?`).run(CAFE_PROJECT);
  d.prepare(`DELETE FROM character_drafts WHERE project_id = ?`).run(CAFE_PROJECT);
  d.prepare(`DELETE FROM character_notes WHERE project_id = ?`).run(CAFE_PROJECT);
  d.prepare(`DELETE FROM projects WHERE id = ?`).run(CAFE_PROJECT);
}

main().catch((e) => {
  console.error(`시연 준비 실패: ${(e as Error).message}`);
  process.exit(1);
});
