// ⑨ 기능 회귀 유닛테스트 — 과거 지적 다발 지점의 순수 로직 고정
// 대상: 발주 구매처 도출·그룹핑·발행번호 / 연차 계산 / 출력 글자축소 / 날짜 유틸
import { describe, it, expect, afterEach } from 'vitest';
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
import {
  calcPaymentDue,
  paymentTermLabel,
  PAYMENT_TERM_TYPES,
  isPrepaidTerm,
  prepaidBasisOf,
} from '../../src/utils/paymentTerms';
import {
  closingRowsOf,
  payMonthLabel,
  vatOf,
  withVat,
  applyConfirm,
} from '../../src/domain/marginClosing';
import {
  buildMailHtml,
  mailSubject,
  senderLine,
  setLibraryCards,
  cardNames,
  cardFileFor,
  newMessageId,
  threadKeyOf,
} from '../../src/utils/mailTemplate';
import { nextDocNo } from '../../src/domain/qualityDocNo';
import { countByType, countUnclassified, DEFECT_TYPES } from '../../src/domain/defectTypes';
import { panelToNcrFacts } from '../../src/domain/productionQuality';
import {
  deriveBoxStatus,
  boxDefectChecked,
  JAIP,
  JAIP_GROUPS,
  MP_SUBS,
  SHIP_PHOTO_SIDES,
} from '../../src/domain/production';
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

describe('생산 — 박스 상태는 불량 확인까지 되어야 완료', () => {
  const 입고완료 = Object.fromEntries(JAIP.map((k) => [k, true]));
  const 박스 = 'P/W BOX';
  const 판넬 = (mat, insp) => ({ 박스입고: { [박스]: mat }, 검수: insp });
  const 불량 = (내용, 완료) => ({
    차1: { 공정비고: { [박스]: { 항목: [{ 내용, 완료, 일자: '2026-08-22' }] } } },
  });

  it('자재가 덜 들어왔으면 대기', () => {
    expect(deriveBoxStatus(판넬({ 판금: true }, {}), 박스)).toBe('대기');
  });

  it('자재는 다 들어왔지만 아무도 들여다보지 않았으면 진행중 — 예전에는 완료였다', () => {
    expect(deriveBoxStatus(판넬(입고완료, {}), 박스)).toBe('진행중');
  });

  it('「불량 없음」을 체크하면 완료', () => {
    const insp = { 차1: { 공정비고: { [박스]: { 항목: [], 불량없음: true } } } };
    expect(boxDefectChecked(insp, 박스)).toBe(true);
    expect(deriveBoxStatus(판넬(입고완료, insp), 박스)).toBe('완료');
  });

  it('미해결 불량이 있으면 문제 — 자재가 다 들어왔어도', () => {
    expect(deriveBoxStatus(판넬(입고완료, 불량('스크래치', false)), 박스)).toBe('문제');
  });

  it('불량을 모두 처리했으면 완료', () => {
    expect(deriveBoxStatus(판넬(입고완료, 불량('스크래치', true)), 박스)).toBe('완료');
  });

  it('불량을 처리했어도 자재가 덜 들어왔으면 대기', () => {
    expect(deriveBoxStatus(판넬({ 판금: true }, 불량('스크래치', true)), 박스)).toBe('대기');
  });
});

