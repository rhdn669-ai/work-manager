import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  setDoc,
  query,
  orderBy,
  where,
  arrayUnion,
  arrayRemove,
  increment,
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { addFinanceItem, deleteFinanceItem } from './siteService';
import { getToday } from '../utils/dateUtils';
import { groupLayoutUpdates } from '../domain/itemLayout';

const suppliersRef = collection(db, 'suppliers');
const itemsRef = collection(db, 'purchaseItems');
const purchasesRef = collection(db, 'purchases');
const printLogsRef = collection(db, 'purchasePrintLogs');
const configDoc = doc(db, 'appConfig', 'purchase');

// ---------- 발주서 출력 이력(스냅샷) ----------
// 출력 시점의 발주서 상태를 그대로 저장 → 나중에 그 시점 그대로 재출력/PDF 저장
export async function addPurchasePrintLog(purchaseId, snapshot, byName) {
  return addDoc(printLogsRef, {
    purchaseId,
    by: byName || '',
    snapshot: snapshot || {},
    at: new Date(),
  });
}

export async function getPurchasePrintLogs(purchaseId) {
  const q = query(printLogsRef, where('purchaseId', '==', purchaseId));
  const snap = await getDocs(q);
  const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const ms = (x) => (x?.toDate ? x.toDate().getTime() : x ? new Date(x).getTime() : 0);
  logs.sort((a, b) => ms(b.at) - ms(a.at)); // 최신순
  return logs;
}

// ---------- 구매 설정 (본사 귀속 프로젝트 등) ----------

export async function getPurchaseConfig() {
  const snap = await getDoc(configDoc);
  return snap.exists() ? snap.data() : {};
}

// 구매 설정 실시간 구독 — 발주 현황 상단 "전체 공통 특이사항" 등 전역 값 공유용
export function subscribePurchaseConfig(cb) {
  return onSnapshot(
    configDoc,
    (snap) => cb(snap.exists() ? snap.data() : {}),
    (err) => {
      console.error('[구매] 설정 구독 오류:', err);
      cb({});
    },
  );
}

