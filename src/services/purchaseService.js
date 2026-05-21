import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  query, orderBy, arrayUnion,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { addFinanceItem } from './siteService';

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

// 다음 IOPN- 코드 생성 (기존 items의 IOPN-XXXXX 중 최대 + 1)
export function nextItemCode(items) {
  const PREFIX = 'IOPN-';
  let max = 0;
  for (const it of items || []) {
    const code = (it && it.code) || '';
    if (!code.startsWith(PREFIX)) continue;
    const n = parseInt(code.slice(PREFIX.length), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${PREFIX}${String(max + 1).padStart(5, '0')}`;
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
