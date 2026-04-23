import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, query, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

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
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateVendor(id, data) {
  await updateDoc(doc(db, 'vendors', id), { ...data, updatedAt: new Date() });
}

export async function deleteVendor(id) {
  await deleteDoc(doc(db, 'vendors', id));
}
