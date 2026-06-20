import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  deleteDoc,
  setDoc,
  query,
  orderBy,
  where,
  writeBatch,
} from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { db, storage } from '../config/firebase';

// 삭제된 발주/프로젝트BOM의 스냅샷을 보관하는 휴지통
const trashRef = collection(db, 'trash');

// 휴지통 목록 (최근 삭제순)
export async function getTrashItems() {
  const snap = await getDocs(query(trashRef, orderBy('deletedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 타입(들)별 휴지통 목록 — 페이지별 휴지통 모달에서 사용
export async function getTrashByType(types) {
  const all = await getTrashItems();
  const set = Array.isArray(types) ? new Set(types) : new Set([types]);
  return all.filter((t) => set.has(t.type));
}

// 범용 소프트 삭제 — 임의 컬렉션 문서 1건을 휴지통에 스냅샷 후 원본 삭제
// 어느 저장 페이지든 이 함수로 삭제하면 휴지통에서 복원 가능
export async function trashGeneric(collectionName, docId, meta = {}, deletedByName = '') {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return;
  const data = snap.data();
  await addDoc(trashRef, {
    type: collectionName,
    collection: collectionName,
    refId: docId,
    title: meta.title || data.name || data.title || '(이름 없음)',
    summary: meta.summary || '',
    payload: data,
    deletedAt: new Date(),
    deletedByName,
  });
  await deleteDoc(doc(db, collectionName, docId));
}

// 발주(purchase) 1건 → 휴지통에 스냅샷 보관
export async function trashPurchase(purchaseId, deletedByName = '') {
  const snap = await getDoc(doc(db, 'purchases', purchaseId));
  if (!snap.exists()) return;
  const data = snap.data();
  await addDoc(trashRef, {
    type: 'purchase',
    refId: purchaseId,
    title: data.title || '(제목 없음)',
    siteName: data.siteName || '',
    summary: `${(data.items || []).length}개 품목 · ${Number(data.totalAmount || 0).toLocaleString()}원`,
    payload: data,
    deletedAt: new Date(),
    deletedByName,
  });
}

// 프로젝트 BOM 1건(프로젝트 문서 + 모든 BOM 항목) → 휴지통에 스냅샷 보관
export async function trashBomProject(projectId, deletedByName = '') {
  const projSnap = await getDoc(doc(db, 'bomProjects', projectId));
  const itemsSnap = await getDocs(query(collection(db, 'bom'), where('siteId', '==', projectId)));
  const bomItems = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const proj = projSnap.exists() ? projSnap.data() : {};
  await addDoc(trashRef, {
    type: 'bomProject',
    refId: projectId,
    title: proj.name || '(이름 없음)',
    siteName: proj.name || '',
    summary: `${bomItems.length}개 품목`,
    payload: proj,
    bomItems,
    deletedAt: new Date(),
    deletedByName,
  });
}

// 휴지통 항목 복원 — 원래 id 그대로 컬렉션에 되살림
export async function restoreTrashItem(trashId) {
  const tSnap = await getDoc(doc(db, 'trash', trashId));
  if (!tSnap.exists()) return;
  const t = tSnap.data();
  if (t.type === 'purchase') {
    await setDoc(doc(db, 'purchases', t.refId), t.payload || {});
  } else if (t.type === 'bomProject') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'bomProjects', t.refId), t.payload || {});
    for (const it of t.bomItems || []) {
      const { id, ...data } = it;
      batch.set(doc(db, 'bom', id), data);
    }
    await batch.commit();
  } else if (t.collection) {
    // 범용(trashGeneric) 복원 — 원래 컬렉션에 원래 id로 되살림
    await setDoc(doc(db, t.collection, t.refId), t.payload || {});
  }
  await deleteDoc(doc(db, 'trash', trashId));
}

// 휴지통 항목 영구 삭제 (복구 불가) — 자료실 파일이면 Storage 객체도 함께 제거
export async function purgeTrashItem(trashId) {
  const tSnap = await getDoc(doc(db, 'trash', trashId));
  if (tSnap.exists()) {
    const t = tSnap.data();
    const path = t.payload?.storagePath;
    if ((t.collection === 'libraryFiles' || t.type === 'libraryFiles') && path) {
      try {
        await deleteObject(storageRef(storage, path));
      } catch {
        /* 이미 없으면 무시 */
      }
    }
  }
  await deleteDoc(doc(db, 'trash', trashId));
}
