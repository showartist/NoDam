#!/usr/bin/env bash
# SceneNote 시연 실행: 음성 사이드카(:8790) + Next 개발 서버(:3210).
#
#   bash scripts/start-demo-mac.sh
#
# - 사이드카가 이미 떠 있으면 그대로 쓰고, 이 스크립트가 띄운 사이드카만 끝날 때 함께 끈다.
# - 사이드카가 없어도 앱은 돈다. 그때는 업로드 전사가 Grok 화자로, 회의 중 화면은 조각 사이 화자를 잇지 못한 채로 돈다.
# - 시연 데이터(분석 결과·과거 결정 충돌 회의)는 따로 준비한다: npx tsx scripts/prepare-demo.ts
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 이 맥처럼 셸에 NODE_ENV=production 이 걸려 있으면 npm ci 가 개발 의존성을 빼고, next dev 도 경고를 낸다.
unset NODE_ENV

say() { printf '\033[1m%s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "필요한 프로그램이 없습니다: $1 ($2)"; exit 1; }; }

need node "Node 22 이상"
need ffmpeg "brew install ffmpeg"
need curl "기본 설치"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node 22 이상이 필요합니다 (node:sqlite)."; exit 1; }

if [ -z "${OPENROUTER_API_KEY:-}" ] && ! grep -qsE '^OPENROUTER_API_KEY=.+' .env.local; then
  echo "경고: OPENROUTER_API_KEY 가 없습니다. 화면은 뜨지만 전사·분석·이미지는 NOT_CONFIGURED 오류를 냅니다."
  echo "      cp .env.example .env.local 후 키를 채우세요."
fi

mkdir -p .data
[ -d node_modules ] || { say "npm ci"; npm ci; }

PORT="${SIDECAR_PORT:-8790}"
HEALTH="http://127.0.0.1:${PORT}/health"
SIDECAR_PID=""
cleanup() { [ -n "$SIDECAR_PID" ] && kill "$SIDECAR_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if curl -sf "$HEALTH" >/dev/null 2>&1; then
  say "음성 사이드카가 이미 떠 있습니다 (:${PORT})"
elif command -v uv >/dev/null 2>&1; then
  [ -d sidecar/.venv ] || { say "사이드카 가상환경 만들기 (uv sync, 처음 한 번)"; (cd sidecar && uv sync); }
  say "음성 사이드카 시작 (:${PORT}) → 로그 .data/sidecar.log"
  (cd sidecar && exec uv run uvicorn audio_sidecar.server:app --host 127.0.0.1 --port "$PORT") >.data/sidecar.log 2>&1 &
  SIDECAR_PID=$!
  for _ in $(seq 1 60); do curl -sf "$HEALTH" >/dev/null 2>&1 && break; sleep 1; done
  if curl -sf "$HEALTH" >/dev/null 2>&1; then
    # 화자 임베딩 모델(ECAPA)을 미리 올려 둔다. 첫 요청 때 내려받고 올리느라 시연 중에 멈추지 않게.
    WARM="$ROOT/fixtures/eval/audio/scene27/meeting.m4a"
    [ -f "$WARM" ] && curl -sf -X POST "http://127.0.0.1:${PORT}/embed" -H 'content-type: application/json' \
      -d "{\"audio_path\":\"$WARM\",\"segments\":[{\"start_ms\":0,\"end_ms\":3000}]}" >/dev/null 2>&1 \
      && say "화자 임베딩 모델 준비 완료" || true
  else
    echo "사이드카가 60초 안에 뜨지 않았습니다. .data/sidecar.log 를 보세요. 앱은 사이드카 없이 계속 뜹니다."
  fi
else
  echo "uv 가 없어 음성 사이드카를 건너뜁니다 (brew install uv). 앱은 사이드카 없이 뜹니다."
fi

say "Next 개발 서버 → http://localhost:3210"
echo "  다시 짚기      http://localhost:3210/m/m_01/alignment"
echo "  회의 중 화면   http://localhost:3210/m/m_01/live"
echo "  결정 이력      http://localhost:3210/m/m_01/history"
npm run dev
