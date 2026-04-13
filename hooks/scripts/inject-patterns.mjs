/**
 * PreToolUse Hook — 리뷰 지시 주입 + 패턴 선별 주입 (review-evolve)
 *
 * Agent|Task 도구 실행 전 발동. 리뷰 관련 에이전트인지 판별하고:
 * 1. [항상] 리뷰 결과를 .review-evolve/claude-review/ 에 JSON으로 저장하라는 지시를 주입
 * 2. [패턴 있으면] review-knowledge.md에서 관련 패턴을 선별하여 주입
 *
 * 설계 결정:
 *   - code-reviewer는 리뷰를 텍스트로만 출력하므로, JSON 저장을 강제하여 캡처 훅과 연동
 *   - hookSpecificOutput.additionalContext로 주입
 *   - 토큰 예산: 5,000토큰 초과 시 high/core만, 10,000 초과 시 core만
 */

import { readStdin, parseContext } from './lib/stdin.mjs';
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const REVIEW_KEYWORDS = [
  'review',
  'code-reviewer',
  '리뷰',
  'reviewer',
  'code review',
];

const TOKEN_BUDGET_STANDARD = 5000;
const TOKEN_BUDGET_HIGH = 10000;
const CHARS_PER_TOKEN = 4;

function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function isReviewRelated(context) {
  const searchFields = [
    context.tool_input?.description,
    context.tool_input?.prompt,
    context.tool_input?.subagent_type,
    context.tool_input?.task_description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return REVIEW_KEYWORDS.some((kw) => searchFields.includes(kw));
}

function parseKnowledgeBase(content) {
  const patterns = [];
  const lines = content.split('\n');
  let currentPattern = null;

  for (const line of lines) {
    if (line.startsWith('## ')) continue;

    if (line.trim().startsWith('- pattern:')) {
      if (currentPattern) patterns.push(currentPattern);
      currentPattern = {
        pattern: line.replace(/.*pattern:\s*/, '').trim(),
        confidence: 'pending',
        fields: {},
      };
      continue;
    }

    if (currentPattern && line.trim().startsWith('|')) {
      const fieldMatch = line.trim().match(/\|\s*(\w[\w-]*):\s*(.*)/);
      if (fieldMatch) {
        const key = fieldMatch[1].trim();
        const value = fieldMatch[2].trim();
        currentPattern.fields[key] = value;
        if (key === 'confidence') currentPattern.confidence = value;
      }
    }
  }
  if (currentPattern) patterns.push(currentPattern);
  return patterns;
}

function getConfidenceLevel(pattern) {
  const conf = pattern.confidence.toLowerCase();
  if (conf === 'core') return 4;
  if (conf === 'high') return 3;
  if (conf === 'medium') return 2;
  return 1;
}

function filterByRelevance(patterns, changedFiles) {
  if (changedFiles.length === 0) return patterns;

  const extensions = new Set(
    changedFiles.map((f) => f.split('.').pop()?.toLowerCase()).filter(Boolean)
  );

  return patterns.map((p) => {
    const context = (p.fields.context || '').toLowerCase();
    let relevance = 0.5;
    for (const ext of extensions) {
      if (context.includes(ext)) relevance += 0.3;
    }
    for (const file of changedFiles) {
      const name = file.toLowerCase();
      if (context.includes(name) || name.includes(context.split(' ')[0])) {
        relevance += 0.2;
      }
    }
    return { ...p, relevance };
  });
}

function formatPatterns(patterns) {
  return patterns
    .map((p) => {
      let fixText = p.fields.fix || '';
      const sentences = fixText.split(/[.。]/);
      if (sentences.length > 2) {
        fixText = sentences.slice(0, 2).join('.') + '.';
      }
      return [
        `- **${p.pattern}** [${p.confidence}]`,
        `  상황: ${p.fields.context || 'N/A'}`,
        `  심각도: ${p.fields.severity || 'N/A'}`,
        `  수정 방향: ${fixText || 'N/A'}`,
      ].join('\n');
    })
    .join('\n\n');
}

async function main() {
  const raw = await readStdin(3000);
  const context = parseContext(raw);

  if (!isReviewRelated(context)) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const cwd = context.cwd || process.cwd();
  const injectionParts = [];

  // --- [1] 항상: 리뷰 결과를 JSON으로 저장하라는 지시 ---
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reviewJsonPath = `.review-evolve/claude-review/${timestamp}.json`;

  injectionParts.push(
    '## [review-evolve] 리뷰 결과 저장 지시',
    '',
    '리뷰를 완료한 후, 반드시 아래 형식의 JSON 파일을 Write 도구로 저장하세요.',
    '이 저장은 기존 리뷰 출력과 별개로, 추가로 수행해야 합니다.',
    '',
    `**저장 경로**: \`${reviewJsonPath}\``,
    '',
    '**JSON 형식**:',
    '```json',
    '{',
    '  "timestamp": "ISO 8601 형식",',
    '  "issues": [',
    '    {',
    '      "severity": "critical | major | minor",',
    '      "file": "파일 경로",',
    '      "line": 42,',
    '      "issue": "이슈 설명",',
    '      "rationale": "근거"',
    '    }',
    '  ],',
    '  "positive": [',
    '    {',
    '      "pattern": "패턴 이름",',
    '      "description": "설명"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '리뷰에서 발견한 모든 이슈와 긍정적 패턴을 빠짐없이 포함하세요.',
    '이슈가 없는 severity는 빈 배열로 두세요.',
  );

  // --- [2] 패턴 있으면: 축적된 패턴 주입 ---
  const knowledgePaths = [
    join(cwd, '.review-evolve', 'review-knowledge.md'),
    join(cwd, 'review-knowledge.md'),
  ];

  let knowledgeContent = '';
  for (const p of knowledgePaths) {
    if (existsSync(p)) {
      knowledgeContent = readFileSync(p, 'utf8');
      break;
    }
  }

  if (knowledgeContent) {
    let patterns = parseKnowledgeBase(knowledgeContent);
    patterns = patterns.filter((p) => p.confidence !== 'pending');

    if (patterns.length > 0) {
      let changedFiles = [];
      try {
        const filesRaw = execSync('git diff HEAD --name-only', {
          cwd,
          encoding: 'utf8',
          timeout: 5000,
        });
        changedFiles = filesRaw.trim().split('\n').filter(Boolean);
      } catch {
        // git 실패 시 전체 패턴 사용
      }

      patterns = filterByRelevance(patterns, changedFiles);
      patterns.sort(
        (a, b) =>
          getConfidenceLevel(b) - getConfidenceLevel(a) ||
          (b.relevance || 0) - (a.relevance || 0)
      );

      let formatted = formatPatterns(patterns);
      let tokens = estimateTokens(formatted);

      if (tokens > TOKEN_BUDGET_HIGH) {
        patterns = patterns.filter((p) => p.confidence === 'core');
        formatted = formatPatterns(patterns);
      } else if (tokens > TOKEN_BUDGET_STANDARD) {
        patterns = patterns.filter(
          (p) => p.confidence === 'core' || p.confidence === 'high'
        );
        formatted = formatPatterns(patterns);
      }

      if (patterns.length > 0) {
        injectionParts.push(
          '',
          '---',
          '',
          '## 축적된 리뷰 패턴 (review-evolve)',
          '',
          `아래는 이전 리뷰에서 반복 발견된 ${patterns.length}개 패턴입니다. 이번 리뷰에서 해당 패턴을 우선 확인하세요.`,
          '',
          formatted
        );
      }
    }
  }

  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: injectionParts.join('\n'),
      },
    })
  );
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