// 발주 현황 참고 사항 — 한 건씩 개별 등록/삭제 (전 관리자 공유, notes 배열)
// 배열 원소에는 Firestore Timestamp 대신 ISO 문자열을 넣는다(배열 안 serverTimestamp 불가).
export async function addPurchaseNote(text, byName) {
  const t = (text || '').trim();
  if (!t) return;
  const snap = await getDoc(configDoc);
  const cur = snap.exists() && Array.isArray(snap.data().notes) ? snap.data().notes : [];
  const note = {
    id: `n${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    text: t,
    byName: byName || '',
    at: new Date().toISOString(),
  };
  await setDoc(configDoc, { notes: [...cur, note] }, { merge: true });
}

// 내용만 고친다 — 누가 언제 고쳤는지 남도록 작성자·시각도 갱신
export async function updatePurchaseNote(id, text, byName) {
  const t = (text || '').trim();
  if (!t) return;
  const snap = await getDoc(configDoc);
  const cur = snap.exists() && Array.isArray(snap.data().notes) ? snap.data().notes : [];
  const next = cur.map((n) =>
    n.id === id ? { ...n, text: t, byName: byName || n.byName || '', at: new Date().toISOString() } : n,
  );
  await setDoc(configDoc, { notes: next }, { merge: true });
}

export async function removePurchaseNote(id) {
  const snap = await getDoc(configDoc);
  const cur = snap.exists() && Array.isArray(snap.data().notes) ? snap.data().notes : [];
  await setDoc(configDoc, { notes: cur.filter((n) => n.id !== id) }, { merge: true });
}

export async function setHqSite(siteId, siteName) {
  await setDoc(
    configDoc,
    {
      hqSiteId: siteId || '',
      hqSiteName: siteName || '',
      updatedAt: new Date(),
    },
    { merge: true },
  );
}

// ---------- 구매처 (suppliers) ----------

export async function getSuppliers() {
  const q = query(suppliersRef, orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addSupplier(data) {
  return addDoc(suppliersRef, {
    name: data.name || '',
    representative: data.representative || '',
    contact: data.contact || '',
    email: data.email || '',
    businessNumber: data.businessNumber || '',
    bankName: data.bankName || '',
    bankAccount: data.bankAccount || '',
    category: data.category || '',
    note: data.note || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateSupplier(id, data) {
  await updateDoc(doc(db, 'suppliers', id), { ...data, updatedAt: new Date() });
}

export async function deleteSupplier(id) {
  await deleteDoc(doc(db, 'suppliers', id));
}

// ---------- 구매 품목 (purchaseItems) ----------

export async function getPurchaseItems() {
  const q = query(itemsRef, orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 실시간 구독 — 품목 마스터가 변경될 때마다 콜백 호출
export function subscribePurchaseItems(cb) {
  const q = query(itemsRef, orderBy('name'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function addPurchaseItem(data) {
  return addDoc(itemsRef, {
    code: data.code || '', // 품목 코드
    name: data.name || '',
    spec: data.spec || '',
    maker: data.maker || '', // 제조사/메이커
    // 도번 — 도면 번호. 품목에 적어 두면 BOM·발주서로 그대로 따라간다.
    // 품목마다 정해진 값이라 여기가 원본이다 (2026-09-02 대표님 「품목에서 도번 입력이 되어야 할듯」).
    drawingNo: data.drawingNo || '',
    unit: data.unit || '',
    category: data.category || '',
    standardPrice: Number(data.standardPrice) || 0,
    unitPrice: Number(data.unitPrice) || 0, // 복합 단위(roll/610m)일 때 단위(m)당 단가
    priceHistory: data.priceHistory || [], // [{ price, date: 'YYYY-MM-DD' }]
    certification: data.certification || '', // 인증 (CE/KS/UL 등 자유 텍스트)
    defaultSupplierId: data.defaultSupplierId || '',
    stockQty: Number(data.stockQty) || 0, // 창고 보유 수량 — 재고 화면에서 손으로 관리(모자라면 음수)
    siteIds: data.siteIds || [], // 사용 프로젝트 (다중)
    note: data.note || '',
    groupKey: data.groupKey || null, // 대분류 그룹 식별자 — 베어 메인의 doc id (베어 메인은 null)
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// 로드된 items에 groupKey 채워넣기 (백워드 호환 — 기존 데이터엔 groupKey 없음)
// 베어 메인(IOPN-NNNNN): groupKey 없음 (own id가 anchor)
// 소분류(IOPN-NNNNN-N): groupKey = 같은 메인 코드 베어의 id
export function inferGroupKeys(items) {
  const bareIdByCode = new Map();
  for (const it of items) {
    if (!it.groupKey) {
      const m = (it.code || '').match(/^IOPN-(\d+)$/);
      if (m) bareIdByCode.set(it.code, it.id);
    }
  }
  return items.map((it) => {
    if (it.groupKey) return it;
    const m = (it.code || '').match(/^IOPN-(\d+)-(\d+)$/);
    if (m) {
      const mainCode = `IOPN-${m[1]}`;
      const bareId = bareIdByCode.get(mainCode);
      if (bareId) return { ...it, groupKey: bareId };
    }
    return it; // 베어 메인이거나 매칭 안 됨 — own id가 anchor
  });
}

// 코드 자릿수 마이그레이션 — 기존 5자리(IOPN-00001)를 3자리(IOPN-001)로 재패딩
// 대분류 번호 부분만 3자리로 정규화, 소분류(-N)는 그대로. groupKey(id 기반)는 영향 없음.
// 변경분만 batch commit 후, 코드가 갱신된 items 배열을 반환.
export async function repadItemCodes(items) {
  const list = items || [];
  const updates = [];
  const next = list.map((it) => {
    const m = (it.code || '').match(/^IOPN-(\d+)(-\d+)?$/);
    if (!m) return it;
    const newMain = String(parseInt(m[1], 10)).padStart(3, '0');
    if (newMain === m[1]) return it; // 이미 3자리(또는 동일)면 변경 없음
    const newCode = `IOPN-${newMain}${m[2] || ''}`;
    if (!String(it.id).startsWith('tmp-')) updates.push({ id: it.id, code: newCode });
    return { ...it, code: newCode };
  });
  if (updates.length > 0) {
    const batch = writeBatch(db);
    for (const u of updates) batch.update(doc(db, 'purchaseItems', u.id), { code: u.code, updatedAt: new Date() });
    await batch.commit();
  }
  return next;
}

export async function updatePurchaseItem(id, data) {
  await updateDoc(doc(db, 'purchaseItems', id), { ...data, updatedAt: new Date() });
}

// 품목 단가(standardPrice) 직접 수정 이력 — 실거래(priceHistory)와 분리된 "관리자 단가 변경" 기록.
// { from 이전가, to 변경가, rate 변동률%, date, reason 사유, supplierName 구매처 }
// 품목 재고 수량 — 손으로 직접 적는 값이다. 발주해도 자동으로 줄지 않으므로
// 자재를 꺼내 쓴 뒤에는 재고 화면에서 사람이 고쳐야 한다.
// 고친 내력은 누가 언제 몇에서 몇으로 바꿨는지 함께 남긴다.
export async function setItemStock(id, { from, to, reason, byName }) {
  const f = Number(from) || 0;
  const t = Number(to) || 0; // 음수 허용 — 창고에 없는데 먼저 쓴 만큼을 '-3' 처럼 적어 둘 수 있다
  await updateDoc(doc(db, 'purchaseItems', id), {
    stockQty: t,
    stockUpdatedAt: new Date(),
    stockUpdatedBy: byName || '',
    stockHistory: arrayUnion({
      from: f,
      to: t,
      date: getToday(),
      reason: reason || '',
      byName: byName || '',
    }),
    updatedAt: new Date(),
  });
}

// 발주서가 재고를 가져다 쓴 만큼 줄인다 (되돌릴 땐 used 를 음수로 주면 그만큼 되돌아온다).
// 두 사람이 동시에 담아도 어긋나지 않도록 '얼마를 더하고 뺀다'로 처리한다 — 읽은 값으로 덮어쓰면 한쪽이 묻힌다.
export async function consumeItemStock(id, used, { byName, note } = {}) {
  const n = Number(used) || 0;
  if (n === 0) return;
  await updateDoc(doc(db, 'purchaseItems', id), {
    stockQty: increment(-n),
    stockUpdatedAt: new Date(),
    stockUpdatedBy: byName || '',
    stockHistory: arrayUnion({
      delta: -n,
      date: getToday(),
      reason: note || (n > 0 ? '발주 사용' : '발주 취소로 되돌림'),
      byName: byName || '',
    }),
    updatedAt: new Date(),
  });
}

// 발주서가 쥐고 있던 재고를 한꺼번에 창고로 되돌린다 — 발주서를 통째로 지울 때.
// 줄 하나를 지울 때는 반환하면서 정작 발주서를 지우면 재고가 사라져 버리던 문제를 막는다.
//   stockUsed  창고에서 가져다 쓴 양      → 창고로 돌려준다
//   stockShort 모자라서 발주로 메운 양    → 다시 모자란 상태로 되돌린다
// back=false 로 주면 반대로(휴지통에서 되살릴 때) 다시 가져다 쓴다.
export async function releasePurchaseStock(items, { byName, note, back = true } = {}) {
  const byItem = new Map();
  for (const ln of items || []) {
    if (!ln?.itemId) continue;
    const d = (-(Number(ln.stockUsed) || 0) + (Number(ln.stockShort) || 0)) * (back ? 1 : -1);
    if (d) byItem.set(ln.itemId, (byItem.get(ln.itemId) || 0) + d);
  }
  if (byItem.size === 0) return;
  await Promise.all([...byItem].map(([id, d]) => consumeItemStock(id, d, { byName, note })));
}

// 재고 목록에서 내리기 — 품목은 그대로 두고 재고 관련 값만 지운다.
// stockQty 필드가 없어지면 재고 화면 목록에서 빠지고, 발주 때 재고 차감도 하지 않는다.
export async function clearItemStock(id) {
  await updateDoc(doc(db, 'purchaseItems', id), {
    stockQty: deleteField(),
    stockUpdatedAt: deleteField(),
    stockUpdatedBy: deleteField(),
    stockHistory: deleteField(),
    updatedAt: new Date(),
  });
}

export async function recordPriceChange(id, { from, to, reason, supplierName }) {
  const f = Number(from) || 0;
  const t = Number(to) || 0;
  const rate = f > 0 ? Math.round(((t - f) / f) * 1000) / 10 : 0; // 소수 1자리 %
  await updateDoc(doc(db, 'purchaseItems', id), {
    standardPrice: t,
    priceChangeHistory: arrayUnion({
      from: f,
      to: t,
      rate,
      date: getToday(),
      reason: reason || '',
      supplierName: supplierName || '',
    }),
    updatedAt: new Date(),
  });
}

// 단가 변경 이력 1건 삭제 (해당 항목을 배열에서 제거)
export async function deletePriceChange(id, entry) {
  await updateDoc(doc(db, 'purchaseItems', id), {
    priceChangeHistory: arrayRemove(entry),
    updatedAt: new Date(),
  });
}

export async function deletePurchaseItem(id) {
  await deleteDoc(doc(db, 'purchaseItems', id));
}

// 새 대분류 코드 (IOPN-NNNNN, 소분류 없음)
export function nextMainCode(items) {
  const PREFIX = 'IOPN-';
  let maxMain = 0;
  for (const it of items || []) {
    const code = (it && it.code) || '';
    const m = code.match(/^IOPN-(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxMain) maxMain = n;
    }
  }
  return `${PREFIX}${String(maxMain + 1).padStart(3, '0')}`;
}

// 여러 품목 일괄 삭제 (대분류 그룹 전체 삭제용)
export async function deletePurchaseItems(ids) {
  const realIds = (ids || []).filter((id) => !String(id).startsWith('tmp-'));
  if (realIds.length === 0) return;
  const batch = writeBatch(db);
  for (const id of realIds) {
    batch.delete(doc(db, 'purchaseItems', id));
  }
  await batch.commit();
}

// 그룹 안의 서브 항목들을 새 순서대로 재할당 (드래그앤드롭 후 호출)
// orderedIds: 새 순서대로 정렬된 sub doc id 배열 (베어 메인 제외)
// mainCode: 그룹 키 (예: "IOPN-00001") — 베어 메인 코드는 변경 안 함
// 서브들은 -1, -2, -3, ... 순서대로 부여
export async function reorderGroupCodes(orderedIds, currentItems, mainCode) {
  const m = (mainCode || '').match(/^IOPN-(\d+)/);
  if (!m) throw new Error('잘못된 그룹 코드');
  const mainNum = m[1];
  const prefix = `IOPN-${mainNum}`;

  const byId = new Map(currentItems.map((it) => [it.id, it]));
  const updates = [];

  orderedIds.forEach((id, idx) => {
    const it = byId.get(id);
    if (!it) return;
    const newCode = `${prefix}-${idx + 1}`;
    if (it.code !== newCode) {
      updates.push({ id, code: newCode });
    }
  });

  if (updates.length === 0) return [];

  const batch = writeBatch(db);
  for (const u of updates) {
    if (String(u.id).startsWith('tmp-')) continue;
    batch.update(doc(db, 'purchaseItems', u.id), { code: u.code, updatedAt: new Date() });
  }
  await batch.commit();
  return updates;
}

// 화면에 보이는 대분류 배치를 그대로 코드에 새긴다 — 순서 바꾸기·다른 대분류로 옮기기 (2026-09-02 대표님).
//
// 대분류 번호는 «보이는 차례»가 곧 번호다: 첫 번째가 IOPN-000, 그다음이 IOPN-001…
// 그래서 대분류 하나를 위로 올리면 그 사이에 낀 대분류와 그 아래 하위 품목 코드가
// 한꺼번에 밀린다. 대표님이 그 방식을 고르셨다 (「코드도 다시 매긴다」).
//
// BOM·발주서는 품목을 코드가 아니라 문서 id 로 붙들고 코드는 그릴 때마다 마스터에서
// 읽어 가므로, 코드가 바뀌어도 연결은 그대로다 — 이미 발송된 메일·PDF 만 옛 코드로 남는다.
//
// groups: [{ repId, subIds: [...] }] — 화면 순서 그대로. 하위의 groupKey 도 함께 맞춘다.
export async function applyGroupLayout(groups, currentItems) {
  const updates = groupLayoutUpdates(groups, currentItems);
  if (updates.length === 0) return [];

  // 한 배치에 500 건까지다. 대분류 하나를 옮기면 수백 줄이 밀리므로 나눠 커밋한다.
  const CHUNK = 400;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const u of updates.slice(i, i + CHUNK)) {
      batch.update(doc(db, 'purchaseItems', u.id), { ...u.patch, updatedAt: new Date() });
    }
    await batch.commit();
  }
  return updates;
}

// 부모 코드의 다음 소분류 (IOPN-00001-1, -2, ...)
export function nextSubCode(items, parentCode) {
  const PREFIX = 'IOPN-';
  const m = (parentCode || '').match(/^IOPN-(\d+)/);
  if (!m) return null;
  const mainNum = parseInt(m[1], 10);
  let maxSub = 0;
  for (const it of items || []) {
    const code = (it && it.code) || '';
    const cm = code.match(/^IOPN-(\d+)(?:-(\d+))?$/);
    if (cm && parseInt(cm[1], 10) === mainNum && cm[2]) {
      const sub = parseInt(cm[2], 10);
      if (sub > maxSub) maxSub = sub;
    }
  }
  return `${PREFIX}${String(mainNum).padStart(3, '0')}-${maxSub + 1}`;
}

// 다음 IOPN- 코드 생성 (엑셀 일괄·구매 등록 자동 생성용 — 같은 품명 그룹화)
// - 같은 품명이 이미 있으면 그 대분류 번호 + 다음 소분류 (IOPN-00001-2)
// - 새 품명이면 새 대분류 번호 (IOPN-00003)
// - name 미지정 시 새 대분류만 부여
export function nextItemCode(items, name = '') {
  const PREFIX = 'IOPN-';
  const trimmedName = (name || '').trim();
  const list = items || [];

  // 같은 품명이 있으면 그 대분류 사용
  if (trimmedName) {
    const sameName = list.filter((it) => it && (it.name || '').trim() === trimmedName && it.code);
    if (sameName.length > 0) {
      const mainNumbers = sameName
        .map((it) => {
          const m = (it.code || '').match(/^IOPN-(\d+)/);
          return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => n > 0);
      if (mainNumbers.length > 0) {
        const mainNum = Math.min(...mainNumbers);
        // 소분류 있는 것만 카운트 — 대분류만 있는 첫 행 다음은 -1부터
        let maxSub = 0;
        for (const it of list) {
          const m = (it && it.code ? it.code : '').match(/^IOPN-(\d+)(?:-(\d+))?$/);
          if (m && parseInt(m[1], 10) === mainNum && m[2]) {
            const sub = parseInt(m[2], 10);
            if (sub > maxSub) maxSub = sub;
          }
        }
        return `${PREFIX}${String(mainNum).padStart(3, '0')}-${maxSub + 1}`;
      }
    }
  }

  // 새 품명 또는 품명 미지정 — 새 대분류 번호 (소분류 없음)
  return nextMainCode(list);
}

// ---------- 구매 건 (purchases) ----------
// status: ordered(발주) → partial(부분입고) → received(전체입고) → settled(정산완료)
// 라인 데이터: { itemId, name, spec, unit, qty, unitPrice, amount,
//              receivedQty, receivedAt, receivedBy, receiveNote }

// items 배열로부터 발주 상태 자동 계산 (settled는 그대로 유지)
export function deriveStatus(items, currentStatus) {
  if (currentStatus === 'settled') return 'settled';
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return 'ordered';
  const allReceived = list.every((it) => Number(it.receivedQty) >= Number(it.qty) && Number(it.qty) > 0);
  if (allReceived) return 'received';
  const anyReceived = list.some((it) => Number(it.receivedQty) > 0);
  return anyReceived ? 'partial' : 'ordered';
}

// 프로젝트의 그 달 자재비 — 그 달에 입고된 금액만 센다.
// 발주는 했지만 아직 안 들어온 몫은 원가로 잡지 않는다(들어온 달에 잡힌다).
// 반환: { total, count, rows: [{ purchaseId, title, supplierName, amount }] }
export async function getPurchaseCostBySite(siteId, year, month) {
  if (!siteId) return { total: 0, count: 0, rows: [] };
  const snap = await getDocs(query(purchasesRef, where('siteId', '==', siteId)));
  const rows = [];
  let total = 0;
  snap.forEach((d) => {
    const p = d.data();
    let amount = 0;
    for (const ln of p.items || []) {
      const got = Math.min(Number(ln.receivedQty) || 0, Number(ln.qty) || 0);
      if (got <= 0 || !ln.receivedAt) continue;
      const dt = ln.receivedAt.toDate ? ln.receivedAt.toDate() : new Date(ln.receivedAt);
      if (Number.isNaN(dt.getTime())) continue;
      if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month) continue;
      amount += got * (Number(ln.unitPrice) || 0);
    }
    if (amount > 0) {
      rows.push({ purchaseId: d.id, title: p.title || '(제목 없음)', supplierName: p.supplierName || '', amount });
      total += amount;
    }
  });
  rows.sort((a, b) => b.amount - a.amount);
  return { total, count: rows.length, rows };
}

export async function getPurchases() {
  const q = query(purchasesRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 발주 실시간 구독 (결제 대기 배지 등에 사용)
export function subscribePurchases(cb) {
  const q = query(purchasesRef, orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[발주] 구독 오류:', err);
      cb([]);
    },
  );
}

// 사이드바 배지 전용 — 결제요청된 발주만 구독(전체 구독 대신). 발주 누적에 비례하던 읽기 비용 제거.
export function subscribePaymentPendingPurchases(cb) {
  const q = query(purchasesRef, where('paymentRequested', '!=', null));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.error('[결제배지] 구독 오류:', err);
      cb([]);
    },
  );
}

// 결제 대기(결제 요청됐으나 미결제) (발주×업체) 건수 — 사이드바 배지용
export function countPaymentPending(purchases) {
  let n = 0;
  for (const p of purchases || []) {
    const req = p.paymentRequested;
    if (!req) continue;
    const paid = p.supplierPaid || {};
    for (const key of Object.keys(req)) {
      if (!paid[key]) n++;
    }
  }
  return n;
}

// 드래그 순서변경 — 전달된 id 순서대로 order 저장
export async function savePurchasesOrder(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'purchases', id), { order: idx, updatedAt: new Date() });
  });
  await batch.commit();
}

export async function getPurchaseById(id) {
  const snap = await getDoc(doc(db, 'purchases', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function addPurchase(data) {
  return addDoc(purchasesRef, {
    title: data.title || '',
    items: data.items || [], // [{ itemId, name, spec, unit, qty, unitPrice, amount }]
    supplierId: data.supplierId || '',
    supplierName: data.supplierName || '',
    ownerType: data.ownerType || 'hq', // 'site' | 'hq'
    siteId: data.siteId || '',
    siteName: data.siteName || '',
    totalAmount: Number(data.totalAmount) || 0,
    status: 'draft', // 초안 → confirmPurchase()로 발주 확정
    requesterId: data.requesterId || '',
    requesterName: data.requesterName || '',
    deliveryDue: data.deliveryDue || '',
    contactName: data.contactName || '',
    contactPhone: data.contactPhone || '',
    factoryKey: data.factoryKey || '',
    deliveryPlace: data.deliveryPlace || '',
    note: data.note || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updatePurchase(id, data) {
  await updateDoc(doc(db, 'purchases', id), { ...data, updatedAt: new Date() });
}

export async function deletePurchase(id) {
  await deleteDoc(doc(db, 'purchases', id));
}

// 상태 전이 — extra에 단계별 담당자·일시 등 기록
// (발행번호는 더 이상 여기서 생성하지 않음 — 발주서 내 구매처 순서로 화면에서 계산)
export async function setPurchaseStatus(id, status, extra = {}) {
  await updateDoc(doc(db, 'purchases', id), { status, ...extra, updatedAt: new Date() });
}

// 초안 → 발주 확정 (draft → ordered)
export async function confirmPurchase(id, confirmedBy = '') {
  await updateDoc(doc(db, 'purchases', id), {
    status: 'ordered',
    orderedAt: new Date(),
    confirmedBy,
    updatedAt: new Date(),
  });
}

// 업체별 발주 완료 마킹 — 발주완료 일시·발송자만 기록 (발행번호는 생성하지 않음)
export async function markSupplierSent(purchaseId, key, sentBy = '') {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierSent.${key}.sentAt`]: new Date(),
    [`supplierSent.${key}.sentBy`]: sentBy,
    updatedAt: new Date(),
  });
}

