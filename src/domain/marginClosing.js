// 마감 리스트 — 그달 매출과, 업체에 줄 돈을 건별로 펼친다.
//
// 총 마감은 집계 숫자만 보여 주어 무엇이 담기고 무엇이 빠졌는지 알 수 없었다.
// 그래서 대표님이 그 숫자를 믿지 못했다. 여기서는 건별로 펼쳐 놓고 금액을 확정한다
// (2026-08-25 대표님).
//
// 이 파일을 지배하는 세 가지.
//  ① 마감은 그달에 납품받은 내역이다. 결제가 다음 달이어도 납품이 8월이면 8월 지출이다.
//     ("마감은 해당 월에 납품 받은 내역" · "마감은 이번달에 결제는 다음달에 되는 경우가 많음")
//  ② 목록에 오르는 문은 하나다 — 발주서에서 누른 「결제 요청」.
//     한때는 문이 둘이었다(그달 입고 확정 · 그달 결제 완료). 그러다 보니 마감엔 있는데
//     결제엔 없고, 결제엔 있는데 마감엔 없는 건이 생겼다. 문을 하나로 합쳐 두 목록이
//     항상 짝이 맞게 했다 (2026-08-28 대표님 「결제 요청 버튼을 눌러야만 마감리스트
//     결제리스트에 동시에 생성되게」). 선결제도 예외가 아니다 — 어차피 결제 요청을
//     해야 돈이 나간다.
//     어느 달 마감에 넣을지는 결제 요청 모달에서 함께 정한다(마감 달). 입고는 8월인데
//     결제는 9월인 일이 흔해, 달을 자동으로 정하면 늘 어긋난다.
//     다만 요청만 눌러 둔 건은 아직 오르지 않는다 — 돈이 나갔거나 물건이 들어와야 지출이다.
//  ④ 지출은 업체에 줄 돈만 담는다. 잔업 수당·고정비는 총 마감에서 따로 본다.
//     ("마감리스트에는 업체에 결제해줘야하는 금액만 지출로")
import { mapPrintItems } from '../utils/purchaseOrder';
import { supplierKey } from './supplierContacts';
import { paidList, paidTotal, hasLegacyPaid } from './payment';

