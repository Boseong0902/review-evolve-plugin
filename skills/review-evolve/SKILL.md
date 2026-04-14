---
name: review-evolve
description: "리뷰 교차검증 세션. 캡처된 Claude 리뷰를 Codex와 교차검증하고, 반복 패턴을 review-knowledge.md에 축적한다."
aliases: [re]
---

# review-evolve: 인터랙티브 리뷰 교차검증 세션

## 개요
Claude의 코드 리뷰 결과를 Codex CLI와 교차검증하여 리뷰 품질을 개선하고,
반복되는 패턴을 review-knowledge.md에 축적하는 인터랙티브 세션.

## 동작 원리
- code-reviewer 에이전트가 리뷰할 때 PreToolUse 훅이 자동으로 JSON 저장을 지시함
- 저장된 JSON은 PostToolUse 훅이 diff/컨텍스트와 함께 캡처함
- 이 스킬은 캡처된 데이터를 로드하여 Codex와 교차검증함

## 축적된 리뷰 패턴 (자동 로드)
!`cat .review-evolve/knowledge/index.md 2>/dev/null || cat .review-evolve/review-knowledge.md 2>/dev/null || echo "아직 축적된 패턴 없음"`

## 세션 실행 절차

### Step 1: 캡처 데이터 로드

1. `.review-evolve/captures/` 디렉토리에서 캡처 파일 목록을 확인한다.
2. 캡처 파일이 없으면:
   - 아직 코드 리뷰를 실행하지 않았거나, 훅이 정상 동작하지 않은 상태.
   - 안내: "캡처된 리뷰가 없습니다. OMC team이나 code-reviewer로 코드 리뷰를 먼저 실행하세요. PreToolUse 훅이 자동으로 리뷰 결과를 JSON으로 저장합니다."
3. 여러 캡처가 있으면 가장 최근 파일을 사용한다.
4. 캡처 파일을 Read로 로드하고 요약 표시:
   ```
   캡처된 리뷰 정보:
   - 캡처 시각: {timestamp}
   - 소스: {source}
   - 변경 파일: {changed_files 목록}
   - 발견 이슈: {issues 요약}
   ```

### Step 2: Codex 리뷰 요청

1. 캡처된 프로젝트 경로에서 Codex CLI로 독립 리뷰를 실행한다.
2. Bash 도구로 **반드시 아래 명령어 중 하나를 그대로** 실행한다. 임의로 플래그를 추가하거나 변형하지 말 것:
   ```bash
   # 방법 1: uncommitted 변경사항이 있을 때
   codex review --uncommitted

   # 방법 2: 특정 커밋 리뷰
   codex review --commit {sha}

   # 방법 3: 브랜치 대비 리뷰
   codex review --base {branch}
   ```
   **금지 사항:**
   - `--quiet`, `--silent` 등 존재하지 않는 플래그 사용 금지
   - PROMPT와 플래그를 동시에 사용 금지 (codex review "텍스트" --uncommitted 은 에러)
   - `codex exec`를 대신 사용하지 말 것 — 반드시 `codex review`를 사용
3. Codex 리뷰 결과를 표시한다.

### Step 3: 교차 비교

1. Claude 리뷰(캡처된 JSON)와 Codex 리뷰(Step 2 결과)를 비교한다:
   - 같은 파일 + 유사한 이슈 내용이면 "Both"로 분류
   - 한쪽에서만 발견되면 "Claude only" 또는 "Codex only"로 분류
2. 비교 결과를 표시:

   ```
   교차검증 결과

   양쪽 모두 발견 ({n}건) - 고신뢰
     1. [{severity}] {file}:{line} - {issue}

   Claude만 발견 ({n}건) - 확인 필요
     1. [{severity}] {file}:{line} - {issue}

   Codex만 발견 ({n}건) - 확인 필요
     1. [{severity}] {file}:{line} - {issue}
   ```

### Step 4: 인터랙티브 확인

각 이슈에 대해 사용자에게 AskUserQuestion으로 확인을 요청한다.

**양쪽 모두 발견 (Both)**:
- 자동으로 confidence: high 태깅
- 질문: "양쪽 모두 발견한 이슈입니다. 패턴으로 축적할까요? (승인 시 카테고리 파일에 정식 반영됩니다)"
- 옵션: [유효 - 패턴 추가] [무효 - 무시] [수정 후 채택]

