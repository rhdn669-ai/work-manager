// 마감 리스트 — 그달 매출과, 업체에 줄 돈을 건별로 펼친다.
//
// 총 마감은 집계 숫자만 보여 주어 무엇이 담기고 무엇이 빠졌는지 알 수 없었다.
// 그래서 대표님이 그 숫자를 믿지 못했다. 여기서는 건별로 펼쳐 놓고 금액을 확정한다
// (2026-08-25 대표님).
//
// 이 파일을 지배하는 세 가지.
//  ① 마감은 그달에 납품받은 내역이다. 결제가 다음 달이어도 납품이 8월이면 8월 지출이다.
//     ("마감은 해당 월에 납품 받은 내역" · "마감은 이번달에 결제는 다음달에 되는 경우가 많음")
//  ② 목록에 오르는 문은 둘이다 — 그달 「입고 확정」 또는 그달 「결제 완료」.
//     ("입고확정이 해당 월인 내용은 다 리스트에 올라와야함" — 빠지는 건이 없어야 한다)
//     선결제처럼 돈이 먼저 나가고 물건이 나중에 오는 건은 입고만 보면 그달에서 빠진다.
//     그달에 나간 돈은 그달에 다 보여야 하므로 결제일도 문으로 둔다 (2026-08-27 대표님).
//  ③ 확정은 마감 리스트에서만 한다. 업체에서 마감내역을 받아 우리 숫자와 대조해야
//     확정할 수 있기 때문이다 — 발주서에서 미리 확정하면 앞뒤가 뒤바뀐다 (2026-08-27 대표님).
//     예외는 선결제뿐이다. 이미 나간 돈은 우리 통장이 곧 사실이라 다툴 여지가 없다.
//  ③ 지출은 업체에 줄 돈만 담는다. 잔업 수당·고정비는 총 마감에서 따로 본다.
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

function inMonth(v, year, month) {
  const d = toDate(v);
  return !!d && d.getFullYear() === year && d.getMonth() + 1 === month;
}

// 그달에 실제로 들어온 몫만 금액으로 친다.
// 초과 입고는 발주 수량까지만 — 잘못 적힌 숫자가 지출을 부풀리지 않게 한다.
function receivedAmount(line) {
  const qty = Number(line.qty) || 0;
  const got = Math.min(Number(line.receivedQty) || 0, qty);
  return got > 0 ? got * (Number(line.unitPrice) || 0) : 0;
}

// 한 업체의 납품 금액 — 마감 버튼을 누를 때 이 값이 기본으로 들어간다.
// 아직 안 들어온 몫은 빼고 센다. 들어온 달에 잡히는 게 맞기 때문이다.
export function receivedAmountOf(purchase, itemMaster, suppliers, vendorName) {
  const lines = mapPrintItems(purchase.items || [], itemMaster, suppliers);
  let total = 0;
  let count = 0;
  for (const ln of lines) {
    const vendor = ln._supplier || purchase.supplierName || MISC_VENDOR;
    if (vendor !== vendorName) continue;
    const amt = receivedAmount(ln);
    if (amt <= 0) continue;
    total += amt;
    count += 1;
  }
  return { amount: total, count };
}

