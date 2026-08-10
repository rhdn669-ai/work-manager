// 사진을 올리기 전에 줄인다.
//
// 현장에서 폰으로 찍은 사진은 한 장에 3~8MB(4800×3600)다. 불량 부위를 확대해 보고
// A4로 뽑는 용도에는 그만한 화소가 필요 없다 — 인쇄는 200~300dpi면 충분하다.
// 긴 변 2400px·JPEG 90%면 A4 200dpi가 나오고 용량은 1~1.5MB로 내려가 5배쯤 빨라진다.
// (2026-08-10 대표님: 원본 화질에 가깝게 두되 업로드는 빠르게)
//
// 폰 사진은 세로로 찍어도 가로로 저장되고 회전 정보(EXIF)만 따로 붙는 경우가 있다.
// createImageBitmap 의 imageOrientation:'from-image' 가 그 회전을 미리 적용해 준다.

const MAX_EDGE = 2400;
const QUALITY = 0.9;

export async function shrinkImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  if (!file || !file.type?.startsWith('image/')) return file;
  // GIF·SVG 등은 캔버스로 옮기면 오히려 깨지거나 커진다 — 그대로 둔다
  if (!/jpe?g|png|webp|heic|heif/i.test(file.type)) return file;

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // 브라우저가 못 읽으면 원본을 그대로 올린다(업로드 자체는 되게)
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  // 이미 작은 사진은 다시 굽지 않는다 — 화질만 나빠진다
  if (scale === 1 && file.size < 1024 * 1024) {
    bitmap.close?.();
    return file;
  }

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file; // 줄인 것이 더 크면 의미 없다

  const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() });
}
