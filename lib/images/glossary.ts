/**
 * 한국어 슬롯 값 → 짧은 영어 풀이(gloss). 결정적이다: 같은 입력이면 같은 출력.
 *
 * 원문은 프롬프트에 그대로 남고, 풀이는 괄호로 덧붙는 보조다. 그래서
 *   - 값의 모든 낱말이 사전에 있을 때만 풀이를 만든다. 일부만 아는 풀이는 뜻을 바꿀 수 있어 만들지 않는다.
 *   - 문장 번역이 아니라 낱말 풀이다. 어순은 원문을 따른다.
 * 사전에 없는 값은 lib/images/gloss.ts 가 (설정돼 있으면) LLM 으로 풀이하고, 아니면 원문만 보낸다.
 *
 * 순수 모듈. 브라우저에서 import 해도 된다.
 */

/** 촬영·미술·조명 회의에 자주 나오는 말. 여러 낱말 표현을 먼저 찾는다. */
const PHRASES: Record<string, string> = {
  "인물 없음": "no people",
  "사람 없음": "no people",
  "인물 없는": "without people",
  "텅 빈": "empty",
  "한 명": "one person",
  "두 명": "two people",
  "세 명": "three people",
  "서 있는": "standing",
  "떠 있는": "floating",
  "수면 높이": "at water level",
  "눈 높이": "eye level",
  "실내 수영장": "indoor swimming pool",
  "야외 수영장": "outdoor swimming pool",
  "채도 낮은": "desaturated",
  "익스트림 클로즈업": "extreme close-up",
  "레인 로프": "lane rope",
  "푸른 새벽빛": "blue dawn light",
  "새벽 빛": "dawn light",
};

const WORDS: Record<string, string> = {
  // 구도·카메라
  와이드: "wide shot", 와이드샷: "wide shot", 풀샷: "full shot", 미디엄: "medium shot", 미디엄샷: "medium shot",
  클로즈업: "close-up", 바스트샷: "bust shot", 롱테이크: "long take", 부감: "high angle", 앙각: "low angle",
  로우앵글: "low angle", 하이앵글: "high angle", 정면: "frontal", 측면: "side view", 뒷모습: "seen from behind",
  대칭: "symmetrical", 비대칭: "asymmetrical", 중앙: "centre", 가운데: "centre", 프레임: "frame", 구도: "composition",
  눈높이: "eye level", 원경: "distant view", 근경: "foreground", 전경: "foreground", 배경: "background",
  핸드헬드: "handheld", 고정: "locked-off", 트래킹: "tracking shot", 달리: "dolly", 틸트: "tilt", 패닝: "pan",
  멀리: "far", 가까이: "close", 작게: "small in frame", 크게: "large in frame", 구석: "corner", 한쪽: "one side",
  // 인물 유무·배치
  인물: "person", 사람: "person", 없음: "none", 없는: "without", 없이: "without", 혼자: "alone",
  빈: "empty", 등장: "appearing", 뒤: "behind", 앞: "in front", 옆: "beside", 밖: "outside",
  // 공간
  수영장: "swimming pool", 실내: "indoor", 실외: "outdoor", 야외: "outdoor", 타일: "tile", 물: "water", 수면: "water surface",
  레인: "lane", 벽: "wall", 벽면: "wall", 천장: "ceiling", 창: "window", 창문: "window", 복도: "corridor", 모텔방: "motel room",
  방: "room", 탈의실: "locker room", 샤워실: "shower room", 계단: "stairs", 바닥: "floor", 곰팡이: "mould", 녹: "rust",
  먼지: "dust", 얼룩: "stain", 안내판: "sign", 표지판: "sign", 간판: "signboard", 바랜: "faded", 빛바랜: "faded",
  낡은: "worn", 오래된: "old", 깨진: "cracked", 젖은: "wet", 버려진: "abandoned", 폐쇄된: "closed-down", 텅: "empty",
  공간: "space", 건물: "building", 거리: "street", 옥상: "rooftop", 교실: "classroom", 집: "house", 부엌: "kitchen",
  // 조명·시간
  새벽: "dawn", 새벽빛: "dawn light", 아침: "morning", 낮: "day", 밤: "night", 저녁: "evening", 황혼: "dusk", 노을: "sunset glow",
  빛: "light", 조명: "lighting", 자연광: "natural light", 역광: "backlight", 측광: "side light", 순광: "front light",
  형광등: "fluorescent light", 햇빛: "sunlight", 햇살: "sunlight", 창빛: "window light", 어둠: "darkness", 어두운: "dark",
  밝은: "bright", 그림자: "shadow", 부드러운: "soft", 강한: "hard", 은은한: "subtle", 희미한: "dim", 차가운: "cold",
  따뜻한: "warm", 하이키: "high-key", 로우키: "low-key", 실루엣: "silhouette", 반사: "reflection", 물빛: "water reflections",
  // 색
  푸른: "blue", 파란: "blue", 파랑: "blue", 파란색: "blue", 청색: "blue", 푸른빛: "bluish light", 녹색: "green",
  초록: "green", 초록색: "green", 빨간: "red", 붉은: "red", 빨간색: "red", 노란: "yellow", 노란색: "yellow", 흰: "white",
  하얀: "white", 흰색: "white", 검은: "black", 검은색: "black", 회색: "grey", 잿빛: "ashen grey", 청록: "teal",
  청록색: "teal", 틸: "teal", 무채색: "achromatic", 모노톤: "monotone", 파스텔: "pastel", 톤: "tone", 색: "colour",
  색감: "colour palette", 색온도: "colour temperature", 채도: "saturation", 낮은: "low", 높은: "high",
  // 의상·소품
  수영복: "swimsuit", 수영모: "swim cap", 가운: "robe", 교복: "school uniform", 코트: "coat", 셔츠: "shirt", 맨발: "barefoot",
  수건: "towel", 호루라기: "whistle", 의자: "chair", 벤치: "bench", 시계: "clock", 사다리: "ladder", 튜브: "swim ring",
  가방: "bag", 휴대폰: "mobile phone", 편지: "letter", 사진: "photograph",
  // 행동·연기
  서있는: "standing", 앉은: "seated", 앉아: "sitting", 걷는: "walking", 뛰어드는: "diving in",
  수영하는: "swimming", 바라보는: "looking at", 떠있는: "floating", 절제된: "restrained",
  무표정: "expressionless", 담담한: "composed", 오열: "sobbing", 울음: "crying", 감정: "emotion", 침묵: "silence",
  고요한: "still", 정적인: "static", 긴장: "tension", 쓸쓸한: "lonely", 외로운: "lonely", 차분한: "calm",
  // 이음말
  그리고: "and", 및: "and", 또는: "or", 느낌: "feel", 분위기: "mood", 정도: "degree", 있는: "with", 있음: "present",
};

