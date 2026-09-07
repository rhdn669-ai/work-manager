// 보낸 메일 한 통 = 스레드 하나.
//
// 업체가 답장하면 그 메일의 In-Reply-To 에 우리가 심은 번호가 담겨 온다. 그 번호로
// 여기를 찾아보면 「어느 발주서의 · 어느 업체에게 · 무슨 메일을 보냈던 건지」가 나온다.
// 제목을 고쳐 답장해도, 본문을 다 지워도 붙는다 (2026-08-28 대표님).
//
// 번호를 문서 ID 로 쓴다 — 답장이 오면 조회 한 번으로 끝난다.
import { collection, doc, setDoc, getDoc, getDocs, query, where } from '../config/data';
import { db } from '../config/data';
import { callSendEmail } from '../config/firebase';
import { newMessageId, threadKeyOf } from '../utils/mailTemplate';

const threadsRef = collection(db, 'mailThreads');

/**
 * 메일을 보낸 직후 그 사실을 적어 둔다.
 * @param {string} key      추적 번호 (threadKeyOf 가 뽑아낸 wm-… 부분)
 * @param {object} o
 * @param {string} o.kind        'purchase-order' | 'mail-send' | 'statement-request'
 * @param {string} o.purchaseId  발주서 건이면 그 id
 * @param {string} o.vendor      받는 업체명
 * @param {string} o.to          받는 메일 주소
 * @param {string} o.subject     보낸 제목
 * @param {string} o.monthKey    마감내역 요청이면 'YYYY-MM'
 * @param {string} o.by          보낸 사람
 * @param {string} o.messageId   실제로 나간 Message-ID 전체
 */
export async function recordMailThread(key, o = {}) {
  if (!key) return;
  await setDoc(doc(threadsRef, key), {
    kind: o.kind || '',
    purchaseId: o.purchaseId || '',
    vendor: o.vendor || '',
    to: o.to || '',
    subject: o.subject || '',
    monthKey: o.monthKey || '',
    by: o.by || '',
    messageId: o.messageId || '',
    sentAt: new Date(),
  });
}

export async function getMailThread(key) {
  if (!key) return null;
  const snap = await getDoc(doc(threadsRef, key));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// 한 발주서에서 나간 메일들 — 발주서 화면에서 답장을 붙여 보여 줄 때 쓴다
export async function getThreadsByPurchase(purchaseId) {
  if (!purchaseId) return [];
  const snap = await getDocs(query(threadsRef, where('purchaseId', '==', purchaseId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * 추적 번호를 달아 메일을 보낸다 — 세 발송처(발주서·메일발송·마감내역요청)가 함께 쓴다.
 *
 * 번호를 심지 않고 보내면 답장이 와도 어느 건인지 알 길이 없다. 한 곳에서 감싸 두면
 * 앞으로 새 발송처가 생겨도 빠뜨리지 않는다.
 *
 * @param {object} data 보낼 것 (to · subject · html · attachments)
 * @param {object} meta 무엇에 대한 메일인지 (kind · purchaseId · vendor · monthKey · by)
 */
export async function sendTrackedMail(data, meta = {}) {
  const wanted = newMessageId();
  const res = await callSendEmail({ ...data, messageId: wanted });
  // 네이버가 우리 번호를 덮어썼을 수 있다 — 실제로 나간 값이 답장에 담겨 온다
  const actual = res?.data?.messageId || wanted;
  const key = threadKeyOf(actual) || threadKeyOf(wanted);
  // 기록에 실패해도 메일은 이미 나갔다. 발송을 되돌릴 수는 없으니 삼키되 남긴다.
  await recordMailThread(key, {
    ...meta,
    to: data.to,
    subject: data.subject,
    messageId: actual,
  }).catch((err) => console.error('메일 스레드 기록 실패', err));
  return res;
}

// ── 받아 온 답장 ───────────────────────────────────────────────
// 5분마다 도는 수집기(functions/mailReplies.js)가 담아 둔 것을 읽는다.
// 무엇에 대한 답장인지는 이미 붙어 있어 여기서는 꺼내 오기만 하면 된다.

const repliesRef = collection(db, 'mailReplies');

// 한 발주서에 온 답장 — 발주서 화면에서 업체 줄에 붙인다
export async function getRepliesByPurchase(purchaseId) {
  if (!purchaseId) return [];
  const snap = await getDocs(query(repliesRef, where('purchaseId', '==', purchaseId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => at(a) - at(b));
}

// 그달 마감내역 요청에 온 답장 — 「요청완료」를 「내역 도착」으로 바꾸고, 본문도 보여 준다.
// 반환: { 업체명: [답장…] } — 온 순서대로
export async function getStatementReplies(monthKey) {
  if (!monthKey) return {};
  const snap = await getDocs(
    query(repliesRef, where('kind', '==', 'statement-request'), where('monthKey', '==', monthKey)),
  );
  const out = {};
  for (const d of snap.docs) {
    const v = { id: d.id, ...d.data() };
    if (!v.vendor) continue;
    if (!out[v.vendor]) out[v.vendor] = [];
    out[v.vendor].push(v);
  }
  for (const list of Object.values(out)) list.sort((a, b) => at(a) - at(b));
  return out;
}

// 최근 답장 — 메일 발송 화면에서 「답장 왔음」을 보여 준다
export async function getRecentReplies(max = 200) {
  const snap = await getDocs(repliesRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => at(b) - at(a))
    .slice(0, max);
}

function at(v) {
  const d = v?.receivedAt?.toDate ? v.receivedAt.toDate() : v?.receivedAt ? new Date(v.receivedAt) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}
