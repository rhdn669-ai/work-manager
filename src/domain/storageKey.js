// 보관함(Storage)에 올릴 때 쓰는 «파일 열쇠» 이름.
//
// 사내 서버의 보관함은 열쇠에 영문·숫자와 몇몇 기호만 허용한다. 한글이 들어가면
// 「400 InvalidKey」로 거부된다 — 2026-09-08 사내 서버로 옮긴 뒤 「(주)에이티이엔지_통장사본.pdf」
// 처럼 한글 이름을 그대로 열쇠로 쓰던 자료실 올리기가 «전부» 조용히 실패하고 있었다
// (2026-09-18 대표님 「pdf 자료실 저장중 오류가 발생했습니다」).
// 사람이 보는 이름은 문서(libraryFiles.name)에 그대로 두고, 열쇠는 도장(stamp)+확장자만 쓴다.

/** 파일 이름에서 «영문·숫자 확장자»만 뽑는다 — 없거나 이상하면 bin */
export function asciiExt(fileName) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(fileName || '').trim());
  return m ? m[1].toLowerCase() : 'bin';
}

/** 보관함 열쇠 이름 — 도장과 확장자만. 한글·공백·괄호가 절대 섞이지 않는다 */
export function storageKeyName(fileName, stamp) {
  return `${stamp}.${asciiExt(fileName)}`;
}
