/** 이미 분석한 회의 ID를 인자로 준다. 실제 서버 API와 SSR 화면의 집계를 대조한다. */
import assert from "node:assert/strict";
const base = process.env.SCENENOTE_URL ?? "http://localhost:3210";
async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("사용법: npx tsx scripts/verify-review-ui.ts <분석된-회의-ID>");
  const r = await fetch(`${base}/api/meetings/${encodeURIComponent(id)}/analyze-v2`);
  assert.equal(r.status,200); const data = await r.json();
  assert.equal(data.status,"completed"); assert.ok(data.review); assert.ok(!("index" in data)); assert.ok(!("score" in data.review));
  const page = await fetch(`${base}/m/${encodeURIComponent(id)}/alignment`);
  assert.equal(page.status,200); const html = await page.text();
  const summary = html.match(/<p[^>]*data-testid="review-summary"[^>]*>([\s\S]*?)<\/p>/)?.[1].replace(/<[^>]*>/g, "");
  assert.ok(summary,"서버가 실제 요약 요소를 렌더해야 함");
  assert.match(summary,new RegExp(`확인 필요 안건 ${data.review.pendingIssues}건`));
  assert.ok(summary.includes(data.review.coverage == null ? "비교 항목 없음" : `${data.review.coverage}%`));
  assert.match(summary,new RegExp(`판정 ${data.review.compared}쌍`));
  if (data.issues.length) assert.ok(/data-testid="issue-comparison-counts"/.test(html));
  const visible = html.replace(/<script[\s\S]*?<\/script>/g,"").replace(/<[^>]*>/g,"");
  assert.ok(!/동상이몽 지수|\d+\s*\/\s*100|\d+점/.test(visible),"점수 표기가 남아 있으면 안 됨");
  console.log(`PASS ${id}: API=${JSON.stringify(data.review)}; rendered=${summary}`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
