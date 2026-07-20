import Icon from '../../components/common/Icon';
import { updatePanel } from '../../services/productionService';
import {
  BUPMOK,
  JAIP,
  MP_SUBS,
  UI_TASK_STATES,
  TASK_LABEL,
  TASK_CFG,
  OVERALL_CFG,
  getDday,
} from '../../domain/production';

// 엑셀식 가로 매트릭스 — 호기(행) × BOX/공정(컬럼). 셀 직접 입력, 가로 스크롤.
// v1: 현재 도메인(부품7·MP하위9·자재입고4·일정) 기준. 엑셀 정밀컬럼(Bracket·케이블 도급/제작 등)은 파일 수령 후 확장.
const today = () => new Date().toISOString().slice(0, 10);
const mmdd = (d) => (d ? String(d).slice(5) : '');
const norm = (s) => (s === '불량' ? '문제' : s || '대기');

export default function ProductionMatrix({ panels, canEdit, checkerName, onOpen, onRemove }) {
  const setField = (p, patch) => canEdit && updatePanel(p.id, patch);

  // 부품/ MP 상태 셀 — 클릭 시 대기→완료→불량 순환
  const cyclePart = (p, key, isMp) => {
    if (!canEdit) return;
    const cur = norm((isMp ? p.mp하위상태 : p.부품상태)?.[key]);
    const next = UI_TASK_STATES[(UI_TASK_STATES.indexOf(cur) + 1) % UI_TASK_STATES.length];
    if (isMp) setField(p, { mp하위상태: { ...(p.mp하위상태 || {}), [key]: next } });
    else
      setField(p, {
        부품상태: { ...(p.부품상태 || {}), [key]: next },
        부품검수자: { ...(p.부품검수자 || {}), [key]: next === '대기' ? '' : checkerName },
      });
  };

  const toggleJaip = (p, k) => {
    if (!canEdit) return;
    const on = !!(p.자재입고상태 || {})[k];
    setField(p, {
      자재입고상태: { ...(p.자재입고상태 || {}), [k]: !on },
      자재입고일자: { ...(p.자재입고일자 || {}), [k]: !on ? today() : '' },
    });
  };

  const StatusCell = ({ p, fieldKey, isMp }) => {
    const st = norm((isMp ? p.mp하위상태 : p.부품상태)?.[fieldKey]);
    const c = TASK_CFG[st] || TASK_CFG['대기'];
    return (
      <td
        className="mx-cell mx-status"
        style={{ background: c.bg, color: c.fg, cursor: canEdit ? 'pointer' : 'default' }}
        onClick={() => cyclePart(p, fieldKey, isMp)}
        title={`${fieldKey}: ${TASK_LABEL[st] || st}`}
      >
        {st === '완료' ? '○' : st === '문제' ? '✕' : ''}
      </td>
    );
  };

  const DateCell = ({ p, field }) => (
    <td className="mx-cell mx-date">
      {canEdit ? (
        <input
          type="date"
          className="mx-date-input"
          defaultValue={p[field] || ''}
          onChange={(e) => setField(p, { [field]: e.target.value })}
        />
      ) : (
        mmdd(p[field])
      )}
    </td>
  );

  return (
    <div className="mx-wrap card">
      <table className="mx-table">
        <thead>
          <tr className="mx-group-row">
            <th className="mx-sticky" colSpan={5}>
              기본
            </th>
            <th colSpan={JAIP.length}>자재입고</th>
            <th colSpan={BUPMOK.length}>부품 · BOX</th>
            <th colSpan={MP_SUBS.length}>MP 하위</th>
            <th colSpan={3}>일정</th>
            <th colSpan={canEdit ? 3 : 2}>판정</th>
          </tr>
          <tr className="mx-sub-row">
            <th className="mx-sticky mx-c0">#</th>
            <th className="mx-sticky mx-c1">프로젝트</th>
            <th className="mx-sticky mx-c2">호기</th>
            <th>정역</th>
            <th>자재</th>
            {JAIP.map((k) => (
              <th key={k}>{k}</th>
            ))}
            {BUPMOK.map((b) => (
              <th key={b} className="mx-rot">
                {b}
              </th>
            ))}
            {MP_SUBS.map((k) => (
              <th key={k} className="mx-rot">
                {k}
              </th>
            ))}
            <th>자재입고</th>
            <th>납기</th>
            <th>턴온</th>
            <th>진행</th>
            <th>상태</th>
            {canEdit && <th>작업</th>}
          </tr>
        </thead>
        <tbody>
          {panels.map((p, idx) => {
            const oc = OVERALL_CFG[p.overallStatus] || OVERALL_CFG['대기중'];
            const dd = getDday(p.납기);
            const isDone = p.overallStatus === '출고완료' || p.overallStatus === '출고숨김';
            const urg = dd >= 0 && dd <= 3 && !isDone;
            const od = dd < 0 && !isDone;
            return (
              <tr key={p.id} className={od ? 'mx-od' : urg ? 'mx-urg' : ''}>
                <td className="mx-sticky mx-c0 mx-no">{idx + 1}</td>
                <td className="mx-sticky mx-c1 mx-proj" onClick={() => onOpen(p.id)} title="클릭: 상세">
                  {p.프로젝트 || '—'}
                </td>
                <td className="mx-sticky mx-c2 mx-hogi" onClick={() => onOpen(p.id)}>
                  {(p.호기 || '').slice(-3)}
                </td>
                <td className="mx-cell mx-dir">
                  {p.정역 ? <span className={`dir-badge ${p.정역 === '정' ? 'jung' : 'yeok'}`}>{p.정역}</span> : ''}
                </td>
                <td className="mx-cell mx-jaje">{p.자재 || ''}</td>
                {JAIP.map((k) => {
                  const on = !!(p.자재입고상태 || {})[k];
                  return (
                    <td
                      key={k}
                      className="mx-cell mx-jaip"
                      style={{ background: on ? '#e7f4ec' : undefined, cursor: canEdit ? 'pointer' : 'default' }}
                      onClick={() => toggleJaip(p, k)}
                      title={on ? (p.자재입고일자 || {})[k] || '완료' : ''}
                    >
                      {on ? '○' : ''}
                    </td>
                  );
                })}
                {BUPMOK.map((b) => (
                  <StatusCell key={b} p={p} fieldKey={b} isMp={false} />
                ))}
                {MP_SUBS.map((k) => (
                  <StatusCell key={k} p={p} fieldKey={k} isMp />
                ))}
                <DateCell p={p} field="자재입고" />
                <DateCell p={p} field="납기" />
                <DateCell p={p} field="턴온" />
                <td className="mx-cell mx-prog">{p.progress}%</td>
                <td className="mx-cell">
                  <span className="badge badge-sm" style={{ background: oc.bg, color: oc.fg }}>
                    {p.overallStatus}
                  </span>
                </td>
                {canEdit && (
                  <td className="mx-cell">
                    <button className="btn btn-sm btn-danger" onClick={(e) => onRemove(e, p)}>
                      <Icon name="trash" className="btn-ic" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
