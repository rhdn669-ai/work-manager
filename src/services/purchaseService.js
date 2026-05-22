import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, arrayUnion, writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { addFinanceItem, deleteFinanceItem } from './siteService';

const suppliersRef = collection(db, 'suppliers');
const itemsRef = collection(db, 'purchaseItems');
const purchasesRef = collection(db, 'purchases');
const configDoc = doc(db, 'appConfig', 'purchase');

// ---------- 구매 설정 (본사 귀속 프로젝트 등) ----------

export async function getPurchaseConfig() {
  const snap = await getDoc(configDoc);
  return snap.exists() ? snap.data() : {};
}

export async function setHqSite(siteId, siteName) {
  await setDoc(configDoc, {
    hqSiteId: siteId || '',
    hqSiteName: siteName || '',
    updatedAt: new Date(),
  }, { merge: true });
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

export async function addPurchaseItem(data) {
  return addDoc(itemsRef, {
    code: data.code || '',                // 품목 코드
    name: data.name || '',
    spec: data.spec || '',
    maker: data.maker || '',              // 제조사/메이커
    unit: data.unit || '',
    category: data.category || '',
    standardPrice: Number(data.standardPrice) || 0,
    priceHistory: data.priceHistory || [],   // [{ price, date: 'YYYY-MM-DD' }]
    defaultSupplierId: data.defaultSupplierId || '',
    siteIds: data.siteIds || [],         // 사용 프로젝트 (다중)
    note: data.note || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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
    const m = code.match(/^IOPN-(\d{5})/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxMain) maxMain = n;
    }
  }
  return `${PREFIX}${String(maxMain + 1).padStart(5, '0')}`;
}

// 그룹 안의 항목들을 새 순서대로 재할당 (드래그앤드롭 후 호출)
// orderedIds: 새 순서대로 정렬된 doc id 배열
// mainCode: 그룹 키 (예: "IOPN-00001")
// 첫 번째 항목은 bare main code, 나머지는 -1, -2, ...
// 변경 필요한 행만 batch update. 결과 [{ id, code }] 반환
export async function reorderGroupCodes(orderedIds, currentItems, mainCode) {
  const m = (mainCode || '').match(/^IOPN-(\d{5})/);
  if (!m) throw new Error('잘못된 그룹 코드');
  const mainNum = m[1];
  const prefix = `IOPN-${mainNum}`;

  const byId = new Map(currentItems.map((it) => [it.id, it]));
  const updates = [];

  orderedIds.forEach((id, idx) => {
    const it = byId.get(id);
    if (!it) return;
    const newCode = idx === 0 ? prefix : `${prefix}-${idx}`;
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
  const m = (parentCode || '').match(/^IOPN-(\d{5})/);
  if (!m) return null;
  const mainNum = parseInt(m[1], 10);
  let maxSub = 0;
  for (const it of items || []) {
    const code = (it && it.code) || '';
    const cm = code.match(/^IOPN-(\d{5})(?:-(\d+))?$/);
    if (cm && parseInt(cm[1], 10) === mainNum && cm[2]) {
      const sub = parseInt(cm[2], 10);
      if (sub > maxSub) maxSub = sub;
    }
  }
  return `${PREFIX}${String(mainNum).padStart(5, '0')}-${maxSub + 1}`;
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
          const m = (it.code || '').match(/^IOPN-(\d{5})/);
          return m ? parseInt(m[1], 10) : 0;
        })
        .filter((n) => n > 0);
      if (mainNumbers.length > 0) {
        const mainNum = Math.min(...mainNumbers);
        // 소분류 있는 것만 카운트 — 대분류만 있는 첫 행 다음은 -1부터
        let maxSub = 0;
        for (const it of list) {
          const m = (it && it.code ? it.code : '').match(/^IOPN-(\d{5})(?:-(\d+))?$/);
          if (m && parseInt(m[1], 10) === mainNum && m[2]) {
            const sub = parseInt(m[2], 10);
            if (sub > maxSub) maxSub = sub;
          }
        }
        return `${PREFIX}${String(mainNum).padStart(5, '0')}-${maxSub + 1}`;
      }
    }
  }

  // 새 품명 또는 품명 미지정 — 새 대분류 번호 (소분류 없음)
  return nextMainCode(list);
}

// ---------- 구매 건 (purchases) ----------
// status: ordered(발주) → received(입고) → settled(정산완료)

export async function getPurchases() {
  const q = query(purchasesRef, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addPurchase(data) {
  return addDoc(purchasesRef, {
    title: data.title || '',
    items: data.items || [],            // [{ itemId, name, spec, unit, qty, unitPrice, amount }]
    supplierId: data.supplierId || '',
    supplierName: data.supplierName || '',
    ownerType: data.ownerType || 'hq',  // 'site' | 'hq'
    siteId: data.siteId || '',
    siteName: data.siteName || '',
    totalAmount: Number(data.totalAmount) || 0,
    status: 'ordered',                  // 등록 = 발주
    requesterId: data.requesterId || '',
    requesterName: data.requesterName || '',
    note: data.note || '',
    orderedAt: new Date(),
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
export async function setPurchaseStatus(id, status, extra = {}) {
  await updateDoc(doc(db, 'purchases', id), {
    status,
    ...extra,
    updatedAt: new Date(),
  });
}

// 정산 — 구매 금액을 귀속 프로젝트의 지출로 등록하고 status='settled' 처리
export async function settlePurchase(purchase, settledBy) {
  const siteId = purchase.siteId;
  if (!siteId) throw new Error('귀속 프로젝트가 지정되지 않았습니다.');
  const recv = purchase.receivedAt;
  const d = recv?.toDate ? recv.toDate() : (recv ? new Date(recv) : new Date());
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
  await Promise.all(lineItems
    .filter((ln) => ln.itemId)
    .map((ln) => updateDoc(doc(db, 'purchaseItems', ln.itemId), {
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
    })),
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
    try { await deleteFinanceItem(purchase.financeId); } catch { /* 이미 삭제된 경우 무시 */ }
  }
  // 각 품목 priceHistory에서 이 purchaseId 매칭 항목 제거
  const lineItems = Array.isArray(purchase.items) ? purchase.items : [];
  await Promise.all(lineItems
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
