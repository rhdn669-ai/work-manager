import { describe, it, expect } from 'vitest';
import { newIncident, isOpen, statusLabel, allIncidents, incidentsForRow, rowIncidentLabel } from '../../src/domain/incidents';

const name = (id) => ({ p207: '207', p209: '209' })[id] || id;

describe('분실·파손 장부 — 사건 하나 = 줄 하나', () => {
  it('새 사건은 열려 있고 사유에 따라 상태 글자가 다르다', () => {
    const a = newIncident({ id: 'a', reason: '파손', from: 'p209', at: '2026-09-15', by: '손' });
    const b = newIncident({ id: 'b', reason: '분실', at: '2026-09-12' });
    expect(isOpen(a)).toBe(true);
    expect(statusLabel(a)).toBe('수리 대기');
    expect(statusLabel(b)).toBe('재구매 대기');
    expect(statusLabel({ ...a, status: 'done' })).toBe('수리 입고');
    expect(statusLabel({ ...b, status: 'done' })).toBe('입고됨');
    expect(newIncident({ reason: '이상한값' }).reason).toBe('파손');
  });

  it('모든 호기 기록에서 모아 최신순으로', () => {
    const all = {
      p207: { MP: { rowA: { qty: 1, incidents: [newIncident({ id: 'a', at: '2026-09-15', from: 'p209' })] } } },
      p185: { 'S/D BOX': { rowB: { qty: 1, incidents: [newIncident({ id: 'b', reason: '분실', at: '2026-09-12' })] } } },
      p209: { MP: { rowA: { qty: 0 } } },
    };
    const list = allIncidents(all);
    expect(list.map((x) => x.inc.id)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ panelId: 'p207', box: 'MP', rowId: 'rowA' });
  });

  it('호기 체크 줄 표시 — 사건 난 호기와 빌려준 호기', () => {
    const inc = newIncident({ id: 'a', reason: '파손', from: 'p209', at: '2026-09-15' });
    const all = { p207: { MP: { rowA: { incidents: [inc] } } } };
    expect(rowIncidentLabel(incidentsForRow(all, 'MP', 'rowA', 'p207'), name)).toBe('파손 1 · 수리 대기');
    expect(rowIncidentLabel(incidentsForRow(all, 'MP', 'rowA', 'p209'), name)).toBe('207에 빌려줌 1');
    expect(rowIncidentLabel(incidentsForRow(all, 'MP', 'rowA', 'p211'), name)).toBe('');
    expect(rowIncidentLabel(incidentsForRow(all, 'MP', 'rowB', 'p207'), name)).toBe('');
  });
});