// 업체별 발주 완료 마킹 취소
export async function unmarkSupplierSent(purchaseId, key) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierSent.${key}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 회신 확인 마킹 — 회신 일시·확인자 기록
export async function markSupplierReplied(purchaseId, key, by = '', deliveryDue = '') {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierReplied.${key}.repliedAt`]: new Date(),
    [`supplierReplied.${key}.repliedBy`]: by,
    [`supplierReplied.${key}.deliveryDue`]: deliveryDue || '', // 회신 확인 시 입력한 납기일
    updatedAt: new Date(),
  });
}

// 업체별 회신 확인 취소
export async function unmarkSupplierReplied(purchaseId, key) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierReplied.${key}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 결제 완료 표시 / 취소 (결제 페이지 노출용)
// 결제 완료 — 회차로 쌓는다. 한 업체 물량이 나눠 들어오면 들어온 만큼씩 나눠 낸다.
// amount 는 그 회차에 낸 공급가액. 옛 기록(객체 하나)은 1차로 읽어 그대로 살린다.
export async function markSupplierPaid(purchaseId, key, by = '', amount = null) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  const ref = doc(db, 'purchases', purchaseId);
  const snap = await getDoc(ref);
  const prev = snap.data()?.supplierPaid?.[key];
  const list = !prev ? [] : Array.isArray(prev) ? prev.filter(Boolean) : [{ seq: 1, ...prev }];
  list.push({ seq: list.length + 1, paidAt: new Date(), paidBy: by, amount: amount == null ? null : Number(amount) });
  await updateDoc(ref, { [`supplierPaid.${key}`]: list, updatedAt: new Date() });
}

// 결제 취소 — 마지막 회차만 무른다. 앞 회차는 이미 나간 돈이라 건드리지 않는다.
export async function unmarkSupplierPaid(purchaseId, key) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  const ref = doc(db, 'purchases', purchaseId);
  const snap = await getDoc(ref);
  const prev = snap.data()?.supplierPaid?.[key];
  const list = !prev ? [] : Array.isArray(prev) ? prev.filter(Boolean) : [{ seq: 1, ...prev }];
  list.pop();
  await updateDoc(ref, {
    [`supplierPaid.${key}`]: list.length ? list : deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 결제 요청 — 이 버튼 하나로 마감 리스트와 결제 리스트에 동시에 올라간다.
//
//   dueDate       결제 마감일(YYYY-MM-DD) — 실제로 돈이 나갈 날. 결제 리스트가 이 날짜로 본다.
//   closingMonth  마감 달(YYYY-MM) — 어느 달 지출로 잡을지. 마감 리스트가 이 달로 본다.
//
// 두 날짜가 따로 있는 이유: 8월에 들어온 물건을 9/30에 결제하는 일이 흔하다.
// 하나로 묶으면 마감이 늘 한 달씩 밀린다 (2026-08-28 대표님).
export async function markPaymentRequested(purchaseId, key, by = '', dueDate = '', closingMonth = '') {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`paymentRequested.${key}.requestedAt`]: new Date(),
    [`paymentRequested.${key}.requestedBy`]: by,
    [`paymentRequested.${key}.dueDate`]: dueDate || '',
    [`paymentRequested.${key}.closingMonth`]: closingMonth || '',
    updatedAt: new Date(),
  });
}
export async function unmarkPaymentRequested(purchaseId, key) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`paymentRequested.${key}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 세금계산서(홈택스/코드에프 또는 수동) 정보 저장 — 결제 페이지 표시용
export async function setSupplierTaxInvoice(purchaseId, key, data) {
  key = String(key ?? '').replace(/\./g, '_'); // 업체명을 그대로 넘겨도 안전하게
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`taxInvoice.${key}`]: { ...data, fetchedAt: new Date() },
    updatedAt: new Date(),
  });
}

