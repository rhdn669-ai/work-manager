import { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';

const quotesRef = collection(db, 'quotes');

// 견적서 데이터 모델:
// {
//   title, supplierId, supplierName, siteName,
//   items: [{ name, spec, unit, qty, unitPrice, amount, note }],
//   totalAmount, vat, grandTotal,
//   validity, delivery, payment,  // 유효기간/납품기일/지불조건
//   note,                          // 특이사항 (기본 안내문 자동 채움)
//   createdAt, updatedAt
// }

export async function getQuotes() {
  try {
    const snap = await getDocs(query(quotesRef, orderBy('createdAt', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(quotesRef);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  }
}

export async function getQuoteById(id) {
  const snap = await getDoc(doc(db, 'quotes', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function addQuote(data) {
  return addDoc(quotesRef, {
    title: data.title || '',
    supplierId: data.supplierId || '',
    supplierName: data.supplierName || '',
    siteName: data.siteName || '',
    items: data.items || [],
    totalAmount: Number(data.totalAmount) || 0,
    vat: Number(data.vat) || 0,
    grandTotal: Number(data.grandTotal) || 0,
    validity: data.validity || '15일',
    delivery: data.delivery || '일정에 준함',
    payment: data.payment || '협의',
    note: data.note || '• 견적서 유효기간 : 15일\n• 물품 납품기간 : 일정에 준함\n• 견적서 외 사항은 별도임.',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export async function updateQuote(id, data) {
  await updateDoc(doc(db, 'quotes', id), { ...data, updatedAt: new Date() });
}

export async function deleteQuote(id) {
  await deleteDoc(doc(db, 'quotes', id));
}