// 매트릭스 표는 머리글 폭(colSpan)과 본문 칸 수가 어긋나면 열이 통째로 밀린다.
// 출고사진 칸을 더할 때 실제로 MP 쪽에 잘못 넣어 밀린 적이 있어, 숫자로 못 박아 둔다.
describe('생산현황 표 — 머리글 폭과 본문 칸 수', () => {
  // 실물 BOX 한 칸: 자재 5 + 불량 + 상태 + 출고사진
  const 실물박스칸 = JAIP.length + 3;

  it('실물 BOX 는 자재 5칸 + 불량·상태·출고사진 3칸 = 8칸', () => {
    expect(실물박스칸).toBe(8);
  });

  it('머리글 2행(자재 그룹 + 불량·상태·출고사진)이 같은 폭이다', () => {
    const 그룹폭 = JAIP_GROUPS.reduce((a, g) => a + g.leaves.length, 0);
    expect(그룹폭 + 3).toBe(실물박스칸);
  });

  it('MP 는 실물 박스가 아니라 출고사진 칸이 없다 — 하위 9 + 상태 1', () => {
    expect(MP_SUBS.length + 1).toBe(10);
  });

  it('출고사진은 다섯 면', () => {
    expect(SHIP_PHOTO_SIDES).toEqual(['전면', '후면', '좌측', '우측', '상부']);
  });
});

