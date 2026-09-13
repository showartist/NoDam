import type { TranscriptUtterance } from "./types";
export function inferSpeakerNames(utterances: TranscriptUtterance[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const u of utterances) {
    if (!u.speakerId) continue;
    const pattern = /(?:^|[^가-힣])(?:저는|저의 이름은|제 이름은)\s+([가-힣]{2,4}?)(?:\s+(?:감독|대표|피디|PD|작가|배우|팀장|교수|기자))?\s*(?:이라고\s*합니다|라고\s*합니다|라고\s*해요|입니다만|입니다|이에요|예요)(?=$|[\s,.;!?。]|만|요)/g;
    for (const match of u.text.matchAll(pattern)) {
      const name = match[1];
      if (["감독", "촬영", "배우", "작가", "대표", "담당자", "진행자", "학생", "선생님", "반대", "찬성", "동의", "불참", "참석", "괜찮음", "진심", "처음", "초보", "경찰", "의사", "회사원"].includes(name)) continue;
      const names = candidates.get(u.speakerId) ?? new Set<string>();
      names.add(name); candidates.set(u.speakerId, names);
    }
  }
  const result = new Map<string, string>();
  for (const [speaker, names] of candidates) {
    if (names.size !== 1) continue;
    const name = [...names][0];
    if ([...candidates].some(([other, ns]) => other !== speaker && ns.has(name))) continue;
    result.set(speaker, name);
  }
  return result;
}
