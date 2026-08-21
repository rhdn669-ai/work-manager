// ⑨ 기능 회귀 유닛테스트 — 과거 지적 다발 지점의 순수 로직 고정
// 대상: 발주 구매처 도출·그룹핑·발행번호 / 연차 계산 / 출력 글자축소 / 날짜 유틸
import { describe, it, expect } from 'vitest';
import { poNumber, deriveSupplier, mapPrintItems, computeSupplierList } from '../../src/utils/purchaseOrder';
import { ccOf, mailToLine } from '../../src/domain/supplierContacts';
import {
  paidList,
  paidTotal,
  hasLegacyPaid,
  unpaidAmount,
  nextSeq,
  payButtonLabel,
} from '../../src/domain/payment';
import { calculateAccruedLeave } from '../../src/utils/leaveCalculator';
import { effLen, specFontClass } from '../../src/utils/printText';
import { formatMinutes, getMonthEnd } from '../../src/utils/dateUtils';
import { splitNeed, allocateReceived, panelReceiveStatus } from '../../src/utils/panelAllocation';
import { calcPaymentDue, paymentTermLabel } from '../../src/utils/paymentTerms';
import { nextDocNo } from '../../src/domain/qualityDocNo';
import { isStockTracked } from '../../src/domain/stock';
import { mergeSetLots, setLotsLabel, totalSetCount } from '../../src/utils/setLots';
import { cutoffMonth, monthlyCounts, basisField, monthLabel } from '../../src/domain/monthlyLoad';
import { splitPasted, toISODate, mapPastedValues } from '../../src/utils/pasteColumn';
import { contactsOf, primaryEmail, hasChoice, resolveEmail, supplierKey } from '../../src/domain/supplierContacts';
import { poFingerprint } from '../../src/utils/poFingerprint';

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
  it('재고로 채워 수량이 0인 줄은 발주분(orderCount)에서 뺀다', () => {
    const items = [
      { itemId: 'I1', name: 'SLIDE PACK', qty: 5 },
      { itemId: 'I3', name: 'NUT', qty: 0 }, // 재고로 채움
      { itemId: 'I2', name: 'BOLT', qty: 3 },
    ];
    const r = computeSupplierList(items, itemMaster, suppliers, {});
    const 상진 = r.find((s) => s.name === '(주)상진미크론');
    expect(상진.count).toBe(2); // 품목은 둘
    expect(상진.orderCount).toBe(1); // 실제 발주는 하나
  });

  it('발주분이 0이어도 업체는 목록에 남는다 — 발행번호 순번이 밀리면 안 된다', () => {
    const items = [
      { itemId: 'I1', name: 'SLIDE PACK', qty: 0 }, // 상진: 전부 재고
      { itemId: 'I2', name: 'BOLT', qty: 3 },
    ];
    const r = computeSupplierList(items, itemMaster, suppliers, {});
    expect(r).toHaveLength(2);
    expect(r[0].orderCount).toBe(0); // 화면에서는 감추되 순번은 그대로
    expect(r[1].orderCount).toBe(1);
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
    const r = mapPrintItems([{ itemId: 'I1' }, { itemId: 'I2' }, { name: '수기' }], itemMaster, suppliers);
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
    const panels = [
      { id: 'p1', 호기: '1호기' },
      { id: 'p2', 호기: '2호기' },
      { id: 'p3', 호기: '3호기' },
    ];
    const st = panelReceiveStatus(items, panels);
    expect(st.map((s) => s.done)).toEqual([true, true, false]);
    expect(st[2].shortLines[0].name).toBe('CP');
  });

  it('걸린 호기가 없으면 빈 결과', () => {
    expect(panelReceiveStatus([{ name: 'CP', qty: 5, receivedQty: 0 }], [])).toEqual([]);
  });
});

