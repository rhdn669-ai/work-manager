// 구독이 «첫 값»을 줬는지 센다 — 화면이 자료를 절반만 받은 채 그려지지 않게. (2026-09-14)
//
// 서버에서 호기·입고 기록·발주 입고·BOM·재고통이 저마다 따로 도착한다. 첫 것이 오자마자
// 그리면 「0 − 나감」 같은 중간값이 잠깐 보이고, 표 상자도 위쪽이 아직 덜 그려진 채 높이를
// 재서 작았다 커진다 (대표님 「음수화면이 잠깐보였다가 돌아옴」 「작았다 커짐」).
//
// 쓰는 법:
//   const { take, has } = useArrived();
//   useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
//   const ready = has('panels', 'materials');   // 둘 다 한 번은 왔을 때만 true
//
// take 는 늘 같은 함수라 effect 의 의존에 넣어도 다시 구독하지 않는다.
import { useCallback, useState } from 'react';

export function useArrived() {
  const [got, setGot] = useState({});
  const take = useCallback(
    (key, setter) => (v) => {
      setter(v);
      setGot((g) => (g[key] ? g : { ...g, [key]: true }));
    },
    [],
  );
  const has = (...keys) => keys.every((k) => !!got[k]);
  return { take, has };
}
