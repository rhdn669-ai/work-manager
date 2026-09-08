// 사내 서버의 파일 보관함 — 자료실 첨부와 생산 사진을 올리고 내려받는다. (2026-09-08)
//
// 보관함은 «비공개»다. 링크만 알면 누구나 여는 일이 없도록, 화면에 보여 줄 때마다
// 잠시(네 시간) 동안만 열리는 주소를 새로 만들어 준다.
//
//   library    자료실 첨부           경로: 폴더id/파일이름
//   production 생산 사진             경로: defects/… · ship/…
import { sb } from '../config/serverData';

const SIGN_SECONDS = 4 * 60 * 60;

// 저장 위치를 «보관함 + 경로» 로 가른다. 자료실은 예전 경로(library/…)를 그대로 쓴다.
export function splitPath(storagePath = '') {
  const p = String(storagePath).replace(/^\/+/, '');
  if (p.startsWith('library/')) return { bucket: 'library', path: p.slice('library/'.length) };
  if (p.startsWith('productionDefects/'))
    return { bucket: 'production', path: 'defects/' + p.slice('productionDefects/'.length) };
  if (p.startsWith('productionShipPhotos/'))
    return { bucket: 'production', path: 'ship/' + p.slice('productionShipPhotos/'.length) };
  const i = p.indexOf('/');
  return i > 0 ? { bucket: p.slice(0, i), path: p.slice(i + 1) } : { bucket: 'library', path: p };
}

// 사내 서버에 올린 파일은 주소 대신 이 표시로 저장한다 — 나중에 도메인이 바뀌어도 그대로 쓴다.
export const MARK = 'wm-file://';
export const markOf = (bucket, path) => `${MARK}${bucket}/${path}`;
export const isMarked = (u) => typeof u === 'string' && u.startsWith(MARK);

// 예전 구글 주소에서 저장 위치를 되찾는다 (사진처럼 주소만 적혀 있던 것들)
export function pathFromFirebaseUrl(url = '') {
  const m = /\/o\/([^?]+)/.exec(String(url));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

// 잠시 열리는 주소 만들기 — 여러 개를 한 번에
export async function signMany(entries) {
  const out = new Map();
  const byBucket = new Map();
  for (const e of entries) {
    const { bucket, path } = e;
    if (!bucket || !path) continue;
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(path);
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data, error } = await sb.storage.from(bucket).createSignedUrls(chunk, SIGN_SECONDS);
      if (error) continue;
      for (const row of data || []) {
        if (row.signedUrl) out.set(`${bucket}/${row.path}`, row.signedUrl);
      }
    }
  }
  return out;
}

export async function signOne(bucket, path) {
  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, SIGN_SECONDS);
  if (error) throw new Error(`파일 주소를 만들지 못했습니다: ${error.message}`);
  return data.signedUrl;
}

// 화면에 넘길 주소로 바꾼다. 예전 구글 주소는 그대로 두어 옮기기 전에도 열린다.
export async function resolveUrl(value) {
  if (!value) return value;
  if (!isMarked(value)) return value;
  const rest = value.slice(MARK.length);
  const i = rest.indexOf('/');
  return signOne(rest.slice(0, i), rest.slice(i + 1));
}

// 올리기 — 올린 뒤에는 표시(wm-file://…)를 돌려준다
export async function uploadFileTo(bucket, path, file, contentType) {
  const { error } = await sb.storage.from(bucket).upload(path, file, {
    contentType: contentType || file.type || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`파일을 올리지 못했습니다: ${error.message}`);
  return markOf(bucket, path);
}

export async function removeFileAt(storagePath) {
  const { bucket, path } = splitPath(storagePath);
  const { error } = await sb.storage.from(bucket).remove([path]);
  if (error) throw new Error(`파일을 지우지 못했습니다: ${error.message}`);
}
