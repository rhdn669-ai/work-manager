// 사업자등록증 PDF에서 상호·대표자·사업자등록번호 자동 추출 (텍스트 기반 PDF 전용)
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// PDF 파일 → 전체 텍스트
export async function extractPdfText(file) {
  return (await extractPdfTextPerPage(file)).join('\n');
}

// PDF 파일 → 페이지별 텍스트 배열 (페이지 분류용)
export async function extractPdfTextPerPage(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => it.str).join(' '));
  }
  return pages;
}

// OCR 전처리 — 흑백 변환 + Otsu 자동 이진화 (스캔 문서 인식률 향상)
function preprocessCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const n = d.length / 4;
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    gray[j] = g;
    hist[g] += 1;
  }
  // Otsu 임계값
  let sum = 0;
  for (let t = 0; t < 256; t += 1) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let varMax = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > varMax) {
      varMax = v;
      threshold = t;
    }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    const v = gray[j] > threshold ? 255 : 0;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// PDF 각 페이지를 캔버스 이미지로 렌더 (스캔 PDF OCR용) — 고해상도 + 전처리
export async function renderPdfToCanvases(file, scale = 3) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const canvases = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    preprocessCanvas(canvas);
    canvases.push(canvas);
  }
  return canvases;
}

// 캔버스 이미지들 OCR (한국어+영어) → 페이지별 텍스트 배열. tesseract.js는 필요할 때만 동적 로드
export async function ocrCanvasesPerPage(canvases, onProgress) {
  const Tesseract = (await import('tesseract.js')).default;
  const pages = [];
  for (let i = 0; i < canvases.length; i += 1) {
    const { data } = await Tesseract.recognize(canvases[i], 'kor+eng', {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      },
      tessedit_pageseg_mode: '4', // 단일 컬럼 문서 가정
      preserve_interword_spaces: '1',
    });
    pages.push(data.text || '');
  }
  return pages;
}

// 호환용 — 합친 텍스트
export async function ocrCanvases(canvases, onProgress) {
  return (await ocrCanvasesPerPage(canvases, onProgress)).join('\n');
}

// 통장사본 텍스트 → { bankName, bankAccount }
const BANK_NAMES = [
  'KB국민',
  '국민',
  '신한',
  '우리',
  '하나',
  'KEB하나',
  '농협',
  'NH농협',
  '기업',
  'IBK기업',
  'SC제일',
  '제일',
  '씨티',
  '카카오뱅크',
  '케이뱅크',
  '토스뱅크',
  '새마을금고',
  '신협',
  '수협',
  '우체국',
  '대구',
  '부산',
  '경남',
  '광주',
  '전북',
  '제주',
  '산업',
];
export function parseBank(rawText) {
  const t = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = { bankName: '', bankAccount: '' };
  for (const b of BANK_NAMES) {
    if (t.includes(b)) {
      out.bankName = /(뱅크|금고|협|우체국)$/.test(b) ? b : `${b}은행`;
      break;
    }
  }
  // 계좌번호 — 하이픈 포함(3덩이 이상) 우선, 없으면 10~16자리 숫자
  const acc = t.match(/\d{2,6}\s*-\s*\d{2,6}\s*-\s*\d{2,7}(?:\s*-\s*\d{1,6})?/);
  if (acc) out.bankAccount = acc[0].replace(/\s/g, '');
  else {
    const acc2 = t.match(/\b(\d{10,16})\b/);
    if (acc2) out.bankAccount = acc2[1];
  }
  return out;
}

// 페이지 종류 판별 — 사업자등록증 vs 통장사본.
// 사업자등록증 마커가 있고 통장 키워드가 없으면 'bizreg', 통장 키워드(또는 은행명만)면 'bank', 애매하면 'unknown'.
export function classifyPage(rawText) {
  const t = String(rawText || '').replace(/\s+/g, '');
  const biz = /사업자등록증|법인명|단체명|대표자|사업장소재지|업태|종목|사업자등록번호/.test(t);
  const bankKw = /통장사본|통장|예금주|계좌번호|입금계좌|보통예금|예금계좌/.test(t);
  const hasBankName = BANK_NAMES.some((b) => t.includes(b));
  if (biz && !bankKw) return 'bizreg';
  if (bankKw || (hasBankName && !biz)) return 'bank';
  if (biz) return 'bizreg';
  return 'unknown';
}

