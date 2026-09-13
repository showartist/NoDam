/**
 * 한국어 조사 고르기. 마지막 글자에 받침이 있는지로 을/를, 이/가, 은/는, (으)로 를 고른다.
 * 끝의 닫는 괄호·따옴표는 건너뛰고 본다("윤도현 (감독)" → 독). 한글이 아니면(숫자·영문으로 끝나면) 두 형태를 함께 쓴다.
 */
const TRAILING = /[\s)\]}"'”’」』>]+$/u;

export function hasBatchim(word: string): boolean | null {
  const ch = word.replace(TRAILING, "").slice(-1);
  const code = ch.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return null;
  return (code - 0xac00) % 28 !== 0;
}

/** ㄹ 받침은 "로"를 쓴다(서울로, 연필로). */
function endsWithRieul(word: string): boolean {
  const code = word.replace(TRAILING, "").slice(-1).charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

export function josa(word: string, pair: "을/를" | "이/가" | "은/는" | "과/와" | "(으)로"): string {
  const b = hasBatchim(word);
  if (pair === "(으)로") {
    if (b === null) return `${word}(으)로`;
    return `${word}${b && !endsWithRieul(word) ? "으로" : "로"}`;
  }
  const [withB, without] = pair.split("/");
  if (b === null) return `${word}${withB}(${without})`;
  return `${word}${b ? withB : without}`;
}
