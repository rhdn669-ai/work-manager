// 붙여넣기로 품목을 알아보는 일 (2026-09-02 대표님 「코드 추가 도번, 수량 순서로
// 넣어도 인식 가능하게」). 엉뚱한 품목이 붙으면 그대로 발주로 나간다.
import { describe, it, expect } from 'vitest';
import { findMasterByToken, splitQty } from '../../src/domain/pasteMatch';

const master = [
  { id: 'a', code: 'IOPN-014-13', drawingNo: '3603-002683', name: 'CP', spec: 'GCP-32ANM 5A 2P' },
  { id: 'b', code: 'IOPN-009-2', drawingNo: '3501-001593', name: 'N/F', spec: 'WYNFS50T2M' },
  { id: 'c', code: 'IOPN-025-1', drawingNo: '', name: 'FAN', spec: '3110SB-05W-B49' },
];

describe('수량 가르기', () => {
  it('대표님이 붙여넣는 「도번 <탭> 1EA」를 읽는다', () => {
    expect(splitQty('3501-001593\t1EA')).toEqual({ token: '3501-001593', qty: 1 });
    expect(splitQty('3704-001262\t2EA')).toEqual({ token: '3704-001262', qty: 2 });
  });

  it('공백으로 띄어도 읽는다', () => {
    expect(splitQty('3501-001593  1EA')).toEqual({ token: '3501-001593', qty: 1 });
  });

  it('EA 말고 개·PCS·SET 도 읽는다', () => {
    expect(splitQty('3501-001593 2개').qty).toBe(2);
    expect(splitQty('3501-001593 3 PCS').qty).toBe(3);
    expect(splitQty('3501-001593 1 set').qty).toBe(1);
  });

  it('수량이 없으면 0 — 부르는 쪽이 1 로 본다', () => {
    expect(splitQty('3501-001593')).toEqual({ token: '3501-001593', qty: 0 });
  });

  it('코드 끝 숫자를 수량으로 잘못 떼지 않는다', () => {
    // 앞에 공백이 없으므로 수량이 아니다
    expect(splitQty('SS-130')).toEqual({ token: 'SS-130', qty: 0 });
    expect(splitQty('4797.0015')).toEqual({ token: '4797.0015', qty: 0 });
    expect(splitQty('IOPN-014-13')).toEqual({ token: 'IOPN-014-13', qty: 0 });
  });

  it('빈 줄은 빈 채로', () => {
    expect(splitQty('   ')).toEqual({ token: '', qty: 0 });
  });
});

describe('품목 찾기', () => {
  it('도번으로 찾는다 — 이번에 열어 준 길', () => {
    expect(findMasterByToken(master, '3501-001593')?.id).toBe('b');
    expect(findMasterByToken(master, '3603-002683')?.id).toBe('a');
  });

  it('코드로도 그대로 찾는다', () => {
    expect(findMasterByToken(master, 'IOPN-009-2')?.id).toBe('b');
  });

  it('품명·규격으로도 찾는다', () => {
    expect(findMasterByToken(master, 'WYNFS50T2M')?.id).toBe('b');
    expect(findMasterByToken(master, 'FAN')?.id).toBe('c');
  });

  it('띄어쓰기·하이픈 차이는 넘어간다', () => {
    expect(findMasterByToken(master, '3501 001593')?.id).toBe('b');
    expect(findMasterByToken(master, '3501001593')?.id).toBe('b');
  });

  it('괄호 메모는 떼고 찾는다', () => {
    expect(findMasterByToken(master, '3501-001593 (급함)')?.id).toBe('b');
  });

  it('부분만 맞는 것은 붙이지 않는다 — 엉뚱한 자재가 발주되면 안 된다', () => {
    expect(findMasterByToken(master, '3501')).toBeNull();
    expect(findMasterByToken(master, 'GCP-32')).toBeNull();
  });

  it('도번이 빈 품목이 빈 토큰에 걸리지 않는다', () => {
    expect(findMasterByToken(master, '')).toBeNull();
  });
});
