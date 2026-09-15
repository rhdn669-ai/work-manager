import { describe, it, expect } from 'vitest';
import { needsMate, needsStock, newLog, mateLog, mateDelta, logLabel, rowSummary, allLogs } from '../../src/domain/matLog';

const name = (id) => ({ p207: '207', p209: '209', p213: '213' })[id] || id;

describe('자재 이력 — 왜 없나 / 어떻게 채웠나', () => {
  it('상대 호기를 골라야 하는 까닭', () => {
    expect(needsMate('out', '차용해 줌')).toBe(true);
    expect(needsMate('out', '파손')).toBe(false);
    expect(needsMate('in', '차용')).toBe(true);
    expect(needsMate('in', '구매')).toBe(false);
    expect(needsMate('why', '차용')).toBe(true);
    expect(needsMate('why', '미입고')).toBe(false);
  });

  it('재고 통에 실물이 있어야 하는 까닭 — 구매·수리 입고 (대표님 「재고에서는 수량이 있어야」)', () => {
    expect(needsStock('in', '구매')).toBe(true);
    expect(needsStock('in', '수리 입고')).toBe(true);
    expect(needsStock('in', '차용')).toBe(false);
    expect(needsStock('out', '파손')).toBe(false);
  });

  it('한쪽에서 차용을 고르면 상대에도 짝이 남고 수량이 움직인다', () => {
    // 209 가 207 에 빌려줌
    const out = newLog({ id: 'L1', kind: 'out', why: '차용해 줌', n: 1, mate: 'p207', at: '2026-09-15' });
    const pair = mateLog(out, 'p209');
    expect(pair).toMatchObject({ kind: 'in', why: '차용', mate: 'p209', pair: 'L1', n: 1 });
    expect(mateDelta(out)).toBe(+1); // 207 줄이 +1

    // 207 이 209 에서 차용
    const inLog = newLog({ id: 'L2', kind: 'in', why: '차용', n: 1, mate: 'p209', at: '2026-09-15' });
    expect(mateLog(inLog, 'p207')).toMatchObject({ kind: 'out', why: '차용해 줌', mate: 'p207', pair: 'L2' });
    expect(mateDelta(inLog)).toBe(-1); // 209 줄이 −1
  });

  it('0 인 줄 사유는 기록만 — 상대 수량은 안 건드린다', () => {
    const why = newLog({ id: 'L3', kind: 'why', why: '차용', n: 1, mate: 'p207', at: '2026-09-15' });
    expect(mateDelta(why)).toBe(0);
    expect(mateLog(why, 'p209')).toMatchObject({ kind: 'why', why: '뒤호기에 차용해 줌', mate: 'p209' });
    expect(mateLog(newLog({ kind: 'why', why: '미입고' }), 'p209')).toBeNull();
  });

  it('한 줄 요약', () => {
    expect(logLabel(newLog({ kind: 'out', why: '차용해 줌', mate: 'p207' }), name)).toBe('207에 빌려줌 1');
    expect(logLabel(newLog({ kind: 'in', why: '차용', mate: 'p209' }), name)).toBe('209에서 차용 1');
    expect(logLabel(newLog({ kind: 'why', why: '미입고' }), name)).toBe('미입고');
    expect(logLabel(newLog({ kind: 'out', why: '파손', n: 2 }), name)).toBe('파손 2');
  });

  it('줄 상태 — 왜 없나 → 어떻게 채웠나', () => {
    const logs = [
      newLog({ id: 'a', kind: 'why', why: '차용', mate: 'p207', at: '2026-09-14' }),
      newLog({ id: 'b', kind: 'in', why: '구매', at: '2026-09-16' }),
    ];
    expect(rowSummary(logs, name)).toBe('207 차용 → 구매 1');
    expect(rowSummary([], name)).toBe('');
  });

  it('모든 호기에서 모아 최신순', () => {
    const all = {
      p207: { MP: { rowA: { log: [newLog({ id: 'a', kind: 'out', why: '파손', at: '2026-09-15' })] } } },
      p209: { MP: { rowA: { log: [newLog({ id: 'b', kind: 'in', why: '구매', at: '2026-09-16' })] } } },
    };
    expect(allLogs(all).map((x) => x.log.id)).toEqual(['b', 'a']);
  });
});