**한쪽만 발견 (Claude only / Codex only)**:
- confidence: pending 태깅
- 질문: "{Claude/Codex}만 발견한 이슈입니다: {issue}. 유효한 패턴인가요?"
- 옵션: [유효 - 패턴 추가] [무효 - 무시] [수정 후 채택] [의견 추가]

### Step 5: 패턴 축적

1. 유효 판정된 이슈를 패턴으로 저장한다.
2. 패턴 포맷:
   ```markdown
   - pattern: {이슈를 일반화한 패턴 이름}
     | context: {어떤 상황에서 발생하는지}
     | severity: {Critical/Major/Minor}
     | frequency: 1
     | last-seen: {오늘 날짜}
     | confidence: {high (양쪽 모두) / pending (한쪽만, 사용자 승인)}
     | source: {Claude/Codex/Both}
     | fix: {수정 방향 - 2문장 이내}
     | reason: {왜 이 패턴을 축적하는지}
   ```
3. **중복 처리**: 기존 패턴과 의미적으로 동일한 경우:
   - frequency 증가
   - last-seen 갱신
   - confidence 승격 규칙 적용

### 저장 위치 결정
- confidence: pending → `.review-evolve/knowledge/index.md`의 `## Pending` 섹션에 1줄로만 기록
  형식: `- pattern: {이름} | context: {상황 한 줄}`
  (knowledge/index.md 없으면 구형 호환: review-knowledge.md Pending 섹션)
- confidence: medium → `.review-evolve/knowledge/index.md`의 `## Medium` 섹션에 1줄로만 기록
  형식: `- pattern: {이름} | context: {상황 한 줄}`
- confidence: high → 카테고리 판별 후 `.review-evolve/knowledge/{category}.md`에 전체 포맷 저장
- confidence: core → 카테고리 파일의 맨 위(Core 섹션)에 저장

카테고리 자동 판별 (context 필드 키워드 기준):
- null, undefined, optional → null-safety.md
- sql, query, injection → sql-injection.md
- error, exception, catch → error-handling.md
- validation, input, sanitize → data-validation.md
- 기타 → general.md

knowledge/index.md가 없으면 구형 방식(review-knowledge.md 단일 파일) 그대로 사용.

### Step 6: 신뢰도 관리

기존 패턴이 이번 리뷰에서 재발견된 경우 승격 규칙을 적용한다:

| 현재 상태 | 조건 | 변경 후 | 저장 위치 |
|-----------|------|---------|---------|
| pending | 사용자가 유효 승인 | medium | index.md ## Medium (1줄) |
| medium | 2회 재발견 | high | 카테고리 파일 (전체 포맷) |
| high | 양쪽 모두 발견 OR 3회+ 재발견 | core | 카테고리 파일 Core 섹션 |
| core | 5회+ 발견 | — | 최고 레벨 유지 |

### Step 7: 세션 완료

```
리뷰 교차검증 세션 완료
- 새로 추가된 패턴: {n}개
- 승격된 패턴: {n}개
- 무효 처리: {n}개
- 총 축적 패턴: {total}개
- 카테고리 파일 반영: {n}개 (high/core 패턴)

review-knowledge.md가 업데이트되었습니다.
다음 코드 리뷰 시 축적된 패턴이 PreToolUse 훅을 통해 자동 주입됩니다.
```

## 사용 도구

- `Read` — 캡처 파일 및 review-knowledge.md 읽기
- `Write` — review-knowledge.md 업데이트
- `Edit` — 기존 패턴 수정 (frequency, confidence 등)
- `Glob` — .review-evolve/captures/ 에서 캡처 파일 탐색
- `Bash(*)` — Codex CLI 호출 (`codex review`)
- `AskUserQuestion` — 인터랙티브 패턴 확인

## 주의사항

- Codex CLI가 설치 및 인증되어 있어야 합니다 (`codex --version`, `codex login`)
- 캡처가 없으면 먼저 코드 리뷰를 실행하세요 (OMC team, code-reviewer 등)
- 패턴의 fix 필드는 2문장 이내로 유지하세요 (토큰 예산 관리)
