#!/bin/bash
# codex-review.sh — review-evolve
#
# Codex CLI를 사용하여 코드 리뷰를 실행한다.
# 기존 Codex CLI 인증을 그대로 활용하여 별도 API 키 불필요.
#
# 사용법:
#   ./scripts/codex-review.sh                    # uncommitted 변경사항 리뷰
#   ./scripts/codex-review.sh --commit <sha>     # 특정 커밋 리뷰
#   ./scripts/codex-review.sh --base <branch>    # 브랜치 대비 리뷰

set -euo pipefail

# 인자가 없으면 uncommitted 변경사항 리뷰
if [ $# -eq 0 ]; then
  exec codex review --uncommitted
else
  exec codex review "$@"
fi
