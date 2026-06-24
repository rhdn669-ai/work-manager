import { collection, addDoc, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../config/firebase';

const mailLogsRef = collection(db, 'mailLogs');

// 메일 발송 1회(배치)를 이력으로 기록
export async function addMailLog(data) {
  return addDoc(mailLogsRef, { ...data, createdAt: new Date() });
}

// 최근 발송 이력 조회
export async function getMailLogs(max = 200) {
  const q = query(mailLogsRef, orderBy('createdAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
