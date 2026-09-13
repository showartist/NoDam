// 기대출력_A_붉은만장.json(정답 파일) → 4일차 추출 스키마로 투영해 픽스처를 만든다.
// 정답 파일이 갱신되면 이 스크립트를 다시 돌린다. 손으로 고치지 않는다.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");

const golden = JSON.parse(await readFile(path.join(root, "기대출력_A_붉은만장.json"), "utf8"));
const transcript = await readFile(path.join(root, "테스트전사_A_붉은만장.md"), "utf8");

const pick = (o) => ({
  content: o.content,
  decision_state: o.decision_state === "confirmed" ? "candidate" : o.decision_state,
  evidence: o.evidence ?? [],
  confidence: o.confidence ?? "low",
  ...(o.note ? { note: o.note } : {}),
});

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const core = golden.scene_core;
const scene_core = {
  purpose: asArray(core.purpose).map(pick),
  emotion: asArray(core.emotion).map(pick),
  characters: asArray(core.characters).map(pick),
  space: asArray(core.space).map(pick),
  time: asArray(core.time).map(pick),
  references: asArray(core.references).map(pick),
  constraints: asArray(core.constraints).map(pick),
};

const questionText = Object.fromEntries(golden.questions.map((q) => [q.id, q.text]));

const extraction = {
  scene_core,
  decisions: golden.decisions.map((d) => ({ id: d.id, ...pick(d) })),
  unresolved: golden.unresolved.map((n) => ({
    id: n.id,
    subject: n.subject,
    evidence: n.evidence ?? [],
    question: questionText[n.question] ?? "확인이 필요한 항목입니다.",
  })),
};

await mkdir(path.join(here, "..", "fixtures"), { recursive: true });
await writeFile(
  path.join(here, "..", "fixtures", "extraction.json"),
  JSON.stringify(extraction, null, 2) + "\n",
);
await writeFile(
  path.join(here, "..", "fixtures", "sample.json"),
  JSON.stringify(
    {
      project: {
        title: golden.project.title,
        domain: golden.project.domain,
        one_line: golden.project.one_line,
        participants: golden.participants.map((p) => ({ name: p.name, role: p.role })),
      },
      transcript,
    },
    null,
    2,
  ) + "\n",
);

const n = (o) => Object.values(o).reduce((a, v) => a + v.length, 0);
console.log(
  `fixtures/extraction.json — scene_core ${n(scene_core)} · decisions ${extraction.decisions.length} · unresolved ${extraction.unresolved.length}`,
);
console.log(`fixtures/sample.json — 전사 ${transcript.split("\n").length}줄`);
