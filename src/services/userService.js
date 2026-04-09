import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const usersRef = collection(db, 'users');

export async function getUsers() {
  const q = query(usersRef, orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getUsersByDepartment(departmentId) {
  const q = query(usersRef, where('departmentId', '==', departmentId), orderBy('name'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getUser(uid) {
  const docSnap = await getDoc(doc(db, 'users', uid));
  return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
}

export async function updateUser(uid, data) {
  await updateDoc(doc(db, 'users', uid), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function createUser(uid, data) {
  await setDoc(doc(db, 'users', uid), {
    uid,
    ...data,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function deleteUser(uid) {
  await deleteDoc(doc(db, 'users', uid));
}
