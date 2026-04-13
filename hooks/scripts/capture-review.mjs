/**
 * PostToolUse Hook — 리뷰 결과 캡처 (review-evolve)
 *
 * Write/Edit 도구 실행 후 발동. 작성된 파일이 코드 리뷰 결과인지 판별하고,
 * 맞으면 diff + 파일 컨텍스트를 추가하여 .review-evolve/captures/에 저장한다.
 *
 * 판별 기준 (OR 조건):
 *   1. 파일 경로가 .review-evolve/claude-review/ 내부인 경우 (PreToolUse 훅이 지시한 저장)
 *   2. 파일 내용에 ## Critical/Major/Minor/Positive 마커가 2개 이상인 경우 (기존 방식)
 *
 * 설계 결정:
 *   - PostToolUse stdin에는 Write의 content가 없음 → fs.readFileSync로 파일 직접 읽기
 *   - 두 가지 감지 방식으로 확실한 캡처 보장
 */

import { readStdin, parseContext } from './lib/stdin.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, basename } from 'path';

const REVIEW_MARKERS = ['## Critical', '## Major', '## Minor', '## Positive'];
const MIN_MARKERS = 2;

function isReviewFile(filePath, content) {
  // 방법 1: .review-evolve/claude-review/ 경로에 저장된 파일
  if (filePath.includes('.review-evolve/claude-review/')) {
    return true;
  }

  // 방법 2: 내용에 리뷰 마커가 있는 경우
  const markerCount = REVIEW_MARKERS.filter((m) => content.includes(m)).length;
  return markerCount >= MIN_MARKERS;
}

async function main() {
  const raw = await readStdin(5000);
  const context = parseContext(raw);

  const filePath = context.tool_input?.file_path;
  if (!filePath) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  // 파일에서 내용 직접 읽기
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  // 리뷰 파일인지 판별
  if (!isReviewFile(filePath, content)) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  // 이미 캡처 디렉토리에 있는 파일이면 무시 (무한 루프 방지)
  if (filePath.includes('.review-evolve/captures/')) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const cwd = context.cwd || process.cwd();

  // git diff 수집
  let diff = '';
  try {
    diff = execSync('git diff HEAD', { cwd, encoding: 'utf8', timeout: 10000 });
    if (!diff) {
      diff = execSync('git diff HEAD~1', { cwd, encoding: 'utf8', timeout: 10000 });
    }
  } catch {
    diff = '(git diff unavailable)';
  }

  // 변경된 파일 목록
  let changedFiles = [];
  try {
    const filesRaw = execSync('git diff HEAD --name-only', {
      cwd, encoding: 'utf8', timeout: 5000,
    });
    changedFiles = filesRaw.trim().split('\n').filter(Boolean);
    if (changedFiles.length === 0) {
      const filesRaw2 = execSync('git diff HEAD~1 --name-only', {
        cwd, encoding: 'utf8', timeout: 5000,
      });
      changedFiles = filesRaw2.trim().split('\n').filter(Boolean);
    }
  } catch {
    changedFiles = [];
  }

  // 변경 파일 컨텍스트 수집
  const fileContexts = {};
  for (const f of changedFiles.slice(0, 10)) {
    try {
      const fullPath = join(cwd, f);
      if (existsSync(fullPath)) {
        const fileContent = readFileSync(fullPath, 'utf8');
        if (fileContent.length <= 50000) {
          fileContexts[f] = fileContent;
        }
      }
    } catch {
      // skip
    }
  }

  // 리뷰 내용 파싱 (JSON이면 그대로, 아니면 텍스트로)
  let reviewData;
  try {
    reviewData = JSON.parse(content);
  } catch {
    reviewData = { raw_text: content };
  }

  // 캡처 데이터 구성
  const capture = {
    timestamp: new Date().toISOString(),
    source: filePath.includes('claude-review') ? 'claude' : 'unknown',
    review_file: filePath,
    review: reviewData,
    diff,
    changed_files: changedFiles,
    file_contexts: fileContexts,
  };

  // .review-evolve/captures/ 에 저장
  const capturesDir = join(cwd, '.review-evolve', 'captures');
  mkdirSync(capturesDir, { recursive: true });

  const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(join(capturesDir, filename), JSON.stringify(capture, null, 2));

  process.stdout.write(
    JSON.stringify({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[review-evolve] 리뷰 결과가 캡처되었습니다: ${basename(filename)}. /review-evolve 로 교차검증 세션을 시작할 수 있습니다.`,
      },
    })
  );
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }));
});
