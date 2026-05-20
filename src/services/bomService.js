import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const bomRef = collection(db, 'bom');

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
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
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
