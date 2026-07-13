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
    if (url.pathname === '/api/merge-pdf') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return mergePdf(request);
    }
    if (url.pathname === '/api/hometax/taxinvoice') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return hometaxTaxInvoice(request, env);
    }
    // 정적 자산(SPA) — not_found_handling=single-page-application
    // 단, /assets/* 해시 자산에는 SPA 폴백(HTML) 금지 — 배포 전파 중 폴백 HTML이
    // immutable 캐시 헤더로 브라우저에 1년 저장되어 앱이 영구히 깨지는 사고 방지.
    const res = await env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/assets/') && (res.headers.get('content-type') || '').includes('text/html')) {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    }
    return res;
  },
};

// ── 홈택스 전자세금계산서(매입) 조회 — 코드에프(CODEF) 스크래핑 ──
// 필요한 Worker 시크릿: CODEF_CLIENT_ID, CODEF_CLIENT_SECRET, CODEF_CONNECTED_ID(공동인증서 1회 등록 시 발급).
// 선택: CODEF_BASE(기본 https://api.codef.io), CODEF_INVOICE_PATH(기본 매입 세금계산서 목록 경로).
// 키 미설정 시 { configured:false } 반환 → 프런트가 설정 안내.
async function hometaxTaxInvoice(request, env) {
  const clientId = (env.CODEF_CLIENT_ID || '').trim();
  const clientSecret = (env.CODEF_CLIENT_SECRET || '').trim();
  const connectedId = (env.CODEF_CONNECTED_ID || '').trim();
  if (!clientId || !clientSecret || !connectedId) {
    return json({ configured: false, message: '코드에프 키/인증서가 아직 설정되지 않았습니다.' });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: '잘못된 요청' }, 400);
  }
  const { startDate, endDate, bizNo } = body || {};
  try {
    // 1) OAuth 토큰
    const tokenRes = await fetch('https://oauth.codef.io/oauth/token?grant_type=client_credentials&scope=read', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${clientId}:${clientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (!tokenRes.ok) return json({ error: '코드에프 토큰 발급 실패', status: tokenRes.status }, 502);
    const token = (await tokenRes.json()).access_token;

    // 2) 홈택스 매입 세금계산서 목록 조회
    const base = (env.CODEF_BASE || 'https://api.codef.io').replace(/\/$/, '');
    const path = env.CODEF_INVOICE_PATH || '/v1/kr/public/nt/etax-invoice/list';
    const payload = {
      organization: '0001',
      connectedId,
      startDate: (startDate || '').replace(/-/g, ''),
      endDate: (endDate || '').replace(/-/g, ''),
      type: '11', // 매입(받은 세금계산서)
      searchType: '0',
    };
    const apiRes = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = await apiRes.text();
    // CODEF 응답은 URL-encoded JSON
    let parsed;
    try {
      parsed = JSON.parse(decodeURIComponent(raw));
    } catch {
      parsed = JSON.parse(raw);
    }
    // 공급자 사업자번호로 정규화 (bizNo 지정 시 필터)
    const list = (parsed?.data?.resTaxInvoiceList || parsed?.data || []);
    const norm = (Array.isArray(list) ? list : []).map((r) => ({
      writeDate: r.resWriteDate || r.resIssueDate || '',
      approvalNo: r.resIssueId || r.resManageNo || '',
      supplierBizNo: (r.resSupplierCorpNum || r.commCorpNum || '').replace(/-/g, ''),
      supplierName: r.resSupplierCorpName || '',
      supplyValue: Number((r.resSupplyValue || '0').toString().replace(/[^0-9-]/g, '')) || 0,
      tax: Number((r.resTaxAmount || '0').toString().replace(/[^0-9-]/g, '')) || 0,
      total: Number((r.resTotalAmount || '0').toString().replace(/[^0-9-]/g, '')) || 0,
    }));
    const filtered = bizNo ? norm.filter((r) => r.supplierBizNo === String(bizNo).replace(/-/g, '')) : norm;
    return json({ configured: true, result: parsed?.result || null, invoices: filtered });
  } catch (e) {
    return json({ error: '조회 오류: ' + (e?.message || String(e)) }, 500);
  }
}

// 여러 PDF URL을 서버에서 받아 하나로 병합(벡터 그대로). 서버 fetch라 Storage CORS와 무관.
// SSRF 방지: 자사 Firebase Storage 도메인만 fetch 허용.
const MERGE_ALLOWED_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);
function isAllowedPdfUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && MERGE_ALLOWED_HOSTS.has(p.hostname);
  } catch {
    return false;
  }
}

async function mergePdf(request) {
  try {
    const { urls } = await request.json();
    if (!Array.isArray(urls) || urls.length === 0) return json({ error: 'urls가 필요합니다.' }, 400);
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();
    let added = 0;
    for (const u of urls) {
      try {
        if (!isAllowedPdfUrl(u)) continue; // 허용 도메인 외 URL 무시
        const res = await fetch(u);
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        added += 1;
      } catch {
        /* 개별 파일 실패는 건너뜀 */
      }
    }
    if (added === 0) return json({ error: '합칠 PDF를 불러오지 못했습니다.' }, 502);
    const bytes = await merged.save();
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (err) {
    return json({ error: err?.message || 'PDF 병합 실패' }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Browser Rendering은 콜드/세션 준비 전 첫 호출에서 "Unable to connect to existing
// session" 오류가 간헐적으로 난다 → 새 브라우저로 재시도해 첫 호출도 견고하게.
async function launchBrowser(env, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await puppeteer.launch(env.BROWSER);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function renderPdf(request, env) {
  let browser = null;
  try {
    const { html, cssUrls = [], fileName } = await request.json();
    if (!html) return json({ error: 'html이 필요합니다.' }, 400);

    // ★ CSS를 <link>(브라우저 외부 fetch)에 의존하지 않고, 워커가 env.ASSETS로 직접 읽어
    //   <style>로 인라인한다. Browser Rendering이 자산 URL을 못 가져오면 스타일이 통째로
    //   빠져(표 프레임 사라지고 글자만) PDF가 깨지던 문제를 근본 차단. 실패 시에만 <link> 폴백.
    const origin = new URL(request.url).origin;
    const styleParts = [];
    for (const u of (Array.isArray(cssUrls) ? cssUrls : []).filter(Boolean)) {
      let inlined = false;
      try {
        const path = new URL(String(u), origin).pathname;
        const assetRes = await env.ASSETS.fetch(new Request(new URL(path, origin)));
        if (assetRes.ok) {
          const css = await assetRes.text();
          if (css && css.trim()) {
            styleParts.push(`<style>${css}</style>`);
            inlined = true;
          }
        }
      } catch {
        /* 폴백으로 진행 */
      }
      if (!inlined) {
        styleParts.push(`<link rel="stylesheet" href="${String(u).replace(/"/g, '&quot;')}">`);
      }
    }
    const links = styleParts.join('');

    // 인쇄 양식을 .printable-page 컨텍스트로 감싸 @media print 규칙이 그대로 적용되게 함
    const fullHtml = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><base href="${origin}/">${links}
      <style>html,body{margin:0;padding:0;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}</style>
      </head><body><div class="purchase-detail-page printable-page">${html}</div></body></html>`;

    browser = await launchBrowser(env);
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
