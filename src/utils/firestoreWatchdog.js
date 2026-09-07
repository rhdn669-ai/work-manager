import { doc, getDocFromServer, terminate, clearIndexedDbPersistence } from '../config/data';
import { db } from '../config/data';

// Firestore 로컬 캐시(IndexedDB)가 꼬여 읽기가 영영 안 오는 상태를 잡는다
// (2026-09-05 대표님 「앱이 먹통 · 이 상태에서 자꾸 머무는데」 — 새 창은 정상, 그 창만 멈춤).
//
// 앱을 켜고 잠시 뒤 서버에 작은 문서 하나를 직접 요청해 본다. 인터넷은 되는데 응답이 «아예»
// 안 오면(오류도 아니고 그냥 멈춤) 캐시가 원인이다 — 그때 화면에 「초기화 후 다시 열기」를 띄운다.
// 오프라인이거나 서버가 오류를 돌려주는 경우는 캐시 탓이 아니므로 건드리지 않는다.

const PROBE_TIMEOUT_MS = 15000;

export function probeFirestore() {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(navigator.onLine ? 'stuck' : 'offline');
    }, PROBE_TIMEOUT_MS);
    getDocFromServer(doc(db, 'settings', 'paidSets'))
      .then(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve('ok');
      })
      .catch(() => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve('error');
      });
  });
}

/** 로컬 캐시를 비우고 새로 연다 — 데이터는 서버에 있으니 잃는 것은 없다 */
export async function resetLocalCacheAndReload() {
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('[firestore] 캐시 비우기 실패 — 그냥 새로고침', err);
  }
  window.location.reload();
}
