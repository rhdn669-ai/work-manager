// 비밀번호 힌트 답변 해시화 — Web Crypto API 기반 SHA-256
// 평문 저장은 위험하므로(관리자가 Firestore 콘솔로 답을 볼 수 있음) 해시 저장 후 비교
// 답변 입력값은 trim + lowercase + 공백 제거로 정규화 → 사용자가 약간 다르게 입력해도 매칭

export function normalizeAnswer(s) {
  return (s || '').toString().trim().toLowerCase().replace(/\s+/g, '');
}

export async function sha256Hex(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashAnswer(text) {
  return sha256Hex(normalizeAnswer(text));
}
