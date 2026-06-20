import { uploadFile } from '../services/fileLibraryService';

let scopeSeq = 0;

// 발주서 PDF를 만들어 Blob 반환.
// 1순위: 서버 렌더(headless Chromium) → 실제 「PDF 출력」과 동일한 벡터 PDF.
// 실패 시(로컬 vite dev·서버 오류 등): html2canvas 로컬 캡처로 폴백.
export async function captureToPdfBlob(element, fileName) {
  try {
    return await renderPdfOnServer(element, fileName);
  } catch (err) {
    console.warn('[PDF] 서버 렌더 실패 — 로컬 캡처로 폴백:', err?.message || err);
    return await captureToPdfBlobLocal(element);
  }
}

// 서버 렌더 — 인쇄 양식 HTML + 배포된 CSS(href)들을 보내 page.pdf()로 생성
async function renderPdfOnServer(element, fileName) {
  const cssUrls = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((l) => l.href)
    .filter(Boolean);
  if (cssUrls.length === 0) {
    // 빌드 CSS가 <link>로 없으면(로컬 dev) 서버 렌더가 무의미 → 폴백 유도
    throw new Error('배포 환경이 아님(스타일 link 없음)');
  }
  const res = await fetch('/api/render-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html: element.outerHTML, cssUrls, fileName }),
  });
  if (!res.ok) {
    let msg = `서버 응답 ${res.status}`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('pdf')) throw new Error('PDF 응답이 아닙니다.');
  return await res.blob();
}

// 문서의 모든 @media print 규칙을 모아 #scopeId 하위에만 적용되도록 스코프를 붙여 반환.
// 이렇게 하면 화면(screen) 캡처 중에도 클론 요소의 computed style이 인쇄와 동일해진다.
function collectPrintCssScoped(scopeId) {
  const prefix = `#${scopeId} `;
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // CORS로 접근 불가한 외부 스타일시트는 건너뜀
    }
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE && /print/i.test(rule.media.mediaText)) {
        for (const inner of rule.cssRules) {
          if (inner.type === CSSRule.STYLE_RULE && inner.selectorText) {
            const sel = inner.selectorText
              .split(',')
              .map((s) => prefix + s.trim())
              .join(', ');
            out.push(`${sel} { ${inner.style.cssText} }`);
          }
        }
      }
    }
  }
  return out.join('\n');
}

// [폴백] DOM 요소를 html2canvas로 캡처해 PDF Blob 반환 (서버 렌더 불가 시).
// @media print 스타일을 강제 적용하고, .bom-print-page(페이지) 단위로 한 장씩 A4에 담는다.
async function captureToPdfBlobLocal(element) {
  // 무거운 라이브러리는 PDF 저장을 실제로 누를 때만 로드 (메인 번들 분리)
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);

  const scopeId = `pdf-cap-${Date.now()}-${scopeSeq++}`;

  // 화면 밖 래퍼 — A4 본문 폭(210mm − 좌우 여백 10mm씩 = 190mm)로 고정
  const wrapper = document.createElement('div');
  wrapper.id = scopeId;
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '0',
    left: '-99999px',
    zIndex: '-1',
    width: '190mm',
    background: '#ffffff',
  });
  const clone = element.cloneNode(true);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  // @media print 규칙을 #scopeId 하위에 주입 → 캡처가 인쇄와 동일한 스타일로 렌더
  const styleEl = document.createElement('style');
  styleEl.textContent = collectPrintCssScoped(scopeId);
  document.head.appendChild(styleEl);

  // 레이아웃 반영 대기 (한 프레임)
  await new Promise((r) => requestAnimationFrame(() => r()));

  try {
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth(); // 210
    const pageH = pdf.internal.pageSize.getHeight(); // 297
    const marginX = 10;
    const marginTop = 12;
    const marginBottom = 5;
    const contentW = pageW - marginX * 2; // 190
    const maxContentH = pageH - marginTop - marginBottom; // 280

    // 페이지 단위(.bom-print-page)가 있으면 각각 한 장으로, 없으면 양식 전체를 한 흐름으로
    const pageEls = clone.classList.contains('print-form-paged')
      ? [...clone.querySelectorAll('.bom-print-page')]
      : [];
    const targets = pageEls.length > 0 ? pageEls : [clone];

    const opts = { scale: 3, useCORS: true, backgroundColor: '#ffffff', logging: false };

    for (let i = 0; i < targets.length; i++) {
      const canvas = await html2canvas(targets[i], opts);
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      let drawW = contentW;
      let drawH = (canvas.height / canvas.width) * contentW;
      // 한 페이지를 넘기면 비율 유지하며 축소 (인쇄 한 장 = PDF 한 장 보장)
      if (drawH > maxContentH) {
        const s = maxContentH / drawH;
        drawW *= s;
        drawH = maxContentH;
      }
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', marginX + (contentW - drawW) / 2, marginTop, drawW, drawH);
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(wrapper);
    document.head.removeChild(styleEl);
  }
}

// PDF Blob을 자료실에 업로드 — 기존 uploadFile 경로를 그대로 재사용해
// libraryFiles 스키마(uploadedBy 등)와 100% 일치시킨다.
export async function uploadPdfToLibrary(blob, fileName, folderId, user, onProgress) {
  const safeName = (fileName || 'document').replace(/[/\\]/g, '_');
  const withExt = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const file = new File([blob], withExt, { type: 'application/pdf' });
  await uploadFile(file, folderId || null, user, onProgress, withExt);
}
