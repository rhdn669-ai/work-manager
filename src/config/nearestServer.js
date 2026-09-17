// 사내에서는 사내 길로 — 같은 사무실에 둔 서버인데도 요청이 인터넷을 한 바퀴 돌아 들어와
// 조회 한 번에 0.3초가 걸렸다. 사내 길로 곧장 가면 0.02초다 (2026-09-17 실측).
// 그래서 앱이 켜질 때 «사내 길이 열려 있나»를 한 번 찔러 보고, 열려 있으면 그 길을 쓴다.
// 밖(집·현장)에서는 닫혀 있으므로 자동으로 바깥 길(터널)로 간다.
//
// 고른 길은 이 탭에 적어 두어 다음부터는 안 찔러 본다. 사내·바깥을 오가는 일은 하루에
// 몇 번 없고, 탭을 새로 열면 다시 고른다.

const MARK = 'wmServerPath';
const WAIT = 700; // 사내면 0.03초에 답한다. 이만큼 기다려도 안 오면 바깥이다.

/** 이 길이 살아 있나 — 열쇠 없이도 답이 오는 가장 가벼운 자리를 찌른다 */
async function alive(base, anon) {
  try {
    const stop = new AbortController();
    const t = setTimeout(() => stop.abort(), WAIT);
    const r = await fetch(`${base}/rest/v1/`, {
      method: 'HEAD',
      headers: { apikey: anon },
      signal: stop.signal,
      cache: 'no-store',
    });
    clearTimeout(t);
    return r.ok || r.status === 401 || r.status === 404; // 답이 왔다는 것이 중요하다
  } catch {
    return false;
  }
}

/**
 * 쓸 주소를 고른다. 사내 주소를 안 적어 두었으면 바깥 주소를 그대로 쓴다.
 * @param far  바깥 길 (터널)
 * @param near 사내 길 — 없으면 고르기 자체를 안 한다
 */
export async function pickServer(far, near, anon) {
  if (!near || near === far) return far;
  let kept = null;
  try {
    kept = sessionStorage.getItem(MARK);
  } catch {
    kept = null;
  }
  if (kept === 'near') return near;
  if (kept === 'far') return far;
  const ok = await alive(near, anon);
  try {
    sessionStorage.setItem(MARK, ok ? 'near' : 'far');
  } catch {
    /* 사생활 보호 창에서는 못 적는다 — 다음에 다시 찔러 보면 된다 */
  }
  return ok ? near : far;
}
