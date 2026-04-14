# 아키텍처 상세

## 시스템 개요

review-evolve는 Claude Code 플러그인 시스템(Skills, Hooks)과 Codex CLI를 활용하여 구현된 자기강화 메타-리뷰 시스템입니다.

## 컴포넌트 상세

### 1. PreToolUse 훅 — 리뷰 지시 + 패턴 주입 (`inject-patterns.mjs`)

code-reviewer 에이전트 생성 직전에 발동하여 두 가지를 주입합니다:
1. **[항상]** 리뷰 결과를 `.review-evolve/claude-review/`에 JSON으로 저장하라는 지시
2. **[패턴 있으면]** knowledge base에서 관련 high/core 패턴을 선별하여 주입
   - 신형: `.review-evolve/knowledge/index.md` + 카테고리 파일 (high/core만 포함)
   - 구형: `.review-evolve/review-knowledge.md` (하위 호환)

```
Claude Code Runtime
  │
  ├── Agent/Task 도구 호출 감지
  │       │
  │       ▼ PreToolUse(Agent|Task) 발동
  │
  ├── inject-patterns.mjs 실행
  │   │
  │   ├─ tool_input에서 description/subagent_type 확인
  │   ├─ "review" 키워드 매칭 → 리뷰 관련 아니면 통과
  │   │
  │   ├─ [항상] JSON 저장 지시 주입:
  │   │   "리뷰 완료 후 .review-evolve/claude-review/{timestamp}.json에 Write하라"
  │   │   → 이 지시 덕분에 code-reviewer가 리뷰를 파일로 Write
  │   │   → PostToolUse 캡처 훅이 발동할 수 있게 됨
  │   │
  │   ├─ [패턴 있으면] loadKnowledgeBase() — 신형/구형 자동 분기
  │   │   ├─ 신형(knowledge/index.md 존재):
  │   │   │   ├─ index.md 카테고리 목록 파싱
  │   │   │   ├─ diff 변경 파일 ↔ 카테고리 키워드 매칭 → 관련 카테고리 선택
  │   │   │   └─ 해당 카테고리 파일 로드 (high/core 패턴만 포함)
  │   │   ├─ 구형(review-knowledge.md): 전체 파싱 후 pending 제외
  │   │   ├─ confidence(core > high > medium) + relevance 정렬
  │   │   └─ 토큰 예산 체크:
  │   │       ├─ > 10,000 토큰 → core만
  │   │       ├─ > 5,000 토큰 → high + core
  │   │       └─ ≤ 5,000 토큰 → 전체 (pending 제외)
  │   │
  │   └─ hookSpecificOutput.additionalContext로 주입
  │
  └── code-reviewer가 주입된 패턴을 참고하여 리뷰 수행 + JSON 파일 Write
```

### 2. PostToolUse 훅 — 리뷰 캡처 (`capture-review.mjs`)

Write/Edit 도구 실행 후 발동. 리뷰 파일을 감지하여 diff + 컨텍스트와 함께 캡처합니다.

```
Claude Code Runtime
  │
  ├── code-reviewer가 리뷰 JSON을 Write
  │       │
  │       ▼ PostToolUse(Write|Edit) 발동
  │
  ├── capture-review.mjs 실행
  │   │
  │   ├─ stdin에서 context 파싱 (tool_input.file_path)
  │   ├─ fs.readFileSync로 파일 내용 읽기 (stdin에 content 없음)
  │   ├─ 리뷰 파일 판별 (OR 조건):
  │   │   ├─ 파일 경로가 .review-evolve/claude-review/ 내부
  │   │   └─ ## Critical/Major/Minor/Positive 마커 2개 이상
  │   ├─ git diff HEAD로 변경 코드 수집
  │   ├─ 변경 파일 전체 내용 수집 (최대 10파일, 50KB 이하)
  │   └─ .review-evolve/captures/{timestamp}.json 저장
  │
  └── hookSpecificOutput.additionalContext로 캡처 알림
```

**캡처 데이터 스키마:**
```json
{
  "timestamp": "ISO 8601",
  "source": "claude",
  "review_file": "리뷰 파일 경로",
  "review": {
    "timestamp": "ISO 8601",
    "issues": [
      { "severity": "critical|major|minor", "file": "경로", "line": 42, "issue": "설명", "rationale": "근거" }
    ],
    "positive": [
      { "pattern": "패턴명", "description": "설명" }
    ]
  },
  "diff": "git diff 결과",
  "changed_files": ["파일 목록"],
  "file_contexts": { "파일명": "파일 전체 내용" }
}
```

### 3. Codex CLI 연동 (`codex-review.sh`)

```
Claude Code (/review-evolve 스킬)
  │
  ├─ Bash로 codex review 호출
  │       │
  │       ▼ Codex CLI (기존 인증 활용)
  │
  ├── codex review --uncommitted
  │   │
  │   ├─ Codex 모델 자동 사용
  │   ├─ 변경사항 분석 및 리뷰 수행
  │   │
  │   └─ 구조화된 리뷰 반환
  │
  └── 교차 비교는 스킬 내에서 Claude가 직접 수행
      ├─ Claude 리뷰(캡처된 JSON)와 Codex 리뷰를 비교
      ├─ 파일명 + 이슈 유사도로 매칭
      └─ Both / Claude-only / Codex-only 분류
```

