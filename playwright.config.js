// ② UI 스모크 — 4디바이스(아이폰·갤럭시·폴더블·PC) 잘림·콘솔에러·정렬·시각회귀 검사
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 60_000,
  retries: 2,
  workers: 1, // 라이브 운영앱 대상 — 병렬 부하 플레이크 방지 (직렬 ~2분)
  reporter: [['list']],
  use: {
    baseURL: process.env.SMOKE_URL || 'https://work-manager.rhdn669.workers.dev',
    contextOptions: { reducedMotion: 'reduce' },
    screenshot: 'only-on-failure',
  },
  expect: {
    // ⑥ 시각 회귀 — 기준 스크린샷 대비 2%까지 허용(안티앨리어싱·폰트 미세차)
    toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' },
  },
  projects: [
    { name: 'iphone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'galaxy', use: { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: 'fold', use: { viewport: { width: 717, height: 512 } } },
    { name: 'pc', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
