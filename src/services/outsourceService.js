import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const closingItemsRef = collection(db, 'siteClosingItems');

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
