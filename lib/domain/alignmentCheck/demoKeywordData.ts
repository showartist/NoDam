/** 수영장 시연 대본에 맞춘 낱말 목록. 통계 모델이나 일반 회의 탐지 규칙이 아니다. */
export const DEMO_RULE_NOTICE = "시연 대본용 낱말 보조 검사: 일반 회의 탐지·확률 추정에 사용할 수 없습니다.";
export const DEMO_KEYWORDS = {
  emptySpace: ["인물 없는", "비어 있어야", "텅 빈", "아무도 없는"],
  keepPerson: ["인물 남기기", "인물을 멀리", "인물 멀리", "사람 남겨"],
  day: ["낮에", "낮으로", "낮 시간", "햇빛", "주간"],
  night: ["밤에", "밤으로", "밤 시간", "야간", "어두운 밤"],
  ruin: ["폐허", "부서진", "오래된"],
  cleanTiles: ["젖은 타일", "깨끗한", "타일 반사"],
  coldTone: ["차갑게", "차가운", "시원하게"],
  physicalAction: ["걸어나간다", "방을 나간다", "앉는다"],
  agreement: ["합의", "동의", "그렇게 하죠", "확정"],
};

export const DEMO_COLOR_SPECIFIED = /색온도|블루톤|그림자|\d+\s*K/i;
export const DEMO_EMOTION_SPECIFIED = /표정|정서|감정|슬프|기쁘|불안|웃|울|분노/;