**설계 전환 기록:**
초기에는 MCP 서버(`@modelcontextprotocol/sdk` + OpenAI API)로 구현했으나,
Codex CLI가 이미 인증/모델 관리를 처리하므로 불필요한 복잡도로 판단하여 CLI 직접 호출로 전환.

### 4. /review-evolve 스킬 (`SKILL.md`)

```
사용자: /review-evolve
  │
  ├─ Step 1: 캡처 로드 (.review-evolve/captures/)
  ├─ Step 2: Codex 리뷰 요청 (codex review CLI)
  ├─ Step 3: 교차 비교 (Claude가 직접 수행)
  ├─ Step 4: 인터랙티브 확인 (AskUserQuestion)
  │   └─ 각 이슈: [유효] [무효] [수정] [의견]
  ├─ Step 5: 패턴 축적 (review-knowledge.md Write/Edit)
  ├─ Step 6: 신뢰도 관리 (승격/강등 규칙)
  └─ Step 7: 세션 완료 (요약 표시)
```

## 데이터 플로우 전체도

```
[일반 개발 작업]
코드 변경 ──→ git commit ──→ OMC team / code-reviewer 실행
                                │
                    PreToolUse 훅 발동
                    ├─ JSON 저장 지시 주입
                    └─ 축적 패턴 주입 (있으면)
                                │
                         code-reviewer 리뷰
                         ├─ 대화에 텍스트 출력 (기존 동작 유지)
                         └─ .review-evolve/claude-review/ 에 JSON Write (추가)
                                │
                    PostToolUse 훅 발동
                    └─ diff + 컨텍스트 추가 → .review-evolve/captures/ 저장
                                │
                         executor 수정 반영 → 리뷰 통과 → 완료


[리뷰 교차검증 세션 - 사용자가 원할 때]
/review-evolve ──→ 캡처 로드 (.review-evolve/captures/)
                     │
                     ├──→ Codex CLI 리뷰 (codex review --uncommitted)
                     │
                     ├──→ Claude vs Codex 교차 비교
                     │
                     ├──→ 사용자 인터랙티브 확인
                     │
                     └──→ .review-evolve/knowledge/ 업데이트
                          ├─ pending/medium → index.md (1줄)
                          └─ high/core → {category}.md (전체 포맷)


[다음 리뷰 - 자기강화]
OMC team 실행 ──→ code-reviewer Agent/Task 생성
                        │
                 PreToolUse 훅 발동
                 ├─ JSON 저장 지시 주입
                 └─ knowledge base에서 관련 high/core 패턴 선별 주입
                    (신형: index.md → 관련 카테고리 파일만 로드)
                    (구형: review-knowledge.md fallback)
                        │
                 Claude가 패턴 참고하여 더 정확한 리뷰
                        │
                 PostToolUse 훅 → 다시 캡처 → 사이클 반복
```

## 저장 경로 구조

```
프로젝트/
└── .review-evolve/
    ├── claude-review/          ← code-reviewer가 Write하는 리뷰 JSON (원본)
    ├── captures/               ← PostToolUse 훅이 diff/컨텍스트를 추가한 캡처 (보강본)
    ├── knowledge/              ← 신형 지식 베이스 (카테고리 구조)
    │   ├── index.md            ← 카테고리 목록 + pending/medium 1줄 기록 (항상 로드)
    │   ├── null-safety.md      ← null/undefined 관련 high/core 패턴
    │   ├── error-handling.md   ← 에러 처리 high/core 패턴
    │   ├── data-validation.md  ← 입력값 검증 high/core 패턴
    │   ├── sql-injection.md    ← SQL 관련 high/core 패턴
    │   └── general.md          ← 기타 high/core 패턴
    └── review-knowledge.md     ← 구형 단일 파일 지식 베이스 (하위 호환)
```

## 하네스 엔지니어링 구성요소 매핑

| 하네스 구성요소 | review-evolve 구현 | 파일 |
|----------------|-------------------|------|
| Memory | knowledge/index.md + 카테고리 파일 (신형) / review-knowledge.md (구형) — 패턴 지속 저장 | templates/index.md, templates/review-knowledge.md |
| Verification Loops | Claude + Codex 교차검증 | scripts/codex-review.sh |
| Context Management | 토큰 예산 기반 선별 주입 | hooks/scripts/inject-patterns.mjs |
| State Management | confidence 레벨 상태 머신 | skills/review-evolve/SKILL.md |
| Output Parsing | 리뷰 결과 JSON 파싱 | hooks/scripts/capture-review.mjs |
| Tools | Codex CLI (codex review) | scripts/codex-review.sh |
| Prompt Construction | JSON 저장 지시 + 패턴 주입 | hooks/scripts/inject-patterns.mjs |
