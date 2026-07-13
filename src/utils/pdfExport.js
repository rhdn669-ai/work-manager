import { uploadFile } from '../services/fileLibraryService';

// 발주서/견적서/BOM 양식을 서버 렌더(headless Chromium, page.pdf)로 생성 → PDF Blob 반환.
// page.pdf는 브라우저 인쇄(window.print)와 '동일한 Chromium 인쇄 엔진'이라 벡터·선명하다.
// ※ 흐린 html2canvas(화면 사진 캡처) 폴백은 제거 — 저화질 파일이 자료실에 저장되지 않게.
//    서버 렌더가 불가/실패하면 throw하여 호출자가 "실패"로 처리(흐린 파일 저장 안 함).
export async function captureToPdfBlob(element, fileName) {
  const cssUrls = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).filter(Boolean);
  if (cssUrls.length === 0) {
    // 빌드 CSS가 <link>로 없으면(로컬 vite dev) 서버 렌더 불가
    throw new Error('자료실 저장은 배포 환경에서만 동작합니다(로컬 개발 서버 미지원).');
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

// PDF Blob을 자료실에 업로드 — 기존 uploadFile 경로를 그대로 재사용해
// libraryFiles 스키마(uploadedBy 등)와 100% 일치시킨다.
export async function uploadPdfToLibrary(blob, fileName, folderId, user, onProgress) {
  const safeName = (fileName || 'document').replace(/[/\\]/g, '_');
  const withExt = safeName.toLowerCase().endsWith('.pdf') ? safeName : `${safeName}.pdf`;
  const file = new File([blob], withExt, { type: 'application/pdf' });
  await uploadFile(file, folderId || null, user, onProgress, withExt);
}
