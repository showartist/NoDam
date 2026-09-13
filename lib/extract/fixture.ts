// 픽스처 모드 — API 키 없이 신규 회의 파이프라인을 끝까지 돌리기 위한 LLM 스텁.
// 실제 호출과 동일하게 문자열을 반환하고, 같은 검증 파이프라인을 통과한다.
//
// 여러 전사를 지원한다. 회의의 발언 ID 집합을 보고, 그 안에서만 근거를 쓰는
// 스텁을 고른다. 맞는 스텁이 없으면 실패한다 — 조용히 아무거나 돌려주지 않는다.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type Candidate = { name: string; raw: string; uids: Set<string> };

let cache: Candidate[] | null = null;

function collectUids(node: unknown, out: Set<string>) {
  if (Array.isArray(node)) {
    for (const v of node) collectUids(v, out);
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "evidence" && Array.isArray(v)) v.forEach((u) => out.add(String(u)));
      else collectUids(v, out);
    }
  }
}

async function load(): Promise<Candidate[]> {
  if (cache) return cache;
  const dir = path.join(process.cwd(), "fixtures", "film");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".extraction.json"));
  cache = await Promise.all(
    files.map(async (name) => {
      const raw = await readFile(path.join(dir, name), "utf8");
      const uids = new Set<string>();
      collectUids(JSON.parse(raw), uids);
      return { name, raw, uids };
    }),
  );
  return cache;
}

export async function callFixture(attempt: number, validUids: Set<string>): Promise<string> {
  await new Promise((r) => setTimeout(r, 300)); // 호출 지연을 흉내내 로딩 UI를 확인할 수 있게 한다.

  const candidates = await load();
  // 이 회의의 발언 안에서만 근거를 쓰는 스텁을 고른다.
  const match = candidates.find(
    (c) => c.uids.size > 0 && [...c.uids].every((u) => validUids.has(u)),
  );
  if (!match) {
    throw new Error(
      `이 전사에 맞는 LLM 스텁이 없습니다 (fixtures/film/*.extraction.json). ` +
        `새 회의를 분석하려면 OPENROUTER_API_KEY 를 설정해 실제 모델을 쓰세요.`,
    );
  }

  // 재시도 경로를 키 없이 검증하기 위한 스위치. 1회차만 일부러 규칙을 위반한다.
  if (attempt === 1 && process.env.SCENENOTE_FIXTURE_FAIL_FIRST === "1") {
    const broken = JSON.parse(match.raw);
    broken.decisions[0].decision_state = "confirmed";
    broken.decisions[0].evidence = ["U99"];
    return JSON.stringify(broken);
  }

  return match.raw;
}