describe('불량 유형 집계', () => {
  it('유형별로 센다', () => {
    expect(countByType([{ 유형: '조립불량' }, { 유형: '케이블' }, { 유형: '조립불량' }])).toEqual({
      defectAssembly: 2,
      defectCable: 1,
    });
  });

  it('이름을 바꿔도 예전 이름으로 저장된 건이 사라지지 않는다', () => {
    expect(countByType([{ 유형: '스티커·잔공누락' }, { 유형: '잔공 누락' }])).toEqual({ defectStickerHole: 2 });
    expect(countByType([{ 유형: '아이마킹 누락' }, { 유형: '아이마킹' }])).toEqual({ defectEyeMarking: 2 });
  });

  it('목록에서 뺀 「식별표시」는 「라벨 누락」으로 모인다', () => {
    expect(countByType([{ 유형: '식별표시' }, { 유형: '라벨 누락' }])).toEqual({ defectLabelMissing: 2 });
  });

  it('유형을 고르지 않은 건은 어느 칸에도 안 들어간다 — 그 수를 따로 셀 수 있어야 한다', () => {
    const list = [{ 유형: '' }, { 유형: '조립불량' }, { 유형: '없는유형' }];
    expect(countByType(list)).toEqual({ defectAssembly: 1 });
    expect(countUnclassified(list)).toBe(2);
  });

  it('모든 유형에 차트 색이 있다 — 색이 없으면 분포 차트에서 빠진다', () => {
    const 색없음 = DEFECT_TYPES.filter((t) => !t.color).map((t) => t.label);
    expect(색없음).toEqual([]);
  });

  it('유형 키가 겹치지 않는다', () => {
    const keys = DEFECT_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// 불량률이 300% 로 튀던 자리 — 검사수가 「작업자 이름이 적힌 칸 수」였다.
describe('품질 — 불량률 기준', () => {
  const 판넬 = (항목들) => ({
    회사: '메티스',
    프로젝트: 'YS-TEPS',
    호기: '165',
    검수: { 공정작업자: { 'P/W BOX': '홍길동' }, 차1: { 공정비고: 항목들 } },
  });

  it('검사수는 작업자 배정과 무관하게 실물 BOX 수로 고정된다', () => {
    const f = panelToNcrFacts(판넬({ 'P/W BOX': { 항목: [{ 내용: 'a', 유형: '조립불량' }] } }));
    expect(f.inspectedQty).toBe(6); // 작업자를 한 칸에만 적어도 6
  });

  it('한 BOX 에서 불량이 셋 나와도 불량률은 100% 를 넘지 않는다', () => {
    const f = panelToNcrFacts(
      판넬({
        'P/W BOX': {
          항목: [
            { 내용: 'a', 유형: '조립불량' },
            { 내용: 'b', 유형: '오배선' },
            { 내용: 'c', 유형: '케이블' },
          ],
        },
      }),
    );
    expect(f.defectQty).toBe(1); // 불량이 난 BOX 는 하나
    expect(f.defectCount).toBe(3); // 건수는 따로 남는다
    expect((f.defectQty / f.inspectedQty) * 100).toBeCloseTo(16.67, 1);
  });

  it('BOX 두 곳에서 나면 둘로 센다', () => {
    const f = panelToNcrFacts(
      판넬({
        'P/W BOX': { 항목: [{ 내용: 'a', 유형: '조립불량' }] },
        LODER: { 항목: [{ 내용: 'b', 유형: '오배선' }] },
      }),
    );
    expect(f.defectQty).toBe(2);
    expect((f.defectQty / f.inspectedQty) * 100).toBeCloseTo(33.33, 1);
  });
});

// ── 마감 리스트 — 물건이 들어온 달에 오른다 (2026-09-01 대표님)
//
// 한때 「결제 요청」을 유일한 문으로 삼고 달까지 사람이 골랐다. 그러다 8월에 확정한
// 금액이 9월 입고 때문에 저절로 바뀌는 일이 생겼다. 들어온 달로 가르면 그 달 줄은
// 그 달 입고분만 세므로 뒤늦은 입고가 지나간 달을 건드릴 수 없다.
describe('마감 리스트 — 들어온 달에 오른다', () => {
  const suppliers = [{ id: 's1', name: '델타전기' }];
  const itemMaster = [{ id: 'i1', name: 'STEP DRIVER', defaultSupplierId: 's1' }];
  const D = (x) => new Date(x);
  const REQ = (due) => ({ 델타전기: { requestedAt: D('2026-08-01'), dueDate: due } });

  it('8월에 들어오면 8월에 선다 — 결제가 9월이어도', () => {
    const p = {
      id: 'p1',
      title: '8월 입고 · 9월 결제',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 3, unitPrice: 7000, receivedQty: 3, receivedAt: D('2026-08-11') },
      ],
      paymentRequested: REQ('2026-09-30'),
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(21000);
    expect(r[0].payDue).toBe('2026-09-30'); // 결제일은 그대로 따라간다
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 9)).toHaveLength(0);
  });

  // 이것이 이번 변경의 핵심 — 지나간 달의 숫자가 흔들리지 않는다
  it('나눠 들어오면 각자 제 달에 — 9월 입고가 8월을 건드리지 않는다', () => {
    const p = {
      id: 'p2',
      title: '나눠 입고',
      items: [
        { itemId: 'i1', name: 'A', qty: 5, unitPrice: 1000, receivedQty: 5, receivedAt: D('2026-08-10') },
        { itemId: 'i1', name: 'B', qty: 5, unitPrice: 1000, receivedQty: 5, receivedAt: D('2026-09-10') },
      ],
      paymentRequested: REQ(''),
    };
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 8)[0].amount).toBe(5000);
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 9)[0].amount).toBe(5000);
  });

  it('아직 안 들어온 물량은 어느 달에도 안 잡힌다', () => {
    const p = {
      id: 'p3',
      title: '일부만 입고',
      items: [
        { itemId: 'i1', name: 'A', qty: 10, unitPrice: 1000, receivedQty: 4, receivedAt: D('2026-08-10') },
        { itemId: 'i1', name: 'B', qty: 10, unitPrice: 1000, receivedQty: 0 },
      ],
      paymentRequested: REQ(''),
    };
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 8)[0].amount).toBe(4000);
  });

  it('결제 요청을 안 눌러도 마감에는 오른다 — 배지로 알린다', () => {
    const p = {
      id: 'p4',
      title: '요청 전',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 3, unitPrice: 7000, receivedQty: 3, receivedAt: D('2026-08-11') },
      ],
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8);
    expect(r).toHaveLength(1);
    expect(r[0].requested).toBe(false); // 화면이 「결제요청 전」 배지를 띄운다
  });

  it('입고도 결제도 없는 달엔 안 뜬다', () => {
    const p = {
      id: 'p5',
      title: '발주만',
      items: [{ itemId: 'i1', name: 'STEP DRIVER', qty: 9, unitPrice: 1000, receivedQty: 0 }],
      paymentRequested: REQ('2026-10-31'),
    };
    for (const m of [8, 9, 10]) expect(closingRowsOf(p, itemMaster, suppliers, 2026, m)).toHaveLength(0);
  });

  it('초과 입고는 발주 수량까지만', () => {
    const p = {
      id: 'p6',
      title: '초과 입고',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 2, unitPrice: 5000, receivedQty: 9, receivedAt: D('2026-08-02') },
      ],
      paymentRequested: REQ(''),
    };
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 8)[0].amount).toBe(10000);
  });

  // 선결제 — 물건보다 돈이 먼저 나간 건은 돈 나간 달 (2026-08-28 결정 유지)
  it('선결제는 돈 나간 달에, 나간 돈이 곧 금액', () => {
    const p = {
      id: 'p7',
      title: 'M 10월납품 선결제',
      items: [{ itemId: 'i1', name: 'STEP DRIVER', qty: 99, unitPrice: 1000, receivedQty: 0 }],
      supplierPaid: { 델타전기: [{ seq: 1, paidAt: D('2026-08-20'), amount: 99000 }] },
      paymentRequested: REQ('2026-08-20'),
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8);
    expect(r).toHaveLength(1);
    expect(r[0].amount).toBe(99000);
    expect(r[0].prepaid).toBe(true);
    expect(r[0].closed).toBe(true); // 나간 돈은 대조할 것이 없다
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 10)).toHaveLength(0);
  });

  it('입고 직전 선결제는 입고 달 — 물건이 왔으면 입고 기준', () => {
    const p = {
      id: 'p8',
      title: '입고 직전 선결제',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 10, unitPrice: 5000, receivedQty: 10, receivedAt: D('2026-08-14') },
      ],
      supplierPaid: { 델타전기: [{ seq: 1, paidAt: D('2026-08-13'), amount: 50000 }] },
      paymentRequested: REQ('2026-08-13'),
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8);
    expect(r[0].amount).toBe(50000);
    expect(r[0].prepaid).toBe(false); // 물건이 왔으니 선결제로 안 본다
  });

  // 대표님이 결제 요청 때 달을 직접 정한 건은 그 달로 몰아준다
  it('마감 달을 손으로 정하면 그 달로 몰린다', () => {
    const p = {
      id: 'p9',
      title: '손으로 정한 건',
      items: [
        { itemId: 'i1', name: 'A', qty: 5, unitPrice: 1000, receivedQty: 5, receivedAt: D('2026-08-10') },
        { itemId: 'i1', name: 'B', qty: 5, unitPrice: 1000, receivedQty: 5, receivedAt: D('2026-09-10') },
      ],
      paymentRequested: { 델타전기: { requestedAt: D('2026-08-01'), dueDate: '', closingMonth: '2026-09' } },
    };
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 8)).toHaveLength(0);
    expect(closingRowsOf(p, itemMaster, suppliers, 2026, 9)[0].amount).toBe(10000); // 나눠 들어온 것이 한 줄로
  });

  it('결제 전이면 결제일이 없다 — 예정일과 섞이지 않게', () => {
    const p = {
      id: 'p10',
      title: '결제 전',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 1, unitPrice: 4000, receivedQty: 1, receivedAt: D('2026-08-07') },
      ],
      paymentRequested: REQ('2026-09-30'),
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8)[0];
    expect(r.paid).toBe(false);
    expect(r.paidAt).toBe(null);
    expect(r.closed).toBe(false);
  });

  it('회차 결제는 마지막 결제일을 쓴다', () => {
    const p = {
      id: 'p11',
      title: '회차 결제',
      items: [
        { itemId: 'i1', name: 'STEP DRIVER', qty: 4, unitPrice: 5000, receivedQty: 4, receivedAt: D('2026-08-02') },
      ],
      supplierPaid: {
        델타전기: [
          { seq: 1, paidAt: D('2026-08-10'), amount: 10000 },
          { seq: 2, paidAt: D('2026-08-28'), amount: 10000 },
        ],
      },
      paymentRequested: REQ('2026-08-28'),
    };
    const r = closingRowsOf(p, itemMaster, suppliers, 2026, 8)[0];
    expect(payMonthLabel(r.paidAt)).toBe('8.28');
    expect(r.paidAmount).toBe(20000);
  });
});

