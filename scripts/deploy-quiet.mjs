// 배포 — 성공하면 한 줄, 실패하면 전문.
// wrangler 는 자산 116개를 업로드하며 진행 상황을 70줄 넘게 찍는다.
// 잘 된 배포에서 그 목록은 볼 일이 없고, 문제가 생겼을 때만 필요하다.
import { execSync } from 'node:child_process';

try {
  const out = execSync('npx --yes wrangler deploy', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const id = (out.match(/Current Version ID:\s*(\S+)/) || [])[1] || '';
  const url = (out.match(/(https:\/\/\S+workers\.dev)/) || [])[1] || '';
  console.log(`배포 완료${id ? ` · ${id.slice(0, 8)}` : ''}${url ? ` · ${url}` : ''}`);
} catch (err) {
  process.stdout.write(err.stdout || '');
  process.stderr.write(err.stderr || String(err));
  process.exit(1);
}
