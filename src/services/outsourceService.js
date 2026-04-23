import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, where, arrayUnion, arrayRemove,
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

// 특정 날짜(YYYY-MM-DD)에 적용되는 단가 반환
// 우선순위: 현재 단가(dailyRateFrom 이후) > rateHistory 매칭(effectiveFrom~effectiveTo) > fallback dailyRate
export function getRateForDate(freelancer, dateStr) {
  if (!freelancer) return 0;
  const currentFrom = freelancer.dailyRateFrom;
  if (currentFrom && dateStr >= currentFrom) {
    return Number(freelancer.dailyRate) || 0;
  }
  const history = Array.isArray(freelancer.rateHistory) ? freelancer.rateHistory : [];
  if (history.length > 0) {
    // effectiveFrom <= dateStr <= effectiveTo (effectiveTo 없으면 무제한)
    const match = history
      .filter((h) => h && h.effectiveFrom && h.effectiveFrom <= dateStr && (!h.effectiveTo || h.effectiveTo >= dateStr))
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (match) return Number(match.rate) || 0;
  }
  return Number(freelancer.dailyRate) || 0;
}

// 'YYYY-MM-01' 문자열의 직전 월 'YYYY-MM-01' 반환
function prevMonthOf(fromStr) {
  if (!fromStr) return '';
  const [ys, ms] = fromStr.split('-');
  const y = Number(ys); const m = Number(ms);
  if (!y || !m) return '';
  let py = y; let pm = m - 1;
  if (pm <= 0) { py -= 1; pm = 12; }
  return `${py}-${String(pm).padStart(2, '0')}-01`;
}

// 프리랜서 단가 변경 — 새 단가 + 적용 시작 월 지정
// 기존 단가가 있었다면 rateHistory에 누적 기록 (과거 기록을 모두 보존)
export async function setFreelancerRate(freelancerId, { dailyRate, effectiveFromMonth }) {
  if (!freelancerId) return;
  const snap = await getDoc(doc(db, 'freelancers', freelancerId));
  const prev = snap.exists() ? snap.data() : {};
  const prevRate = Number(prev.dailyRate) || 0;
  const prevFrom = prev.dailyRateFrom || '';
  const newRate = Number(dailyRate) || 0;
  const newFrom = effectiveFromMonth || '';

  const update = {
    dailyRate: newRate,
    dailyRateFrom: newFrom,
    updatedAt: new Date(),
  };

  // 이전 단가가 실제로 있었고, 변경 사항이 있을 때만 rateHistory에 항목 추가
  if (prevRate > 0 && (prevRate !== newRate || prevFrom !== newFrom)) {
    const existing = Array.isArray(prev.rateHistory) ? prev.rateHistory : [];
    // 레거시 previousDailyRate가 있고 rateHistory에 아직 병합되지 않았다면 선반영
    const migrated = [];
    if (
      Number(prev.previousDailyRate) > 0
      && !existing.some((h) => h && h.rate === Number(prev.previousDailyRate) && (h.effectiveFrom || '') === (prev.previousDailyRateFrom || ''))
    ) {
      migrated.push({
        rate: Number(prev.previousDailyRate) || 0,
        effectiveFrom: prev.previousDailyRateFrom || '',
        effectiveTo: prev.previousDailyRateTo || prevMonthOf(prevFrom),
      });
    }
    const newEntry = {
      rate: prevRate,
      effectiveFrom: prevFrom,
      effectiveTo: prevMonthOf(newFrom),
    };
    // 중복 방지
    const merged = [...existing, ...migrated];
    const dupKey = (h) => `${h.rate}|${h.effectiveFrom || ''}|${h.effectiveTo || ''}`;
    if (!merged.some((h) => dupKey(h) === dupKey(newEntry))) {
      merged.push(newEntry);
    }
    update.rateHistory = merged;
    // 레거시 필드 정리 (이미 rateHistory로 옮김)
    update.previousDailyRate = 0;
    update.previousDailyRateFrom = '';
    update.previousDailyRateTo = '';
  }

  await updateDoc(doc(db, 'freelancers', freelancerId), update);
}

