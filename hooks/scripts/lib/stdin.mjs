/**
 * stdin JSON 파싱 유틸리티
 * Claude Code 훅 스크립트에서 stdin으로 전달되는 JSON 컨텍스트를 읽는다.
 */

export async function readStdin(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let data = '';
    const timer = setTimeout(() => {
      resolve(data || '{}');
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data || '{}');
    });
    process.stdin.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function parseContext(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
