// UI 스모크 — 반복 지적 이력 기반 자동 게이트
// ①모든 핵심 화면 렌더 ②가로 오버플로(잘림) 0 ③콘솔 에러 0 ④표 No열 오름차순 ⑥시각 회귀
import { test, expect } from '@playwright/test';

// 0003(손성욱·admin) 세션 주입 — 로그인 UI 우회 (표준 패턴)
// password 필드는 ProtectedRoute의 /set-password 리다이렉트 회피용 (자리표시 값 — 실제 인증 아님)
const TEST_USER = { uid: 'smoke-0003', code: '0003', name: '손성욱', role: 'admin', password: 'smoke' };

const PAGES = [
  { path: '/dashboard', name: '대시보드', marker: /홈|출퇴근|근무|일정|공지/ },
  { path: '/admin/purchase', name: '발주현황', marker: /구매|발주/ },
  { path: '/admin/users', name: '인사관리', marker: /직원|인사/ },
  { path: '/sites', name: '공수표(현장)', marker: /현장|프로젝트|공수/ },
  { path: '/admin/payment', name: '결제', marker: /결제/ },
];

// 무해한 콘솔 메시지(서드파티·리소스 404 등)는 제외
const IGNORE_CONSOLE = [
  /favicon/i,
  /net::ERR_/i,
  /Failed to load resource/i,
  /recaptcha|appcheck|app-check/i,
  /BloomFilter/i,
  /requestStorageAccess/i, // 파이어베이스 인증 iframe의 브라우저 저장소 API 소음 (자체 코드 미사용 — grep 확인)
];

test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript((user) => {
    localStorage.setItem('workManagerUser', JSON.stringify(user));
    localStorage.setItem('workManagerLastActivity', String(Date.now()));
  }, TEST_USER);
});

for (const pg of PAGES) {
  test.describe(pg.name, () => {
    test(`렌더·잘림·콘솔·정렬 — ${pg.path}`, async ({ page }, testInfo) => {
      const errors = [];
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const t = msg.text();
        if (IGNORE_CONSOLE.some((re) => re.test(t))) return;
        errors.push(t.slice(0, 200));
      });
      page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));

      // networkidle 금지 — Firestore 실시간 연결이 계속 열려 있어 영원히 idle이 안 됨
      await page.goto(pg.path, { waitUntil: 'domcontentloaded' });

      // ① 렌더 — 로그인/비번설정으로 튕기지 않고, 그 페이지의 실제 내용(마커)이 떠야 함
      await expect(page).not.toHaveURL(/login|set-password/, { timeout: 15000 });
      // 마커 기반 동적 대기 — 고정 sleep은 병렬 부하에서 플레이크 유발
      await page.waitForFunction(
        (src) => new RegExp(src).test(document.body.innerText),
        pg.marker.source,
        { timeout: 25000 },
      ).catch(() => {});
      await page.waitForTimeout(800); // 아이콘·배지 마무리 렌더
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText, `페이지 마커(${pg.marker}) 미발견 — 엉뚱한 화면 렌더 의심`).toMatch(pg.marker);

      // ② 가로 오버플로(잘림 주범) = 0
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `가로 오버플로 ${overflow}px — 화면 잘림 의심`).toBeLessThanOrEqual(1);

      // ③ 콘솔 에러 0
      expect(errors, '콘솔 에러:\n' + errors.join('\n')).toHaveLength(0);

      // ④ 표 No 열 오름차순 (있을 때만) — "순서 뒤죽박죽" 회귀
      const noCols = await page.evaluate(() => {
        const out = [];
        for (const table of document.querySelectorAll('table')) {
          const ths = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
          const idx = ths.findIndex((t) => t === 'No' || t === 'NO');
          if (idx < 0) continue;
          const nums = [...table.querySelectorAll('tbody tr')]
            .map((tr) => parseInt(tr.children[idx]?.textContent, 10))
            .filter((n) => Number.isFinite(n));
          if (nums.length > 1) out.push(nums);
        }
        return out;
      });
      for (const nums of noCols) {
        const sorted = [...nums].sort((a, b) => a - b);
        expect(nums, 'No열 순서 뒤죽박죽: ' + nums.join(',')).toEqual(sorted);
      }

      // ⑥ 시각 기록 — 스크린샷을 증거로 항상 첨부.
      // 픽셀 diff는 라이브 데이터(세션 타이머·상대시각·실데이터)가 매번 달라 차단 게이트로 부적합
      // → 기본은 기록만, 필요 시 VISUAL=1 환경변수로 diff 활성화(전용 마스킹 전제)
      if (process.env.VISUAL) {
        await expect(page).toHaveScreenshot(`${pg.name}-${testInfo.project.name}.png`, { fullPage: false });
      } else {
        await testInfo.attach(`${pg.name}-${testInfo.project.name}`, {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
      }
    });
  });
}
