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
  onSnapshot,
} from '../config/data';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { isServer } from '../config/data';
import * as ServerFiles from './serverFiles';
import { db } from '../config/data';
import { storage } from '../config/firebase';

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

// 타입(들)별 휴지통 실시간 구독 — 휴지통 버튼 개수 배지용
export function subscribeTrashByType(types, cb) {
  const set = Array.isArray(types) ? new Set(types) : new Set([types]);
  return onSnapshot(query(trashRef, orderBy('deletedAt', 'desc')), (snap) => {
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(all.filter((t) => set.has(t.type)));
  });
}

// 범용 소프트 삭제 — 임의 컬렉션 문서 1건을 휴지통에 스냅샷 후 원본 삭제
// 어느 저장 페이지든 이 함수로 삭제하면 휴지통에서 복원 가능
export async function trashGeneric(collectionName, docId, meta = {}, deletedByName = '') {
  const snap = await getDoc(doc(db, collectionName, docId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const trashDocRef = await addDoc(trashRef, {
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
  return trashDocRef.id;
}

// 발주(purchase) 1건 → 휴지통에 스냅샷 보관
export async function trashPurchase(purchaseId, deletedByName = '') {
  const snap = await getDoc(doc(db, 'purchases', purchaseId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const trashDocRef = await addDoc(trashRef, {
    type: 'purchase',
    refId: purchaseId,
    title: data.title || '(제목 없음)',
    siteName: data.siteName || '',
    summary: `${(data.items || []).length}개 품목 · ${Number(data.totalAmount || 0).toLocaleString()}원`,
    payload: data,
    deletedAt: new Date(),
    deletedByName,
  });
  return trashDocRef.id;
}

// 프로젝트 BOM 1건(프로젝트 문서 + 모든 BOM 항목) → 휴지통에 스냅샷 보관
export async function trashBomProject(projectId, deletedByName = '') {
  const projSnap = await getDoc(doc(db, 'bomProjects', projectId));
  const itemsSnap = await getDocs(query(collection(db, 'bom'), where('siteId', '==', projectId)));
  const bomItems = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const proj = projSnap.exists() ? projSnap.data() : {};
  const trashDocRef = await addDoc(trashRef, {
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
  return trashDocRef.id;
}

/** 자재 이력 한 줄 — 지우기 전 스냅샷. 짝 기록(mate)까지 한 벌로 담는다 (2026-09-16) */
export async function trashMatLog({ panelId, box, rowId, log, mate = null, title = '', summary = '' }, by = '') {
  if (!panelId || !box || !rowId || !log?.id) return null;
  const ref = await addDoc(trashRef, {
    type: 'matLog',
    refId: `${panelId}__${box}__${rowId}__${log.id}`,
    title: title || '자재 이력',
    summary,
    payload: { panelId, box, rowId, log, mate },
    deletedAt: new Date(),
    deletedByName: by,
  });
  return ref.id;
}

// 휴지통 항목 복원 — 원래 id 그대로 컬렉션에 되살림
export async function restoreTrashItem(trashId) {
  const tSnap = await getDoc(doc(db, 'trash', trashId));
  if (!tSnap.exists()) return;
  const t = tSnap.data();
  if (t.type === 'purchase') {
    await setDoc(doc(db, 'purchases', t.refId), t.payload || {});
    // 삭제할 때 창고로 돌려준 몫을 다시 뺀다 — 발주서가 되살아났으니 그 몫은 다시 «쥐고 있는» 것.
    // 전에는 페이지의 「실행취소」에서만 해서, 전역 휴지통 복원은 재고가 두 배로 남았다
    const items = t.payload?.items || [];
    if (items.length) {
      const { releasePurchaseStock } = await import('./purchaseService');
      await releasePurchaseStock(items, { byName: '', note: '휴지통 복원', back: false }).catch(() => {});
    }
  } else if (t.type === 'bomProject') {
    const batch = writeBatch(db);
    batch.set(doc(db, 'bomProjects', t.refId), t.payload || {});
    for (const it of t.bomItems || []) {
      const { id, ...data } = it;
      batch.set(doc(db, 'bom', id), data);
    }
    await batch.commit();
  } else if (t.type === 'panelIncidents') {
    // 분실·파손 사건 — 호기 줄 기록(incidents[]) 안으로 되살리고, 열린 사건이면 빈자리도 다시 뺀다
    const { panelId, box, rowId, inc } = t.payload || {};
    if (panelId && box && rowId && inc) {
      const { getPanelMaterials, materialsDocId } = await import('./panelMaterialsService');
      const { shiftHole } = await import('./incidentService');
      const mats = await getPanelMaterials(panelId);
      const list = (mats?.[box]?.[rowId]?.incidents || []).filter((x) => x.id !== inc.id);
      await setDoc(
        doc(db, 'panelMaterials', materialsDocId(panelId, box)),
        { panelId, box, items: { [rowId]: { incidents: [...list, inc] } }, updatedAt: new Date() },
        { merge: true },
      );
      const took = Number(inc.took ?? 0) || 0;
      if ((inc.status || 'open') === 'open' && took > 0) {
        const r = await shiftHole(inc.from || panelId, box, rowId, -took);
        // 다시 뺀 양·줄인 몫을 사건에 새로 적는다 — 다음 삭제가 그만큼만 되돌리게
        await setDoc(
          doc(db, 'panelMaterials', materialsDocId(panelId, box)),
          {
            panelId,
            box,
            items: { [rowId]: { incidents: [...list, { ...inc, took: -r.moved, tookKept: r.kept }] } },
            updatedAt: new Date(),
          },
          { merge: true },
        );
      }
    }
  } else if (t.type === 'matLog') {
    // 자재 이력 한 줄 — 그 호기 줄의 기록으로 되살린다. 수량은 건드리지 않는다(지금 수량이 실물)
    const { panelId, box, rowId, log, mate } = t.payload || {};
    if (panelId && box && rowId && log?.id) {
      const { getPanelMaterials, materialsDocId } = await import('./panelMaterialsService');
      const put = async (pid, one) => {
        const mats = await getPanelMaterials(pid);
        const rest = (mats?.[box]?.[rowId]?.log || []).filter((x) => x.id !== one.id);
        await setDoc(
          doc(db, 'panelMaterials', materialsDocId(pid, box)),
          { panelId: pid, box, items: { [rowId]: { log: [...rest, one] } }, updatedAt: new Date() },
          { merge: true },
        );
      };
      await put(panelId, log);
      if (mate?.panelId && mate?.log?.id) await put(mate.panelId, mate.log);
    }
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
        if (isServer) await ServerFiles.removeFileAt(path);
        else await deleteObject(storageRef(storage, path));
      } catch {
        /* 이미 없으면 무시 */
      }
    }
  }
  await deleteDoc(doc(db, 'trash', trashId));
}