// 그달 입고 확정된 (발주 × 업체) 건 — 마감 버튼을 눌렀든 안 눌렀든 전부 올라온다.
//
// 처음에는 마감 버튼을 누른 것만 올렸는데, 그러면 누르는 걸 잊은 건이 통째로 빠진다.
// 대표님이 총 마감을 못 믿으신 이유가 바로 「빠진 게 있다」였으므로, 입고된 것은
// 무조건 목록에 세우고 마감 여부를 상태로 보여 준다 (2026-08-26 대표님).
//
// 마감을 누른 건은 담당자가 금액을 확정한 것이라 그 금액을 쓰고, 안 누른 건은
// 입고분으로 계산해 미확정으로 세운다.
export function receivedRowsOf(purchase, itemMaster, suppliers, year, month) {
  const lines = mapPrintItems(purchase.items || [], itemMaster, suppliers);
  const byVendor = new Map();
  for (const ln of lines) {
    if (!inMonth(ln.receivedAt, year, month)) continue;
    const amt = receivedAmount(ln);
    if (amt <= 0) continue;
    const vendor = ln._supplier || purchase.supplierName || MISC_VENDOR;
    if (!byVendor.has(vendor)) byVendor.set(vendor, { amount: 0, names: [], count: 0, latest: null });
    const g = byVendor.get(vendor);
    g.amount += amt;
    g.count += 1;
    if (g.names.length < 2) g.names.push(ln._name || ln.name || '');
    const d = toDate(ln.receivedAt);
    if (d && (!g.latest || d > g.latest)) g.latest = d;
  }

  // 두 번째 문 — 그달 결제 완료된 업체. 선결제처럼 입고보다 돈이 먼저 나간 건을 잡는다.
  // 이미 입고로 잡힌 업체는 건드리지 않는다(같은 건이 두 줄이 되지 않게).
  const paidMap = purchase.supplierPaid || {};
  const prepaid = new Map();
  for (const [vkey, raw] of Object.entries(paidMap)) {
    for (const pd of paidList(raw)) {
      if (!inMonth(pd.paidAt, year, month)) continue;
      const amt = Number(pd.amount) || 0;
      const cur = prepaid.get(vkey) || { amount: 0, at: null };
      cur.amount += amt;
      const d = toDate(pd.paidAt);
      if (d && (!cur.at || d > cur.at)) cur.at = d;
      prepaid.set(vkey, cur);
    }
  }

  // 결제일은 결제 요청 때 정해진다 — 거기서 읽는다.
  const req = purchase.paymentRequested || {};
  const out = [];
  for (const [vendor, g] of byVendor) {
    const vkey = closeKeyOf(vendor);
    out.push({
      key: `po:${purchase.id}:${vkey}`,
      purchaseId: purchase.id,
      vendorKey: vkey,
      vendor,
      siteName: purchase.siteName || '',
      title: purchase.title || '(제목 없음)',
      description: g.count > 1 ? `${g.names[0]} 외 ${g.count - 1}건` : g.names[0] || purchase.title || '',
      amount: g.amount, // 입고분 그대로 — 업체 내역과 대조해 마감 리스트에서 고친다
      receivedAmount: g.amount,
      payDue: req[vkey]?.dueDate || '',
      // 돈이 이미 나갔으면 확정이다 — 우리 통장이 곧 사실이라 대조할 것이 없다.
      // 결제가 어느 달이었는지는 따지지 않는다. 나갔다는 사실 자체가 확정 근거다
      // (2026-08-27 대표님 「선결제 된건 기본이 확정인 상태가 낫지않나?」).
      closed: paidTotal(paidMap[vkey]) > 0 || hasLegacyPaid(paidMap[vkey]),
      receivedAt: g.latest,
    });
  }

  // 입고는 없는데 그달 결제만 된 건 — 선결제. 돈이 나간 달에 세운다.
  for (const [vkey, pd] of prepaid) {
    if (out.some((r) => r.vendorKey === vkey)) continue;
    out.push({
      key: `po:${purchase.id}:${vkey}`,
      purchaseId: purchase.id,
      vendorKey: vkey,
      vendor: vkey,
      siteName: purchase.siteName || '',
      title: purchase.title || '(제목 없음)',
      description: `${purchase.title || '(제목 없음)'} — 선결제`,
      amount: pd.amount, // 나간 돈이 곧 금액
      receivedAmount: 0,
      payDue: req[vkey]?.dueDate || '',
      closed: true, // 이미 나갔으면 확정 — 우리 통장이 곧 사실이라 대조할 것이 없다
      receivedAt: null,
      prepaid: true,
    });
  }
  return out;
}

// 결제 — 업체마다 정해진 결제일이 있다 (구매처의 결제 조건).
// 「이 돈은 9월 10일에 나간다」를 대표님이 한눈에 보시는 칸이다.
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