export const MISC_VENDOR = '(구매처 미지정)';

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toDate(v) {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 부가세 — 공급가의 10%. 결제 페이지와 같은 규칙(반올림)이라야 두 화면 숫자가 맞는다.
// 마감은 공급가로, 결제는 VAT 포함으로 보던 것을 나란히 놓기 위해 여기서 함께 낸다
// (2026-08-27 대표님 「마감이랑 결제에 vat 포함 미포함 같이 봐야함」).
export function vatOf(supply) {
  return Math.round((Number(supply) || 0) * 0.1);
}

export function withVat(supply) {
  const v = Number(supply) || 0;
  return v + vatOf(v);
}

// 담당이 갈린 업체는 「업체명__담당」으로 저장된 옛 기록이 있다 — 같은 업체 것으로 받아 준다.
function pickByKey(map, vkey) {
  if (!map) return null;
  if (map[vkey]) return map[vkey];
  const hit = Object.entries(map).find(([k]) => k.startsWith(`${vkey}__`));
  return hit ? hit[1] : null;
}

// 어느 달 마감에 넣을 것인가.
//
// 결제 요청 모달에서 대표님/담당자가 정한다. 옛 기록에는 없으니 되짚는데, 그 순서가
// 선결제 두 종류를 가른다 (2026-08-28 대표님).
//
//   발주와 동시에 결제하고 물건은 10월에 받는 건 → 돈이 나간 달(8월) 마감
//   입고 직전에 선결제하는 건                    → 어차피 같은 달이라 결과가 같다
//   물건 받고 나중에 결제하는 보통의 건          → 물건이 들어온 달 마감
//
// 그래서 규칙은 하나로 적힌다 — 돈이 물건보다 먼저 나갔으면 돈 나간 달, 아니면 입고 달.
//
// 입고일은 반드시 「그 업체 것」이어야 한다. 발주서 전체의 최신 입고일을 쓰면, 한 업체만
// 8월에 들어와도 같은 발주서의 다른 업체까지 8월로 딸려 온다.
export function closingMonthOf(purchase, vkey, vendorReceivedAt = null) {
  const req = pickByKey(purchase.paymentRequested, vkey);
  if (req?.closingMonth) return req.closingMonth;

  const recv = toDate(vendorReceivedAt);
  let firstPaid = null; // 첫 결제일 — 선결제인지 가리는 기준
  for (const pd of paidList(pickByKey(purchase.supplierPaid, vkey))) {
    const d = toDate(pd.paidAt);
    if (d && (!firstPaid || d < firstPaid)) firstPaid = d;
  }

  const at = firstPaid && (!recv || firstPaid < recv) ? firstPaid : recv;
  // 돈도 물건도 없으면 아직 마감이 아니다 — 요청일로 되짚으면 10월 납품 건이 8월에 선다
  return at ? monthKey(at.getFullYear(), at.getMonth() + 1) : '';
}

// 그달 마감에 오르는 (발주 × 업체) 건.
//
// 문은 「결제 요청」 하나다. 요청되지 않은 건은 아직 줄 돈이 정해지지 않았다는 뜻이라
// 마감에도 결제에도 오르지 않는다. 대신 마감 리스트가 「입고는 됐는데 요청은 안 된 건」을
// 따로 세어 알려 준다 — 아무도 안 눌러 잊히는 일이 없게 (2026-08-28 대표님).
//
// 금액은 결제 페이지와 똑같은 식으로 낸다. 한쪽은 그달 입고분만, 다른 쪽은 전체 입고분을
// 세던 것이 두 화면 숫자가 갈리던 뿌리였다.
export function closingRowsOf(purchase, itemMaster, suppliers, year, month) {
  const reqMap = purchase.paymentRequested || {};
  if (Object.keys(reqMap).length === 0) return [];
  const want = monthKey(year, month);

  const lines = mapPrintItems(purchase.items || [], itemMaster, suppliers);
  const byVendor = new Map();
  for (const ln of lines) {
    const vendor = ln._supplier || purchase.supplierName || MISC_VENDOR;
    if (!byVendor.has(vendor)) byVendor.set(vendor, { lines: [], names: [], latest: null });
    const g = byVendor.get(vendor);
    g.lines.push(ln);
    if (g.names.length < 2) g.names.push(ln._name || ln.name || '');
    const d = toDate(ln.receivedAt);
    if (d && (!g.latest || d > g.latest)) g.latest = d;
  }

  const paidMap = purchase.supplierPaid || {};
  const paidInfoOf = (vkey) => {
    const rows = paidList(pickByKey(paidMap, vkey));
    if (rows.length === 0) return { paid: false, paidAt: null, paidAmount: 0 };
    let at = null;
    for (const pd of rows) {
      const d = toDate(pd.paidAt);
      if (d && (!at || d > at)) at = d;
    }
    return { paid: true, paidAt: at, paidAmount: paidTotal(pickByKey(paidMap, vkey)) };
  };

  const out = [];
  const seen = new Set(); // 담당이 갈린 업체는 목록에 두 번 나온다 — 한 줄로 묶는다
  for (const [vendor, g] of byVendor) {
    const vkey = closeKeyOf(vendor);
    if (seen.has(vkey)) continue;
    seen.add(vkey);
    const req = pickByKey(reqMap, vkey);
    if (!req) continue; // 결제 요청된 업체만
    if (closingMonthOf(purchase, vkey, g.latest) !== want) continue;

    const anyReceived = g.lines.some((l) => Number(l.receivedQty) > 0);
    const info = paidInfoOf(vkey);
    // 돈도 안 나가고 물건도 안 왔으면 아직 그달 지출이 아니다. 결제 요청만 눌러 둔
    // 10월 납품 건이 8월 마감에 서던 문제 (2026-08-28 대표님 「마감에서 빼기」).
    // 입고되거나 돈이 나가면 그때 그 달 마감에 오른다.
    if (!anyReceived && !info.paid) continue;

    // 들어온 만큼 센다. 초과 입고는 발주 수량까지만 — 잘못 적힌 숫자가 지출을 부풀리지 않게.
    // 아직 안 들어온 선결제 건은 실제로 나간 돈이 곧 금액이다.
    const receivedTotal = g.lines.reduce((sum, l) => {
      const qty = Number(l.qty) || 0;
      const got = Math.min(Number(l.receivedQty) || 0, qty);
      return sum + got * (Number(l.unitPrice) || 0);
    }, 0);
    const orderedTotal = g.lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    // 금액 없는 옛 결제 기록(전액 결제)은 발주 금액으로 본다 — 0 원으로 서면 안 된다
    const amount = anyReceived ? receivedTotal : info.paidAmount || orderedTotal;
    out.push({
      key: `po:${purchase.id}:${vkey}`,
      purchaseId: purchase.id,
      vendorKey: vkey,
      vendor,
      siteName: purchase.siteName || '',
      title: purchase.title || '(제목 없음)',
      description: g.names.length > 1 ? `${g.names[0]} 외 ${g.lines.length - 1}건` : g.names[0] || purchase.title || '',
      amount, // 업체 내역과 대조해 마감 리스트에서 고친다
      receivedAmount: amount,
      payDue: req.dueDate || '',
      // 돈이 이미 나갔으면 확정이다 — 우리 통장이 곧 사실이라 대조할 것이 없다
      // (2026-08-27 대표님 「선결제 된건 기본이 확정인 상태가 낫지않나?」).
      closed: info.paid || hasLegacyPaid(pickByKey(paidMap, vkey)),
      ...info,
      receivedAt: g.latest,
      prepaid: info.paid && !anyReceived, // 물건보다 돈이 먼저 나간 건
    });
  }
  return out;
}

// 입고는 됐는데 결제 요청은 안 된 (발주 × 업체) 건.
//
// 문을 「결제 요청」 하나로 합치면서 생긴 사각지대다. 담당자가 버튼을 안 누르면
// 마감에도 결제에도 안 뜬다 — 그 돈이 통째로 잊힌다. 마감 리스트 맨 위에서 세어 알린다.
export function unrequestedRowsOf(purchase, itemMaster, suppliers) {
  const reqMap = purchase.paymentRequested || {};
  const lines = mapPrintItems(purchase.items || [], itemMaster, suppliers);
  const byVendor = new Map();
  for (const ln of lines) {
    const got = Math.min(Number(ln.receivedQty) || 0, Number(ln.qty) || 0);
    if (got <= 0) continue; // 입고된 것만 — 발주만 해 둔 건은 아직 줄 돈이 아니다
    const vendor = ln._supplier || purchase.supplierName || MISC_VENDOR;
    if (!byVendor.has(vendor)) byVendor.set(vendor, { amount: 0, latest: null });
    const g = byVendor.get(vendor);
    g.amount += got * (Number(ln.unitPrice) || 0);
    const d = toDate(ln.receivedAt);
    if (d && (!g.latest || d > g.latest)) g.latest = d;
  }

  const out = [];
  for (const [vendor, g] of byVendor) {
    const vkey = closeKeyOf(vendor);
    if (pickByKey(reqMap, vkey)) continue; // 이미 요청된 건
    out.push({
      purchaseId: purchase.id,
      vendor,
      title: purchase.title || '(제목 없음)',
      siteName: purchase.siteName || '',
      amount: g.amount,
      receivedAt: g.latest,
    });
  }
  return out;
}

// 날짜를 「9.10」으로 — 결제 예정일에도, 실제 결제일에도 같은 형식을 쓴다.
export function payMonthLabel(payDue) {
  const d = toDate(payDue);
  if (!d) return '';
  // 「9월」로는 그달 언제 나가는지 모른다. 업체마다 결제일이 정해져 있으니 날짜까지 적는다
  // (2026-08-27 대표님). 연도는 뺀다 — 마감월 근처라 해가 헷갈릴 일이 없다.
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
}

// 발주 전체 → 업체별 묶음. 한 업체가 여러 발주·현장에 걸쳐 있으면 한 줄로 합친다 —
// 결제는 현장이 아니라 회사 대 회사로 나가기 때문이다 (2026-08-25 대표님).
export function groupByVendor(rows) {
  const byVendor = new Map();
  for (const r of rows || []) {
    if (!byVendor.has(r.vendor)) byVendor.set(r.vendor, { vendor: r.vendor, lines: [], total: 0 });
    const g = byVendor.get(r.vendor);
    g.lines.push(r);
    g.total += Number(r.amount) || 0;
  }
  return [...byVendor.values()].sort((a, b) => b.total - a.total);
}

// 매출 — 현장별 마감(finances)에 적힌 그달 매출. 총 마감과 같은 소스라야 숫자가 어긋나지 않는다.
export function revenueRows(sites, financesBySite) {
  const out = [];
  for (const site of sites || []) {
    for (const f of financesBySite[site.id] || []) {
      if (f.type !== 'revenue') continue;
      const amount = Number(f.amount) || 0;
      if (amount <= 0) continue;
      out.push({
        key: `rev:${f.id}`,
        siteId: site.id,
        siteName: site.name || '',
        description: f.description || '(내역 없음)',
        amount,
      });
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// ── 확정 상태 얹기 ──────────────────────────────────────────
// 발주서에서 마감한 건은 담당자가 금액을 정한 것이라 올라올 때부터 확정이다
// (2026-08-26 대표님). 대표님은 이상한 것만 고치면 된다.
// 매출처럼 마감 절차가 없는 것은 미확정으로 시작한다.
export function applyConfirm(rows, confirmMap, { defaultConfirmed = false } = {}) {
  return (rows || []).map((r) => {
    const c = confirmMap?.[r.key] || null;
    const amount = c && c.amount != null ? Number(c.amount) : r.amount;
    return {
      ...r,
      amount,
      autoAmount: r.amount,
      confirmed: c ? !!c.confirmed : defaultConfirmed,
      edited: amount !== r.amount,
      // 금액을 고친 이유 — 몇 달 뒤에 「이 숫자 왜 이렇지」 할 때 답이 된다
      reason: (c && c.reason) || '',
    };
  });
}

// 합계 — 확정한 것만 센다. 이게 이 화면의 핵심이다.
// 미확정을 합계에 넣으면 총 마감과 똑같이 못 믿을 숫자가 되어 버린다.
export function sumRows(rows) {
  let confirmed = 0;
  let pending = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  for (const r of rows || []) {
    if (r.confirmed) {
      confirmed += Number(r.amount) || 0;
      confirmedCount += 1;
    } else {
      pending += Number(r.amount) || 0;
      pendingCount += 1;
    }
  }
  return { confirmed, pending, confirmedCount, pendingCount, count: confirmedCount + pendingCount };
}

// 업체 묶음의 상태 — 안에 든 건이 다 확정이면 확정, 섞여 있으면 일부 미확정.
export function groupState(lines) {
  const total = lines.length;
  const done = lines.filter((l) => l.confirmed).length;
  if (total === 0) return 'empty';
  if (done === total) return 'confirmed';
  if (done === 0) return 'pending';
  return 'partial';
}

export const GROUP_STATE_LABEL = {
  confirmed: '확정',
  partial: '일부 미확정',
  pending: '미확정',
  empty: '',
};

// 발주서 화면에서 쓰는 열쇠 — 결제와 같은 규칙(업체 단위, 담당 무시)이라야
// 「마감 → 결제요청」이 같은 줄에서 이어진다.
export function closeKeyOf(vendorName) {
  return supplierKey(vendorName, null);
}
