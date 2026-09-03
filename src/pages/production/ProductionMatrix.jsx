import { Fragment, useState, useEffect, useRef, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { bulkWritePanels, updatePanel, savePanelOrder } from '../../services/productionService';
import { misorderedIds, mergeMove } from '../../domain/panelOrder';
import {
  BUPMOK,
  JAIP,
  JAIP_GROUPS,
  IPGO_ITEMS,
  IPGO_GROUPS,
  GIGU_MAKERS,
  MP_SUBS,
  UI_TASK_STATES,
  OVERALL_CFG,
  getDday,
  boxMat,
  boxMatDate,
  boxDoneDate,
  boxDefectDate,
  boxHasDefect,
  boxDefectResolved,
  deriveBoxStatus,
  shipPhotoCount,
  deriveMpState,
  normState,
  AFTER_TURNON,
  AFTER_TURNON_KEYS,
  emptyPanel,
} from '../../domain/production';
import { splitPasted, mapPastedValues } from '../../utils/pasteColumn';

// 엑셀식 가로 매트릭스 — 호기(행) × BOX(그룹: 판금·하네스·사급·도급·불량·상태).
// BOX 상태는 하위(자재입고4·불량)에서 자동 산출. 셀 직접 입력. MP 하위 상세는 상세모달.
const mmdd = (d) => (d ? String(d).slice(5) : '');
// 이 폭 이하(태블릿 가로·세로, 폰)는 표를 자르지 않고 페이지 스크롤 — CSS 의 같은 값과 맞춘다
const PAGE_SCROLL_MQ = '(max-width: 1180px)';
const todayStr = () => new Date().toISOString().slice(0, 10);

// 글자 칸 — 표 «밖»에 둔다.
//
// 컴포넌트 함수 안에서 정의하면 부모가 다시 그릴 때마다 새 타입이 되고, React 는
// 그것을 다른 컴포넌트로 보아 입력칸을 통째로 새로 만든다. 그 순간 커서가 날아가
// 한 번 눌러서는 글을 못 쓰고 두 번 눌러야 했다
// (2026-09-03 대표님 「한번 클릭에 바로 입력칸이 안뜸」).
function TextCell({ saved, className, placeholder, onCommit, onPaste }) {
  const [v, setV] = useState(saved);
  // 저장된 값이 밖에서 바뀌면 편집 버퍼를 맞춘다. effect 로 하면 한 번 더 그려지므로
  // 렌더 도중 견주어 바로 맞춘다 (React 가 권하는 방식).
  const [seen, setSeen] = useState(saved);
  if (saved !== seen) {
    setSeen(saved);
    setV(saved);
  }
  return (
    <input
      className={className}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== saved) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setV(saved);
      }}
      onPaste={onPaste}
    />
  );
}

// 끌 수 있는 행 — 손잡이(# 칸)만 잡힌다. 칸 안의 입력·클릭은 그대로 둔다.
// 납기가 바뀔 예정이라 줄을 미리 옮겨 두는 용도 (2026-09-03 대표님 「순서 이동」).
function SortableTr({ id, disabled, className, children }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : undefined,
    position: isDragging ? 'relative' : undefined,
    zIndex: isDragging ? 5 : undefined,
  };
  return (
    <tr ref={setNodeRef} style={style} className={className}>
      {children({ handleProps: { ...attributes, ...listeners, ref: setActivatorNodeRef } })}
    </tr>
  );
}

// 날짜 칸 — 같은 이유로 밖에 둔다. 안에 있으면 달력을 열자마자 다시 그려져 닫힌다.
function DateCell({ value, cellCls, canEdit, onEnter, onChange, onPaste, onFillStart, display }) {
  return (
    <td className={cellCls} onMouseEnter={onEnter}>
      {canEdit ? (
        <>
          <input type="date" className="mx-date-input" value={value} onChange={onChange} onPaste={onPaste} />
          <span className="cell-fill" title="드래그하여 아래로 채우기" onMouseDown={onFillStart} />
        </>
      ) : (
        display
      )}
    </td>
  );
}

