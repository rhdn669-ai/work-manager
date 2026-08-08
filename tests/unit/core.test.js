// ⑨ 기능 회귀 유닛테스트 — 과거 지적 다발 지점의 순수 로직 고정
// 대상: 발주 구매처 도출·그룹핑·발행번호 / 연차 계산 / 출력 글자축소 / 날짜 유틸
import { describe, it, expect } from 'vitest';
import {
  poNumber,
  deriveSupplier,
  mapPrintItems,
  computeSupplierList,
} from '../../src/utils/purchaseOrder';
import { calculateAccruedLeave } from '../../src/utils/leaveCalculator';
import { effLen, specFontClass } from '../../src/utils/printText';
import { formatMinutes, getMonthEnd } from '../../src/utils/dateUtils';
import { splitNeed, allocateReceived, panelReceiveStatus } from '../../src/utils/panelAllocation';
import { calcPaymentDue, paymentTermLabel } from '../../src/utils/paymentTerms';

const suppliers = [
  { id: 'S1', name: '(주)상진미크론', email: 'a@x.com' },
  { id: 'S2', name: '(주)전설의대장간', email: 'b@x.com' },
];
const itemMaster = [
  { id: 'I1', name: 'SLIDE PACK', spec: '3531-16', defaultSupplierId: 'S1' },
  { id: 'I2', name: 'BOLT', spec: 'M4', defaultSupplierId: 'S2' },
  { id: 'I3', name: 'NUT', spec: 'M4', defaultSupplierId: 'S1' },
];

describe('발주 — deriveSupplier (구매처 자동 도출)', () => {
  it('전 품목이 같은 구매처면 그 구매처', () => {
    const r = deriveSupplier([{ itemId: 'I1' }, { itemId: 'I3' }], itemMaster, suppliers);
    expect(r).toEqual({ supplierId: 'S1', supplierName: '(주)상진미크론' });
  });
  it('혼합이면 빈값 (강제 지정 안 함)', () => {
    const r = deriveSupplier([{ itemId: 'I1' }, { itemId: 'I2' }], itemMaster, suppliers);
    expect(r.supplierId).toBe('');
  });
  it('품목 없음/미매칭이면 빈값', () => {
    expect(deriveSupplier([], itemMaster, suppliers).supplierId).toBe('');
    expect(deriveSupplier([{ itemId: 'ZZZ' }], itemMaster, suppliers).supplierId).toBe('');
  });
});

describe('발주 — computeSupplierList (구매처별 그룹핑)', () => {
  it('구매처별 품목수 집계', () => {
    const items = [
      { itemId: 'I1', name: 'SLIDE PACK' },
      { itemId: 'I3', name: 'NUT' },
      { itemId: 'I2', name: 'BOLT' },
    ];
    const r = computeSupplierList(items, itemMaster, suppliers, {});
    expect(r).toHaveLength(2);
    expect(r.find((s) => s.name === '(주)상진미크론').count).toBe(2);
    expect(r.find((s) => s.name === '(주)전설의대장간').count).toBe(1);
  });
  it('빈 이름 라인은 제외', () => {
    const r = computeSupplierList([{ itemId: 'I1', name: '  ' }], itemMaster, suppliers, {});
    expect(r).toHaveLength(0);
  });
  it('마스터 미연결은 발주의 fallback 구매처로', () => {
    const r = computeSupplierList([{ name: '수기품목' }], itemMaster, suppliers, { supplierId: 'S2' });
    expect(r[0].name).toBe('(주)전설의대장간');
  });
});

describe('발주 — 발행번호·출력 매핑', () => {
  it('poNumber = IOPN + 발주일 yyyymmdd', () => {
    expect(poNumber({ orderedAt: '2026-07-07T09:00:00' })).toBe('IOPN20260707');
  });
  it('mapPrintItems — 순번(No)이 1부터 순서대로 (④ 정렬 회귀)', () => {
    const r = mapPrintItems(
      [{ itemId: 'I1' }, { itemId: 'I2' }, { name: '수기' }],
      itemMaster,
      suppliers,
    );
    expect(r.map((x) => x._globalNo)).toEqual([1, 2, 3]);
    expect(r[0]._name).toBe('SLIDE PACK');
    expect(r[2]._name).toBe('수기');
  });
});

describe('연차 계산 (과거 지적: "이번달 입사인데 연차가 왜 8개?")', () => {
  it('이번 달 입사 = 0일', () => {
    expect(calculateAccruedLeave('2026-07-01', new Date('2026-07-11'))).toBe(0);
  });
  it('입사 3개월 = 월차 3일', () => {
    expect(calculateAccruedLeave('2026-01-10', new Date('2026-04-15'))).toBe(3);
  });
  it('만 1년 = 월차 11 + 연차 15 = 26일', () => {
    expect(calculateAccruedLeave('2025-01-02', new Date('2026-01-02'))).toBe(26);
  });
  it('만 3년 = 11 + 15 + 15 + 16 = 57일 (3년차부터 2년마다 +1)', () => {
    expect(calculateAccruedLeave('2023-01-02', new Date('2026-01-02'))).toBe(57);
  });
});