// ── 구매처 결제 조건 — 선결제 두 종류 (2026-08-28 대표님)
//
// 「돈을 먼저 보내야 물건이 오는 곳」과 「물건 오기 직전에 보내는 곳」은 기준일이 다르다.
// 한 종류로 두면 발주시 선결제 업체의 마감일이 오지도 않은 입고일로 계산된다.
describe('구매처 결제 조건 — 선결제 두 종류', () => {
  it('두 종류가 목록에 있고, 옛 값은 빠져 있다', () => {
    const values = PAYMENT_TERM_TYPES.map((t) => t.value);
    expect(values).toContain('prepaidOrder');
    expect(values).toContain('prepaidArrival');
    // 옛 「선결제」는 고를 수 없다 — 어느 쪽인지 알 수 없어 다시 골라야 한다
    expect(values).not.toContain('prepaid');
  });

  it('둘 다 미루지 않는다 — 마감일은 준 기준일 당일', () => {
    expect(calcPaymentDue({ paymentTermType: 'prepaidOrder' }, new Date('2026-08-20'))).toBe('2026-08-20');
    expect(calcPaymentDue({ paymentTermType: 'prepaidArrival' }, new Date('2026-10-05'))).toBe('2026-10-05');
  });

  it('기준일이 갈린다 — 발주시는 발주일, 입고전은 입고일', () => {
    expect(prepaidBasisOf('prepaidOrder')).toBe('order');
    expect(prepaidBasisOf('prepaidArrival')).toBe('arrival');
  });

  it('선결제 여부를 가려낸다', () => {
    expect(isPrepaidTerm('prepaidOrder')).toBe(true);
    expect(isPrepaidTerm('prepaidArrival')).toBe(true);
    expect(isPrepaidTerm('nextMonthEnd')).toBe(false);
    expect(isPrepaidTerm('')).toBe(false);
    expect(isPrepaidTerm('prepaid')).toBe(false); // 옛 값은 선결제로 안 친다
  });

  // 옛 값이 남은 구매처는 계산이 멈추면 안 된다 — 다시 고르기 전까지 하던 대로
  it('옛 「선결제」도 마감일은 그대로 낸다', () => {
    expect(calcPaymentDue({ paymentTermType: 'prepaid' }, new Date('2026-08-20'))).toBe('2026-08-20');
  });

  it('선결제가 아닌 조건은 그대로다', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonthEnd' }, new Date('2026-08-11'))).toBe('2026-09-30');
    expect(calcPaymentDue({ paymentTermType: 'afterDays', paymentTermDay: 30 }, new Date('2026-08-01'))).toBe(
      '2026-08-31',
    );
  });
});

