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
    note: data.note || '',
    order: Number(data.order) || 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateBomItem(id, data) {
  await updateDoc(doc(db, 'bom', id), { ...data, updatedAt: new Date() });
}

export async function deleteBomItem(id) {
  await deleteDoc(doc(db, 'bom', id));
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
    note: data.note || '',
    order: Number(data.order) || 0,
    createdAt: data.createdAt || new Date(),
    updatedAt: new Date(),
  });
}