// 텍스트 우선 추출, 텍스트가 거의 없으면(스캔 PDF) OCR 폴백.
// ★ 페이지별로 분류해 사업자등록증 페이지엔 사업자정보 파서만, 통장 페이지엔 통장 파서만 적용.
//   → 사업자등록증 2페이지의 숫자(사업자번호 등)를 계좌번호로 오인하거나, 통장 인식이 밀리는 문제 해결.
// onStage(stage, progress?) : 'reading' | 'rendering' | 'ocr'
export async function extractBizInfo(file, onStage) {
  if (onStage) onStage('reading');
  const pages = await extractPdfTextPerPage(file);
  let usedOcr = false;

  // ★ 페이지 단위로 OCR 폴백 판단 — 글자가 부족한(스캔/이미지) 페이지만 OCR.
  //   문서 전체 합산으로 판단하면, 사업자등록증(텍스트)+통장사본(스캔) 혼합 첨부 시
  //   합산 글자수가 20을 넘겨 OCR이 통째로 건너뛰고 통장(계좌)이 안 잡히는 문제가 있었음.
  const weak = pages.map((t) => String(t || '').replace(/\s/g, '').length < 20);
  if (weak.some(Boolean)) {
    usedOcr = true;
    if (onStage) onStage('rendering');
    const canvases = await renderPdfToCanvases(file);
    const total = weak.filter(Boolean).length;
    let done = 0;
    if (onStage) onStage('ocr', 0);
    for (let i = 0; i < pages.length; i += 1) {
      if (!weak[i] || !canvases[i]) continue;
      const [ocrText] = await ocrCanvasesPerPage(
        [canvases[i]],
        (p) => onStage && onStage('ocr', (done + (p || 0)) / total),
      );
      pages[i] = ocrText || '';
      done += 1;
    }
  }

  const parsed = { name: '', representative: '', businessNumber: '', bankName: '', bankAccount: '' };
  const take = (src, keys) =>
    keys.forEach((k) => {
      if (!parsed[k] && src[k]) parsed[k] = src[k];
    });
  const dbg = [];
  pages.forEach((pageText, i) => {
    const kind = classifyPage(pageText);
    if (kind === 'bank') {
      const r = parseBank(pageText);
      take(r, ['bankName', 'bankAccount']);
      dbg.push({ page: i + 1, kind, ...r });
    } else {
      // 'bizreg' 또는 'unknown' → 사업자정보만 (통장 파서 미적용 → 사업자번호를 계좌번호로 오인 방지)
      const r = parseBizReg(pageText);
      take(r, ['name', 'representative', 'businessNumber']);
      dbg.push({ page: i + 1, kind, ...r });
    }
  });

  // 진단용 — 어느 페이지가 무엇으로 분류돼 무엇이 잡혔는지 콘솔(F12)로 확인 가능.
  // 값이 안 채워질 때 추출 텍스트와 분류 결과를 바로 보고 정규식/분류를 고치기 위함.
  try {
    // eslint-disable-next-line no-console
    console.info('[bizPdf] 추출 결과', { file: file?.name, usedOcr, perPage: dbg, merged: parsed });
    // eslint-disable-next-line no-console
    console.debug('[bizPdf] 페이지별 원문', pages);
  } catch {
    /* noop */
  }

  return { parsed, usedOcr, text: pages.join('\n') };
}

// 회사명 통일 — "주식회사 X" / "X 주식회사" / "㈜X" / "(주) X" → "(주)X"
export function normalizeCompany(name) {
  let n = String(name || '').trim();
  if (!n) return n;
  const isCorp = /주식회사|㈜|\(\s*주\s*\)/.test(n);
  n = n
    .replace(/주식회사|㈜|\(\s*주\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (isCorp && n) n = `(주)${n}`;
  return n;
}

// 사업자등록증 텍스트 → { name, representative, businessNumber }
export function parseBizReg(rawText) {
  const t = String(rawText || '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = { name: '', representative: '', businessNumber: '' };

  // 사업자등록번호 (하이픈 누락·공백 허용 → xxx-xx-xxxxx로 정규화)
  const bn = t.match(/(\d{3})\s*[-–]?\s*(\d{2})\s*[-–]?\s*(\d{5})/);
  if (bn) out.businessNumber = `${bn[1]}-${bn[2]}-${bn[3]}`;

  // 상호(법인명/단체명)
  const nm = t.match(
    /(?:법\s*인\s*명|단\s*체\s*명|상\s*호)\s*(?:\([^)]*\))?\s*[:：]?\s*([^:：]+?)\s*(?=성\s*명|대\s*표|등\s*록|사\s*업|개\s*업|생\s*년|소\s*재|주\s*소|$)/,
  );
  if (nm)
    out.name = normalizeCompany(
      nm[1]
        .trim()
        .replace(/[()]+$/, '')
        .trim(),
    );

  // 성명(대표자)
  const rep = t.match(
    /(?:성\s*명|대\s*표\s*자)\s*(?:\([^)]*\))?\s*[:：]?\s*([^:：]+?)\s*(?=생\s*년|개\s*업|사\s*업|등\s*록|주\s*소|소\s*재|상\s*호|$)/,
  );
  if (rep) out.representative = rep[1].trim();

  return out;
}