// ── 구매처 결제 조건 — 선결제 두 종류 (2026-08-28 대표님)
//
// 「돈을 먼저 보내야 물건이 오는 곳」과 「물건 오기 직전에 보내는 곳」은 기준일이 다르다.
// 한 종류로 두면 발주시 선결제 업체의 마감일이 오지도 않은 입고일로 계산된다.
describe('구매처 결제 조건 — 선결제 두 종류', () => {
  it('두 종류가 목록에 있고, 옛 값은 빠져 있다', () => {
    const values = PAYMENT_TERM_TYPES.map((t) => t.value);
    expect(values).toContain('prepaidOrder');
    expect(values).toContain('prepaidArrival');
    // 옛 「선결제」는 고를 수 없다 — 어느 쪽인지 알 수 없어 다시 골라야 한다
    expect(values).not.toContain('prepaid');
  });

  it('둘 다 미루지 않는다 — 마감일은 준 기준일 당일', () => {
    expect(calcPaymentDue({ paymentTermType: 'prepaidOrder' }, new Date('2026-08-20'))).toBe('2026-08-20');
    expect(calcPaymentDue({ paymentTermType: 'prepaidArrival' }, new Date('2026-10-05'))).toBe('2026-10-05');
  });

  it('기준일이 갈린다 — 발주시는 발주일, 입고전은 입고일', () => {
    expect(prepaidBasisOf('prepaidOrder')).toBe('order');
    expect(prepaidBasisOf('prepaidArrival')).toBe('arrival');
  });

  it('선결제 여부를 가려낸다', () => {
    expect(isPrepaidTerm('prepaidOrder')).toBe(true);
    expect(isPrepaidTerm('prepaidArrival')).toBe(true);
    expect(isPrepaidTerm('nextMonthEnd')).toBe(false);
    expect(isPrepaidTerm('')).toBe(false);
    expect(isPrepaidTerm('prepaid')).toBe(false); // 옛 값은 선결제로 안 친다
  });

  // 옛 값이 남은 구매처는 계산이 멈추면 안 된다 — 다시 고르기 전까지 하던 대로
  it('옛 「선결제」도 마감일은 그대로 낸다', () => {
    expect(calcPaymentDue({ paymentTermType: 'prepaid' }, new Date('2026-08-20'))).toBe('2026-08-20');
  });

  it('선결제가 아닌 조건은 그대로다', () => {
    expect(calcPaymentDue({ paymentTermType: 'nextMonthEnd' }, new Date('2026-08-11'))).toBe('2026-09-30');
    expect(calcPaymentDue({ paymentTermType: 'afterDays', paymentTermDay: 30 }, new Date('2026-08-01'))).toBe(
      '2026-08-31',
    );
  });
});