describe('출력 글자 축소 (잘림 방지 로직)', () => {
  it('한글은 라틴보다 폭 가중치 (effLen)', () => {
    expect(effLen('한글')).toBeGreaterThan(effLen('ab'));
  });
  it('짧은 문자열은 축소 클래스 없음, 긴 문자열은 축소', () => {
    expect(specFontClass('짧음', 11)).toBe('');
    expect(specFontClass('아주아주아주아주아주아주 긴 규격 문자열입니다', 11)).not.toBe('');
  });
});

describe('날짜 유틸', () => {
  it('formatMinutes — 480분 = 8시간 표기', () => {
    expect(formatMinutes(480)).toMatch(/8/);
  });
  it('getMonthEnd — 2월 말일 문자열 (윤년)', () => {
    expect(getMonthEnd(2024, 2)).toBe('2024-02-29');
    expect(getMonthEnd(2026, 2)).toBe('2026-02-28');
  });
});

describe('구매처 결제 조건 → 결제 마감일', () => {
  it('입고일 + N일 — 달을 넘어간다', () => {
    expect(calcPaymentDue({ paymentTermType: 'afterDays', paymentTermDay: 30 }, '2026-08-03')).toBe('2026-09-02');
  });
  it('익월 N일', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonth', paymentTermDay: 10 }, '2026-08-03')).toBe('2026-09-10');
  });
  it('익월 말일 — 윤년 2월도 맞는다', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonthEnd' }, '2026-08-03')).toBe('2026-09-30');
    expect(calcPaymentDue({ paymentTermType: 'nextMonthEnd' }, '2024-01-15')).toBe('2024-02-29');
    expect(calcPaymentDue({ paymentTermType: 'nextMonthEnd' }, '2026-01-15')).toBe('2026-02-28');
  });
  it('12월 입고 → 이듬해 1월로 넘어간다', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonth', paymentTermDay: 10 }, '2026-12-20')).toBe('2027-01-10');
  });
  it('익월에 없는 날짜(31일)는 그 달 말일로 당긴다', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonth', paymentTermDay: 31 }, '2026-01-05')).toBe('2026-02-28');
  });
  it('선결제 — 미루지 않고 기준일 당일', () => {
    expect(calcPaymentDue({ paymentTermType: 'prepaid' }, '2026-08-03')).toBe('2026-08-03');
  });
  it('조건이 없거나 기준일이 없으면 빈 문자열', () => {
    expect(calcPaymentDue({}, '2026-08-03')).toBe('');
    expect(calcPaymentDue({ paymentTermType: 'nextMonth', paymentTermDay: 10 }, '')).toBe('');
    expect(calcPaymentDue({ paymentTermType: 'afterDays', paymentTermDay: 0 }, '2026-08-03')).toBe('');
  });
  it('조건 문구 — N 자리에 숫자가 박힌다', () => {
    expect(paymentTermLabel({ paymentTermType: 'nextMonth', paymentTermDay: 10 })).toBe('익월 10일');
    expect(paymentTermLabel({ paymentTermType: 'nextMonthEnd' })).toBe('익월 말일');
    expect(paymentTermLabel({})).toBe('');
  });
});

// ── 발주 입고분을 호기에 나누기 (2026-08-08) ──
// 생산이 빠른 호기부터 채우고, 모자라면 뒤 호기가 미입고로 남는다.
describe('호기별 자재 배정', () => {
  it('나눠떨어지지 않으면 앞 호기가 하나씩 더 가져간다', () => {
    expect(splitNeed(10, 3)).toEqual([4, 3, 3]);
    expect(splitNeed(9, 3)).toEqual([3, 3, 3]);
    expect(splitNeed(2, 3)).toEqual([1, 1, 0]);
  });

  it('호기가 없거나 수량이 0이면 빈 배정', () => {
    expect(splitNeed(10, 0)).toEqual([]);
    expect(splitNeed(0, 3)).toEqual([0, 0, 0]);
  });

  it('입고분은 앞 호기부터 채우고 뒤가 모자란다', () => {
    // 10개 필요(4·3·3) 인데 7개만 들어옴 → 1·2호기는 채우고 3호기가 0
    expect(allocateReceived(10, 7, 3)).toEqual([
      { need: 4, got: 4, short: 0 },
      { need: 3, got: 3, short: 0 },
      { need: 3, got: 0, short: 3 },
    ]);
  });

  it('다 들어오면 모두 채워진다', () => {
    expect(allocateReceived(10, 10, 3).every((a) => a.short === 0)).toBe(true);
  });

  it('발주서 전체로 보면 뒤 호기만 미입고로 남는다', () => {
    const items = [
      { name: 'CP', qty: 10, receivedQty: 7 },
      { name: 'FAN', qty: 3, receivedQty: 3 },
    ];
    const panels = [{ id: 'p1', 호기: '1호기' }, { id: 'p2', 호기: '2호기' }, { id: 'p3', 호기: '3호기' }];
    const st = panelReceiveStatus(items, panels);
    expect(st.map((s) => s.done)).toEqual([true, true, false]);
    expect(st[2].shortLines[0].name).toBe('CP');
  });

  it('걸린 호기가 없으면 빈 결과', () => {
    expect(panelReceiveStatus([{ name: 'CP', qty: 5, receivedQty: 0 }], [])).toEqual([]);
  });
});