describe('품질 문서번호 채번', () => {
  it('처음이면 -0001 부터', () => {
    expect(nextDocNo('QP-104A', [])).toBe('QP-104A-0001');
  });

  it('가장 큰 번호 다음을 준다', () => {
    expect(nextDocNo('QP-104A', ['QP-104A-0001', 'QP-104A-0003'])).toBe('QP-104A-0004');
  });

  it('지운 번호를 다시 쓰지 않는다', () => {
    // 0002 를 지워 목록에 없어도 0003 다음으로 간다 — 같은 번호의 다른 문서가 생기면 대조가 깨진다
    expect(nextDocNo('QP-104A', ['QP-104A-0001', 'QP-104A-0003'])).not.toBe('QP-104A-0002');
  });

  it('다른 서식 번호는 세지 않는다', () => {
    expect(nextDocNo('QP-104A', ['QP-104B-0009', 'IP-404B-0007'])).toBe('QP-104A-0001');
  });

  it('같은 기본번호를 쓰는 두 양식은 한 줄로 센다', () => {
    // 치공구·툴이 둘 다 QP-705A — 양식별로 세면 -0001 이 두 장 나온다
    expect(nextDocNo('QP-705A', ['QP-705A-0001', 'QP-705A-0002'])).toBe('QP-705A-0003');
  });

  it('손으로 적은 사내 번호는 무시한다', () => {
    expect(nextDocNo('QP-104A', ['수입-2026-01', 'QP-104A-0002'])).toBe('QP-104A-0003');
  });

  it('기본번호가 없는 서식(인원 명부)은 빈 값', () => {
    expect(nextDocNo('', ['x'])).toBe('');
  });
});

describe('재고 관리 대상 판정', () => {
  it('재고 탭에 올린 품목만 대상 — 수량 0 도 대상이다', () => {
    // 0 은 「창고가 비었다」, 값이 없는 건 「애초에 세지 않는 품목」 — 둘은 다르다
    expect(isStockTracked({ stockQty: 0 })).toBe(true);
    expect(isStockTracked({ stockQty: 11 })).toBe(true);
    expect(isStockTracked({ stockQty: -3 })).toBe(true); // 모자란 상태도 관리 대상
  });

  it('재고 탭에 없는 품목은 대상이 아니다', () => {
    expect(isStockTracked({})).toBe(false);
    expect(isStockTracked({ stockQty: undefined })).toBe(false);
    expect(isStockTracked({ stockQty: null })).toBe(false);
  });

  it('품목을 못 찾은 줄도 대상이 아니다', () => {
    expect(isStockTracked(null)).toBe(false);
    expect(isStockTracked(undefined)).toBe(false);
  });
});

describe('발주서 세트 내역', () => {
  it('타입마다 따로 쌓인다 — 나중 것이 앞의 것을 덮지 않는다', () => {
    let lots = mergeSetLots([], 'T5391', 5);
    lots = mergeSetLots(lots, 'M7H', 6);
    expect(lots).toEqual([
      { name: 'T5391', count: 5 },
      { name: 'M7H', count: 6 },
    ]);
    expect(setLotsLabel(lots)).toBe('T5391 5세트 · M7H 6세트');
    expect(totalSetCount(lots)).toBe(11);
  });

  it('같은 타입을 또 담으면 줄을 늘리지 않고 세트 수만 더한다', () => {
    const lots = mergeSetLots(mergeSetLots([], 'T5391', 5), 'T5391', 3);
    expect(lots).toEqual([{ name: 'T5391', count: 8 }]);
  });

  it('이름이 없거나 0세트면 담지 않는다', () => {
    expect(mergeSetLots([], '', 5)).toEqual([]);
    expect(mergeSetLots([], 'T5391', 0)).toEqual([]);
  });

  it('세트 내역이 없으면 빈 문구 — 옛 발주서는 숫자 배지로 돌아간다', () => {
    expect(setLotsLabel([])).toBe('');
    expect(setLotsLabel(undefined)).toBe('');
    expect(totalSetCount(undefined)).toBe(0);
  });
});

