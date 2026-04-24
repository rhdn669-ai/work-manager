import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { QUARTER_LEAVE_TYPES } from '../utils/constants';

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

// 본사 사이트가 없으면 자동 생성 (한 번만)
// 항상 sites 컬렉션 상단에 표시되며, 일반 프로젝트와 동일하게 잔업/연차에 사용 가능
export async function ensureHeadquartersSite() {
  const all = await getAllSites();
  const existing = all.find((s) => s.name === '본사');
  if (existing) return existing.id;
  return await createSite({
    name: '본사',
    projectType: 'recurring',
    status: 'active',
    hideRevenue: true, // 본사는 매출/지출 합계 비표시 (지원성)
  });
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
    hideRevenue: data.hideRevenue || false, // 매출 섹션 숨김 (지원성 프로젝트용)
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
    // 모달 선택으로 추가된 행의 수정 잠금 플래그
    vendorLocked: !!data.vendorLocked,
    detailLocked: !!data.detailLocked,
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

export async function getAllClosingItemsBySite(siteId) {
  const q = query(itemsRef, where('siteId', '==', siteId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getAllFinanceItemsBySite(siteId) {
  const q = query(financesRef, where('siteId', '==', siteId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
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

// ---------- 연차 변경 → 공수표 dailyQuantities 자동 동기화 ----------

// 연차 유형별 근무 비율 (SiteClosingPage의 leaveWorkFraction과 동일 정책)
function _leaveWorkFraction(type) {
  if (!type) return 1;
  if (type === 'half_am' || type === 'half_pm') return 0.5;
  if (QUARTER_LEAVE_TYPES.includes(type)) return 0.75;
  return 0; // 전일 연차 / 병가 등
}

// 자동 관리되는 근무량 값(수동 편집 흔적이 아닌 값)
// 이 집합에 속한 값만 재계산 시 덮어씀 — 그 외(예: 0.3)는 사용자 수동 편집으로 간주하고 보존
const _AUTO_MANAGED_VALUES = new Set([0.25, 0.5, 0.75, 1]);

// 특정 유저의 특정 월 공수표(employee 타입) dailyQuantities를 연차에 맞게 재계산
// leaveDaysMap: { [day]: leaveType } — 해당 월 승인된 연차의 날짜→유형 맵
// 단발성(once) 프로젝트는 건드리지 않음
export async function syncEmployeeLeaveDaysForMonth(userName, year, month, leaveDaysMap) {
  if (!userName) return;
  const q = query(
    itemsRef,
    where('year', '==', year),
    where('month', '==', month),
    where('itemType', '==', 'employee'),
  );
  const snapshot = await getDocs(q);
  const items = snapshot.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => it.detail === userName);
  if (items.length === 0) return;

  const siteIds = [...new Set(items.map((it) => it.siteId))];
  const sites = await Promise.all(siteIds.map((id) => getSite(id)));
  const siteMap = Object.fromEntries(sites.filter(Boolean).map((s) => [s.id, s]));

  const totalDays = new Date(year, month, 0).getDate();

  for (const item of items) {
    const site = siteMap[item.siteId];
    if (!site || site.projectType === 'once') continue; // 단발성은 수동 입력 영역

    const oldDq = item.dailyQuantities || {};
    const newDq = { ...oldDq };

    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(year, month - 1, d).getDay();
      if (dow === 0 || dow === 6) continue; // 주말 무시
      const frac = _leaveWorkFraction(leaveDaysMap[d]);
      const currentVal = Number(oldDq[d]);
      const isEmpty = oldDq[d] === undefined || oldDq[d] === null;
      const isAutoManaged = isEmpty || _AUTO_MANAGED_VALUES.has(currentVal);
      if (!isAutoManaged) continue; // 수동 편집된 값 보호

      if (frac > 0) newDq[d] = frac;
      else delete newDq[d];
    }

    const quantity = Object.values(newDq).reduce((s, v) => s + Number(v || 0), 0);
    const unitPrice = Number(item.unitPrice) || 0;
    const amount = Math.round(unitPrice * quantity);

    await updateDoc(doc(db, 'siteClosingItems', item.id), {
      dailyQuantities: newDq,
      quantity,
      amount,
      updatedAt: new Date(),
    });
  }
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
