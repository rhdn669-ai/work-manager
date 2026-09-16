import { collection, doc, getDoc, onSnapshot, setDoc } from '../config/data';
import { db } from '../config/data';
import { setLotsOf } from '../utils/setLots';

// 도급 세트 (2026-09-03 대표님) — 우리가 사서 넣는 도급 자재를 세트로 세고 호기에 배정한다.
//
//   설정   settings/paidSets  { [회사]: { startProject, siteId, siteName } }
//   입고   발주서(purchases) 줄의 receivedQty — 프로젝트(siteId)가 설정한 발주 현장인 발주서만.
//          BOM 프로젝트(bomProjects)와 발주서의 현장(sites)은 다른 목록이라 id 가 다르다 —
//          그래서 어느 현장 발주서를 셀지 회사마다 한 번 고른다 (2026-09-03 대표님 「연결 고리」)
//   배정   판넬 문서 paidSet { seq, at, by } + 그 호기 BOX 별 도급 줄 들어온 개수 = BOM 수량
//          + 자재 도급 칸 켜짐 (자재 체크 페이지 ④ 연동과 같은 결과)

const settingsRef = doc(db, 'settings', 'paidSets');
const purchasesRef = collection(db, 'purchases');

export function subscribePaidSetSettings(cb) {
  return onSnapshot(settingsRef, (snap) => cb(snap.exists() ? snap.data() : {}));
}

/**
 * 이 회사의 도급·판금 통을 「실값」 규칙으로 켠다 (2026-09-15 설계 「재고를 통 실값 하나로」).
 * 켜지면 남음 = 통 값, 발주 입고 +, 호기 체크 −. 되돌리려면 이 플래그를 지운다.
 */
export async function enableStockLedger(company) {
  if (!company) return;
  await setDoc(
    settingsRef,
    { [company]: { stockLedger: { paid: true, made: true } }, updatedAt: new Date() },
    { merge: true },
  );
}

/** 한 번만 읽는다 — 입고 처리처럼 구독을 걸 자리가 아닌 곳에서 */
export async function getPaidSetSettings() {
  const snap = await getDoc(settingsRef);
  return snap.exists() ? snap.data() || {} : {};
}

/**
 * 발주서 직결 구독 (2026-09-05 안 B 3단계) — BOM 프로젝트로 직결된 발주서(bomProjectId) 와
 * (옛 방식) 설정한 현장의 발주서를 합쳐 센다. 둘 다 없으면 아무것도 안 한다.
 */
export function subscribeReceivedFor({ siteId = '', bomProjectId = '' } = {}, cb) {
  if (!bomProjectId && !siteId) return () => {};

  // 그 현장에서 산 것이면 무엇이든 세면 세트와 무관한 단품까지 통에 섞인다 — 「매니아 9월
  // 선결제」 63개가 그렇게 들어왔다 (2026-09-12 대표님 「9월선결제 아직 입고전임」).
  // 그렇다고 BOM 에 건 것만 세면 이번에는 세트 발주서가 떨어져 나간다 — 「M 8월 1차」는
  // 세트 7 이 적힌 BOM 발주서인데 bomProjectId 가 비어 있어, 7개가 통째로 빠졌다
  // (대표님 「13세트 입고됐는데 왜 12셋이지」).
  // 그래서 가르는 잣대는 «세트가 적혀 있는가»로 둔다. BOM 에 건 것은 무조건 센다.
  const counted = (v) => {
    if (bomProjectId && v?.bomProjectId === bomProjectId) return true;
    return setLotsOf(v).some((l) => Number(l.count) > 0);
  };
  // 내 것인가 — 전에는 조건마다 서버에 따로 물어 화면 하나가 발주서 표를 두 번씩 읽었다.
  // 세 화면이 이 구독을 쓰므로 여는 순간 여섯 번이 나갔는데, 사내 서버가 인터넷을 돌아
  // 들어오느라 왕복이 0.3초씩 걸려 그대로 「화면이 바로 안 뜸」이 됐다
  // (2026-09-17 대표님 「로그인이 느려지고 화면들이 바로 뜨지않음」).
  // 발주서는 스무 줄 남짓이라 통째로 한 번 받아 여기서 고르는 편이 훨씬 빠르고, 조건이 없어
  // 세 화면이 같은 조회를 나눠 쓴다.
  const mine = (v) => (!!bomProjectId && v?.bomProjectId === bomProjectId) || (!!siteId && v?.siteId === siteId);
  return onSnapshot(
    purchasesRef,
    (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() })).filter((d) => mine(d.data) && counted(d.data));
      summarize(docs, cb);
    },
    (err) => {
      console.error('[도급 배정] 발주 입고 구독 오류:', err);
      summarize([], cb);
    },
  );
}

function summarize(docs, cb) {
  const out = {};
  let lines = 0;
  let noItem = 0;
  let setCount = 0;
  const lotsByName = {};
  docs.forEach((d) => {
    const v = d.data;
    if ((v.items || []).some((ln) => Number(ln.receivedQty) > 0)) {
      for (const lot of setLotsOf(v)) {
        setCount += lot.count;
        lotsByName[lot.name] = (lotsByName[lot.name] || 0) + lot.count;
      }
    }
    for (const ln of v.items || []) {
      const got = Number(ln.receivedQty) || 0;
      if (got <= 0) continue;
      lines += 1;
      if (!ln.itemId) {
        noItem += 1;
        continue;
      }
      out[ln.itemId] = (out[ln.itemId] || 0) + got;
    }
  });
  cb(out, { purchases: docs.length, lines, noItem, setCount, lotsByName });
}

/**
 * 나중에 들어온 부족분을 채운다 — 이미 있는 것은 두고 모자란 줄만, 있는 만큼만.
 * stockByItem 을 주면 발주 여유가 없는 줄은 창고 재고에서 꺼내 채우고, 재고 장부를 그만큼 줄인다
 * (이력 「도급 배정 · 호기」). 꺼낸 양은 paidSet.stockUsed 에 쌓아 두었다가 배정 취소 때 되돌린다.
 * 돌려주는 값: { added 채운 줄 수, short 남은 부족 줄 수, stockUsed { itemId: n } }
 */

/** 배정 취소 — 도급 줄 수량 0 + 자재 도급 칸 끔 + 배정 기록 지움 */

/**
 * 부족한 줄 하나를 창고 재고에서 끌어와 채운다 (2026-09-05 대표님 「부족한 거 재고에서 땡겨오는 버튼」).
 * 들어온 개수를 n 만큼 올리고 재고 장부를 n 줄인다(이력 「도급 배정 · 호기」). 세트 배정 호기면
 * paidSet.stockUsed 에 쌓아 두어 배정 취소 때 되돌린다. BOX 자재 칸은 자재 체크 화면 연동이 맞춘다.
 */
