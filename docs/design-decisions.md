# 설계 결정 기록 (Architecture Decision Records)

## ADR-1: Codex CLI 직접 호출 (MCP 서버에서 전환)

### Context
Codex에게 코드 리뷰를 요청해야 한다. Claude Code 환경에서 외부 LLM 리뷰를 호출하는 방법이 필요하다.

### Decision
Codex CLI(`codex review`)를 Bash로 직접 호출한다.

### Alternatives
1. **MCP 서버로 OpenAI API 래핑**: 초기에 이 방식으로 구현. `@modelcontextprotocol/sdk`로 MCP 프로토콜을 구현하고 `mcp__codex-reviewer__codex_review` 도구로 노출. 그러나 별도 OpenAI API 키와 크레딧이 필요하고, Codex CLI가 이미 인증/모델 관리를 처리하므로 불필요한 복잡도.
2. **OMC의 /ask codex 활용**: OMC 전용 기능이라 범용성 부족.

### Why Chosen
- Codex CLI의 기존 인증을 그대로 활용 — 별도 API 키 불필요
- `codex review --uncommitted`로 간단하게 호출, gpt-5.4 모델 자동 사용
- 실제 동작하는 시스템이 설계만 있는 MCP 서버보다 포트폴리오에서 더 가치 있음
- MCP 서버 구현 경험 자체는 ADR에 기록하여 "시도 → 평가 → 전환"이라는 엔지니어링 판단 과정을 보여줌

### Consequences
- 긍정: 즉시 동작, 의존성 제로 (npm 패키지 불필요), 최신 모델(gpt-5.4) 자동 활용
- 부정: Codex CLI가 설치되어 있어야 함
- 후속: Codex CLI가 없는 환경을 위한 MCP 서버 fallback 옵션 추가 가능

---

## ADR-2: 인터랙티브 세션 방식 채택

### Context
리뷰 교차검증 결과에서 패턴을 추출하여 축적해야 한다. 자동화 수준을 결정해야 한다.

### Decision
배치 자동화가 아닌 인터랙티브 세션(`/review-evolve`)으로 사용자 확인을 거친다.

### Alternatives
1. **완전 자동화**: PostToolUse 훅에서 자동으로 교차검증 + 패턴 축적. 사용자 개입 없음.
2. **반자동화**: 교차검증은 자동, 축적만 사용자 확인.

### Why Chosen
- **Human-in-the-loop behavioral harness**: 사용자가 학습 루프의 일부. AI만으로는 패턴의 유효성을 보장할 수 없음.
- **패턴 품질**: 자동 축적은 false positive 누적 위험. 사용자 확인이 노이즈 필터링의 최종 게이트.
- **포트폴리오 스토리**: "AI가 발견 → 사람이 판단 → 시스템이 학습"이라는 협업 구조가 하네스 엔지니어링의 본질.

### Consequences
- 긍정: 높은 패턴 품질, 사용자 학습 참여, 명확한 하네스 스토리
- 부정: 매번 수동 세션 실행 필요
- 후속: Phase 3에서 고신뢰 패턴(양쪽 모두 발견)은 자동 축적 옵션 추가 가능

---

## ADR-3: PreToolUse 훅 기반 패턴 주입

### Context
축적된 리뷰 지식을 다음 코드 리뷰에 자동 반영해야 한다. 반영 방식을 결정해야 한다.

### Decision
PreToolUse(Agent|Task) 훅으로 리뷰 관련 에이전트 실행 직전에 관련 패턴을 `hookSpecificOutput.additionalContext`로 주입한다.

### Alternatives
1. **CLAUDE.md에 삽입**: 모든 대화에 자동 로드. 그러나 리뷰 외 작업에서도 토큰 소비.
2. **AGENTS.md 수정**: code-reviewer 에이전트에만 적용. 그러나 모든 패턴이 항상 로드됨.
3. **스킬 preamble**: /review-evolve 실행 시에만 로드. 그러나 일반 리뷰에는 미반영.

### Why Chosen
- **토큰 효율**: 리뷰 관련 Agent/Task에만 발동. 코딩, 디버깅 등 비리뷰 작업에서는 토큰 0.
- **컨텍스트 인식**: 현재 diff의 파일 타입/디렉토리에 따라 관련 패턴만 필터링.
- **토큰 예산**: 5,000토큰 초과 시 high/core만, 10,000 초과 시 core만 주입.
- **비침투적**: OMC team의 코드 자체를 수정하지 않고, 훅으로 보조만 함.

### Consequences
- 긍정: 최적 토큰 사용, 정밀 타겟팅, OMC 비침투
- 부정: 훅 API 의존 (Claude Code 훅 스키마 변경 시 수정 필요)
- 후속: 필터링 알고리즘 고도화 (키워드 매칭 → 의미 유사도)

---

## ADR-4: diff + 파일 컨텍스트 리뷰 범위

### Context
Codex에게 리뷰를 요청할 때 전달할 코드 범위를 결정해야 한다.

### Decision
전체 코드베이스가 아닌 git diff + 변경 파일 전체 컨텍스트만 전달한다.

### Alternatives
1. **diff만 전달**: 최소 비용. 그러나 주변 코드 컨텍스트 부족으로 리뷰 정확도 저하.
2. **전체 코드베이스**: 완전한 컨텍스트. 그러나 API 비용 과다 + 노이즈(변경과 무관한 기존 이슈 보고).

### Why Chosen
- diff는 "무엇이 바뀌었는지", 파일 컨텍스트는 "어디서 바뀌었는지"를 제공
- Codex가 같은 diff를 독립적으로 리뷰하면 Claude의 blind spot 포착 가능
- API 비용 합리적 (파일당 ~50KB 제한)

### Consequences
- 긍정: 비용 효율적, 리뷰 포커스 명확
- 부정: 파일 간 영향(cross-file impact)은 제한적으로만 감지
- 후속: Phase 5에서 실제 프로젝트 적용 시 범위 충분성 검증

---

## ADR-5: OMC 전용 플러그인

### Context
review-evolve를 독립 Claude Code 플러그인으로 만들 것인지, OMC 전용으로 만들 것인지 결정해야 한다.

### Decision
OMC 환경 전용 플러그인으로 구현한다.

### Alternatives
1. **독립 Claude Code 플러그인**: 누구나 설치 가능. 그러나 code-reviewer 에이전트와의 통합이 느슨함.
2. **OMC + Claude Code 동시 지원**: 양쪽 모두 지원. 그러나 구현 복잡도 증가.

### Why Chosen
- OMC team의 code-reviewer 에이전트와 자연스러운 통합
- 실제 개발 워크플로우에서 즉시 사용 가능
- 기존 리뷰 프로세스를 변경하지 않고 훅으로 보조

### Consequences
- 긍정: 깊은 통합, 즉시 사용 가능
- 부정: OMC 없이는 사용 불가
- 후속: Claude Code 플러그인 마켓플레이스 지원 시 독립 버전 분리 가능