describe('월별 대수 — 25일 컷 · 회사별 기준일', () => {
  it('25일까지는 그 달', () => {
    expect(cutoffMonth('2026-09-25')).toBe('2026-09');
    expect(cutoffMonth('2026-09-01')).toBe('2026-09');
  });

  it('26일부터는 다음 달로 넘어간다', () => {
    expect(cutoffMonth('2026-09-26')).toBe('2026-10');
    expect(cutoffMonth('2026-09-30')).toBe('2026-10');
  });

  it('연말은 해를 넘긴다', () => {
    expect(cutoffMonth('2026-12-26')).toBe('2027-01');
  });

  it('날짜가 없으면 세지 않는다', () => {
    expect(cutoffMonth('')).toBe(null);
    expect(cutoffMonth(undefined)).toBe(null);
    expect(cutoffMonth('미정')).toBe(null);
  });

  it('회사마다 기준 날짜가 다르다', () => {
    expect(basisField('메티스')).toBe('출하');
    expect(basisField('디에이치')).toBe('ioCheck');
  });

  it('메티스는 출하일로, 디에이치는 I/O CHECK 로 센다', () => {
    const panels = [
      { 회사: '메티스', 출하: '2026-09-10', ioCheck: '2026-08-01' },
      { 회사: '메티스', 출하: '2026-09-26', ioCheck: '2026-08-02' }, // 26일 → 10월
      { 회사: '디에이치', 출하: '2026-12-31', ioCheck: '2026-09-20' },
    ];
    expect(monthlyCounts(panels)).toEqual([
      { month: '2026-09', count: 2 }, // 메티스 9/10 + 디에이치 I/O 9/20
      { month: '2026-10', count: 1 },
    ]);
  });

  it('회사를 주면 그 회사만 센다', () => {
    const panels = [
      { 회사: '메티스', 출하: '2026-09-10' },
      { 회사: '디에이치', ioCheck: '2026-09-20' },
    ];
    expect(monthlyCounts(panels, '메티스')).toEqual([{ month: '2026-09', count: 1 }]);
    expect(monthlyCounts(panels, '디에이치')).toEqual([{ month: '2026-09', count: 1 }]);
  });

  it('기준 날짜가 비면 그 판넬은 빠진다', () => {
    expect(monthlyCounts([{ 회사: '메티스', 출하: '' }])).toEqual([]);
  });

  it('달 이름은 「9월」로 읽는다', () => {
    expect(monthLabel('2026-09')).toBe('9월');
  });
});

describe('엑셀 한 열 붙여넣기', () => {
  it('세로로 긁은 셀은 줄바꿈으로 나뉜다', () => {
    expect(splitPasted('2026-07-21\n2026-07-29\n2026-08-09\n')).toEqual(['2026-07-21', '2026-07-29', '2026-08-09']);
  });

  it('가로로 딸려온 칸은 첫 칸만 쓴다', () => {
    expect(splitPasted('2026-07-21\t건일\n2026-07-29\t대한')).toEqual(['2026-07-21', '2026-07-29']);
  });

  it('중간 빈 줄은 그대로 두고, 끝의 빈 줄만 버린다', () => {
    expect(splitPasted('2026-07-21\n\n2026-08-09\n')).toEqual(['2026-07-21', '', '2026-08-09']);
  });

  it('엑셀이 뱉는 날짜 형태를 모두 읽는다', () => {
    expect(toISODate('2026-07-21')).toBe('2026-07-21');
    expect(toISODate('2026. 7. 21')).toBe('2026-07-21');
    expect(toISODate('2026.07.21')).toBe('2026-07-21');
    expect(toISODate('2026/7/21')).toBe('2026-07-21');
    expect(toISODate('20260721')).toBe('2026-07-21');
  });

  it('연도가 없으면 기준 연도를 붙인다', () => {
    expect(toISODate('7/21', 2026)).toBe('2026-07-21');
    expect(toISODate('6/23', 2026)).toBe('2026-06-23');
  });

  it('날짜가 아니면 null — 머리글이 섞여도 그 줄만 건너뛴다', () => {
    expect(toISODate('I/O CHECK')).toBe(null);
    expect(toISODate('미정')).toBe(null);
    expect(toISODate('')).toBe('');
  });

  it('날짜 열에 머리글이 섞이면 그 줄만 빠지고 나머지는 자리를 지킨다', () => {
    const lines = ['I/O CHECK', '2026-07-21', '2026-07-29'];
    expect(mapPastedValues(lines, { type: 'date' })).toEqual([
      { index: 1, value: '2026-07-21' },
      { index: 2, value: '2026-07-29' },
    ]);
  });

  it('글자 열은 그대로 넣는다', () => {
    expect(mapPastedValues(['네패스아크', '티스나'], { type: 'text' })).toEqual([
      { index: 0, value: '네패스아크' },
      { index: 1, value: '티스나' },
    ]);
  });
});

