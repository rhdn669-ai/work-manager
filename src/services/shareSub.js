// 같은 자료를 여러 화면이 동시에 볼 때, 구독을 하나만 열어 나눠 쓴다
// (2026-09-05 대표님 「앱이 엄청 느려졌어」 — 화면마다 전체 컬렉션을 따로 읽고 있었다).
//
// 마지막 화면이 떠나면 구독을 닫는다. 이미 받아 둔 값이 있으면 새 화면에 곧바로 준다.

export function shareSubscription(open) {
  let unsub = null;
  let last;
  let hasValue = false;
  const subs = new Set();
  return function subscribe(cb) {
    subs.add(cb);
    if (hasValue) cb(last);
    if (!unsub) {
      unsub = open((v) => {
        last = v;
        hasValue = true;
        for (const f of subs) f(v);
      });
    }
    return () => {
      subs.delete(cb);
      if (subs.size === 0 && unsub) {
        unsub();
        unsub = null;
        hasValue = false;
        last = undefined;
      }
    };
  };
}
