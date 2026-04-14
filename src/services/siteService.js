import {
  collection, doc, getDocs, getDoc, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const sitesRef = collection(db, 'sites');
const itemsRef = collection(db, 'siteClosingItems');

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
