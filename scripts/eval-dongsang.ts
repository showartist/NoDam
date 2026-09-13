/** 합성 평가 대본 5종을 실제 v2 LLM 경로로 평가. 사람 회의 품질·임계치 검증 자료가 아니다. */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { analyzeUtterances } from "../lib/alignment/analyze";
import { summarizeAlignmentReview } from "../lib/analysis/reviewSummary";
const U = (uid: string, spk: string, text: string) => ({ uid, idx: Number(uid.slice(2)), speakerId: spk, speakerKey: spk, speakerName: null, role: null, text, startMs: null, endMs: null });
const CASES = [
  { n:"TEST 1 — 애매한 말만 있음", expect:"HIGH 아님 (check 또는 low)", utt:[
    U("U-001","SPEAKER_01","이번 광고는 좀 심플하게 갑시다."),
    U("U-002","SPEAKER_02","네, 알겠습니다."),
  ]},
  { n:"TEST 2 — 실제 동상이몽", expect:"high + 화자별 해석 + 근거", utt:[
    U("U-001","SPEAKER_01","이번 광고는 심플하게 갑시다."),
    U("U-002","SPEAKER_02","버튼을 줄이는 쪽으로 이해했습니다."),
    U("U-003","SPEAKER_03","저는 제작비를 줄이라는 뜻인 줄 알았습니다."),
    U("U-004","SPEAKER_01","제가 말한 건 화면 디자인입니다."),
  ]},
  { n:"TEST 3 — 해결됨", expect:"low 또는 resolved (high 유지 금지)", utt:[
    U("U-001","SPEAKER_01","심플하게 갑시다."),
    U("U-002","SPEAKER_02","기능을 줄인다는 뜻인가요?"),
    U("U-003","SPEAKER_01","아니요. 화면 디자인만 단순화하자는 뜻입니다."),
    U("U-004","SPEAKER_02","네, 디자인만 단순화로 확정하죠."),
  ]},
  { n:"TEST 4 — 명확한 합의", expect:"low + issues=[]", utt:[
    U("U-001","SPEAKER_01","CTA 버튼 하나만 남기겠습니다."),
    U("U-002","SPEAKER_02","네, 파란색 CTA 하나로 확정하죠."),
    U("U-003","SPEAKER_01","좋습니다."),
  ]},
  { n:"TEST 5 — 한 사람의 자기 정정", expect:"active issues=[]", utt:[
    U("U-001","SPEAKER_01","조명은 파란색으로, 아니 흰색으로 하겠습니다."),
    U("U-002","SPEAKER_02","네 흰색 조명으로 확정하죠."),
  ]},
];

async function main() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("환경변수 OPENROUTER_API_KEY가 필요합니다. 파일에서 키를 읽거나 목업으로 대체하지 않습니다.");
  const results = [];
  for (const [index, c] of CASES.entries()) {
    try {
      const r = await analyzeUtterances({ meetingId: `synthetic-eval-${index}`, runId: `eval-${Date.now()}`,
        utts: c.utt, context: {projectTitle: "합성 광고 제작 회의", sceneLine: null, projectId: null}, contextCheck: {useCache: false} });
      const active = r.issues.filter(i => i.state === "open" || i.state === "conditional");
      const differences = active.filter(i => i.type === "interpretation_gap" || i.type === "competing_alternatives" || i.type === "constraint_conflict");
      const pass = index === 1 ? differences.some(i => new Set(i.positions.map(p => p.speaker.key)).size >= 2 && i.positions.every(p => p.evidence.length > 0))
        : index === 0 ? differences.length === 0 : index === 3 ? r.issues.length === 0 : active.length === 0;
      const item = { name: c.n, synthetic: true, pass, active: active.length, differences: differences.length,
        review: summarizeAlignmentReview(r.issues), model: r.model, latencyMs: r.latencyMs, usage: r.usage, issues: r.issues, agreements: r.agreements };
      results.push(item);
      console.log(`${pass ? "PASS" : "FAIL"} ${c.n}: active=${active.length}, differences=${differences.length}, agreements=${r.agreements.length}, ${r.latencyMs}ms`);
    } catch (e) { results.push({name: c.n, synthetic: true, pass:false, error: (e as Error).message}); console.log(`FAIL ${c.n}: ${(e as Error).message}`); }
  }
  const dir = path.resolve("docs/verification/review-20260912"); mkdirSync(dir, {recursive:true});
  writeFileSync(path.join(dir, "quality-eval.json"), JSON.stringify({at: new Date().toISOString(), dataset: "5 synthetic scenarios, live OpenRouter calls; not threshold calibration", results}, null, 2));
  console.log(`RESULT ${results.filter(r => r.pass).length}/${results.length} PASS (합성 대본·실제 API)`);
  if (results.some(r => !r.pass)) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
