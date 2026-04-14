# 개선 계획

> 현재 구현에서 발견된 한계점과 개선 방향을 정리합니다.

## 1. 지식 베이스 카테고리화

### 현재 문제
`review-knowledge.md` 하나에 모든 패턴을 저장하고, 리뷰 시 전체를 로드합니다.
패턴이 많아질수록 토큰 낭비가 심해지고, 관련 없는 패턴까지 주입됩니다.

### 개선 방향
카테고리별 파일로 분리하고, 리뷰 상황에 맞는 파일만 선택적으로 로드합니다.

```
.review-evolve/
└── knowledge/
    ├── index.md                  ← 카테고리 목록 + description만 (항상 로드)
    ├── null-safety.md            ← null 관련 패턴들
    ├── sql-injection.md          ← SQL 관련 패턴들
    ├── error-handling.md         ← 에러 처리 패턴들
    └── data-validation.md        ← 데이터 검증 패턴들
```

**플로우:**
1. PreToolUse 훅이 `index.md`만 읽음 (가벼움)
2. 현재 diff의 파일/코드를 보고 관련 카테고리 판별
3. 해당 카테고리 파일만 로드하여 주입

현재의 토큰 예산 관리(5K/10K 기준 필터링)보다 정밀하고 효율적입니다.

---

## 2. 신뢰도 기준 조정 + 카테고리 반영 기준 ✅ 구현 완료

### 현재 문제
모든 확인된 패턴(pending 포함)이 하나의 파일에 섞여 있어서, 검증된 패턴과 미검증 패턴의 구분이 구조적으로 드러나지 않습니다.

### 개선 방향
high 승격 기준을 낮추고, high부터 카테고리 파일에 정식 반영합니다.

| 레벨 | 승격 조건 | 저장 위치 |
|------|----------|----------|
| pending | 세션에서 사용자 승인만 받은 상태 | index.md에만 기록 |
| medium | 2회 재발견 | index.md에만 기록 |
| high | 양쪽 모두 발견 OR 3회+ 재발견 | **카테고리 파일에 정식 반영** |
| core | 5회+ 발견 | 카테고리 파일에서 최우선 주입 |

**효과:**
- `index.md`는 가볍게 유지 — pending/medium은 한 줄 설명만
- 카테고리 파일은 검증된 패턴만 — high/core만 들어가니 신뢰도 높음
- PreToolUse 훅 입장에서 효율적 — index.md 읽고 → 관련 카테고리만 로드 → 그 안에는 high/core만

### 구현 내역
- `hooks/scripts/inject-patterns.mjs`: `loadKnowledgeBase()` 추가 — 신형(`knowledge/index.md` + 카테고리 파일) / 구형(`review-knowledge.md`) 자동 분기
- `skills/review-evolve/SKILL.md`: Step 5 저장 위치 결정 로직, Step 6 승격 규칙 테이블 업데이트
- `templates/index.md`: 신형 knowledge index 템플릿 신규 생성

---

## 3. 노이즈 필터링 자동화

### 현재 문제
패턴 삭제/아카이브가 수동입니다. 오래된 미검증 패턴이 계속 남아있습니다.

### 개선 방향
**자동 삭제 규칙:**
- pending + 1회 + 한쪽만 + 미승인 → 30일 후 자동 삭제
- severity: Minor + frequency: 1 + confidence: pending → 다음 리뷰 미발견 시 삭제
- 동일 패턴의 frequency가 0으로 30일간 유지 시 → archived로 이동

**패턴 병합:**
- 의미적으로 유사한 패턴 자동 감지
- 사용자에게 병합 제안: "이 두 패턴을 합칠까요?"

---

## 4. /review-dashboard 스킬

축적된 패턴을 조회하고 관리하는 대시보드 스킬:

```
/review-dashboard

Review Knowledge Dashboard
총 패턴: 23개
  Core: 3개 | High: 7개 | Medium: 8개 | Pending: 5개

최근 7일 활동:
  새로 추가: 4개 | 승격: 2개 | 삭제: 1개

카테고리별:
  null-safety: 5개 | error-handling: 4개 | data-validation: 3개

[패턴 목록 보기] [삭제 대상 확인] [수동 패턴 추가] [통계]
```