// ── 메일 기본 틀 — 발주서·메일발송·마감내역요청이 같은 얼굴로 나가는지 (2026-08-27 대표님)
// 마감은 공급가로, 결제는 VAT 포함으로 본다 — 두 화면 숫자가 어긋나면 대조가 안 된다
describe('부가세 — 두 화면이 같은 값을 낸다', () => {
  it('공급가의 10%, 반올림 (결제 페이지와 같은 규칙)', () => {
    expect(vatOf(2100000)).toBe(210000);
    expect(withVat(2100000)).toBe(2310000);
  });

  it('원 단위가 갈리는 값도 결제와 같게 반올림한다', () => {
    // 결제 페이지: Math.round(supply * 0.1)
    for (const v of [1175852, 3737272, 5468155, 347028, 579348]) {
      expect(vatOf(v)).toBe(Math.round(v * 0.1));
      expect(withVat(v)).toBe(v + Math.round(v * 0.1));
    }
  });

  it('빈 값·문자도 0 으로 다룬다', () => {
    expect(vatOf(0)).toBe(0);
    expect(withVat(null)).toBe(0);
    expect(withVat(undefined)).toBe(0);
  });
});

// 자료실 「명함」 폴더가 먼저다 — 코드에 박힌 목록은 아직 안 올린 사람을 위한 대비책
describe('명함 — 자료실 우선', () => {
  afterEach(() => setLibraryCards({})); // 다른 테스트에 새지 않게

  it('자료실에 있으면 그 주소를 쓴다', () => {
    setLibraryCards({ 손성욱: 'https://example.com/a.png' });
    expect(cardFileFor('손성욱')).toBe('https://example.com/a.png');
  });

  it('자료실에 없으면 붙박이 파일로 대신한다', () => {
    setLibraryCards({});
    expect(cardFileFor('손성욱')).toContain('/cards/');
  });

  it('자료실에만 있는 새 사람도 고를 수 있다', () => {
    setLibraryCards({ 김신혜: 'https://example.com/k.png' });
    expect(cardNames()).toContain('김신혜'); // 코드에 없던 이름
    expect(cardNames()).toContain('손성욱'); // 붙박이도 그대로
    expect(senderLine('김신혜')).toBe('주식회사 아이오피엔 김신혜입니다.');
  });

  it('어느 쪽에도 없으면 이름을 넣지 않는다', () => {
    setLibraryCards({});
    expect(cardFileFor('없는사람')).toBe('');
    expect(senderLine('없는사람')).toBe('주식회사 아이오피엔입니다.');
  });
});

