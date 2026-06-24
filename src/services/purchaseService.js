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
  writeBatch,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { addFinanceItem, deleteFinanceItem } from './siteService';

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
    unit: data.unit || '',
    category: data.category || '',
    standardPrice: Number(data.standardPrice) || 0,
    unitPrice: Number(data.unitPrice) || 0, // 복합 단위(roll/610m)일 때 단위(m)당 단가
    priceHistory: data.priceHistory || [], // [{ price, date: 'YYYY-MM-DD' }]
    certification: data.certification || '', // 인증 (CE/KS/UL 등 자유 텍스트)
    defaultSupplierId: data.defaultSupplierId || '',
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
export async function markSupplierSent(purchaseId, supplierName, sentBy = '') {
  const key = supplierName.replace(/\./g, '_');
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierSent.${key}.sentAt`]: new Date(),
    [`supplierSent.${key}.sentBy`]: sentBy,
    updatedAt: new Date(),
  });
}

// 업체별 발주 완료 마킹 취소
export async function unmarkSupplierSent(purchaseId, supplierName) {
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierSent.${supplierName.replace(/\./g, '_')}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 회신 확인 마킹 — 회신 일시·확인자 기록
export async function markSupplierReplied(purchaseId, supplierName, by = '', deliveryDue = '') {
  const key = supplierName.replace(/\./g, '_');
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierReplied.${key}.repliedAt`]: new Date(),
    [`supplierReplied.${key}.repliedBy`]: by,
    [`supplierReplied.${key}.deliveryDue`]: deliveryDue || '', // 회신 확인 시 입력한 납기일
    updatedAt: new Date(),
  });
}

// 업체별 회신 확인 취소
export async function unmarkSupplierReplied(purchaseId, supplierName) {
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierReplied.${supplierName.replace(/\./g, '_')}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 결제 완료 표시 / 취소 (결제 페이지 노출용)
export async function markSupplierPaid(purchaseId, supplierName, by = '') {
  const key = supplierName.replace(/\./g, '_');
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierPaid.${key}.paidAt`]: new Date(),
    [`supplierPaid.${key}.paidBy`]: by,
    updatedAt: new Date(),
  });
}
export async function unmarkSupplierPaid(purchaseId, supplierName) {
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`supplierPaid.${supplierName.replace(/\./g, '_')}`]: deleteField(),
    updatedAt: new Date(),
  });
}

// 업체별 결제 요청 — 발주 상세에서 '결제 요청'을 누르면 결제 페이지에 결제 대기로 올라온다.
// dueDate: 결제 마감일(YYYY-MM-DD) — 결제 페이지에 함께 전달.
export async function markPaymentRequested(purchaseId, supplierName, by = '', dueDate = '') {
  const key = supplierName.replace(/\./g, '_');
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`paymentRequested.${key}.requestedAt`]: new Date(),
    [`paymentRequested.${key}.requestedBy`]: by,
    [`paymentRequested.${key}.dueDate`]: dueDate || '',
    updatedAt: new Date(),
  });
}
export async function unmarkPaymentRequested(purchaseId, supplierName) {
  await updateDoc(doc(db, 'purchases', purchaseId), {
    [`paymentRequested.${supplierName.replace(/\./g, '_')}`]: deleteField(),
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
  const recv = purchase.receivedAt;
  const d = recv?.toDate ? recv.toDate() : recv ? new Date(recv) : new Date();
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const financeId = await addFinanceItem(siteId, year, month, {
    type: 'expense',
    description: `구매 - ${purchase.title}`,
    amount: Number(purchase.totalAmount) || 0,
    note: purchase.supplierName ? `구매처: ${purchase.supplierName}` : '',
    date: dateStr,
  });

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
  // 지출 항목 삭제
  if (purchase.financeId) {
    try {
      await deleteFinanceItem(purchase.financeId);
    } catch {
      /* 이미 삭제된 경우 무시 */
    }
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