export default function ProductionMatrix({
  panels,
  canEdit,
  canDefect = canEdit,
  onOpen,
  onRemove,
  onMaterials,
  company,
  orderPool = null, // 회사 전체 목록(정렬된) — 검색 중 옮겨도 숨은 줄 자리를 지키려고
}) {
  const { toast } = useDialog();

  // ── 끌어서 순서 이동 ──
  const canDrag = canEdit && Array.isArray(orderPool);
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const rowIds = useMemo(() => panels.map((p) => p.id), [panels]);
  // 납기 날짜 차례와 어긋난 줄 — 잠그지 않고 색으로만 알린다
  const misordered = useMemo(() => misorderedIds(panels), [panels]);
  async function handleDragEnd({ active, over }) {
    if (!canDrag || !over || active.id === over.id) return;
    const next = mergeMove(
      orderPool.map((p) => p.id),
      rowIds,
      active.id,
      over.id,
    );
    try {
      await savePanelOrder(next);
    } catch (err) {
      console.error(err);
      toast('순서 저장에 실패했습니다', 'error', 0);
    }
  }
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

  // 화면에 보이는 행만 그린다.
  // 192대를 다 그리면 칸이 14,592개·입력칸 3,456개가 되어 탭 하나 누르는 데 3.4초가 걸렸다.
  // 위아래로 여유 몇 줄을 더 그려 두어 스크롤 중에 빈 칸이 보이지 않게 한다.
  const ROW_H = 53; // 행 높이(고정) — 이 값이 어긋나면 스크롤이 튄다
  const OVERSCAN = 6;
  const wrapRef = useRef(null);
  const [view, setView] = useState({ top: 0, height: 900 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let raf = 0;
    // PC: 표 높이를 화면 남는 만큼으로 맞춰 표 안에서 스크롤한다(머리 3줄 고정·스크롤바가 늘 손 닿는 곳).
    // 태블릿·폰: 상단이 화면의 반을 먹어 표가 반 토막 나므로(2026-09-03 대표님) 자르지 않고
    // 다 펼쳐 페이지 전체를 스크롤한다. 보이는 줄만 그리는 계산도 페이지 스크롤 기준으로 바꾼다.
    const pageMode = () => window.matchMedia(PAGE_SCROLL_MQ).matches;
    const fit = () => {
      if (pageMode()) {
        el.style.maxHeight = 'none';
        return;
      }
      const top = el.getBoundingClientRect().top;
      el.style.maxHeight = `${Math.max(280, Math.round(window.innerHeight - top - 16))}px`;
    };
    const measure = () => {
      raf = 0;
      fit();
      if (pageMode()) {
        const top = el.getBoundingClientRect().top;
        setView({ top: Math.max(0, -top), height: window.innerHeight || 900 });
      } else {
        setView({ top: el.scrollTop, height: el.clientHeight || 900 });
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // 배너가 닫히는 등 위쪽 높이가 바뀌면 다시 맞춘다
    const ro = new ResizeObserver(onScroll);
    ro.observe(document.body);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const HEAD_H = 104; // 머리 3줄(36+36+32)이 sticky 로 덮는 높이
  const win = useMemo(() => {
    const first = Math.max(0, Math.floor((view.top - HEAD_H) / ROW_H) - OVERSCAN);
    const last = Math.min(panels.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);
    return { first, last };
  }, [view, panels.length]);

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
  // 기구제작 인라인 토글 (회사별 선택지 순환, 빈값 포함)
  const gigusOf = (p) => GIGU_MAKERS[p.회사] || [...GIGU_MAKERS['메티스'], ...GIGU_MAKERS['디에이치']];

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

    // 기존 행에 덮을 것과, 모자라 새로 만들 것을 갈라 담아 한 번에 쓴다.
    // 줄마다 저장하면 왕복도 그만큼이고 표가 매번 다시 그려져 굼뜨다.
    const updates = [];
    const creates = [];
    const createdIndex = new Map(); // 붙여넣기 줄 → creates 안 자리
    for (const { index, value } of values) {
      const row = panels[startRow + index];
      const patch = toPatch ? toPatch(row || emptyPanel({ 회사: company }), value) : { [field]: value };
      if (row?.id) {
        updates.push({ id: row.id, patch });
      } else {
        const at = startRow + index - panels.length;
        if (createdIndex.has(at)) {
          Object.assign(creates[createdIndex.get(at)], patch);
        } else {
          createdIndex.set(at, creates.length);
          creates.push(emptyPanel({ 회사: company, ...patch }));
        }
      }
    }
    try {
      await bulkWritePanels({ creates, updates });
      const n = updates.length + creates.length;
      toast(
        `${isDateField(field) ? field : field} ${n}개 행에 붙여넣었습니다` +
          (creates.length ? ` (판넬 ${creates.length}대 추가)` : ''),
      );
    } catch (err) {
      console.error(err);
      toast('붙여넣기 저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  // 눌러서 값을 돌리는 칸(정역·기구제작).
  // 저장이 끝나기를 기다렸다가 다시 그리면 누른 뒤 한 박자 늦게 바뀌는 것처럼 보인다.
  // 화면을 먼저 바꿔 두고 저장은 뒤에서 시킨다 — 실패하면 원래 값으로 되돌아온다.
  const CycleCell = ({ p, field, options, rowIndex, className, title, render }) => {
    const saved = p[field] || '';
    const [v, setV] = useState(saved);
    useEffect(() => setV(saved), [saved]);
    const next = () => {
      if (!canEdit) return;
      const nv = options[(options.indexOf(v) + 1) % options.length];
      setV(nv);
      setField(p, { [field]: nv });
    };
    return (
      <td
        className={className}
        style={{ cursor: canEdit ? 'pointer' : 'default' }}
        onClick={next}
        tabIndex={canEdit ? 0 : -1}
        onPaste={(e) => pasteColumn(e, field, rowIndex)}
        title={title}
      >
        {render(v)}
      </td>
    );
  };

  // 글자 칸 — 치는 동안은 화면만 바꾸고, 칸을 벗어날 때 한 번만 저장한다.
  // 글자마다 저장하면 「YS-TEPS1026033」 한 번 치는 데 저장 14번·표 다시 그리기 14번이다.
  // 아래 셋은 위(파일 최상위)의 칸 컴포넌트에 필요한 값을 채워 넣는 감싸개다.
  // 감싸개는 매 렌더 새로 만들어져도 괜찮다 — 실제로 그려지는 것은 고정된 컴포넌트다.
  const Txt = ({ p, field, rowIndex, className }) => (
    <TextCell
      saved={p[field] || ''}
      className={className}
      placeholder={field === '프로젝트' ? '프로젝트' : undefined}
      onCommit={(v) => setField(p, { [field]: v })}
      onPaste={(e) => pasteColumn(e, field, rowIndex)}
    />
  );

  const Dt = ({ p, field }) => {
    const row = panels.findIndex((x) => x.id === p.id);
    return (
      <DateCell
        value={p[field] || ''}
        cellCls={`mx-cell mx-date${fillCls(field, row)}`}
        canEdit={canEdit}
        onEnter={() => fillEnter(row)}
        onChange={(e) => setField(p, { [field]: e.target.value })}
        onPaste={(e) => pasteColumn(e, field, row)}
        onFillStart={(e) => startFill(e, field, p[field] || '', row)}
        display={mmdd(p[field])}
      />
    );
  };

  // 일정 항목별 입고일 — p.자재입고일[itemKey] 에 개별 저장.
  // 날짜 기준 D-day로 색상: 미도달(미래)·도달(당일)·초과(지남)
  const Ipgo = ({ p, itemKey }) => {
    const cur = (p.자재입고일 || {})[itemKey] || '';
    const dd = cur ? getDday(cur) : null;
    const statusCls = dd === null ? '' : dd < 0 ? ' ipgo-over' : dd === 0 ? ' ipgo-due' : ' ipgo-before';
    const field = `자재입고일:${itemKey}`;
    const row = panels.findIndex((x) => x.id === p.id);
    return (
      <DateCell
        value={cur}
        cellCls={`mx-cell mx-date${statusCls}${fillCls(field, row)}`}
        canEdit={canEdit}
        onEnter={() => fillEnter(row)}
        onChange={(e) => setField(p, { 자재입고일: { ...(p.자재입고일 || {}), [itemKey]: e.target.value } })}
        onPaste={(e) =>
          pasteColumn(e, field, row, (target, value) => ({
            자재입고일: { ...(target.자재입고일 || {}), [itemKey]: value },
          }))
        }
        onFillStart={(e) => startFill(e, field, cur, row)}
        display={mmdd(cur)}
      />
    );
  };

  return (
    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="mx-wrap card" ref={wrapRef}>
        <table className="mx-table">
          <thead>
            {/* 1행: BOX 그룹 (non-MP는 leaf 5 + 불량 + 상태 = 7칸) */}
            <tr className="mx-group-row">
              <th scope="col" className="mx-sticky" colSpan={6}>
                기본
              </th>
              {BUPMOK.map((b) => (
                <th scope="col" key={b} colSpan={b === 'MP' ? MP_SUBS.length + 1 : JAIP.length + 3}>
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
                    {/* 내보내기 전 다섯 면을 찍어 남긴다 (2026-08-22 대표님).
                      「출고사진」 네 글자가 54px 을 넘어 옆 칸과 겹쳐 이 칸만 넓게 잡는다. */}
                    <th scope="col" className="mx-sub-th mx-ship-th" rowSpan={2}>
                      출고사진
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
            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              {win.first > 0 && <tr style={{ height: win.first * ROW_H }} aria-hidden="true" />}
              {panels.slice(win.first, win.last).map((p, i) => {
                const idx = win.first + i;
                const oc = OVERALL_CFG[p.overallStatus] || OVERALL_CFG['대기중'];
                const dd = getDday(p.납기);
                const isDone = p.overallStatus === '출고완료' || p.overallStatus === '출고숨김';
                const urg = dd >= 0 && dd <= 3 && !isDone;
                const od = dd < 0 && !isDone;
                const mis = misordered.has(p.id);
                return (
                  <SortableTr
                    key={p.id}
                    id={p.id}
                    disabled={!canDrag}
                    className={`${od ? 'mx-od' : urg ? 'mx-urg' : ''}${mis ? ' mx-misorder' : ''}`}
                  >
                    {({ handleProps }) => (
                      <>
                        <td className="mx-sticky mx-c0 mx-no" title={mis ? '납기 날짜 차례와 다릅니다' : undefined}>
                          <span className="mx-no-wrap">
                            {canDrag && (
                              <button
                                type="button"
                                className="mx-drag"
                                title="끌어서 순서 이동"
                                aria-label="끌어서 순서 이동"
                                {...handleProps}
                              />
                            )}
                            {idx + 1}
                          </span>
                        </td>
                        {/* 엑셀처럼 표에서 바로 고친다 — 모달을 거치지 않는다 (2026-08-12 대표님).
                    프로젝트명(YS-TEPS1026033) 한 칸만 둔다 — 칸을 쪼개면 이름이 잘린다. */}
                        <td className="mx-sticky mx-c1 mx-proj">
                          <div className="mx-proj-wrap">
                            {canEdit ? (
                              <Txt p={p} field="프로젝트" rowIndex={idx} className="mx-proj-input" />
                            ) : (
                              <span className="mx-proj-name">{p.프로젝트 || '—'}</span>
                            )}
                            {/* 구성품 입고 체크 — BOX 마다 두지 않고 호기당 하나 (2026-09-03 대표님
                        「개별로 두지말고 프로젝트 명 칸 옆에」). BOM 을 연결한 호기만 */}
                            {onMaterials && p.bomLink?.projectId && (
                              <button
                                type="button"
                                className="mx-mat-btn"
                                title="구성품 입고 체크 (BOM)"
                                aria-label="구성품 입고 체크"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMaterials(p.id);
                                }}
                              >
                                <Icon name="list" />
                              </button>
                            )}
                          </div>
                        </td>
                        <CycleCell
                          p={p}
                          field="정역"
                          options={DIR_CYCLE}
                          rowIndex={idx}
                          className="mx-cell mx-dir"
                          title="클릭: 정 / 역 전환 · 붙여넣기 가능"
                          render={(v) =>
                            v ? (
                              <span className={`dir-badge ${v === '정' ? 'jung' : 'yeok'}`}>{v}</span>
                            ) : (
                              <span className="mx-cell-empty">·</span>
                            )
                          }
                        />
                        <td className="mx-cell mx-jaje">
                          {canEdit ? <Txt p={p} field="자재" rowIndex={idx} className="mx-text-input" /> : p.자재 || ''}
                        </td>
                        <td className="mx-cell mx-chuck">
                          {canEdit ? (
                            <Txt p={p} field="CHUCK" rowIndex={idx} className="mx-text-input" />
                          ) : (
                            p.CHUCK || ''
                          )}
                        </td>
                        <CycleCell
                          p={p}
                          field="기구제작"
                          options={['', ...gigusOf(p)]}
                          rowIndex={idx}
                          className="mx-cell mx-gigu"
                          title="클릭: 기구제작 선택 · 붙여넣기 가능"
                          render={(v) =>
                            v ? <span className="mx-gigu-badge">{v}</span> : <span className="mx-cell-empty">·</span>
                          }
                        />
                        {BUPMOK.map((b) => {
                          if (b === 'MP') {
                            const st = deriveMpState(p.mp하위상태 || {});
                            return (
                              <MpGroup key={b} p={p} st={st} canEdit={canEdit} onToggle={(k) => cycleMpSub(p, k)} />
                            );
                          }
                          const mat = boxMat(p, b);
                          const matDate = boxMatDate(p, b);
                          const defect = boxHasDefect(p.검수, b);
                          const defectDone = !defect && boxDefectResolved(p.검수, b);
                          const st = deriveBoxStatus(p, b);

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
                              canEdit={canEdit}
                              onMat={(k) => toggleBoxMat(p, b, k)}
                              canDefect={canDefect}
                              onDefect={() => onOpen(p.id, 'defect', b)}
                              shipCount={shipPhotoCount(p, b)}
                              onShip={() => onOpen(p.id, 'ship', b)}
                            />
                          );
                        })}
                        {IPGO_ITEMS.map((it) => (
                          <Ipgo key={it.key} p={p} itemKey={it.key} />
                        ))}
                        <Dt p={p} field="납기" />
                        <Dt p={p} field="턴온" />
                        {AFTER_TURNON.map((f) => (
                          <Dt key={f.key} p={p} field={f.key} />
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
                          <td className="mx-cell mx-actions">
                            {/* PC 표에는 기본정보(BOM 연결·비고·일정)를 여는 길이 불량·출고 칸뿐이었다.
                        상세를 바로 여는 버튼을 둔다 (2026-09-03 대표님 「호기별 자재」 ②) */}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => onOpen(p.id, 'info')}
                              title="기본정보 · BOM 연결"
                            >
                              상세
                            </button>
                            <button className="btn btn-sm btn-danger" onClick={(e) => onRemove(e, p)}>
                              <Icon name="trash" className="btn-ic" />
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </SortableTr>
                );
              })}
              {win.last < panels.length && (
                <tr style={{ height: (panels.length - win.last) * ROW_H }} aria-hidden="true" />
              )}
            </SortableContext>
          </tbody>
        </table>
      </div>
    </DndContext>
  );
}

// MP 하위: 전장 9종 각 셀(대기→완료→불량 순환) + 종합상태(자동)
function MpGroup({ p, st, canEdit, onToggle }) {
  return (
    <>
      {MP_SUBS.map((k, ki) => {
        const s = normState((p.mp하위상태 || {})[k]);

        return (
          <td
            key={k}
            className={`mx-cell mx-boxmat${ki === 0 ? ' mx-box-start' : ''}`}
            style={{ cursor: canEdit ? 'pointer' : 'default' }}
            onClick={() => onToggle(k)}
            title={`${k} — ${s === '문제' ? '불량' : s}`}
          >
            {s === '완료' ? (
              <span className="mx-tag is-done">
                <Icon name="check" />
              </span>
            ) : s === '문제' ? (
              <span className="mx-tag is-defect">
                <Icon name="close" />
              </span>
            ) : (
              ''
            )}
          </td>
        );
      })}
      <td className="mx-cell mx-boxstate" title={st}>
        {st === '완료' ? (
          <span className="mx-tag is-done">
            <Icon name="check" />
          </span>
        ) : st === '문제' ? (
          <span className="mx-tag is-defect">
            <Icon name="close" />
          </span>
        ) : (
          ''
        )}
      </td>
    </>
  );
}

// 각 자재 그룹의 첫 leaf = 그룹 경계(좌측 구분선)
const GRP_START = new Set(JAIP_GROUPS.map((g) => g.leaves[0].key));

// BOX 하위: 판금 · 하네스{사급·제작} · 자재{사급·도급} · 불량 · 상태 — 체크 시 일자(MM-DD)
function BoxGroup({
  canDefect,
  mat,
  matDate,
  defect,
  defectDone,
  defectDate,
  doneDate,
  st,
  canEdit,
  onMat,
  onDefect,
  shipCount,
  onShip,
}) {
  return (
    <>
      {JAIP.map((k, ki) => {
        const on = !!mat[k];
        return (
          <td
            key={k}
            // BOX가 바뀌는 첫 칸은 굵게, BOX 안의 자재 그룹 경계는 얇게 — 두 단계로 구분한다
            className={`mx-cell mx-boxmat mx-dcell${ki === 0 ? ' mx-box-start' : GRP_START.has(k) ? ' mx-grp-start' : ''}`}
            style={{ cursor: canEdit ? 'pointer' : 'default' }}
            onClick={() => onMat(k)}
            title={k}
          >
            {on ? <span className="mx-tag is-done">{mmdd(matDate[k]) || <Icon name="check" />}</span> : ''}
          </td>
        );
      })}
      <td
        className="mx-cell mx-boxdefect mx-dcell mx-grp-start"
        style={{ cursor: 'pointer' }}
        onClick={canDefect ? onDefect : undefined}
        title={
          defect
            ? '미해결 불량 (클릭: 상세)'
            : defectDone
              ? '불량 처리완료 (클릭: 상세)'
              : '불량 기록/사진 (클릭: 상세)'
        }
      >
        {defect ? (
          <span className="mx-tag is-defect">{mmdd(defectDate) || <Icon name="close" />}</span>
        ) : defectDone ? (
          <span className="mx-tag is-done">
            <Icon name="check" />
          </span>
        ) : (
          ''
        )}
      </td>
      <td className="mx-cell mx-boxstate mx-dcell" title={st}>
        {st === '완료' ? (
          <span className="mx-tag is-done">{mmdd(doneDate) || <Icon name="check" />}</span>
        ) : st === '문제' ? (
          <span className="mx-tag is-defect">{mmdd(defectDate) || <Icon name="close" />}</span>
        ) : st === '진행중' ? (
          <span className="mx-tag is-progress">진행</span>
        ) : (
          ''
        )}
      </td>
      <td
        className="mx-cell mx-boxship mx-dcell"
        style={{ cursor: 'pointer' }}
        onClick={onShip}
        title={shipCount > 0 ? `출고사진 ${shipCount}/5 (클릭: 보기·등록)` : '출고사진 등록 (전면·후면·좌측·우측·상부)'}
      >
        {shipCount > 0 ? (
          <span className="mx-tag is-done mx-ship-count">{shipCount}/5</span>
        ) : (
          <Icon name="image" className="mx-ship-empty" />
        )}
      </td>
    </>
  );
}
