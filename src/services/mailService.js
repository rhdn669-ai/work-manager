import { collection, addDoc, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
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

// 그달 마감내역을 이미 요청한 업체 — 버튼을 「요청완료」로 바꾸는 데 쓴다.
//
// 보낸 뒤에도 버튼이 그대로면 두 번 세 번 보내게 된다. 업체 쪽에서는 재촉으로 읽힌다
// (2026-08-27 대표님 「내역 요청 하고나면 요청완료 버튼으로 변경」).
//
// 반환: { 업체명: 보낸시각(Date) }
export async function getStatementRequests(monthKey) {
  const q = query(mailLogsRef, where('kind', '==', 'statement-request'), where('monthKey', '==', monthKey));
  const snap = await getDocs(q);
  const out = {};
  for (const d of snap.docs) {
    const v = d.data();
    if (!v.supplier) continue;
    const at = v.sentAt?.toDate ? v.sentAt.toDate() : v.sentAt ? new Date(v.sentAt) : null;
    // 여러 번 보냈으면 마지막 것
    if (!out[v.supplier] || (at && at > out[v.supplier])) out[v.supplier] = at || new Date();
  }
  return out;
}