describe('구매처 담당자 메일', () => {
  it('예전 데이터(email 한 칸)도 그대로 읽는다', () => {
    expect(contactsOf({ email: 'sales@a.com' })).toEqual([{ name: '', email: 'sales@a.com' }]);
    expect(primaryEmail({ email: 'sales@a.com' })).toBe('sales@a.com');
  });

  it('여러 줄이면 첫 줄이 대표', () => {
    const sup = { email: '옛날@a.com', emails: [{ name: '김', email: 'cosel@a.com' }, { name: '박', email: 'delta@a.com' }] };
    expect(primaryEmail(sup)).toBe('cosel@a.com');
    expect(contactsOf(sup)).toHaveLength(2);
  });

  it('빈 줄·공백은 버린다', () => {
    const sup = { emails: [{ name: '김', email: ' a@b.c ' }, { name: '빈', email: '' }] };
    expect(contactsOf(sup)).toEqual([{ name: '김', email: 'a@b.c' }]);
  });

  it('고를 거리가 둘 이상일 때만 품목에 담당자 칸을 띄운다', () => {
    expect(hasChoice({ email: 'a@b.c' })).toBe(false);
    expect(hasChoice({ emails: [{ email: 'a@b.c' }, { email: 'd@e.f' }] })).toBe(true);
  });

  it('품목에 박힌 담당자를 구매처에서 지우면 대표로 돌아간다', () => {
    const sup = { emails: [{ email: 'cosel@a.com' }, { email: 'delta@a.com' }] };
    expect(resolveEmail(sup, 'delta@a.com')).toBe('delta@a.com');
    expect(resolveEmail(sup, '사라진@a.com')).toBe('cosel@a.com');
    expect(resolveEmail(sup, '')).toBe('cosel@a.com');
  });

  it('이메일이 하나도 없으면 빈 값', () => {
    expect(contactsOf({})).toEqual([]);
    expect(primaryEmail({})).toBe('');
  });
});

describe('발송 표시 키', () => {
  it('담당자가 없으면 업체명만 — 예전 데이터와 같은 키', () => {
    expect(supplierKey('(주)형제전기')).toBe('(주)형제전기');
    expect(supplierKey('(주)에이.비', '')).toBe('(주)에이_비');
  });

  it('담당자가 있으면 담당까지 넣어 갈린다', () => {
    const a = supplierKey('텔콤', 'cosel@a.com');
    const b = supplierKey('텔콤', 'delta@a.com');
    expect(a).not.toBe(b);
  });

  it('Firestore 가 못 쓰는 점·골뱅이는 밑줄로 바꾼다', () => {
    expect(supplierKey('텔콤', 'cosel@a.com')).toBe('텔콤__cosel_a_com');
    expect(supplierKey('텔콤')).not.toContain('__');
  });
});