// 발주건 상태를 '회신'으로 전환 (모든 업체 회신 확인 시 자동 호출)
export async function setPurchaseReplied(id, by = '') {
  await updateDoc(doc(db, 'purchases', id), {
    status: 'replied',
    repliedAt: new Date(),
    repliedBy: by,
    updatedAt: new Date(),
  });
}

// 공장 프리셋 저장
export async function saveFactories(factories) {
  await setDoc(configDoc, { factories, updatedAt: new Date() }, { merge: true });
}

// 일괄 입고 — 잔여 수량 있는 모든 라인을 동일 일자/메모로 입고 처리
// mode: 'remaining' (잔여만큼만 입고, 발주 수량은 그대로) | 'close-as-is' (현재 입고 수량으로 발주 수량 정정 후 종결)
export async function bulkReceivePurchase(purchase, info) {
  const items = Array.isArray(purchase.items) ? [...purchase.items] : [];
  if (items.length === 0) throw new Error('입고할 품목이 없습니다.');
  const mode = info.mode || 'remaining';
  const date = info.date ? new Date(info.date) : new Date();
  const receivedBy = info.receivedBy || purchase.receivedBy || '';
  const note = info.note || '';

  const next = items.map((it) => {
    const lineQty = Number(it.qty) || 0;
    const prevRecv = Number(it.receivedQty) || 0;
    if (mode === 'close-as-is') {
      // 입고된 수량을 발주 수량으로 정정. prevRecv === 0인 라인은 그대로 미입고로 두지 않고 0 처리
      const finalQty = prevRecv;
      const finalAmount = finalQty * (Number(it.unitPrice) || 0);
      return {
        ...it,
        qty: finalQty,
        amount: finalAmount,
        receivedQty: finalQty,
        receivedAt: it.receivedAt || date,
        receivedBy: it.receivedBy || receivedBy,
        receiveNote: it.receiveNote || note,
      };
    }
    // 잔여만큼만 채워서 받기
    if (prevRecv >= lineQty || lineQty <= 0) return it;
    return {
      ...it,
      receivedQty: lineQty,
      receivedAt: date,
      receivedBy,
      receiveNote: it.receiveNote || note,
    };
  });

  const totalAmount = next.reduce(
    (s, it) => s + (Number(it.amount) || (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
    0,
  );
  const nextStatus = deriveStatus(next, purchase.status);
  const extra = {
    items: next,
    totalAmount,
    status: nextStatus,
    updatedAt: new Date(),
  };
  if (nextStatus === 'received' && purchase.status !== 'received') {
    extra.receivedAt = date;
    extra.receivedBy = receivedBy;
    extra.receiveNote = note;
  }
  await updateDoc(doc(db, 'purchases', purchase.id), extra);
  return { items: next, status: nextStatus };
}

// 라인별 입고 처리 — qty/입고일/메모를 해당 라인에 기록, 발주 상태는 자동 계산
// lineIdx: items 배열 인덱스, info: { qty, date 'YYYY-MM-DD', note, receivedBy }
export async function receivePurchaseLine(purchase, lineIdx, info) {
  const items = Array.isArray(purchase.items) ? [...purchase.items] : [];
  if (lineIdx < 0 || lineIdx >= items.length) throw new Error('잘못된 라인 인덱스');
  const cur = items[lineIdx];
  const receivedQty = Math.max(0, Number(info.qty) || 0);
  const lineQty = Number(cur.qty) || 0;
  if (receivedQty > lineQty) throw new Error(`입고 수량(${receivedQty})이 발주 수량(${lineQty})을 초과합니다.`);
  items[lineIdx] = {
    ...cur,
    receivedQty,
    receivedAt: info.date ? new Date(info.date) : null,
    receivedBy: info.receivedBy || '',
    receiveNote: info.note || '',
  };
  const nextStatus = deriveStatus(items, purchase.status);
  const extra = { items, status: nextStatus, updatedAt: new Date() };
  // 발주 전체 입고 완료 시 발주 단위 메타도 갱신 (정산 흐름과 호환)
  if (nextStatus === 'received' && purchase.status !== 'received') {
    extra.receivedAt = items[lineIdx].receivedAt || new Date();
    extra.receivedBy = info.receivedBy || purchase.receivedBy || '';
  }
  await updateDoc(doc(db, 'purchases', purchase.id), extra);
  return { items, status: nextStatus };
}

// 정산 — 구매 금액을 귀속 프로젝트의 지출로 등록하고 status='settled' 처리
export async function settlePurchase(purchase, settledBy) {
  const siteId = purchase.siteId;
  if (!siteId) throw new Error('귀속 프로젝트가 지정되지 않았습니다.');

  const purchaseRef = doc(db, 'purchases', purchase.id);
  // 서버 최신 상태로 중복 정산 방지 (클라이언트 purchase는 stale일 수 있음)
  const curSnap = await getDoc(purchaseRef);
  const cur = curSnap.exists() ? curSnap.data() : {};
  if (cur.status === 'settled') return cur.financeId || null; // 이미 정산 완료 — 아무 것도 하지 않음

  const recv = purchase.receivedAt;
  const d = recv?.toDate ? recv.toDate() : recv ? new Date(recv) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 지출 등록 — 이전 시도가 지출까지만 성공했으면(financeId 존재) 재사용해 중복 등록 방지
  let financeId = cur.financeId || null;
  if (!financeId) {
    financeId = await addFinanceItem(siteId, year, month, {
      type: 'expense',
      description: `구매 - ${purchase.title}`,
      amount: Number(purchase.totalAmount) || 0,
      note: purchase.supplierName ? `구매처: ${purchase.supplierName}` : '',
      date: dateStr,
    });
    // 지출 생성 직후 즉시 발주에 기록 → 이후 단계가 실패해도 재시도 시 중복 지출을 막음
    await updateDoc(purchaseRef, { financeId, financeSiteId: siteId });
  }

  // 각 품목의 실거래 단가를 priceHistory에 누적, standardPrice도 최신화
  const lineItems = Array.isArray(purchase.items) ? purchase.items : [];
  await Promise.all(
    lineItems
      .filter((ln) => ln.itemId)
      .map((ln) =>
        updateDoc(doc(db, 'purchaseItems', ln.itemId), {
          priceHistory: arrayUnion({
            price: Number(ln.unitPrice) || 0,
            date: dateStr,
            qty: Number(ln.qty) || 0,
            supplierId: purchase.supplierId || '',
            supplierName: purchase.supplierName || '',
            purchaseId: purchase.id,
          }),
          standardPrice: Number(ln.unitPrice) || 0,
          updatedAt: new Date(),
        }),
      ),
  );

  await setPurchaseStatus(purchase.id, 'settled', {
    settledAt: new Date(),
    settledBy: settledBy || '',
    financeId,
    financeSiteId: siteId,
  });
  return financeId;
}

// 정산 취소 — 지출 삭제 + priceHistory에서 이 구매 기록 제거 + 상태 received로 되돌림
export async function cancelSettlePurchase(purchase) {
  const purchaseRef = doc(db, 'purchases', purchase.id);
  // 서버 최신 상태 확인 — 이미 취소됐으면 아무 것도 하지 않음(유령 상태 방지)
  const curSnap = await getDoc(purchaseRef);
  const cur = curSnap.exists() ? curSnap.data() : {};
  if (cur.status !== 'settled') return;

  // 지출 항목 삭제 후 즉시 financeId 제거 → 재시도 시 유령 참조·중복 삭제 방지
  if (cur.financeId) {
    try {
      await deleteFinanceItem(cur.financeId);
    } catch {
      /* 이미 삭제된 경우 무시 */
    }
    await updateDoc(purchaseRef, { financeId: null });
  }
  // 각 품목 priceHistory에서 이 purchaseId 매칭 항목 제거
  const lineItems = Array.isArray(purchase.items) ? purchase.items : [];
  await Promise.all(
    lineItems
      .filter((ln) => ln.itemId)
      .map(async (ln) => {
        const ref = doc(db, 'purchaseItems', ln.itemId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const history = Array.isArray(snap.data().priceHistory) ? snap.data().priceHistory : [];
        const filtered = history.filter((h) => h && h.purchaseId !== purchase.id);
        if (filtered.length !== history.length) {
          await updateDoc(ref, { priceHistory: filtered, updatedAt: new Date() });
        }
      }),
  );
  // 상태 되돌림 (정산 메타 제거)
  await updateDoc(doc(db, 'purchases', purchase.id), {
    status: 'received',
    settledAt: null,
    settledBy: null,
    financeId: null,
    financeSiteId: null,
    updatedAt: new Date(),
  });
}
