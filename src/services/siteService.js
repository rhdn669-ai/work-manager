import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const sitesRef = collection(db, 'sites');
const itemsRef = collection(db, 'siteClosingItems');
const financesRef = collection(db, 'siteFinances');

// ---------- 프로젝트(sites) ----------

export async function getAllSites() {
  const q = query(sitesRef, orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 팀장이 담당하는 프로젝트만 조회
export async function getSitesByManager(uid) {
  const q = query(sitesRef, where('managerIds', 'array-contains', uid));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export async function getSite(siteId) {
  const snap = await getDoc(doc(db, 'sites', siteId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createSite(data) {
  const docRef = await addDoc(sitesRef, {
    name: data.name,
    team: data.team || '',
    managerIds: data.managerIds || [],
    defaultVendors: data.defaultVendors || [],
    projectType: data.projectType || 'recurring',   // 'recurring' | 'once'
    status: data.status || 'active',                 // 'active' | 'completed'
    startYear: data.startYear || null,
    startMonth: data.startMonth || null,
    endYear: data.endYear || null,
    endMonth: data.endMonth || null,
    mirrorFromSiteIds: data.mirrorFromSiteIds || [], // 지출 합산 대상 프로젝트 ID 목록
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return docRef.id;
}

export async function updateSite(siteId, data) {
  await updateDoc(doc(db, 'sites', siteId), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function deleteSite(siteId) {
  await deleteDoc(doc(db, 'sites', siteId));
}

// ---------- 월별 마감 메타(siteClosings) ----------

function closingId(siteId, year, month) {
  return `${siteId}_${year}_${String(month).padStart(2, '0')}`;
}

export async function getClosing(siteId, year, month) {
  const id = closingId(siteId, year, month);
  const snap = await getDoc(doc(db, 'siteClosings', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function upsertClosing(siteId, year, month, data) {
  const id = closingId(siteId, year, month);
  await setDoc(doc(db, 'siteClosings', id), {
    siteId, year, month,
    equipmentCount: data.equipmentCount ?? 0,
    note: data.note ?? '',
    locked: data.locked ?? false,
    updatedAt: new Date(),
  }, { merge: true });
  return id;
}

// ---------- 마감 항목(siteClosingItems) ----------

export async function getClosingItems(siteId, year, month) {
  const cid = closingId(siteId, year, month);
  const q = query(itemsRef, where('closingId', '==', cid));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function addClosingItem(siteId, year, month, data) {
  const cid = closingId(siteId, year, month);
  const docRef = await addDoc(itemsRef, {
    closingId: cid,
    siteId, year, month,
    no: data.no || 1,
    vendor: data.vendor || '',
    detail: data.detail || '',
    category: data.category || '',
    itemType: data.itemType || 'freelancer',
    unitPrice: data.unitPrice || 0,
    dailyQuantities: data.dailyQuantities || {},
    quantity: data.quantity || 0,
    amount: data.amount || 0,
    order: data.order || 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return docRef.id;
}

export async function updateClosingItem(itemId, data) {
  await updateDoc(doc(db, 'siteClosingItems', itemId), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function deleteClosingItem(itemId) {
  await deleteDoc(doc(db, 'siteClosingItems', itemId));
}

// ---------- 지출/매출(siteFinances) ----------

export async function getFinanceItems(siteId, year, month) {
  const cid = closingId(siteId, year, month);
  const q = query(financesRef, where('closingId', '==', cid));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function addFinanceItem(siteId, year, month, data) {
  const cid = closingId(siteId, year, month);
  const docRef = await addDoc(financesRef, {
    closingId: cid,
    siteId, year, month,
    type: data.type, // 'expense' | 'revenue'
    description: data.description || '',
    amount: data.amount || 0,
    note: data.note || '',
    order: data.order || 0,
    overtimeRecordId: data.overtimeRecordId || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return docRef.id;
}

export async function updateFinanceItem(itemId, data) {
  await updateDoc(doc(db, 'siteFinances', itemId), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function deleteFinanceItem(itemId) {
  await deleteDoc(doc(db, 'siteFinances', itemId));
}

// overtimeRecordId로 지출 항목 찾기
export async function findFinanceByOvertimeId(overtimeRecordId) {
  const q = query(financesRef, where('overtimeRecordId', '==', overtimeRecordId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- 월별 전체 프로젝트 직원 배정 조회 ----------

export async function getAssignedEmployeeIds(year, month) {
  const q = query(itemsRef, where('year', '==', year), where('month', '==', month), where('itemType', '==', 'employee'));
  const snapshot = await getDocs(q);
  const ids = new Set();
  snapshot.docs.forEach((d) => {
    const data = d.data();
    if (data.detail) ids.add(data.detail); // detail = 직원 이름
  });
  return ids;
}

// ---------- 전월 데이터 복사 ----------

// 명단만 초기화 (매출/지출 제외, 수량 초기화)
export async function initRosterFromPreviousMonth(siteId, year, month) {
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevYear -= 1; prevMonth = 12; }

  const prevItems = await getClosingItems(siteId, prevYear, prevMonth);
  if (prevItems.length === 0) throw new Error('전월 공수표 데이터가 없습니다.');

  let count = 0;
  for (const item of prevItems) {
    await addClosingItem(siteId, year, month, {
      no: item.no,
      vendor: item.vendor,
      detail: item.detail,
      category: item.category,
      itemType: item.itemType || 'freelancer',
      unitPrice: item.unitPrice || 0,
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
      order: item.order || 0,
    });
    count++;
  }
  return count;
}

export async function copyPreviousMonth(siteId, year, month) {
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevYear -= 1; prevMonth = 12; }

  const [prevItems, prevFinances] = await Promise.all([
    getClosingItems(siteId, prevYear, prevMonth),
    getFinanceItems(siteId, prevYear, prevMonth),
  ]);

  if (prevItems.length === 0 && prevFinances.length === 0) {
    throw new Error('전월 데이터가 없습니다.');
  }

  const added = { items: 0, finances: 0 };

  // 공수표 항목 복사 (수량/금액 초기화)
  for (const item of prevItems) {
    await addClosingItem(siteId, year, month, {
      no: item.no,
      vendor: item.vendor,
      detail: item.detail,
      category: item.category,
      itemType: item.itemType || 'freelancer',
      unitPrice: item.unitPrice || 0,
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
      order: item.order || 0,
    });
    added.items++;
  }

  // 매출/지출 항목 복사 (금액 초기화, 잔업은 제외)
  for (const fin of prevFinances) {
    const desc = (fin.description || '').trim();
    const isOvertime = desc === '잔업' || desc.startsWith('잔업 -') || desc.startsWith('잔업-');
    if (isOvertime) continue;
    await addFinanceItem(siteId, year, month, {
      type: fin.type,
      description: fin.description,
      amount: 0,
      note: '',
      order: fin.order || 0,
    });
    added.finances++;
  }

  return added;
}