describe('메일 기본 틀', () => {
  it('발신·수신 줄이 순서대로 붙는다', () => {
    const html = buildMailHtml({ to: '델타전기', body: '안녕하세요.' });
    expect(html.indexOf('발신 : (주)아이오피엔')).toBeLessThan(html.indexOf('수신 : 델타전기'));
    expect(html.indexOf('수신 : 델타전기')).toBeLessThan(html.indexOf('안녕하세요.'));
  });

  it('수신처가 없으면 수신 줄을 넣지 않는다', () => {
    expect(buildMailHtml({ body: '안녕하세요.' })).not.toContain('수신 :');
  });

  // 명함은 첨부(cid)로 나간다 — 상대 경로 이미지는 받는 쪽 메일함에서 깨진다
  it('명함은 명단에 있는 사람만 붙는다', () => {
    expect(buildMailHtml({ to: 'A', body: 'x', cardName: '손성욱' })).toContain('cid:bizcard');
    expect(buildMailHtml({ to: 'A', body: 'x', cardName: '없는사람' })).not.toContain('cid:');
    expect(buildMailHtml({ to: 'A', body: 'x' })).not.toContain('cid:');
  });

  it('보낼 때는 서버 경로가 새어 나가지 않는다', () => {
    // /cards/... 가 들어가면 받는 쪽에서 깨진 그림이 된다
    expect(buildMailHtml({ to: 'A', body: 'x', cardName: '손성욱' })).not.toContain('/cards/');
  });

  it('미리보기는 파일 경로를 쓴다 — 브라우저는 cid: 를 모른다', () => {
    const html = buildMailHtml({ to: 'A', body: 'x', cardName: '손성욱', preview: true });
    expect(html).toContain('/cards/');
    expect(html).not.toContain('cid:');
  });

  it('본문의 태그는 글자로 나간다 — 메일이 깨지지 않게', () => {
    const html = buildMailHtml({ to: 'A', body: '<script>x</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('줄바꿈은 살린다', () => {
    expect(buildMailHtml({ to: 'A', body: '첫줄\n둘째줄' })).toContain('첫줄<br>둘째줄');
  });

  // 이름이 비면 「아이오피엔 입니다」처럼 빈칸이 남아 받는 쪽에서 실수로 읽힌다
  it('담당자를 안 골랐으면 회사명까지만 적는다', () => {
    expect(senderLine('손성욱')).toBe('주식회사 아이오피엔 손성욱입니다.');
    expect(senderLine('')).toBe('주식회사 아이오피엔입니다.');
    expect(senderLine(null)).toBe('주식회사 아이오피엔입니다.');
    expect(senderLine('  ')).toBe('주식회사 아이오피엔입니다.'); // 공백만 친 경우
    // 계정 이름이 「IOPN」 같은 회사 계정일 때 「아이오피엔 IOPN입니다」로 나가면 안 된다
    expect(senderLine('IOPN')).toBe('주식회사 아이오피엔입니다.');
    expect(senderLine('없는사람')).toBe('주식회사 아이오피엔입니다.');
  });

  it('제목 접두는 한 번만 붙는다', () => {
    expect(mailSubject('8월 마감내역 요청')).toBe('[주식회사 아이오피엔] 8월 마감내역 요청');
    expect(mailSubject('[주식회사 아이오피엔] 이미 붙음')).toBe('[주식회사 아이오피엔] 이미 붙음');
  });
});
