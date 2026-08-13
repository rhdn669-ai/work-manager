// 엑셀 캡처 사진 OCR — Google Vision API + 파싱 (legacy index.html 검증 로직 이식)
import { BUPMOK } from './production.js';

// Vision API 키 — .env(VITE_VISION_KEY)에서만 로드. 코드에 키를 두지 않는다(공개 repo).
// 미설정 시 OCR 기능만 안내 메시지와 함께 비활성. 키 발급 시 referrer 제한+Vision 한정 권장.
// 장기: Supabase Edge Function 프록시(서버측 시크릿) — 온프레미스 이전 시 함께 처리.
const VISION_KEY = import.meta.env.VITE_VISION_KEY;

export function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 파일 → base64 (data: 접두 제거)
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Google Vision DOCUMENT_TEXT_DETECTION
export async function visionOcr(base64) {
  if (!VISION_KEY) throw new Error('.env에 VITE_VISION_KEY가 없습니다. 키 설정 후 dev 서버를 재시작하세요.');
  const resp = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          image: { content: base64 },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['ko', 'en'] },
        },
      ],
    }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || 'Vision API 오류');
  const anno = json.responses?.[0];
  if (anno?.error) throw new Error(anno.error.message || 'Vision API 오류');
  return anno?.fullTextAnnotation?.text || '';
}

