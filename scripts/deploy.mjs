// 배포 — 만들고, 확인하고, 올리고, 다시 확인한다.
//
// 그냥 「만들고 올리기」로 두었더니 설정이 빠진 결과물이 운영에 올라가는 일이 두 번 있었다.
// 그 상태에서는 앱이 사내 서버 대신 구글을 보아 직원들이 로그인조차 못 한다.
// 그래서 올리기 전과 후에 «사내 서버 주소가 들어 있는지»를 반드시 확인한다. (2026-09-10 대표님)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const SITE = 'https://work-manager.rhdn669.workers.dev';

// 윈도우에서 npx 는 배치 파일이라 셸 없이는 못 부른다. 명령은 이 파일 안에 고정되어 있고
// 바깥에서 들어오는 값이 섞이지 않으므로 셸을 써도 안전하다.
const run = (bin, args) =>
  execFileSync(bin, args, { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
const say = (m) => console.log(m);

// 배포본이 반드시 품고 있어야 할 표시 — .env.production 의 서버 주소
function requiredMark() {
  const f = path.join(ROOT, '.env.production');
  if (!fs.existsSync(f)) return null; // 설정이 아예 없으면 예전처럼 구글을 보는 것이 맞다
  const line = fs
    .readFileSync(f, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('VITE_SB_URL='));
  if (!line) return null;
  return line.slice('VITE_SB_URL='.length).trim().replace(/^https?:\/\//, '');
}

function distHas(mark) {
  const dir = path.join(DIST, 'assets');
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .some((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes(mark));
}

async function servedHas(mark) {
  const html = await fetch(`${SITE}/?check=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } }).then((r) =>
    r.text(),
  );
  const files = [...new Set([...html.matchAll(/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]))];
  for (const f of files) {
    const t = await fetch(`${SITE}/${f}`).then((r) => r.text());
    if (t.includes(mark)) return true;
  }
  return false;
}

const mark = requiredMark();

say('① 이전 결과물 지우기');
fs.rmSync(DIST, { recursive: true, force: true });

say('② 새로 만들기');
run('npx', ['vite', 'build', '--mode', 'production']);

if (mark) {
  say(`③ 확인 — 만든 결과물에 «${mark}» 가 들어 있나`);
  if (!distHas(mark)) {
    console.error(`\n[배포 중단] 만든 결과물에 사내 서버 주소(${mark})가 없습니다.`);
    console.error('.env.production 을 읽지 못한 채 만들어진 것입니다. 파일을 확인하고 다시 하세요.');
    process.exit(1);
  }
  say('   들어 있습니다');
}

say('④ 올리기');
run('npx', ['wrangler', 'deploy']);

if (mark) {
  say('⑤ 확인 — 올라간 것이 실제로 그 결과물인가 (최대 2분 기다립니다)');
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await servedHas(mark)) {
      say('   올라간 배포본에 사내 서버 주소가 있습니다 — 정상');
      process.exit(0);
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.error('\n[경고] 올라간 배포본에서 사내 서버 주소를 찾지 못했습니다.');
  console.error('가장자리에 퍼지는 중일 수 있습니다. 잠시 뒤 다시 확인하고, 그래도 없으면 다시 올리세요.');
  process.exit(1);
}
