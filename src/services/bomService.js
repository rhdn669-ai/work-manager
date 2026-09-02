import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const bomRef = collection(db, 'bom');
const projectsRef = collection(db, 'bomProjects');

// ---- 프로젝트 (BOM 그룹) ----
// order(수동 순서)가 있으면 그 순서로, 없으면 최신 등록순
export async function getBomProjects() {
  const snap = await getDocs(projectsRef);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const hasOrder = list.some((p) => typeof p.order === 'number');
  if (hasOrder) {
    return list.sort((a, b) => {
      const ao = typeof a.order === 'number' ? a.order : 1e9;
      const bo = typeof b.order === 'number' ? b.order : 1e9;
      if (ao !== bo) return ao - bo;
      return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
    });
  }
  return list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

// 드래그 순서변경 — 전달된 id 순서대로 order 저장
export async function saveBomProjectsOrder(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'bomProjects', id), { order: idx, updatedAt: new Date() });
  });
  await batch.commit();
}

export async function getBomProjectById(id) {
  const snap = await getDoc(doc(db, 'bomProjects', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function addBomProject(name) {
  return addDoc(projectsRef, {
    name: String(name || '').trim(),
    createdAt: new Date(),
  });
}

export async function updateBomProject(projectId, name) {
  await updateDoc(doc(db, 'bomProjects', projectId), {
    name: String(name || '').trim(),
    updatedAt: new Date(),
  });
}

// ---- 타입(형번) ----
// 같은 제품인데 형번마다 자재가 조금씩 다를 때, BOM을 여러 벌 만들지 않고 한 벌로 관리한다.
// 두 벌로 나눠 두면 자재가 바뀔 때마다 양쪽을 다 고쳐야 해서 한쪽을 빠뜨리기 쉽다.
//
// 프로젝트: variants [{ key, label }]  — key 는 라벨을 바꿔도 그대로인 식별자
// 품목:     variantKeys []             — 비어 있으면 '공통'(모든 타입에 들어감),
//                                        값이 있으면 그 타입에서만 쓰인다
export async function setBomVariants(projectId, variants) {
  await updateDoc(doc(db, 'bomProjects', projectId), {
    variants: (variants || []).map((v) => ({ key: v.key, label: String(v.label || '').trim() })),
    updatedAt: new Date(),
  });
}

// 타입을 지우면 그 타입에만 속하던 품목이 어디에도 안 잡히게 된다.
// 남은 타입이 없으면 공통으로 되돌려 품목이 사라지지 않게 한다.
export async function removeBomVariant(projectId, key) {
  const proj = await getBomProjectById(projectId);
  const next = (proj?.variants || []).filter((v) => v.key !== key);
  const items = await getBomBySite(projectId);
  const batch = writeBatch(db);
  for (const b of items) {
    const ks = Array.isArray(b.variantKeys) ? b.variantKeys : [];
    if (!ks.includes(key)) continue;
    batch.update(doc(db, 'bom', b.id), { variantKeys: ks.filter((k) => k !== key), updatedAt: new Date() });
  }
  batch.update(doc(db, 'bomProjects', projectId), { variants: next, updatedAt: new Date() });
  await batch.commit();
}

// 한 타입으로 발주할 때 실제로 들어가는 품목 — 공통 + 그 타입 전용
export function bomItemsForVariant(items, variantKey) {
  if (!variantKey) return items;
  return (items || []).filter((b) => {
    const ks = Array.isArray(b.variantKeys) ? b.variantKeys : [];
    return ks.length === 0 || ks.includes(variantKey);
  });
}

// BOM 프로젝트 복사 — 프로젝트 문서 + 품목 전체(BOX·순서 포함)를 새 프로젝트로 복제
export async function duplicateBomProject(projectId, newName) {
  const src = await getBomProjectById(projectId);
  if (!src) throw new Error('원본 프로젝트를 찾을 수 없습니다');
  const newRef = await addDoc(projectsRef, {
    name: String(newName || `${src.name} (복사)`).trim(),
    createdAt: new Date(),
  });
  const items = await getBomBySite(projectId);
  // writeBatch는 500건 제한 — BOM 품목 수백 건 수준이므로 450개씩 분할
  for (let i = 0; i < items.length; i += 450) {
    const batch = writeBatch(db);
    items.slice(i, i + 450).forEach((b) => {
      const { id: _id, siteId: _s, createdAt: _c, updatedAt: _u, ...data } = b;
      batch.set(doc(bomRef), {
        ...data,
        siteId: newRef.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    await batch.commit();
  }
  return newRef.id;
}

export async function deleteBomProject(projectId) {
  const snap = await getDocs(query(bomRef, where('siteId', '==', projectId)));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, 'bomProjects', projectId));
  await batch.commit();
}

// 프로젝트별 BOM 항목 조회 (order 순)
export async function getBomBySite(siteId) {
  if (!siteId) return [];
  try {
    const q = query(bomRef, where('siteId', '==', siteId), orderBy('order'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // composite index 미생성 환경 fallback — 클라이언트 정렬
    const q = query(bomRef, where('siteId', '==', siteId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
}

export async function addBomItem(siteId, data) {
  return addDoc(bomRef, {
    siteId,
    itemId: data.itemId || '',
    name: data.name || '',
    spec: data.spec || '',
    unit: data.unit || '',
    qty: Number(data.qty) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    box: data.box || '',
    note: data.note || '',
    // 사급 = 고객사 제공 자재. 우리 돈이 안 나가므로 금액 합계에서 뺀다.
    // 빈 값이 도급(우리가 사서 넣는 것) — 지금까지의 모든 품목이 그렇다 (2026-09-02 대표님).
    supplyType: data.supplyType || '',
    // 도번 — 도면 번호. 품목 코드와 나란히 다니며 현장에서 도면을 찾는 열쇠가 된다
    // (2026-09-02 대표님). 발주서로도 그대로 따라간다.
    drawingNo: data.drawingNo || '',
    variantKeys: data.variantKeys || [], // 비어 있으면 공통
    order: Number(data.order) || 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// 드래그 순서변경 — 전달된 id 순서대로 order 저장 (프로젝트 목록 saveBomProjectsOrder와 동일 패턴)
// ※ 발주서 품목은 가져올 때 복사본이므로 기존 발주서에는 영향 없음 — 이후 「품목 불러오기」부터 새 순서 적용
export async function saveBomItemsOrder(orderedIds) {
  const batch = writeBatch(db);
  orderedIds.forEach((id, idx) => {
    batch.update(doc(db, 'bom', id), { order: idx, updatedAt: new Date() });
  });
  await batch.commit();
}

export async function updateBomItem(id, data) {
  await updateDoc(doc(db, 'bom', id), { ...data, updatedAt: new Date() });
}

export async function deleteBomItem(id) {
  await deleteDoc(doc(db, 'bom', id));
}

// 사급인가 — 고객사 제공 자재. 값이 'free' 인 것만 사급이고 나머지는 다 도급이다.
// 한 곳에서 가려야 화면·합계·발주 불러오기가 어긋나지 않는다 (2026-09-02 대표님).
export function isFreeIssue(item) {
  return (item?.supplyType || '') === 'free';
}

// 실행취소용 — 원래 id 그대로 복원
export async function restoreBomItem(id, siteId, data) {
  await setDoc(doc(db, 'bom', id), {
    siteId,
    itemId: data.itemId || '',
    name: data.name || '',
    spec: data.spec || '',
    unit: data.unit || '',
    qty: Number(data.qty) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    box: data.box || '',
    note: data.note || '',
    supplyType: data.supplyType || '',
    drawingNo: data.drawingNo || '',
    variantKeys: data.variantKeys || [],
    order: Number(data.order) || 0,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date(),
  });
}
