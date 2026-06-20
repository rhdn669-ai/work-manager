// Cloudflare Worker 진입점 — 정적 자산(SPA) 서빙 + 발주서 PDF 서버 렌더.
// /api/render-pdf : Browser Rendering(headless Chromium)으로 실제 「PDF 출력」과 동일한 벡터 PDF 생성.
// 그 외 모든 요청 : env.ASSETS(빌드된 dist) — SPA.
import puppeteer from '@cloudflare/puppeteer';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/render-pdf') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return renderPdf(request, env);
    }
    // 정적 자산(SPA) — not_found_handling=single-page-application
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderPdf(request, env) {
  let browser = null;
  try {
    const { html, cssUrls = [], fileName } = await request.json();
    if (!html) return json({ error: 'html이 필요합니다.' }, 400);

    const links = (Array.isArray(cssUrls) ? cssUrls : [])
      .filter(Boolean)
      .map((u) => `<link rel="stylesheet" href="${String(u).replace(/"/g, '&quot;')}">`)
      .join('');

    // 인쇄 양식을 .printable-page 컨텍스트로 감싸 @media print 규칙이 그대로 적용되게 함
    const fullHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8">${links}
      <style>html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style>
      </head><body><div class="purchase-detail-page printable-page">${html}</div></body></html>`;

    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    // 웹폰트(Pretendard) 로딩 완료까지 대기 — 한글 글리프 보장
    try {
      await page.evaluate(() => (document.fonts ? document.fonts.ready : null));
    } catch {
      /* 폰트 API 미지원 시 무시 */
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '12mm', right: '10mm', bottom: '5mm', left: '10mm' },
    });

    await browser.close();
    browser = null;

    const headers = { 'Content-Type': 'application/pdf' };
    if (fileName) headers['Content-Disposition'] = `inline; filename="${encodeURIComponent(fileName)}"`;
    return new Response(pdf, { headers });
  } catch (err) {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
    return json({ error: err?.message || 'PDF 렌더에 실패했습니다.' }, 500);
  }
}
