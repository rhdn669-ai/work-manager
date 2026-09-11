// 메일 보내기 — 사내 서버판.
//
// 구글 함수(sendPurchaseOrderEmail)를 부르던 자리를 그대로 대신한다. 돌려주는 모양도
// 같게 `{ data: { success, messageId } }` 로 맞춰 두었으므로 부르는 쪽은 고칠 것이 없다.
//
// 보내는 일은 NAS 의 «메일 살림»(supabase-mailer)이 한다. 관문(Kong)의 /mail/v1/ 로 들어간다.
import { sb } from './serverData';
import { callSendEmail as callGoogleMail } from './firebase';

const URL = import.meta.env.VITE_SB_URL || '';
const ANON = import.meta.env.VITE_SB_ANON_KEY || '';

// 사내 메일 살림이 아직 준비되지 않았거나 잠깐 멈췄을 때 — 지금까지 쓰던 구글 발송으로 보낸다.
// 발주서 메일이 끊기면 일이 멈추므로, 옮기는 동안에는 두 길을 다 열어 둔다 (2026-09-11).
export async function callSendEmail(data) {
  try {
    return await sendViaServer(data);
  } catch (e) {
    console.warn('[메일] 사내 서버 발송 실패 — 구글로 보냅니다:', e?.message || e);
    return callGoogleMail(data);
  }
}

async function sendViaServer(data) {
  // 로그인한 사람만 보낼 수 있다 — 서버가 이 표(JWT)를 그 자리에서 검산한다
  const { data: s } = await sb.auth.getSession();
  const token = s?.session?.access_token;
  if (!token) throw new Error('로그인이 풀렸습니다. 다시 로그인한 뒤 보내 주세요.');

  const res = await fetch(`${URL}/mail/v1/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `메일 발송 실패 (${res.status})`);
  return { data: out };
}
