// 사업자등록증 PDF에서 상호·대표자·사업자등록번호 자동 추출 (텍스트 기반 PDF 전용)
// pdfjs(~300KB)는 사업자등록증 처리 시에만 필요하므로 지연 로딩 — 초기 번들에서 제외.
let _pdfjsPromise = null;
function loadPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjsLib = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjsLib;
    })();
  }
  return _pdfjsPromise;
}

// PDF 파일 → 전체 텍스트
export async function extractPdfText(file) {
  return (await extractPdfTextPerPage(file)).join('\n');
}

// PDF 파일 → 페이지별 텍스트 배열 (페이지 분류용)
export async function extractPdfTextPerPage(file) {
  const pdfjsLib = await loadPdfjs();
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
  // 1) 그레이스케일
  for (let i = 0, j = 0; i < d.length; i += 4, j += 1) {
    gray[j] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }
  // 2) 명암 정규화 — 2~98 백분위로 스트레치. 통장사본처럼 옅은 글자(저대비) 스캔의
  //    인식률을 크게 올린다. (이 단계 없이는 Otsu가 흐린 글자를 통째로 날려버림)
  const ghist = new Array(256).fill(0);
  for (let j = 0; j < n; j += 1) ghist[gray[j]] += 1;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let t = 0; t < 256; t += 1) {
    acc += ghist[t];
    if (acc >= n * 0.02) {
      lo = t;
      break;
    }
  }
  acc = 0;
  for (let t = 255; t >= 0; t -= 1) {
    acc += ghist[t];
    if (acc >= n * 0.02) {
      hi = t;
      break;
    }
  }
  const span = Math.max(1, hi - lo);
  // 3) 정규화 적용 + Otsu용 히스토그램 재계산
  const hist = new Array(256).fill(0);
  for (let j = 0; j < n; j += 1) {
    let v = Math.round(((gray[j] - lo) * 255) / span);
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    gray[j] = v;
    hist[v] += 1;
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
  const pdfjsLib = await loadPdfjs();
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

// 캔버스 회전 (0/90/180/270) — 눕혀 찍거나 스캔한 통장·서류 대응
function rotateCanvasEl(src, deg) {
  if (!deg) return src;
  const canvas = document.createElement('canvas');
  if (deg === 90 || deg === 270) {
    canvas.width = src.height;
    canvas.height = src.width;
  } else {
    canvas.width = src.width;
    canvas.height = src.height;
  }
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

// 사업자등록증·통장사본 키워드 — 방향(회전) 자동 감지에 사용
const BIZ_KEYWORDS = /통장|계좌|예금|은행|보통예금|예금주|사업자등록|법인명|단체명|대표자|사업장|등록번호/;

// 캔버스 이미지들 OCR (한국어+영어) → 페이지별 텍스트 배열. tesseract.js는 필요할 때만 동적 로드.
// ★ 방향 자동 감지: 0°부터 돌려보며 사업자/통장 키워드가 잡히는 방향을 채택(눕힌 사진·스캔 대응).
export async function ocrCanvasesPerPage(canvases, onProgress) {
  const Tesseract = (await import('tesseract.js')).default;
  const pages = [];
  for (let i = 0; i < canvases.length; i += 1) {
    // 1) 방향 자동 감지 + 본문 인식 (PSM 6)
    let best = null;
    for (const deg of [0, 90, 270, 180]) {
      const rot = rotateCanvasEl(canvases[i], deg);
      const { data } = await Tesseract.recognize(rot, 'kor+eng', {
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') onProgress(m.progress * 0.6);
        },
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      });
      const text = data.text || '';
      if (deg === 0) best = { text, canvas: rot }; // 기본값(정방향)
      if (BIZ_KEYWORDS.test(text.replace(/\s+/g, ''))) {
        best = { text, canvas: rot };
        break; // 키워드가 잡히는 방향 = 올바른 방향
      }
    }
    // 2) 숫자 전용 보강 패스 — 채택된 방향에서 계좌번호·사업자번호 인식
    let digits = '';
    try {
      const dRes = await Tesseract.recognize(best.canvas, 'eng', {
        logger: (m) => {
          if (onProgress && m.status === 'recognizing text') onProgress(0.6 + m.progress * 0.4);
        },
        tessedit_pageseg_mode: '11', // sparse text — 흩어진 숫자 덩어리 인식
        tessedit_char_whitelist: '0123456789-',
      });
      digits = dRes.data.text || '';
    } catch {
      /* 숫자 보강 실패는 무시 — 본문 패스만으로 진행 */
    }
    pages.push(`${best.text || ''}\n${digits}`);
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
  // ★ 공백 완전 제거(compact) + 하이픈 변형 정규화 — 스캔 OCR이 하이픈을 em-dash(—)·
  //   다른 기호로 읽어도 계좌번호가 매칭되게 ASCII '-'로 통일한다.
  const c = String(rawText || '')
    .replace(/[—–―‒−﹣－‐ー]/g, '-').replace(/-{2,}/g, '-')
    .replace(/\s+/g, '');
  const out = { bankName: '', bankAccount: '' };
  for (const b of BANK_NAMES) {
    if (c.includes(b)) {
      out.bankName = /(뱅크|금고|협|우체국)$/.test(b) ? b : `${b}은행`;
      break;
    }
  }
  // 계좌번호 — 하이픈 포함(3덩이) 우선. 전화·팩스(0 또는 15·16·18로 시작)는 제외하고
  //   계좌형만 채택. 계좌형이 없으면 전화번호를 잘못 채우지 않도록 비워둔다(수기 입력 유도).
  //   각 구간 2~6자리로 제한 — 인접한 전화번호 앞자리를 끌어와 과다매칭되는 것 방지.
  const accs = [...c.matchAll(/\d{2,6}-\d{2,6}-\d{2,6}(?:-\d{2,6})?/g)].map((m) => m[0]);
  const acc = accs.find((a) => !/^0/.test(a) && !/^1[5689]/.test(a));
  if (acc) out.bankAccount = acc;
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
// 첨부 가능 여부 — PDF 또는 이미지(휴대폰 사진·스캔)
export function isImageFile(file) {
  return (
    (file?.type || '').startsWith('image/') ||
    /\.(jpe?g|png|webp|bmp|gif|heic|heif)$/i.test(file?.name || '')
  );
}
export function isSupportedBizFile(file) {
  return (
    file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '') || isImageFile(file)
  );
}

// 이미지 파일 → OCR용 캔버스 (작으면 확대해 인식률↑, 큰 건 maxDim로 축소)
async function imageFileToCanvas(file, maxDim = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('이미지를 읽을 수 없습니다(HEIC 등은 JPG/PNG로 변환해 올려주세요).'));
      im.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('이미지 크기를 확인할 수 없습니다.');
    const scale = Math.min(2, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 페이지별 텍스트 → 사업자/통장 정보 병합 (PDF·이미지 공용)
function parsePagesToInfo(pages, { usedOcr = false, fileName = '' } = {}) {
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
  try {
    // eslint-disable-next-line no-console
    console.info('[bizPdf] 추출 결과', { file: fileName, usedOcr, perPage: dbg, merged: parsed });
    // eslint-disable-next-line no-console
    console.debug('[bizPdf] 페이지별 원문', pages);
  } catch {
    /* noop */
  }
  return { parsed, usedOcr, text: pages.join('\n') };
}

// 사업자등록증·통장사본(PDF 또는 사진)에서 상호·대표자·사업자번호·은행·계좌 추출.
// onStage(stage, progress?) : 'reading' | 'rendering' | 'ocr'
export async function extractBizInfo(file, onStage) {
  // 이미지(휴대폰 사진·스캔 이미지) → 전처리 후 OCR
  if (isImageFile(file)) {
    if (onStage) onStage('rendering');
    const canvas = await imageFileToCanvas(file);
    preprocessCanvas(canvas);
    if (onStage) onStage('ocr', 0);
    const pages = await ocrCanvasesPerPage([canvas], (p) => onStage && onStage('ocr', p));
    return parsePagesToInfo(pages, { usedOcr: true, fileName: file?.name });
  }

  // PDF — 텍스트 우선, 글자가 부족한(스캔) 페이지만 OCR
  if (onStage) onStage('reading');
  const pages = await extractPdfTextPerPage(file);
  let usedOcr = false;
  // ★ 페이지 단위로 OCR 폴백 — 사업자등록증(텍스트)+통장사본(스캔) 혼합에서도 통장 페이지만 OCR.
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
  return parsePagesToInfo(pages, { usedOcr, fileName: file?.name });
}

// 회사명 통일 — "주식회사 X" / "X 주식회사" / "㈜X" / "(주) X" → "(주)X"
export function normalizeCompany(name) {
  let n = String(name || '').trim();
  if (!n) return n;
  // 주식회사 표기 변형 모두 인식 → "(주)"로 통일:
  //   자간 공백("주 식 회 사"), "주식 회사", ㈜, (주)/( 주 ), 전각 괄호「（주）」
  const CORP = /주\s*식\s*회\s*사|㈜|[(（]\s*주\s*[)）]/;
  const isCorp = CORP.test(n);
  n = n
    .replace(/주\s*식\s*회\s*사|㈜|[(（]\s*주\s*[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (isCorp && n) n = `(주)${n}`;
  return n;
}

// 사업자등록증 텍스트 → { name, representative, businessNumber }
export function parseBizReg(rawText) {
  // ★ 공백 완전 제거(compact) + 하이픈 변형 정규화 — "주 식 회 사", "1 5 6 - 8 7",
  //   OCR이 em-dash로 읽은 "156—87—03859" 같은 경우에도 라벨·숫자가 잡힌다.
  const c = String(rawText || '')
    .replace(/[—–―‒−﹣－‐ー]/g, '-').replace(/-{2,}/g, '-')
    .replace(/\s+/g, '');
  const out = { name: '', representative: '', businessNumber: '' };

  // 사업자등록번호 3-2-5 — '등록번호' 라벨 뒤 우선, 없으면 문서 내 첫 3-2-5
  //   (법인등록번호 6-7자리와 하이픈 위치로 구분됨)
  const bn =
    c.match(/(?:사업자등록번호|등록번호)[:：]?(\d{3})-?(\d{2})-?(\d{5})(?!\d)/) ||
    c.match(/(\d{3})-(\d{2})-(\d{5})(?!\d)/);
  if (bn) out.businessNumber = `${bn[1]}-${bn[2]}-${bn[3]}`;

  // 상호(법인명/단체명/상호)
  const nm = c.match(/(?:법인명\(단체명\)|법인명|단체명|상호)[:：]?(.+?)(?=대표자|성명|개업|등록|사업|소재|발급|$)/);
  if (nm) out.name = normalizeCompany(nm[1].replace(/[()]/g, ''));

  // 대표자/성명 — 라벨 뒤 한글 이름(2~5자)
  let rep = c.match(/(?:성명|대표자)(?:\([^)]*\))?[:：]?([가-힣]{2,5})(?=생년|개업|사업|등록|주소|소재|법인|$)/);
  // 폴백 — 국세청 양식에서 대표자명이 라벨과 분리돼 소재지 뒤·사업종류 앞에 오는 경우
  if (!rep) rep = c.match(/\)([가-힣]{2,4})(?=사업의종류|업태|종목)/);
  if (rep) out.representative = rep[1];

  return out;
}