// OCR 원문 → 판넬 행 배열 (legacy parsePhotoText 이식)
export function parsePhotoText(text) {
  // 날짜 표기 정규화: "4 / 27", "4.27", "4-27" 등을 "4/27"로 통일
  text = text.replace(/(\d{1,2})\s*[/／.．·－-]\s*(\d{1,2})/g, '$1/$2');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const parsed = [];
  const year = new Date().getFullYear();
  const toDate = (s) => {
    if (!s || !s.match(/^\d{1,2}\/\d{1,2}$/)) return '';
    const p = s.split('/');
    return `${year}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`;
  };

  let i = 0;
  while (i < lines.length && !lines[i].match(/YS[\s\-.]*TEPS/i)) i++;

  while (i < lines.length) {
    const line = lines[i];
    const tepsM = line.match(/YS[\s\-.]*TEPS\s*(\d+)/i);
    if (!tepsM) {
      i++;
      continue;
    }
    const 호기 = tepsM[1];
    const inlineName = line.replace(tepsM[0], '').trim();

    const rawVals = [];
    if (inlineName) rawVals.push(inlineName);
    i++;
    while (i < lines.length && !lines[i].match(/YS[\s\-.]*TEPS/i)) {
      if (lines[i].length > 0) rawVals.push(lines[i]);
      i++;
    }
    // 한 줄에 여러 값이 합쳐진 경우 분리 (U-FLEX PLUS 등은 유지)
    const vals = [];
    rawVals.forEach((v) => {
      const parts = v.split(/\s+/);
      if (parts.length === 1) {
        vals.push(v);
        return;
      }
      const merged = [];
      for (let k = 0; k < parts.length; k++) {
        if (parts[k].match(/^U[-/]?FLEX$/i) && k + 1 < parts.length && parts[k + 1].match(/^PLUS$/i)) {
          merged.push(parts[k] + ' ' + parts[k + 1]);
          k++;
        } else if (parts[k].match(/^\d+$/) && k > 0 && merged[merged.length - 1] === 'ZONE') {
          merged[merged.length - 1] = parts[k - 1] + ' ' + parts[k];
        } else {
          merged.push(parts[k]);
        }
      }
      merged.forEach((m) => vals.push(m));
    });

    let vi = 0,
      납입처 = '',
      proj = '',
      정역 = '',
      기구 = '',
      자재 = '';
    const dates = [];

    // 납입처
    if (vi < vals.length && !vals[vi].match(/^H[O0]?\d/i) && !vals[vi].match(/^[정역]$/)) {
      납입처 = vals[vi];
      vi++;
    }
    // 프로젝트 (H로 시작)
    if (vi < vals.length && vals[vi].match(/^H[O0]?\d/i)) {
      let pv = vals[vi];
      const tailDir = pv.match(/([정역])$/);
      if (tailDir) {
        pv = pv.slice(0, -1);
        정역 = tailDir[1];
      }
      proj = pv
        .replace(/[\s-]/g, '_')
        .toUpperCase()
        .replace(/^HO(0)?/, 'H0');
      vi++;
    }
    // 방향 (별도 줄)
    if (!정역 && vi < vals.length && (vals[vi] === '정' || vals[vi] === '역')) {
      정역 = vals[vi];
      vi++;
    }
    // 방향+제작 합쳐진 경우
    if (!정역 && vi < vals.length) {
      const dirMfg = vals[vi].match(/^([정역])\s*(건일|두원|대원)/);
      if (dirMfg) {
        정역 = dirMfg[1];
        vals[vi] = dirMfg[2];
      }
    }
    // 제작+방향 합쳐진 경우
    if (!정역 && vi < vals.length) {
      const mfgDir = vals[vi].match(/^(건일|두원|대원)\s*([정역])$/);
      if (mfgDir) {
        기구 = mfgDir[1];
        정역 = mfgDir[2];
        vi++;
      }
    }
    // 방향이 앞쪽 값에 포함
    if (!정역) {
      for (let k = vi; k < Math.min(vi + 3, vals.length); k++) {
        if (vals[k] === '정' || vals[k] === '역') {
          정역 = vals[k];
          vals.splice(k, 1);
          break;
        }
        if (vals[k].match(/^[정역]\s/)) {
          정역 = vals[k][0];
          vals[k] = vals[k].slice(1).trim();
          break;
        }
        if (vals[k].match(/\s[정역]$/)) {
          정역 = vals[k].slice(-1);
          vals[k] = vals[k].slice(0, -1).trim();
          break;
        }
      }
    }
    // 제작
    if (
      !기구 &&
      vi < vals.length &&
      (vals[vi].includes('건일') || vals[vi].includes('두원') || vals[vi].includes('대원'))
    ) {
      기구 = vals[vi].includes('건일') ? '건일' : vals[vi].includes('두원') ? '두원' : '대원';
      vi++;
    }
    if (!기구) {
      for (let k = vi; k < Math.min(vi + 3, vals.length); k++) {
        if (vals[k].includes('건일') || vals[k].includes('두원') || vals[k].includes('대원')) {
          기구 = vals[k].includes('건일') ? '건일' : vals[k].includes('두원') ? '두원' : '대원';
          vals.splice(k, 1);
          break;
        }
      }
    }
    // 날짜들 (M/D)
    while (vi < vals.length && vals[vi].match(/^\d{1,2}\/\d{1,2}$/)) {
      dates.push(vals[vi]);
      vi++;
    }
    // 자재구분
    for (let k = vi; k < vals.length; k++) {
      const m = vals[k].match(/T\d{3,5}|M\d[A-Z]*\d*|MT\d{3,5}|U[-/]?FLEX\s*PLUS|M7HSV/i);
      if (m) {
        자재 = m[0].toUpperCase();
        break;
      }
    }

    const 자재필요 = toDate(dates[0]);
    const ioCheck = toDate(dates[2]);
    const 납기 = ioCheck ? addDays(ioCheck, -14) : '';
    const 턴온 = ioCheck ? addDays(ioCheck, -1) : '';

    if (호기)
      parsed.push({
        프로젝트: proj,
        호기,
        정역,
        기구제작: 기구,
        자재,
        납입처,
        자재입고: 자재필요,
        납기,
        턴온,
        'I/O CHECK': ioCheck || '',
      });
  }
  return parsed;
}

export const OCR_COLUMNS = ['프로젝트', '호기', '정역', '기구제작', '자재', '자재입고', '납기', '턴온', 'I/O CHECK'];
export { BUPMOK };
