// 앱이 쓰는 자료 칸이 사내 서버에 «전부» 있는지 대조한다.
//
// 왜 있는가: 2026-09-11 사이드바 대분류가 제멋대로 바뀌었다. 원인은 9/7 이관 때
// userPreferences 표 하나가 통째로 빠진 것이었다. 앱은 「설정 없음」으로 읽고
// 기본값을 다시 깔았다. 표가 없으면 조용히 빈 값이 되므로 눈으로는 안 보인다.
//
// 하는 일: src 에서 쓰는 컬렉션 이름을 모아 표 이름으로 바꾸고, 서버에 하나씩 물어본다.
//   · 서버가 「없다(404)」고 하면 → 실패. 이관에서 빠진 것이다.
//   · 서버에 닿지 못하면(사외·꺼짐) → 그냥 지나간다. 이 검사 때문에 작업이 막히면 안 된다.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── ① 앱이 쓰는 이름 모으기 ──────────────────────────────────
const NAMES = new Set();
const DIRECT = /(?:collection|doc)\(\s*db\s*,\s*'([A-Za-z_]+)'/g;
const CONST = /\bCOLL[A-Z_]*\s*=\s*'([A-Za-z_]+)'/g;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(e.name)) {
      const text = fs.readFileSync(p, 'utf8');
      for (const re of [DIRECT, CONST]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) NAMES.add(m[1]);
      }
    }
  }
}
walk(SRC);

// 컬렉션 이름 → 표 이름 (serverData.js 의 tableOf 와 같은 규칙)
const tableOf = (name) => name.replace(/(?<!^)(?=[A-Z])/g, '_').toLowerCase();

// ── ② 서버 주소 찾기 ─────────────────────────────────────────
function readEnv(file) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}
const env = { ...readEnv('.env.server'), ...readEnv('.env.production'), ...process.env };
const URL = env.VITE_SB_URL;
const KEY = env.VITE_SB_ANON_KEY;

const skip = (why) => {
  console.log(`자료 칸 대조: 건너뜀 — ${why}`);
  process.exit(0);
};
if (!URL || !KEY) skip('사내 서버 주소가 없습니다(.env.production)');

// ── ③ 하나씩 물어보기 ────────────────────────────────────────
const ask = async (table) => {
  const r = await fetch(`${URL}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'wm' },
    signal: AbortSignal.timeout(10000),
  });
  return r.status;
};

const names = [...NAMES].sort();
let missing = [];
try {
  const codes = await Promise.all(names.map((n) => ask(tableOf(n))));
  missing = names.filter((n, i) => codes[i] === 404);
} catch (e) {
  skip(`서버에 닿지 못했습니다 (${e.message})`);
}

if (missing.length) {
  console.error(`자료 칸 대조: 서버에 없는 표 ${missing.length}개`);
  for (const n of missing) console.error(`  · ${n} → wm.${tableOf(n)}`);
  console.error('이관에서 빠진 것입니다. 표를 만들고 구글에서 자료를 옮긴 뒤 다시 도세요.');
  process.exit(1);
}
console.log(`자료 칸 대조: ${names.length}개 모두 서버에 있습니다.`);