describe('발주서 내용 지문', () => {
  const base = [{ itemId: 'a', name: 'CP', spec: '10A', qty: 3, unitPrice: 1000 }];

  it('같은 내용이면 같은 지문 — 미리 만든 발주서를 다시 쓴다', () => {
    expect(poFingerprint(base, { supplierName: '텔콤' })).toBe(poFingerprint([...base], { supplierName: '텔콤' }));
  });

  it('수량이 바뀌면 지문도 바뀐다', () => {
    expect(poFingerprint([{ ...base[0], qty: 5 }], {})).not.toBe(poFingerprint(base, {}));
  });

  it('단가·규격·비고가 바뀌어도 잡는다', () => {
    for (const patch of [{ unitPrice: 2000 }, { spec: '20A' }, { note: '급함' }]) {
      expect(poFingerprint([{ ...base[0], ...patch }], {})).not.toBe(poFingerprint(base, {}));
    }
  });

  it('특이사항·납기가 바뀌면 다시 만들어야 한다', () => {
    expect(poFingerprint(base, { note: '가' })).not.toBe(poFingerprint(base, { note: '나' }));
    expect(poFingerprint(base, { deliveryDue: '2026-09-01' })).not.toBe(poFingerprint(base, {}));
  });

  it('담당자가 다르면 다른 발주서다', () => {
    expect(poFingerprint(base, { supplierName: '텔콤', contact: 'a@b.c' })).not.toBe(
      poFingerprint(base, { supplierName: '텔콤', contact: 'd@e.f' }),
    );
  });

  it('발주서에 안 찍히는 값(입고 수량)은 지문에 넣지 않는다', () => {
    expect(poFingerprint([{ ...base[0], receivedQty: 3 }], {})).toBe(poFingerprint(base, {}));
  });

  it('빈 줄은 세지 않는다', () => {
    expect(poFingerprint([...base, { name: '', qty: 0 }], {})).toBe(poFingerprint(base, {}));
  });

  it('값 경계가 섞이지 않는다 — 「가」+「나」와 「가나」+「」는 다른 지문', () => {
    expect(poFingerprint(base, { title: '가', subtitle: '나' })).not.toBe(poFingerprint(base, { title: '가나' }));
  });
});

describe('결제 — 회차 나눠 결제 (payment)', () => {
  it('결제 기록이 없으면 들어온 금액 전부가 청구 대상', () => {
    expect(unpaidAmount(1870000, undefined)).toBe(1870000);
    expect(nextSeq(undefined)).toBe(1);
    expect(payButtonLabel(undefined)).toBe('결제 요청');
  });

  it('1차를 결제했으면 그만큼 빼고 청구한다', () => {
    const paid = [{ seq: 1, amount: 1870000 }];
    expect(unpaidAmount(3740000, paid)).toBe(1870000);
    expect(nextSeq(paid)).toBe(2);
    expect(payButtonLabel(paid)).toBe('2차 결제요청');
  });

  it('아직 새로 들어온 것이 없으면 청구할 몫이 없다', () => {
    expect(unpaidAmount(1870000, [{ seq: 1, amount: 1870000 }])).toBe(0);
  });

  it('입고 수량을 줄여 이미 낸 돈보다 적어져도 음수가 되지 않는다', () => {
    expect(unpaidAmount(1000000, [{ seq: 1, amount: 1870000 }])).toBe(0);
  });

  it('금액이 없는 옛 기록은 전액 결제로 본다 — 다시 청구하지 않는다', () => {
    const legacy = { paidAt: new Date(), paidBy: 'IOPN' };
    expect(paidList(legacy)).toHaveLength(1);
    expect(hasLegacyPaid(legacy)).toBe(true);
    expect(unpaidAmount(3740000, legacy)).toBe(0);
  });

  it('세 번째 회차도 이어서 센다', () => {
    const paid = [
      { seq: 1, amount: 1000000 },
      { seq: 2, amount: 500000 },
    ];
    expect(paidTotal(paid)).toBe(1500000);
    expect(unpaidAmount(2000000, paid)).toBe(500000);
    expect(payButtonLabel(paid)).toBe('3차 결제요청');
  });
});

describe('구매처 — 참조(CC)', () => {
  it('쉼표·세미콜론·줄바꿈 아무거나로 나눠 적어도 읽는다', () => {
    const sup = { ccEmails: 'a@x.com, b@y.com; c@z.com\nd@w.com' };
    expect(ccOf(sup)).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
  });

  it('메일 주소 꼴이 아닌 것은 버린다', () => {
    expect(ccOf({ ccEmails: 'a@x.com, 홍길동, 010-1234' })).toEqual(['a@x.com']);
  });

  it('참조가 없으면 담당자만', () => {
    expect(mailToLine('me@x.com', {})).toBe('me@x.com');
  });

  it('담당자 뒤에 참조를 붙인다', () => {
    expect(mailToLine('me@x.com', { ccEmails: 'cc@y.com' })).toBe('me@x.com, cc@y.com');
  });

  it('같은 주소가 두 번 들어가지 않는다 (대소문자 무시)', () => {
    expect(mailToLine('me@x.com', { ccEmails: 'ME@X.com, cc@y.com' })).toBe('me@x.com, cc@y.com');
  });
});
