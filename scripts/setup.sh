#!/bin/bash
# review-evolve 설치 스크립트
# Claude Code settings.json에 플러그인을 자동 등록한다.
#
# 사용법:
#   ./scripts/setup.sh          # 설치
#   ./scripts/setup.sh uninstall # 제거

set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS_FILE="${HOME}/.claude/settings.json"
MARKETPLACE_ID="review-evolve-local"
PLUGIN_ID="review-evolve@${MARKETPLACE_ID}"

# jq 확인
if ! command -v jq &>/dev/null; then
  echo "❌ jq가 필요합니다. brew install jq 로 설치해주세요."
  exit 1
fi

# settings.json 존재 확인
if [ ! -f "$SETTINGS_FILE" ]; then
  echo "❌ ${SETTINGS_FILE} 파일이 없습니다. Claude Code를 먼저 실행해주세요."
  exit 1
fi

uninstall() {
  echo "🗑  review-evolve 플러그인 제거 중..."

  jq "
    del(.enabledPlugins[\"${PLUGIN_ID}\"]) |
    del(.extraKnownMarketplaces[\"${MARKETPLACE_ID}\"])
  " "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"

  echo "✅ 제거 완료. Claude Code를 재시작하세요."
}

install() {
  echo "📦 review-evolve 플러그인 설치 중..."
  echo "   플러그인 경로: ${PLUGIN_DIR}"

  # 이미 등록되어 있는지 확인
  if jq -e ".enabledPlugins[\"${PLUGIN_ID}\"]" "$SETTINGS_FILE" &>/dev/null; then
    echo "ℹ️  이미 등록되어 있습니다. 경로를 업데이트합니다."
  fi

  # settings.json 업데이트
  jq "
    .enabledPlugins[\"${PLUGIN_ID}\"] = true |
    .extraKnownMarketplaces[\"${MARKETPLACE_ID}\"] = {
      \"source\": {
        \"source\": \"directory\",
        \"path\": \"${PLUGIN_DIR}\"
      }
    }
  " "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"

  echo "✅ 설치 완료!"
  echo ""
  echo "다음 단계:"
  echo "  1. Claude Code를 재시작하세요"
  echo "  2. /review-evolve 로 리뷰 개선 세션을 시작할 수 있습니다"
  echo "  3. codex login 이 완료되어 있는지 확인하세요"
}

case "${1:-install}" in
  uninstall|remove)
    uninstall
    ;;
  install|"")
    install
    ;;
  *)
    echo "사용법: $0 [install|uninstall]"
    exit 1
    ;;
esac
