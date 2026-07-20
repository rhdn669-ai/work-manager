import Icon from '../../components/common/Icon';
import { updatePanel } from '../../services/productionService';
import {
  BUPMOK,
  JAIP,
  MP_SUBS,
  UI_TASK_STATES,
  TASK_CFG,
  OVERALL_CFG,
  getDday,
  boxMat,
  boxMatDate,
  boxDoneDate,
  boxDefectDate,
  boxHasDefect,
  deriveBoxStatus,
  deriveMpState,
  normState,
} from '../../domain/production';

// 엑셀식 가로 매트릭스 — 호기(행) × BOX(그룹: 판금·하네스·사급·도급·불량·상태).
// BOX 상태는 하위(자재입고4·불량)에서 자동 산출. 셀 직접 입력. MP 하위 상세는 상세모달.
const mmdd = (d) => (d ? String(d).slice(5) : '');
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ProductionMatrix({ panels, canEdit, onOpen, onRemove }) {
  const setField = (p, patch) => canEdit && updatePanel(p.id, patch);

  // BOX 자재입고 항목 토글 → 박스입고 + 체크일자 갱신 + 박스 상태 자동 산출
  const toggleBoxMat = (p, box, k) => {
    if (!canEdit) return;
    const cur = boxMat(p, box);
    const on = !cur[k];
    const nextMat = { ...cur, [k]: on };
    const nextBoxIn = { ...(p.박스입고 || {}), [box]: nextMat };
    const curDate = boxMatDate(p, box);
    const nextBoxDate = { ...(p.박스입고일자 || {}), [box]: { ...curDate, [k]: on ? todayStr() : '' } };
    const st = deriveBoxStatus(p, box, p.검수, nextMat);
    setField(p, {
      박스입고: nextBoxIn,
      박스입고일자: nextBoxDate,
      부품상태: { ...(p.부품상태 || {}), [box]: st },
    });
  };

  // MP 하위 종목 상태 순환(대기→완료→불량) — 진행률은 구독 recompute가 자동 반영
  const cycleMpSub = (p, k) => {
    if (!canEdit) return;
    const cur = normState((p.mp하위상태 || {})[k]);
    const next = UI_TASK_STATES[(UI_TASK_STATES.indexOf(cur) + 1) % UI_TASK_STATES.length];
    setField(p, { mp하위상태: { ...(p.mp하위상태 || {}), [k]: next } });
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
            {BUPMOK.map((b) => (
              <th key={b} colSpan={b === 'MP' ? MP_SUBS.length + 1 : 6}>
                {b}
              </th>
            ))}
            <th colSpan={3}>일정</th>
            <th colSpan={canEdit ? 3 : 2}>판정</th>
          </tr>
          <tr className="mx-sub-row">
            <th className="mx-sticky mx-c0">#</th>
            <th className="mx-sticky mx-c1">프로젝트 호기</th>
            <th>정역</th>
            <th>자재</th>
            <th>기구</th>
            {BUPMOK.map((b) =>
              (b === 'MP' ? [...MP_SUBS, '상태'] : [...JAIP, '불량', '상태']).map((sub) => (
                <th key={`${b}-${sub}`} className="mx-sub-th">
                  {sub}
                </th>
              )),
            )}
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
                <td className="mx-sticky mx-c1 mx-proj" onClick={() => onOpen(p.id, 'info')} title="클릭: 기본정보">
                  <span className="mx-proj-name">{p.프로젝트 || '—'}</span>
                  {p.호기 ? <span className="mx-proj-hogi">{(p.호기 || '').slice(-3)}</span> : null}
                </td>
                <td className="mx-cell mx-dir">
                  {p.정역 ? <span className={`dir-badge ${p.정역 === '정' ? 'jung' : 'yeok'}`}>{p.정역}</span> : ''}
                </td>
                <td className="mx-cell mx-jaje">{p.자재 || ''}</td>
                <td className="mx-cell mx-gigu">{p.기구제작 || ''}</td>
                {BUPMOK.map((b) => {
                  if (b === 'MP') {
                    const st = deriveMpState(p.mp하위상태 || {});
                    return (
                      <MpGroup
                        key={b}
                        p={p}
                        st={st}
                        sc={TASK_CFG[st] || TASK_CFG['대기']}
                        canEdit={canEdit}
                        onToggle={(k) => cycleMpSub(p, k)}
                      />
                    );
                  }
                  const mat = boxMat(p, b);
                  const matDate = boxMatDate(p, b);
                  const defect = boxHasDefect(p.검수, b);
                  const st = deriveBoxStatus(p, b);
                  const sc = TASK_CFG[st] || TASK_CFG['대기'];
                  return (
                    <BoxGroup
                      key={b}
                      mat={mat}
                      matDate={matDate}
                      defect={defect}
                      defectDate={boxDefectDate(p.검수, b)}
                      doneDate={boxDoneDate(p, b)}
                      st={st}
                      sc={sc}
                      canEdit={canEdit}
                      onMat={(k) => toggleBoxMat(p, b, k)}
                      onDefect={() => onOpen(p.id, 'defect', b)}
                    />
                  );
                })}
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

// MP 하위: 전장 9종 각 셀(대기→완료→불량 순환) + 종합상태(자동)
function MpGroup({ p, st, sc, canEdit, onToggle }) {
  return (
    <>
      {MP_SUBS.map((k) => {
        const s = normState((p.mp하위상태 || {})[k]);
        const c = TASK_CFG[s] || TASK_CFG['대기'];
        return (
          <td
            key={k}
            className="mx-cell mx-boxmat"
            style={{
              background: s === '완료' ? '#e7f4ec' : s === '문제' ? '#fdebec' : undefined,
              color: c.dot,
              cursor: canEdit ? 'pointer' : 'default',
            }}
            onClick={() => onToggle(k)}
            title={`${k} — ${s === '문제' ? '불량' : s}`}
          >
            {s === '완료' ? '○' : s === '문제' ? '✕' : ''}
          </td>
        );
      })}
      <td className="mx-cell mx-boxstate" style={{ background: sc.bg, color: sc.fg }} title={st}>
        {st === '완료' ? '○' : st === '문제' ? '✕' : ''}
      </td>
    </>
  );
}

// BOX 하위 6칸: 판금·하네스·사급·도급 · 불량 · 상태 — 체크 시 일자(MM-DD) 표기
function BoxGroup({ mat, matDate, defect, defectDate, doneDate, st, sc, canEdit, onMat, onDefect }) {
  return (
    <>
      {JAIP.map((k) => {
        const on = !!mat[k];
        return (
          <td
            key={k}
            className="mx-cell mx-boxmat mx-dcell"
            style={{ background: on ? '#e7f4ec' : undefined, cursor: canEdit ? 'pointer' : 'default' }}
            onClick={() => onMat(k)}
            title={k}
          >
            {on ? mmdd(matDate[k]) || '○' : ''}
          </td>
        );
      })}
      <td
        className="mx-cell mx-boxdefect mx-dcell"
        style={{ cursor: 'pointer', color: '#d6303f', background: defect ? '#fdebec' : undefined }}
        onClick={onDefect}
        title="불량 기록/사진 (클릭: 상세)"
      >
        {defect ? mmdd(defectDate) || '✕' : ''}
      </td>
      <td className="mx-cell mx-boxstate mx-dcell" style={{ background: sc.bg, color: sc.fg }} title={st}>
        {st === '완료' ? mmdd(doneDate) || '○' : st === '문제' ? mmdd(defectDate) || '✕' : ''}
      </td>
    </>
  );
}
