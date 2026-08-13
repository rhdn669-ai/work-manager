import { Fragment, useState, useEffect } from 'react';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { updatePanel } from '../../services/productionService';
import {
  BUPMOK,
  JAIP,
  JAIP_GROUPS,
  IPGO_ITEMS,
  IPGO_GROUPS,
  GIGU_MAKERS,
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
  boxDefectResolved,
  deriveBoxStatus,
  deriveMpState,
  normState,
  AFTER_TURNON,
  AFTER_TURNON_KEYS,
} from '../../domain/production';
import { splitPasted, mapPastedValues } from '../../utils/pasteColumn';

// 엑셀식 가로 매트릭스 — 호기(행) × BOX(그룹: 판금·하네스·사급·도급·불량·상태).
// BOX 상태는 하위(자재입고4·불량)에서 자동 산출. 셀 직접 입력. MP 하위 상세는 상세모달.
const mmdd = (d) => (d ? String(d).slice(5) : '');
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ProductionMatrix({ panels, canEdit, onOpen, onRemove, onAddBlank }) {
  const { toast } = useDialog();
  const setField = (p, patch) => {
    if (!canEdit) return;
    updatePanel(p.id, patch).catch((e) => {
      console.error(e);
      toast('저장에 실패했습니다. 다시 시도해 주세요.', 'error', 0);
    });
  };

  // ---- 엑셀식 날짜 채우기 (모서리 점을 잡고 아래로 끌면 같은 날짜가 채워진다) ----
  // 같은 날 잡힌 일정을 호기마다 하나씩 고르는 일이 잦아, 구매 품목표와 같은 방식으로 맞춘다.
  const [fill, setFill] = useState(null); // { field, value, start, end }

  function startFill(e, field, value, startIndex) {
    e.preventDefault();
    e.stopPropagation();
    setFill({ field, value, start: startIndex, end: startIndex });
  }
  function fillEnter(idx) {
    setFill((f) => (f ? { ...f, end: idx } : f));
  }
  // 끌고 지나간 칸에만 색을 준다 — 행 전체가 아니라 그 열만
  function fillCls(field, row) {
    if (!fill || fill.field !== field) return '';
    const lo = Math.min(fill.start, fill.end);
    const hi = Math.max(fill.start, fill.end);
    return row >= lo && row <= hi ? ' cell-fill-on' : '';
  }

  useEffect(() => {
    if (!fill) return undefined;
    const done = () => {
      const lo = Math.min(fill.start, fill.end);
      const hi = Math.max(fill.start, fill.end);
      setFill(null);
      if (hi === lo) return; // 끌지 않고 클릭만 한 경우
      const [base, key] = fill.field.split(':');
      for (let i = lo; i <= hi; i++) {
        const p = panels[i];
        if (!p) continue;
        if (key) setField(p, { 자재입고일: { ...(p.자재입고일 || {}), [key]: fill.value } });
        else setField(p, { [base]: fill.value });
      }
    };
    window.addEventListener('mouseup', done);
    return () => window.removeEventListener('mouseup', done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, panels]);

  // 정/역 인라인 토글 (빈값 → 정 → 역 → 빈값)
  const DIR_CYCLE = ['', '정', '역'];
  const cycleDir = (p) => setField(p, { 정역: DIR_CYCLE[(DIR_CYCLE.indexOf(p.정역 || '') + 1) % DIR_CYCLE.length] });
  // 기구제작 인라인 토글 (회사별 선택지 순환, 빈값 포함)
  const gigusOf = (p) => GIGU_MAKERS[p.회사] || [...GIGU_MAKERS['메티스'], ...GIGU_MAKERS['디에이치']];
  const cycleGigu = (p) => {
    const opts = ['', ...gigusOf(p)];
    setField(p, { 기구제작: opts[(opts.indexOf(p.기구제작 || '') + 1) % opts.length] });
  };

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

  // 엑셀에서 한 열을 긁어 붙여넣기 — 누른 칸부터 아래로 채운다.
  // 줄이 표의 행보다 많으면 그만큼 판넬을 새로 만들어 이어 붙인다 (2026-08-12 대표님).
  // 날짜로 다룰 열인지 — 나머지(프로젝트·호기·자재)는 글자 그대로 넣는다
  const isDateField = (f) => f === '납기' || f === '턴온' || f === '자재입고' || AFTER_TURNON_KEYS.includes(f);

  const pasteColumn = async (e, field, startRow, toPatch) => {
    if (!canEdit) return;
    const text = e.clipboardData?.getData('text/plain') || '';
    const lines = splitPasted(text);
    if (lines.length <= 1) return; // 한 줄이면 평소대로 그 칸에만 붙는다
    e.preventDefault();

    const values = mapPastedValues(lines, { type: isDateField(field) ? 'date' : 'text' });
    if (values.length === 0) {
      toast('붙여넣은 내용에서 넣을 값을 찾지 못했습니다', 'error');
      return;
    }
    const need = startRow + lines.length - panels.length;
    let extra = [];
    if (need > 0) {
      if (!onAddBlank) {
        toast(`행이 ${need}개 모자랍니다 — 판넬을 먼저 추가해 주세요`, 'error');
        return;
      }
      extra = (await onAddBlank(need)) || [];
    }
    const target = (i) => panels[startRow + i] || extra[startRow + i - panels.length];
    let done = 0;
    await Promise.all(
      values
        .map(({ index, value }) => {
          const row = target(index);
          if (!row?.id) return null;
          done += 1;
          return updatePanel(row.id, toPatch ? toPatch(row, value) : { [field]: value });
        })
        .filter(Boolean),
    ).catch((err) => {
      console.error(err);
      toast('붙여넣기 저장 중 오류가 발생했습니다', 'error', 0);
    });
    toast(`${field} ${done}개 행에 붙여넣었습니다${need > 0 ? ` (판넬 ${need}대 추가)` : ''}`);
  };

  const DateCell = ({ p, field }) => {
    const row = panels.findIndex((x) => x.id === p.id);
    return (
      <td className={`mx-cell mx-date${fillCls(field, row)}`} onMouseEnter={() => fillEnter(row)}>
        {canEdit ? (
          <>
            <input
              type="date"
              className="mx-date-input"
              value={p[field] || ''}
              onChange={(e) => setField(p, { [field]: e.target.value })}
              onPaste={(e) => pasteColumn(e, field, row)}
            />
            <span
              className="cell-fill"
              title="드래그하여 아래로 채우기"
              onMouseDown={(e) => startFill(e, field, p[field] || '', row)}
            />
          </>
        ) : (
          mmdd(p[field])
        )}
      </td>
    );
  };

  // 일정 항목별 입고일 셀 — p.자재입고일[itemKey] 에 개별 저장.
  // 날짜 기준 D-day로 색상: 미도달(미래)·도달(당일)·초과(지남)
  const IpgoDateCell = ({ p, itemKey }) => {
    const cur = (p.자재입고일 || {})[itemKey] || '';
    const dd = cur ? getDday(cur) : null;
    const statusCls = dd === null ? '' : dd < 0 ? ' ipgo-over' : dd === 0 ? ' ipgo-due' : ' ipgo-before';
    const field = `자재입고일:${itemKey}`;
    const row = panels.findIndex((x) => x.id === p.id);
    return (
      <td className={`mx-cell mx-date${statusCls}${fillCls(field, row)}`} onMouseEnter={() => fillEnter(row)}>
        {canEdit ? (
          <>
            <input
              type="date"
              className="mx-date-input"
              value={cur}
              onChange={(e) => setField(p, { 자재입고일: { ...(p.자재입고일 || {}), [itemKey]: e.target.value } })}
              onPaste={(e) =>
                pasteColumn(e, field, row, (target, value) => ({
                  자재입고일: { ...(target.자재입고일 || {}), [itemKey]: value },
                }))
              }
            />
            <span
              className="cell-fill"
              title="드래그하여 아래로 채우기"
              onMouseDown={(e) => startFill(e, field, cur, row)}
            />
          </>
        ) : (
          mmdd(cur)
        )}
      </td>
    );
  };

  return (
    <div className="mx-wrap card">
      <table className="mx-table">
        <thead>
          {/* 1행: BOX 그룹 (non-MP는 leaf 5 + 불량 + 상태 = 7칸) */}
          <tr className="mx-group-row">
            <th scope="col" className="mx-sticky" colSpan={6}>
              기본
            </th>
            {BUPMOK.map((b) => (
              <th scope="col" key={b} colSpan={b === 'MP' ? MP_SUBS.length + 1 : JAIP.length + 2}>
                {b}
              </th>
            ))}
            <th scope="col" colSpan={IPGO_ITEMS.length}>
              입고 예정일
            </th>
            <th scope="col" colSpan={2 + AFTER_TURNON.length}>
              일정
            </th>
            <th scope="col" colSpan={canEdit ? 3 : 2}>
              판정
            </th>
          </tr>
          {/* 2행: 자재 그룹(판금·하네스·자재) + 불량·상태 — 하위 없는 칸은 rowSpan 2 */}
          <tr className="mx-sub-row">
            <th scope="col" className="mx-sticky mx-c0" rowSpan={2}>
              #
            </th>
            <th scope="col" className="mx-sticky mx-c1" rowSpan={2}>
              프로젝트
            </th>
            <th scope="col" rowSpan={2}>
              정역
            </th>
            <th scope="col" rowSpan={2}>
              자재
            </th>
            <th scope="col" rowSpan={2}>
              CHUCK
            </th>
            <th scope="col" rowSpan={2}>
              기구
            </th>
            {BUPMOK.map((b) =>
              b === 'MP' ? (
                <Fragment key={b}>
                  {MP_SUBS.map((s, si) => (
                    <th scope="col" key={s} className={`mx-sub-th${si === 0 ? ' mx-box-start' : ''}`} rowSpan={2}>
                      {s}
                    </th>
                  ))}
                  <th scope="col" className="mx-sub-th" rowSpan={2}>
                    상태
                  </th>
                </Fragment>
              ) : (
                <Fragment key={b}>
                  {JAIP_GROUPS.map((g, gi) =>
                    g.leaves.length === 1 ? (
                      <th
                        scope="col"
                        key={g.key}
                        className={`mx-sub-th ${gi === 0 ? 'mx-box-start' : 'mx-grp-start'}`}
                        rowSpan={2}
                      >
                        {g.label}
                      </th>
                    ) : (
                      <th
                        scope="col"
                        key={g.key}
                        className={`mx-sub-th ${gi === 0 ? 'mx-box-start' : 'mx-grp-start'}`}
                        colSpan={g.leaves.length}
                      >
                        {g.label}
                      </th>
                    ),
                  )}
                  <th scope="col" className="mx-sub-th mx-grp-start" rowSpan={2}>
                    불량
                  </th>
                  <th scope="col" className="mx-sub-th" rowSpan={2}>
                    상태
                  </th>
                </Fragment>
              ),
            )}
            {IPGO_GROUPS.map((g) =>
              g.leaves.length === 1 ? (
                <th scope="col" key={g.key} className="mx-sub-th mx-grp-start" rowSpan={2}>
                  {g.label}
                </th>
              ) : (
                <th scope="col" key={g.key} className="mx-sub-th mx-grp-start" colSpan={g.leaves.length}>
                  {g.label}
                </th>
              ),
            )}
            {/* 자재 납기(발주)와 헷갈려 「판넬납기」로 부른다 — 저장 필드명은 납기 그대로 */}
            <th scope="col" rowSpan={2}>
              판넬납기
            </th>
            <th scope="col" rowSpan={2}>
              턴온
            </th>
            {/* 턴온 뒤 마무리 일정 — 조정부터 출하까지 현장 흐름 순서 (2026-08-12 대표님) */}
            {AFTER_TURNON.map((f) => (
              <th scope="col" key={f.key} rowSpan={2}>
                {f.label}
              </th>
            ))}
            <th scope="col" rowSpan={2}>
              진행
            </th>
            <th scope="col" rowSpan={2}>
              상태
            </th>
            {canEdit && (
              <th scope="col" rowSpan={2}>
                작업
              </th>
            )}
          </tr>
          {/* 3행: 하네스·자재 하위 leaf (non-MP만) */}
          <tr className="mx-sub-row mx-leaf-row">
            {BUPMOK.map((b) => (
              <Fragment key={b}>
                {b === 'MP'
                  ? null
                  : JAIP_GROUPS.filter((g) => g.leaves.length > 1).flatMap((g, gi) =>
                      g.leaves.map((l, li) => (
                        <th
                          scope="col"
                          key={`${b}-${l.key}`}
                          className={`mx-sub-th${gi === 0 && li === 0 ? ' mx-grp-start' : ''}`}
                        >
                          {l.label}
                        </th>
                      )),
                    )}
              </Fragment>
            ))}
            {/* 일정 입고일 — 하네스·자재 묶음 하위(사급·도급·제작 / 사급·도급) */}
            {IPGO_GROUPS.filter((g) => g.leaves.length > 1).flatMap((g) =>
              g.leaves.map((l) => (
                <th scope="col" key={`ipgo-${l.key}`} className="mx-sub-th">
                  {l.label}
                </th>
              )),
            )}
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
                {/* 엑셀처럼 표에서 바로 고친다 — 모달을 거치지 않는다 (2026-08-12 대표님).
                    프로젝트명(YS-TEPS1026033) 한 칸만 둔다 — 칸을 쪼개면 이름이 잘린다. */}
                <td className="mx-sticky mx-c1 mx-proj">
                  {canEdit ? (
                    <input
                      className="mx-proj-input"
                      value={p.프로젝트 || ''}
                      placeholder="프로젝트"
                      onChange={(e) => setField(p, { 프로젝트: e.target.value })}
                      onPaste={(e) => pasteColumn(e, '프로젝트', idx)}
                    />
                  ) : (
                    <span className="mx-proj-name">{p.프로젝트 || '—'}</span>
                  )}
                </td>
                <td
                  className="mx-cell mx-dir"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={() => cycleDir(p)}
                  /* 입력칸이 없는 칸이라, 칸 자체가 포커스를 받아야 Ctrl+V 가 걸린다 */
                  tabIndex={canEdit ? 0 : -1}
                  onPaste={(e) => pasteColumn(e, '정역', idx)}
                  title="클릭: 정 / 역 전환 · 붙여넣기 가능"
                >
                  {p.정역 ? (
                    <span className={`dir-badge ${p.정역 === '정' ? 'jung' : 'yeok'}`}>{p.정역}</span>
                  ) : (
                    <span className="mx-cell-empty">·</span>
                  )}
                </td>
                <td className="mx-cell mx-jaje">
                  {canEdit ? (
                    <input
                      className="mx-text-input"
                      value={p.자재 || ''}
                      onChange={(e) => setField(p, { 자재: e.target.value })}
                      onPaste={(e) => pasteColumn(e, '자재', idx)}
                    />
                  ) : (
                    p.자재 || ''
                  )}
                </td>
                <td className="mx-cell mx-chuck">
                  {canEdit ? (
                    <input
                      className="mx-text-input"
                      value={p.CHUCK || ''}
                      onChange={(e) => setField(p, { CHUCK: e.target.value })}
                      onPaste={(e) => pasteColumn(e, 'CHUCK', idx)}
                    />
                  ) : (
                    p.CHUCK || ''
                  )}
                </td>
                <td
                  className="mx-cell mx-gigu"
                  style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onClick={() => cycleGigu(p)}
                  tabIndex={canEdit ? 0 : -1}
                  onPaste={(e) => pasteColumn(e, '기구제작', idx)}
                  title="클릭: 기구제작 선택 · 붙여넣기 가능"
                >
                  {p.기구제작 ? (
                    <span className="mx-gigu-badge">{p.기구제작}</span>
                  ) : (
                    <span className="mx-cell-empty">·</span>
                  )}
                </td>
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
                  const defectDone = !defect && boxDefectResolved(p.검수, b);
                  const st = deriveBoxStatus(p, b);
                  const sc = TASK_CFG[st] || TASK_CFG['대기'];
                  return (
                    <BoxGroup
                      key={b}
                      mat={mat}
                      matDate={matDate}
                      defect={defect}
                      defectDone={defectDone}
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
                {IPGO_ITEMS.map((it) => (
                  <IpgoDateCell key={it.key} p={p} itemKey={it.key} />
                ))}
                <DateCell p={p} field="납기" />
                <DateCell p={p} field="턴온" />
                {AFTER_TURNON.map((f) => (
                  <DateCell key={f.key} p={p} field={f.key} />
                ))}
                <td className="mx-cell mx-prog">
                  <div className="mx-prog-wrap">
                    <div className="mx-prog-track">
                      <div
                        className={`mx-prog-fill${p.progress >= 100 ? ' is-done' : ''}`}
                        style={{ width: `${Math.min(100, Number(p.progress) || 0)}%` }}
                      />
                    </div>
                    <span className="mx-prog-num">{p.progress}%</span>
                  </div>
                </td>
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
      {MP_SUBS.map((k, ki) => {
        const s = normState((p.mp하위상태 || {})[k]);
        const c = TASK_CFG[s] || TASK_CFG['대기'];
        return (
          <td
            key={k}
            className={`mx-cell mx-boxmat${ki === 0 ? ' mx-box-start' : ''}`}
            style={{
              background: s === '완료' ? 'var(--status-done-bg)' : s === '문제' ? 'var(--status-cancel-bg)' : undefined,
              color: c.dot,
              cursor: canEdit ? 'pointer' : 'default',
            }}
            onClick={() => onToggle(k)}
            title={`${k} — ${s === '문제' ? '불량' : s}`}
          >
            {s === '완료' ? <Icon name="check" /> : s === '문제' ? <Icon name="close" /> : ''}
          </td>
        );
      })}
      <td className="mx-cell mx-boxstate" style={{ background: sc.bg, color: sc.fg }} title={st}>
        {st === '완료' ? <Icon name="check" /> : st === '문제' ? <Icon name="close" /> : ''}
      </td>
    </>
  );
}

// 각 자재 그룹의 첫 leaf = 그룹 경계(좌측 구분선)
const GRP_START = new Set(JAIP_GROUPS.map((g) => g.leaves[0].key));

// BOX 하위: 판금 · 하네스{사급·제작} · 자재{사급·도급} · 불량 · 상태 — 체크 시 일자(MM-DD)
function BoxGroup({ mat, matDate, defect, defectDone, defectDate, doneDate, st, sc, canEdit, onMat, onDefect }) {
  return (
    <>
      {JAIP.map((k, ki) => {
        const on = !!mat[k];
        return (
          <td
            key={k}
            // BOX가 바뀌는 첫 칸은 굵게, BOX 안의 자재 그룹 경계는 얇게 — 두 단계로 구분한다
            className={`mx-cell mx-boxmat mx-dcell${ki === 0 ? ' mx-box-start' : GRP_START.has(k) ? ' mx-grp-start' : ''}`}
            style={{ background: on ? 'var(--status-done-bg)' : undefined, cursor: canEdit ? 'pointer' : 'default' }}
            onClick={() => onMat(k)}
            title={k}
          >
            {on ? mmdd(matDate[k]) || <Icon name="check" /> : ''}
          </td>
        );
      })}
      <td
        className="mx-cell mx-boxdefect mx-dcell mx-grp-start"
        style={{
          cursor: 'pointer',
          color: defectDone ? 'var(--status-done-fg)' : 'var(--status-cancel-fg)',
          background: defect ? 'var(--status-cancel-bg)' : defectDone ? 'var(--status-done-bg)' : undefined,
        }}
        onClick={onDefect}
        title={
          defect
            ? '미해결 불량 (클릭: 상세)'
            : defectDone
              ? '불량 처리완료 (클릭: 상세)'
              : '불량 기록/사진 (클릭: 상세)'
        }
      >
        {defect ? mmdd(defectDate) || <Icon name="close" /> : defectDone ? <Icon name="check" /> : ''}
      </td>
      <td className="mx-cell mx-boxstate mx-dcell" style={{ background: sc.bg, color: sc.fg }} title={st}>
        {st === '완료'
          ? mmdd(doneDate) || <Icon name="check" />
          : st === '문제'
            ? mmdd(defectDate) || <Icon name="close" />
            : ''}
      </td>
    </>
  );
}
