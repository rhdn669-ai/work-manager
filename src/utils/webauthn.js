// WebAuthn 기기별 지문 빠른 로그인 (A안 — 편의 계층, 서버검증 아님)
// 1회 정식 로그인 후 이 기기에 생체 자격증명을 등록 → 다음부터 지문/Face/Windows Hello로
// 저장된 코드를 잠금해제해 로그인. 기기당 1계정.
// 보안 주의: 서버 검증이 없는 편의 기능. 정식 패스키(서버검증)는 보안 강화 단계에서 별도 진행.

const STORE_KEY = 'wm-bio';

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuf(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function isBioSupported() {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!(navigator.credentials && navigator.credentials.create)
  );
}

// 기기에 실제 생체 인증기(지문/Face/Windows Hello)가 있는지
export async function isPlatformAuthAvailable() {
  if (!isBioSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function getBioRecord() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function hasBioRegistered() {
  const r = getBioRecord();
  return !!(r && r.credId && r.code);
}

export function clearBio() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

// 이 기기에 생체 자격증명 등록 (정식 로그인된 profile 필요). 기기당 1계정 — 이전 것 교체.
export async function registerBio(profile) {
  if (!isBioSupported()) throw new Error('이 기기는 생체 인증을 지원하지 않습니다.');
  if (!profile?.code) throw new Error('로그인 코드를 확인할 수 없습니다.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'IOPN Work Manager', id: location.hostname },
      user: { id: userId, name: profile.code, displayName: profile.name || profile.code },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('지문 등록이 취소되었습니다.');
  localStorage.setItem(
    STORE_KEY,
    JSON.stringify({
      credId: bufToB64url(cred.rawId),
      code: profile.code,
      name: profile.name || '',
    }),
  );
  return true;
}

// 생체 인증 확인 → 성공 시 저장된 로그인 코드 반환
export async function verifyBio() {
  const rec = getBioRecord();
  if (!rec || !rec.credId) throw new Error('이 기기에 등록된 지문이 없습니다.');
  if (!isBioSupported()) throw new Error('이 기기는 생체 인증을 지원하지 않습니다.');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ type: 'public-key', id: b64urlToBuf(rec.credId) }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error('지문 인증이 취소되었습니다.');
  return rec.code;
}
