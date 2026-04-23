import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy, where,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const closingItemsRef = collection(db, 'siteClosingItems');

function closingIdFor(siteId, year, month) {
  return `${siteId}_${year}_${String(month).padStart(2, '0')}`;
}

// ── 프리랜서 ──────────────────────────────────────────
const freelancersRef = collection(db, 'freelancers');

export async function getFreelancers() {
  const q = query(freelancersRef, orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addFreelancer(data) {
  return addDoc(freelancersRef, {
    name: data.name || '',
    vendor: data.vendor || '',
    dailyRate: Number(data.dailyRate) || 0,
    contact: data.contact || '',
    note: data.note || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateFreelancer(id, data) {
  await updateDoc(doc(db, 'freelancers', id), {
    ...data,
    dailyRate: Number(data.dailyRate) || 0,
    updatedAt: new Date(),
  });
}

export async function deleteFreelancer(id) {
  await deleteDoc(doc(db, 'freelancers', id));
}

// ── 업체(vendor) ──────────────────────────────────────
const vendorsRef = collection(db, 'vendors');

export async function getVendors() {
  const q = query(vendorsRef, orderBy('name'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addVendor(data) {
  return addDoc(vendorsRef, {
    name: data.name || '',
    representative: data.representative || '',
    contact: data.contact || '',
    note: data.note || '',
    dailyRate: Number(data.dailyRate) || 0, // 공수(일) 단가
    caseRate: Number(data.caseRate) || 0,   // 건당 단가
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateVendor(id, data) {
  const update = { ...data, updatedAt: new Date() };
  if (data.dailyRate !== undefined) update.dailyRate = Number(data.dailyRate) || 0;
  if (data.caseRate !== undefined) update.caseRate = Number(data.caseRate) || 0;
  await updateDoc(doc(db, 'vendors', id), update);
}

export async function deleteVendor(id) {
  await deleteDoc(doc(db, 'vendors', id));
}

// 업체에 직원(프리랜서) 추가 — vendor 필드를 해당 업체명으로 설정
export async function addFreelancerToVendor(vendorName, data) {
  return addFreelancer({
    name: data.name,
    vendor: vendorName,
    dailyRate: data.dailyRate,
    contact: data.contact || '',
    note: data.note || '',
  });
}

// 업체를 특정 프로젝트의 해당 월 공수표에 추가 (itemType='vendor', unit='day')
export async function addVendorToProject({ vendorName, siteId, year, month, unitPrice = 0 }) {
  const cid = closingIdFor(siteId, year, month);
  // 순서 번호 계산 — 해당 closing의 현재 최대값 + 1
  const q = query(closingItemsRef, where('closingId', '==', cid));
  const snap = await getDocs(q);
  const existing = snap.docs.map((d) => d.data());
  const nextOrder = existing.length ? Math.max(...existing.map((i) => i.order || 0)) + 1 : 1;
  const nextNo = existing.length ? Math.max(...existing.map((i) => i.no || 0)) + 1 : 1;
  return addDoc(closingItemsRef, {
    closingId: cid,
    siteId, year, month,
    no: nextNo,
    vendor: vendorName,
    detail: '',
    category: '',
    itemType: 'vendor',
    unitPrice: Number(unitPrice) || 0,
    dailyQuantities: {},
    quantity: 0,
    amount: 0,
    order: nextOrder,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// 업체 상세: 소속 프리랜서(직원) + 참여 프로젝트 조회
export async function getVendorDetail(vendorName) {
  if (!vendorName) return { freelancers: [], projects: [] };

  // 포함 직원(프리랜서 중 소속 업체가 일치하는 사람)
  const fSnap = await getDocs(freelancersRef);
  const freelancerList = fSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => (f.vendor || '').trim() === vendorName.trim())
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // 참여 프로젝트: siteClosingItems에서 해당 업체 등록 건 추출 → siteId·연월 집계
  const itemSnap = await getDocs(closingItemsRef);
  const items = itemSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => (it.vendor || '').trim() === vendorName.trim());

  const siteIds = [...new Set(items.map((it) => it.siteId).filter(Boolean))];
  let siteList = [];
  if (siteIds.length > 0) {
    const siteSnap = await getDocs(collection(db, 'sites'));
    siteList = siteSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => siteIds.includes(s.id));
  }

  const projects = siteList.map((s) => {
    const siteItems = items.filter((it) => it.siteId === s.id);
    const months = [...new Set(siteItems.map((it) => `${it.year}-${String(it.month).padStart(2, '0')}`))].sort();
    const totalAmount = siteItems.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
    return { id: s.id, name: s.name, months, totalAmount, entryCount: siteItems.length };
  }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  return { freelancers: freelancerList, projects };
}

// ── 기존 공수표에서 프리랜서·업체 일괄 가져오기 ──────
// 모든 siteClosingItems 중 itemType이 freelancer/daily이고 이름이 있는 것에서 추출.
// 같은 이름은 최근 값(updatedAt 기준) 우선. 기존 외주관리에 이미 있는 이름은 skip.
export async function importFromSiteClosings() {
  const snap = await getDocs(closingItemsRef);
  const items = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => it.itemType !== 'employee' && (it.detail || '').trim());

  // 최신순 정렬 (최근 값 우선 채택)
  items.sort((a, b) => {
    const ta = a.updatedAt?.seconds || 0;
    const tb = b.updatedAt?.seconds || 0;
    return tb - ta;
  });

  const freelancerMap = new Map();
  const vendorSet = new Set();
  for (const it of items) {
    const name = (it.detail || '').trim();
    const vendor = (it.vendor || '').trim();
    if (!name) continue;
    if (!freelancerMap.has(name)) {
      freelancerMap.set(name, {
        name,
        vendor,
        dailyRate: Number(it.unitPrice) || 0,
      });
    }
    if (vendor) vendorSet.add(vendor);
  }

  const [existingF, existingV] = await Promise.all([getFreelancers(), getVendors()]);
  const existingFNames = new Set(existingF.map((f) => f.name));
  const existingVNames = new Set(existingV.map((v) => v.name));

  const stats = {
    freelancersAdded: 0, freelancersSkipped: 0,
    vendorsAdded: 0, vendorsSkipped: 0,
  };
  for (const f of freelancerMap.values()) {
    if (existingFNames.has(f.name)) { stats.freelancersSkipped++; continue; }
    await addFreelancer(f);
    stats.freelancersAdded++;
  }
  for (const v of vendorSet) {
    if (existingVNames.has(v)) { stats.vendorsSkipped++; continue; }
    await addVendor({ name: v });
    stats.vendorsAdded++;
  }
  return stats;
}
