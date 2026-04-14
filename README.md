# review-evolve

자기강화 메타-리뷰 시스템. Claude의 코드 리뷰 결과를 Codex와 교차검증하여 반복 패턴을 축적하고, 다음 리뷰에 자동 주입한다.

## 요구사항

- [Claude Code](https://claude.com/claude-code) 설치
- [Codex CLI](https://github.com/openai/codex) 설치 및 `codex login` 완료
- [OMC (oh-my-claudecode)](https://github.com/Yeachan-Heo/oh-my-claudecode) 설치 (선택)

## 설치

```bash
git clone https://github.com/bagboseong/review-evolve.git
cd review-evolve
./scripts/setup.sh
```

설치 스크립트가 `~/.claude/settings.json`에 플러그인을 자동 등록합니다.
설치 후 Claude Code를 재시작하세요.

제거:
```bash
./scripts/setup.sh uninstall
```

## 빠른 시작

```bash
# 1. Codex CLI 인증 (아직 안 했다면)
codex login

# 2. Claude Code 재시작 (새 세션에서 플러그인 로드)

# 3. 작업 중인 프로젝트에서 코드 리뷰 실행
# OMC team이나 code-reviewer로 리뷰하면 자동으로 리뷰가 JSON 캡처됨

# 4. 리뷰 교차검증 세션 시작
# Claude Code에서 /review-evolve 입력
```

## 상세 사용법

### 1. 리뷰 캡처 (자동 — 두 단계)

코드 리뷰 실행 시 두 개의 훅이 자동으로 동작합니다:

1. **PreToolUse 훅**: code-reviewer 에이전트 생성 직전에 "리뷰 결과를 `.review-evolve/claude-review/`에 JSON으로 Write하라"는 지시를 주입
2. **PostToolUse 훅**: JSON 파일이 Write되면 감지하여 diff + 파일 컨텍스트를 추가한 캡처를 `.review-evolve/captures/`에 저장

기존 리뷰 동작(텍스트 출력)은 그대로 유지되며, JSON 저장은 추가로 수행됩니다.

### 2. Codex 독립 리뷰

Codex CLI로 동일한 변경사항에 대해 독립적인 리뷰를 실행합니다.

```bash
# uncommitted 변경사항 리뷰
./scripts/codex-review.sh

# 특정 커밋 리뷰
./scripts/codex-review.sh --commit <sha>

# 특정 브랜치 대비 리뷰
./scripts/codex-review.sh --base main
```

### 3. 리뷰 개선 세션 (/review-evolve)

Claude Code에서 `/review-evolve` 스킬을 실행하면 인터랙티브 리뷰 개선 세션이 시작됩니다.

```
/review-evolve
```

세션 흐름:
1. 캡처된 Claude 리뷰 데이터 로드
2. Codex CLI로 동일 범위 리뷰 실행
3. Claude vs Codex 교차 비교 결과 표시
4. 각 이슈에 대해 사용자가 유효/무효/수정 판단
5. 확인된 패턴을 review-knowledge.md에 축적

### 4. 패턴 자동 주입 (자동)

다음 코드 리뷰 시 PreToolUse 훅이 자동으로 축적된 패턴 중 관련된 것만 선별하여 컨텍스트에 주입합니다.

- review 관련 에이전트(code-reviewer)에만 발동
- 현재 diff와 관련된 패턴만 필터링
- 토큰 예산 관리 (5,000토큰 초과 시 high/core만 주입)
- pending 패턴은 주입하지 않음

## 프로젝트 구조

```
review-evolve/
├── .claude-plugin/plugin.json     # 플러그인 매니페스트
├── skills/
│   └── review-evolve/SKILL.md    # 인터랙티브 리뷰 개선 세션
├── hooks/
│   ├── hooks.json                 # PostToolUse + PreToolUse 훅 설정
│   └── scripts/
│       ├── lib/stdin.mjs          # stdin JSON 파싱 유틸리티
│       ├── capture-review.mjs     # 리뷰 결과 자동 캡처
│       └── inject-patterns.mjs    # 패턴 선별 주입
├── scripts/
│   └── codex-review.sh            # Codex CLI 리뷰 래퍼
├── templates/
│   └── review-knowledge.md        # 지식 베이스 템플릿
└── docs/
    ├── design-decisions.md        # 설계 결정 기록 (ADR)
    ├── architecture.md            # 아키텍처 상세
    ├── improvement.md                 # Phase 3-5 로드맵
    └── example.md                 # 포트폴리오 설계 문서
```

## 신뢰도 관리

패턴은 발견 횟수와 교차검증 결과에 따라 자동 승격됩니다.

```
pending → medium → high → core
```

| 현재 | 조건 | 변경 후 |
|------|------|---------|
| pending | 사용자 유효 승인 | medium |
| medium | 2회+ 재발견 또는 양쪽 모두 발견 | high |
| high | 5회+ 발견 | core |

## 실행 예시
<img width="716" height="292" alt="Image" src="https://github.com/user-attachments/assets/e6b8eb52-cc15-4719-be1f-6afc3267ac54" />
<img width="737" height="826" alt="Image" src="https://github.com/user-attachments/assets/56d8db63-eeca-47a6-999d-2f6b86c09a20" />
<img width="840" height="736" alt="Image" src="https://github.com/user-attachments/assets/26f014a1-e4ec-4f4a-8dd2-db595efca6ed" />
<img width="695" height="338" alt="Image" src="https://github.com/user-attachments/assets/a4d246ab-fa50-47ea-a07d-68ec4afa9087" />
<img width="792" height="381" alt="Image" src="https://github.com/user-attachments/assets/82667850-f9a2-4c4a-9d62-c97adb564ef7" />
<img width="637" height="556" alt="Image" src="https://github.com/user-attachments/assets/9ca6b4e5-e186-4b3d-b3fb-c8ef4e5f3844" />

## 라이센스

MIT
