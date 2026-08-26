// 마감 리스트 — 그달 매출과, 업체에 줄 돈을 건별로 펼친다.
//
// 총 마감은 집계 숫자만 보여 주어 무엇이 담기고 무엇이 빠졌는지 알 수 없었다.
// 그래서 대표님이 그 숫자를 믿지 못했다. 여기서는 건별로 펼쳐 놓고 금액을 확정한다
// (2026-08-25 대표님).
//
// 이 파일을 지배하는 세 가지.
//  ① 마감은 그달에 납품받은 내역이다. 결제가 다음 달이어도 납품이 8월이면 8월 지출이다.
//     ("마감은 해당 월에 납품 받은 내역" · "마감은 이번달에 결제는 다음달에 되는 경우가 많음")
//  ② 마감월은 앱이 추정하지 않는다. 발주서에서 담당자가 「마감」을 눌러 정한다 —
//     부분입고·늦게 찍힌 입고일 때문에 자동 추정은 엉뚱한 달로 새기 때문이다.
//  ③ 지출은 업체에 줄 돈만 담는다. 잔업 수당·고정비는 총 마감에서 따로 본다.
//     ("마감리스트에는 업체에 결제해줘야하는 금액만 지출로")
import { mapPrintItems } from '../utils/purchaseOrder';
import { supplierKey } from './supplierContacts';

export const MISC_VENDOR = '(구매처 미지정)';

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function toDate(v) {
  if (!v) return null;
  const d = v.toDate ? v.toDate() : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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

// 마감 처리된 (발주 × 업체) 한 건.
export function closedRowsOf(purchase, year, month) {
  const closed = purchase.supplierClosed || {};
  const want = monthKey(year, month);
  const out = [];
  for (const [key, info] of Object.entries(closed)) {
    if (!info || info.monthKey !== want) continue;
    out.push({
      key: `po:${purchase.id}:${key}`,
      purchaseId: purchase.id,
      vendorKey: key,
      vendor: info.vendor || key,
      siteName: purchase.siteName || '',
      title: purchase.title || '(제목 없음)',
      description: info.note || purchase.title || '(제목 없음)',
      amount: Number(info.amount) || 0,
      payDue: info.payDue || '',
      closedAt: toDate(info.at),
      closedBy: info.by || '',
    });
  }
  return out;
}

// 결제 예정 — 업체마다 정해진 결제일이 있다 (구매처의 결제 조건).
// 「이 돈은 9월에 나간다」를 대표님이 한눈에 보시는 칸이다.
export function payMonthLabel(payDue) {
  const d = toDate(payDue);
  return d ? `${d.getMonth() + 1}월` : '';
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