/** 낱말 끝 조사. 긴 것부터 떼 본다. 사전에 원형이 있을 때만 뗀 형태를 쓴다. */
const PARTICLES = ["에서의", "으로", "에서", "까지", "부터", "처럼", "보다", "하고", "이랑", "랑", "의", "와", "과", "에", "을", "를", "이", "가", "은", "는", "도", "로", "만"];

const LATIN = /^[A-Za-z0-9.:%+\-#×x/]+$/;

function lookup(term: string): string | null {
  if (PHRASES[term]) return PHRASES[term];
  if (WORDS[term]) return WORDS[term];
  for (const p of PARTICLES) {
    if (term.length > p.length && term.endsWith(p)) {
      const stem = term.slice(0, -p.length);
      if (PHRASES[stem]) return PHRASES[stem];
      if (WORDS[stem]) return WORDS[stem];
    }
  }
  return null;
}

/**
 * 결정적 풀이. 모든 낱말을 알 때만 영어를 돌려주고, 하나라도 모르면 null.
 * 영어·숫자만 있는 값은 풀이가 필요 없으므로 null.
 */
export function glossaryGloss(value: string): string | null {
  const v = value.replace(/\s+/g, " ").trim();
  if (!v || !/[가-힣]/.test(v)) return null;
  const whole = lookup(v);
  if (whole) return whole;

  const tokens = v.split(/[\s,·/;:()\[\]"'“”‘’]+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let len = Math.min(3, tokens.length - i); len >= 1; len--) {
      const phrase = tokens.slice(i, i + len).join(" ");
      if (len === 1 && LATIN.test(phrase)) {
        out.push(phrase);
        i += 1;
        matched = true;
        break;
      }
      const hit = lookup(phrase);
      if (hit) {
        out.push(hit);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) return null;
  }
  return out.join(" ");
}
