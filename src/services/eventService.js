import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';

const eventsRef = collection(db, 'events');

export async function getEvents() {
  const q = query(eventsRef, orderBy('startDate', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getEventsInRange(startDate, endDate) {
  const all = await getEvents();
  return all.filter((e) => {
    const s = e.startDate;
    const en = e.endDate || e.startDate;
    return en >= startDate && s <= endDate;
  });
}

export async function addEvent(data) {
  const docRef = await addDoc(eventsRef, {
    title: data.title || '',
    description: data.description || '',
    type: data.type || 'event',
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    color: data.color || '',
    createdBy: data.createdBy || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return docRef.id;
}

export async function updateEvent(id, data) {
  await updateDoc(doc(db, 'events', id), {
    ...data,
    updatedAt: new Date(),
  });
}

export async function deleteEvent(id) {
  await deleteDoc(doc(db, 'events', id));
}
