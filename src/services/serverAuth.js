// 사내 서버 로그인 — 직원은 지금처럼 «사번 + 비밀번호»만 입력한다.
// 서버(GoTrue)는 아이디를 이메일 모양으로 받으므로 여기서 «사번@iopn.local» 로 바꿔 준다.
// 비밀번호는 서버가 암호로 바꿔 보관하므로, 앱이나 자료 표에는 남지 않는다. (2026-09-07)
import { sb } from '../config/serverData';

const DOMAIN = 'iopn.local';

export async function signInToServer(code, password) {
  // 비밀번호가 없으면(지문 로그인) 이미 열려 있는 세션을 확인만 한다
  if (password === null || password === undefined) {
    const { data } = await sb.auth.getSession();
    return !!data?.session;
  }
  const { error } = await sb.auth.signInWithPassword({
    email: `${code}@${DOMAIN}`,
    password,
  });
  if (error) {
    // 서버가 거절한 이유를 그대로 보여 주지 않는다 — 사번이 있는지 없는지 알려 주지 않기 위해
    throw new Error('코드 또는 비밀번호가 올바르지 않습니다.');
  }
  return true;
}

export function signOutOfServer() {
  sb.auth.signOut().catch(() => {});
}

export async function serverSessionAlive() {
  const { data } = await sb.auth.getSession();
  return !!data?.session;
}
