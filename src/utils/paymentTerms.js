// 구매처별 결제 조건 → 결제 마감일 계산.
//
// 현장에서 쓰는 조건은 네 가지로 갈린다. 조건 종류와 숫자 하나면 전부 담긴다.
//   afterDays  입고일 + N일
//   nextMonth  익월 N일
//   nextMonthEnd  익월 말일
//   nextMonthAfterClose  당월 말 마감 · 익월 N일 (nextMonth 와 결과는 같고 뜻이 다르다)
//   prepaidOrder    발주시 선결제 — 돈을 먼저 보내야 물건이 온다. 마감일은 발주일 당일.
//   prepaidArrival  입고전 선결제 — 물건 오기 직전에 보낸다. 마감일은 입고일 당일.
//   prepaid         (옛 값) 둘 중 어느 쪽인지 알 수 없어 「지정 안 함」처럼 다룬다.
//                   대표님이 구매처마다 다시 골라 주셔야 한다 (2026-08-28).
//
// 날짜는 전부 'YYYY-MM-DD' 문자열로 주고받는다. 앱의 date 입력이 그 형식이다.

export const PAYMENT_TERM_TYPES = [
  { value: '', label: '지정 안 함' },
  { value: 'afterDays', label: '입고일 + N일', needsDay: true, unit: '일' },
  { value: 'nextMonth', label: '익월 N일', needsDay: true, unit: '일' },
  { value: 'nextMonthEnd', label: '익월 말일', needsDay: false },
  { value: 'nextMonthAfterClose', label: '당월 말 마감 · 익월 N일', needsDay: true, unit: '일' },
  { value: 'prepaidOrder', label: '선결제 — 발주시', needsDay: false },
  { value: 'prepaidArrival', label: '선결제 — 입고전', needsDay: false },
];

// 선결제 두 종류. 어느 쪽인지에 따라 기준일이 갈린다 — 발주시는 발주일, 입고전은 입고일.
export const PREPAID_TYPES = ['prepaidOrder', 'prepaidArrival'];

export function isPrepaidTerm(type) {
  return PREPAID_TYPES.includes(type);
}

/**
 * 그 조건이 무엇을 기준일로 삼는가.
 * @returns {'order'|'arrival'} 발주일 | 입고일
 */
export function prepaidBasisOf(type) {
  return type === 'prepaidOrder' ? 'order' : 'arrival';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toDate(base) {
  if (!base) return null;
  const d = base instanceof Date ? new Date(base) : base.toDate ? base.toDate() : new Date(base);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 그 달의 마지막 날. 2월·윤년도 여기서 걸러진다.
function lastDayOf(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 결제 마감일을 구한다.
 * @param {{paymentTermType?: string, paymentTermDay?: number|string}} supplier 구매처
 * @param {Date|string} baseDate 기준일 — 보통 그 업체 물량의 입고 완료일
 * @returns {string} 'YYYY-MM-DD', 조건이 없거나 기준일이 잘못됐으면 ''
 */
export function calcPaymentDue(supplier, baseDate) {
  const type = supplier?.paymentTermType || '';
  if (!type) return '';
  const base = toDate(baseDate);
  if (!base) return '';
  const day = Number(supplier?.paymentTermDay) || 0;

  // 선결제는 미루지 않는다. 기준일을 무엇으로 줄지는 부르는 쪽이 정한다 —
  // 발주시 선결제면 발주일, 입고전 선결제면 입고 완료일.
  if (isPrepaidTerm(type)) return ymd(base);
  if (type === 'prepaid') return ymd(base); // 옛 값 — 둘 중 어느 쪽인지 모르니 그대로 둔다

  if (type === 'afterDays') {
    if (day <= 0) return '';
    const d = new Date(base);
    d.setDate(d.getDate() + day);
    return ymd(d);
  }

  // 나머지는 전부 다음 달을 본다
  const y = base.getFullYear();
  const m = base.getMonth() + 1; // 다음 달 (0-based 라 +1 이 곧 익월)

  if (type === 'nextMonthEnd') {
    // new Date(y, m + 1, 0) = 익월 마지막 날
    return ymd(new Date(y, m + 1, 0));
  }

  if (type === 'nextMonth' || type === 'nextMonthAfterClose') {
    if (day <= 0) return '';
    // 익월에 그 날짜가 없으면(예: 2월 31일) 그 달 마지막 날로 당긴다
    const target = new Date(y, m, 1);
    const last = lastDayOf(target.getFullYear(), target.getMonth());
    return ymd(new Date(target.getFullYear(), target.getMonth(), Math.min(day, last)));
  }

  return '';
}

/** 사람이 읽는 조건 문구 — 「익월 10일」 */
export function paymentTermLabel(supplier) {
  const type = supplier?.paymentTermType || '';
  const def = PAYMENT_TERM_TYPES.find((t) => t.value === type);
  if (!def || !type) return '';
  const day = Number(supplier?.paymentTermDay) || 0;
  if (!def.needsDay) return def.label;
  if (day <= 0) return '';
  return def.label.replace('N', String(day));
}
