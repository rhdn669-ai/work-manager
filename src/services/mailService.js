import { collection, addDoc, getDocs, query, orderBy, limit, where } from '../config/data';
import { db } from '../config/data';

const mailLogsRef = collection(db, 'mailLogs');

// 메일 발송 1회(배치)를 이력으로 기록
export async function addMailLog(data) {
  return addDoc(mailLogsRef, { ...data, createdAt: new Date() });
}

// 이력 한 줄을 화면이 읽을 수 있는 모양으로.
//
// 마감내역 요청은 to·supplier·sentBy 로, 메일 발송은 recipients·total·by 로 적어 왔다.
// 이미 쌓인 것을 되돌릴 수는 없으니 읽을 때 맞춰 준다 (2026-09-01 대표님).
export function normalizeMailLog(l) {
  const recipients =
    l.recipients?.length > 0
      ? l.recipients
      : l.supplier || l.to
        ? [{ name: l.supplier || l.to, email: l.to || '' }]
        : [];
  const total = l.total ?? (recipients.length || 0);
  const okCount = l.okCount ?? (l.failCount ? Math.max(0, total - l.failCount) : total);
  return {
    ...l,
    recipients,
    total,
    okCount,
    failCount: l.failCount ?? 0,
    by: l.by || l.sentBy || '',
    targetType: l.targetType || 'supplier',
  };
}

// 최근 발송 이력 조회
export async function getMailLogs(max = 200) {
  const q = query(mailLogsRef, orderBy('createdAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeMailLog({ id: d.id, ...d.data() }));
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