// 단가 이력 항목 추가 (중복 방지: 같은 effectiveFrom+rate는 skip)
export async function addRateHistoryEntry(freelancerId, entry) {
  if (!freelancerId || !entry?.effectiveFrom) return;
  const normalized = {
    rate: Number(entry.rate) || 0,
    effectiveFrom: entry.effectiveFrom,
    note: entry.note || '',
  };
  await updateDoc(doc(db, 'freelancers', freelancerId), {
    rateHistory: arrayUnion(normalized),
    updatedAt: new Date(),
  });
}

// 단가 이력 항목 제거
export async function removeRateHistoryEntry(freelancerId, entry) {
  if (!freelancerId || !entry) return;
  await updateDoc(doc(db, 'freelancers', freelancerId), {
    rateHistory: arrayRemove(entry),
    updatedAt: new Date(),
  });
}

// 모든 프리랜서의 단가 이력 일괄 초기화 (rateHistory + 레거시 previousDailyRate*)
export async function clearAllRateHistories() {
  const snap = await getDocs(freelancersRef);
  let count = 0;
  for (const d of snap.docs) {
    const data = d.data() || {};
    const hasHistory = Array.isArray(data.rateHistory) && data.rateHistory.length > 0;
    const hasLegacy = Number(data.previousDailyRate) > 0 || data.previousDailyRateFrom || data.previousDailyRateTo;
    if (!hasHistory && !hasLegacy) continue;
    await updateDoc(doc(db, 'freelancers', d.id), {
      rateHistory: [],
      previousDailyRate: 0,
      previousDailyRateFrom: '',
      previousDailyRateTo: '',
      updatedAt: new Date(),
    });
    count += 1;
  }
  return count;
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
    name: data.name || '',                     // 업체명
    representative: data.representative || '', // 대표자 이름
    contact: data.contact || '',               // 연락처
    businessNumber: data.businessNumber || '', // 사업자번호
    bankAccount: data.bankAccount || '',       // 계좌
    note: data.note || '',
    dailyRate: Number(data.dailyRate) || 0,
    caseRate: Number(data.caseRate) || 0,
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

// 업체 상세: 소속 프리랜서(직원) + 수기 입력된 프로젝트명 목록
export async function getVendorDetail(vendorId, vendorName) {
  // 포함 직원(프리랜서 중 소속 업체가 일치하는 사람)
  const fSnap = await getDocs(freelancersRef);
  const freelancerList = fSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => (f.vendor || '').trim() === (vendorName || '').trim())
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  // 업체 문서의 projects 배열 (수기 입력: 이름 + 단가)
  // 구버전 projectNames(문자열 배열)도 흡수
  let projects = [];
  if (vendorId) {
    const snap = await getDoc(doc(db, 'vendors', vendorId));
    if (snap.exists()) {
      const d = snap.data();
      const modern = Array.isArray(d.projects) ? d.projects : [];
      const legacy = Array.isArray(d.projectNames) ? d.projectNames : [];
      const merged = [...modern];
      for (const name of legacy) {
        if (!merged.some((p) => p.name === name)) {
          merged.push({ name, unitPrice: 0 });
        }
      }
      projects = merged;
    }
  }
  return { freelancers: freelancerList, projects };
}

// 업체 프로젝트 추가 (이름 + 건당 단가)
export async function addVendorProject(vendorId, { name, unitPrice }) {
  if (!vendorId || !name?.trim()) return;
  const entry = { name: name.trim(), unitPrice: Number(unitPrice) || 0 };
  await updateDoc(doc(db, 'vendors', vendorId), {
    projects: arrayUnion(entry),
    updatedAt: new Date(),
  });
}

// 업체 프로젝트 제거
export async function removeVendorProject(vendorId, project) {
  if (!vendorId || !project) return;
  await updateDoc(doc(db, 'vendors', vendorId), {
    projects: arrayRemove(project),
    updatedAt: new Date(),
  });
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
