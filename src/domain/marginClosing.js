// 마감 리스트 — 그달 매출과, 업체에 줄 돈을 건별로 펼친다.
//
// 총 마감은 집계 숫자만 보여 주어 무엇이 담기고 무엇이 빠졌는지 알 수 없었다.
// 그래서 대표님이 그 숫자를 믿지 못했다. 여기서는 건별로 펼쳐 놓고 금액을 확정한다
// (2026-08-25 대표님).
//
// 이 파일을 지배하는 세 가지.
//  ① 마감은 그달에 납품받은 내역이다. 결제가 다음 달이어도 납품이 8월이면 8월 지출이다.
//     ("마감은 해당 월에 납품 받은 내역" · "마감은 이번달에 결제는 다음달에 되는 경우가 많음")
//  ② 마감은 「물건이 들어온 달」에 오른다. 8월에 받은 건 8월, 9월에 받은 건 9월.
//     한때 「결제 요청」을 유일한 문으로 삼고 달까지 사람이 골랐으나, 그러면 8월에
//     확정한 금액이 9월 입고 때문에 저절로 바뀌었다 (2026-09-01 대표님 「물건이 실제로
//     들어온 달에 마감내역으로 올리고 해당 업체 결제일에 맞게 올라가는 게 맞을 것 같다」).
//     들어온 달로 가르면 그 달 줄은 그 달 입고분만 세므로 뒤늦은 입고가 건드릴 수 없다.
//     예외 둘 — 물건보다 돈이 먼저 나간 선결제는 「돈 나간 달」, 대표님이 결제 요청 때
//     달을 직접 정한 건은 그 달.
//     결제 요청을 안 눌러도 마감에는 오른다. 입고됐으면 그달 지출이기 때문이다.
//  ③ 확정은 마감 리스트에서만 한다. 업체에서 마감내역을 받아 우리 숫자와 대조해야
//     확정할 수 있기 때문이다. 예외는 선결제뿐 — 이미 나간 돈은 다툴 여지가 없다.
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

function inMonth(v, year, month) {
  const d = toDate(v);
  return !!d && d.getFullYear() === year && d.getMonth() + 1 === month;
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
  const want = monthKey(year, month);
  const reqMap = purchase.paymentRequested || {};
  const paidMap = purchase.supplierPaid || {};
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

  // 그달에 실제로 나간 돈 — 물건이 아직 안 온 선결제 건의 금액이 된다
  const paidInMonth = (vkey) => {
    let sum = 0;
    let at = null;
    for (const pd of paidList(pickByKey(paidMap, vkey))) {
      if (!inMonth(pd.paidAt, year, month)) continue;
      sum += Number(pd.amount) || 0;
      const d = toDate(pd.paidAt);
      if (d && (!at || d > at)) at = d;
    }
    return { sum, at };
  };

  const money = (l, qty) => qty * (Number(l.unitPrice) || 0);

  const out = [];
  const seen = new Set(); // 담당이 갈린 업체는 한 줄로 묶는다
  for (const [vendor, g] of byVendor) {
    const vkey = closeKeyOf(vendor);
    if (seen.has(vkey)) continue;
    seen.add(vkey);

    const req = pickByKey(reqMap, vkey);
    const info = paidInfoOf(vkey);
    const anyReceived = g.lines.some((l) => Number(l.receivedQty) > 0);

    // 그달 입고분 — 초과 입고는 발주 수량까지만 (잘못 적힌 숫자가 지출을 부풀리지 않게)
    let recvThisMonth = 0;
    let recvAt = null;
    let lineCount = 0;
    for (const l of g.lines) {
      if (!inMonth(l.receivedAt, year, month)) continue;
      const got = Math.min(Number(l.receivedQty) || 0, Number(l.qty) || 0);
      if (got <= 0) continue;
      recvThisMonth += money(l, got);
      lineCount += 1;
      const d = toDate(l.receivedAt);
      if (d && (!recvAt || d > recvAt)) recvAt = d;
    }

    // 대표님이 결제 요청 때 달을 직접 정했으면 그 달로 몰아준다. 보통은 입고일이
    // 정하지만, 특별한 건은 손으로 조정할 수 있어야 한다 (2026-09-01 대표님 「남겨 둡니다」).
    const forced = req?.closingMonth || '';
    let amount = 0;
    let prepaid = false;

    if (forced) {
      if (forced !== want) continue;
      const receivedTotal = g.lines.reduce(
        (sum, l) => sum + money(l, Math.min(Number(l.receivedQty) || 0, Number(l.qty) || 0)),
        0,
      );
      const orderedTotal = g.lines.reduce((sum, l) => sum + money(l, Number(l.qty) || 0), 0);
      amount = anyReceived ? receivedTotal : info.paidAmount || orderedTotal;
      prepaid = info.paid && !anyReceived;
      if (!anyReceived && !info.paid) continue; // 돈도 물건도 없으면 아직 지출이 아니다
    } else if (recvThisMonth > 0) {
      // 그달에 들어온 만큼만 — 다음 달에 더 들어오면 그건 다음 달 줄이 된다
      amount = recvThisMonth;
    } else if (!anyReceived) {
      // 물건은 아직인데 그달에 돈이 나갔다 — 선결제. 나간 돈이 곧 금액
      const p = paidInMonth(vkey);
      if (p.sum <= 0) continue;
      amount = p.sum;
      prepaid = true;
    } else {
      continue; // 이 달에는 들어온 것도 나간 것도 없다
    }

    out.push({
      key: `po:${purchase.id}:${vkey}`,
      purchaseId: purchase.id,
      vendorKey: vkey,
      vendor,
      siteName: purchase.siteName || '',
      title: purchase.title || '(제목 없음)',
      description:
        lineCount > 1 || g.names.length > 1
          ? `${g.names[0]} 외 ${Math.max(lineCount, g.lines.length) - 1}건`
          : g.names[0] || purchase.title || '',
      amount, // 업체 내역과 대조해 마감 리스트에서 고친다
      receivedAmount: amount,
      payDue: req?.dueDate || '',
      // 결제 요청을 안 눌러도 마감에는 오른다 — 입고됐으면 그달 지출이기 때문.
      // 대신 배지로 알려 잊히지 않게 한다 (2026-09-01 대표님 「올립니다」).
      requested: !!req,
      // 돈이 이미 나갔으면 확정이다 — 우리 통장이 곧 사실이라 대조할 것이 없다
      closed: info.paid || hasLegacyPaid(pickByKey(paidMap, vkey)),
      ...info,
      receivedAt: recvAt || g.latest,
      prepaid,
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
