import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import ProjectName from '../../components/common/ProjectName';
import { isFinePointer } from '../../utils/finePointer';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useArrived } from '../../utils/useArrived';
import Select from '../../components/common/Select';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { getBomBySite } from '../../services/bomService';
import { rowsForPanel } from '../../domain/panelBom';
import { panelShortageBySupply } from '../../domain/paidSets';
import { COMPANIES } from '../../domain/production';
import { MADE } from '../../domain/itemKind';
import PanelMaterialsPage from './PanelMaterialsPage';
import ShortagePage from './ShortagePage';
import FreeStockPage from './FreeStockPage';
import PaidStockPage from './PaidStockPage';
import MatLogPage from './MatLogPage';

// 자재 허브 — 호기 자재 체크와 갈래별 재고를 한 화면의 탭으로
// (2026-09-05 대표님 안 B 2단계 「자재 화면 3 → 1」). 옛 주소(/production/:id/materials,
// /production/shortage, /production/paid-sets)는 라우터가 여기로 넘긴다.
//   ?company=메티스&tab=check|shortage|freestock|paidstock|madestock&panel=<호기 id>
// 「도급 배정」 탭은 뺐다 — 발주서에 호기를 걸면 입고 때 자동 배정되므로 (2026-09-05 대표님)
// 「부족 집계」는 잠시 걷었다가 되살렸다 — 재고 칸에 부족분을 겹쳐 적으니 「실물이 몇 개인지」와
// 「얼마가 모자란지」가 한 칸에서 엉켰다. 재고는 배정 안 된 실물만, 부족은 이 탭에서 본다
// (2026-09-14 대표님 「부족집계를 살려서 현재 체크 진행중인 호기의 배정된 부족수량을 표시하고
// 재고에는 배정안된 실제 수량만 표시하자」)
const TABS = [
  { value: 'check', label: '호기 체크' },
  { value: 'shortage', label: '부족 집계' },
  // 호기를 정하지 않고 들어온 사급을 모아 두는 곳 (2026-09-10 대표님 「사급 재고를 따로」)
  { value: 'freestock', label: '사급 재고' },
  // 도급도 같은 모양으로 — 들어온 것 중 아직 호기에 안 간 양 (2026-09-11 대표님)
  { value: 'paidstock', label: '도급 재고' },
  // 판금도 같은 모양으로 — BOM 판금 탭에 담은 줄만 센다 (2026-09-12 대표님 「판금 재고 탭을 따로」)
  { value: 'madestock', label: '판금 재고' },
  // 호기 줄에서 한 일(왜 없나 / 어떻게 채웠나)이 자동으로 쌓이는 이력 (2026-09-15 대표님)
  { value: 'matlog', label: '자재 이력' },
];

export default function MaterialsHubPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'check';
  const panelId = sp.get('panel') || '';
  const [panels, setPanels] = useState([]);
  const { take, has } = useArrived(); // 어느 구독이 첫 값을 줬는지
  useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
  // 호기 점 색 — 초록: 도급 다 들어옴 · 주황: 배정됐는데 부족 · 없음: 아직 발주에 안 걸림
  const [materials, setMaterials] = useState({});
  const [bomRowsByProject, setBomRowsByProject] = useState({});
  useEffect(() => subscribeAllMaterials(take('materials', setMaterials)), [take]);

  // 회사 — 주소에 없으면 고른 호기의 회사, 그것도 없으면 첫 회사
  const picked = panels.find((p) => p.id === panelId) || null;
  const company = sp.get('company') || picked?.회사 || COMPANIES[0];

  const patch = (next) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setSp(q, { replace: true });
  };

  // 끝난 호기(출고완료·출고숨김)는 기본으로 감춘다 — 생산현황의 「출고 숨김」과 같은 기준
  // (2026-09-08 대표님 「종결된 호기는 호기 체크에서도 숨기기」)
  const [hideDone, setHideDone] = useState(true);
  const isDone = (p) => p.overallStatus === '출고완료' || p.overallStatus === '출고숨김';
  const doneCount = useMemo(
    () => panels.filter((p) => (!p.회사 || p.회사 === company) && isDone(p)).length,
    [panels, company],
  );

  // 호기 목록 — 생산현황 순서 그대로, BOM 을 연결한 호기가 먼저
  const list = useMemo(() => {
    const mine = panels.filter((p) => (!p.회사 || p.회사 === company) && (!hideDone || !isDone(p)));
    return [...mine.filter((p) => p.bomLink?.projectId), ...mine.filter((p) => !p.bomLink?.projectId)];
  }, [panels, company, hideDone]);
  // 호기 탭인데 아직 안 골랐으면 BOM 연결된 첫 호기
  useEffect(() => {
    if (tab === 'check' && !panelId && list.length) patch({ panel: list[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, panelId, list.length]);

  useEffect(() => {
    const ids = [...new Set(list.map((p) => p.bomLink?.projectId).filter(Boolean))].filter(
      (id) => !(id in bomRowsByProject),
    );
    if (ids.length === 0) return undefined;
    let alive = true;
    Promise.all(ids.map((id) => getBomBySite(id).then((rows) => [id, rows || []]))).then((pairs) => {
      if (alive) setBomRowsByProject((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
  }, [list, bomRowsByProject]);
  // 도급·사급 상태를 따로 (2026-09-05 대표님 「사급 도급 열 만들어서 각자 상태도」)
  const stateOf = (p) => {
    if (!p.bomLink?.projectId) return null;
    // BOM 이나 입고 기록이 아직 안 왔으면 셈하지 않는다 — 「–」가 떴다가 「대기」로 바뀌던 잔상
    if (!has('materials') || !(p.bomLink.projectId in bomRowsByProject)) return 'loading';
    const rows = rowsForPanel(bomRowsByProject[p.bomLink.projectId] || [], p);
    const s = panelShortageBySupply(rows, materials[p.id] || {});
    const one = (kind, k) => {
      if (s[k].total === 0) return { cls: 'is-none', label: '–', title: `${kind} 줄 없음` };
      // 아직 아무것도 안 적었으면 「대기」 — 부족 숫자를 띄워 봤자 계획만 있는 호기다
      // (2026-09-14 대표님 「도급도 수량 하나도안넣은거 대기로」)
      if (s[k].entered === 0) return { cls: 'is-wait', label: '대기', title: `${kind} 수량을 아직 적지 않았습니다` };
      return s[k].short > 0
        ? { cls: 'is-short', label: String(s[k].short), title: `${kind} ${s[k].short}줄 부족` }
        : { cls: 'is-ok', label: '완료', title: `${kind} 자재 다 들어옴` };
    };
    const out = { paid: one('도급', 'paid'), free: one('사급', 'free') };
    if (s.made.total > 0) out.made = one(MADE, 'made');
    return out;
  };
  const nameOf = (p) => `${p.프로젝트 || ''}${p.호기 ? ` ${p.호기}` : ''}`.trim() || '(이름 없음)';

  // 터치 기기(태블릿)에서는 호기 목록을 옆이 아니라 «위쪽 칩 줄»로 — 옆 목록 232px 가 표로
  // 돌아와 열 잘림이 풀리고, 호기 바꾸는 손도 위에서 끝난다. 마우스 PC 는 정보가 더 많은
  // 옆 목록 그대로 (2026-09-18 대표님 「사이드에 있는 호기 표시를 상단으로 옮긴다면」).
  const strip = !isFinePointer();
  const stripRef = useRef(null);
  useEffect(() => {
    if (!strip || !panelId) return;
    // 지금 호기가 늘 보이게 — 44대 중 어디에 있든 가운데로 끌어온다
    const el = stripRef.current?.querySelector('.pstrip-chip.on');
    el?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [strip, panelId, list]);
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/production', { replace: true }));

  return (
    <div className="page mhub-page">
      <div className="page-header no-print">
        <div className="mhub-head-left">
          <button type="button" className="btn btn-sm btn-outline" onClick={back}>
            <Icon name="chevronLeft" className="btn-ic" />
            생산현황
          </button>
          <h2>
            자재 <span className="pmat-title-sub">· {company}</span>
          </h2>
        </div>
        <div className="page-actions">
          <ViewSwitch options={TABS} value={tab} onChange={(v) => patch({ tab: v })} ariaLabel="자재 보기" />
        </div>
      </div>

      {tab === 'shortage' ? (
        <ShortagePage embedded company={company} />
      ) : tab === 'freestock' ? (
        <FreeStockPage company={company} />
      ) : tab === 'paidstock' ? (
        <PaidStockPage company={company} kind="paid" />
      ) : tab === 'madestock' ? (
        <PaidStockPage company={company} kind="made" />
      ) : tab === 'matlog' ? (
        <MatLogPage company={company} />
      ) : (
        <div className={`mhub-body${strip ? ' is-strip' : ''}`}>
          {/* 호기 칩 줄 — 터치 기기. 번호·호기·타입 + 도급/사급(판금) 점. 끝난 호기는 흐리게 */}
          {strip && (
            <div className="pstrip no-print">
              <div className="pstrip-scroll" ref={stripRef} role="tablist" aria-label="호기">
                {list.map((p, i) => {
                  const st = stateOf(p);
                  const dots = st && st !== 'loading' ? [st.paid, st.free, ...(st.made ? [st.made] : [])] : [];
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="tab"
                      aria-selected={p.id === panelId}
                      className={`pstrip-chip${p.id === panelId ? ' on' : ''}${isDone(p) ? ' is-done' : ''}${
                        p.bomLink?.projectId ? '' : ' no-bom'
                      }`}
                      onClick={() => patch({ panel: p.id })}
                      title={`${nameOf(p)}${p.bomLink?.projectId ? '' : ' · BOM 을 아직 연결하지 않은 호기'}`}
                    >
                      <span className="pstrip-no">{i + 1}</span>
                      <ProjectName name={nameOf(p)} className="pstrip-name" />
                      {p.bomLink?.variantLabel && <span className="pstrip-tag">{p.bomLink.variantLabel}</span>}
                      <span className="pstrip-dots" aria-hidden="true">
                        {dots.map((d, k) => (
                          <i key={k} className={d.cls} title={d.title} />
                        ))}
                      </span>
                    </button>
                  );
                })}
                {list.length === 0 && <span className="mhub-empty">호기가 없습니다</span>}
              </div>
              <div className="pstrip-side">
                {doneCount > 0 && (
                  <button
                    type="button"
                    className={`filter-chip mhub-done-toggle${hideDone ? '' : ' on'}`}
                    onClick={() => setHideDone((v) => !v)}
                    title={hideDone ? `끝난 호기 ${doneCount}대를 감추는 중` : '끝난 호기까지 보이는 중'}
                  >
                    {hideDone ? `끝난 ${doneCount} 숨김` : `끝난 ${doneCount} 표시`}
                  </button>
                )}
                <span className="pstrip-count">
                  {Math.max(0, list.findIndex((p) => p.id === panelId) + 1) || '–'}
                  <em>/ {list.length}</em>
                </span>
              </div>
            </div>
          )}
          {/* 호기 목록 — 마우스 PC 는 왼쪽 세로, 모바일은 위쪽 선택 상자 */}
          {!strip && (
            <aside className="mhub-list no-print">
              <div className="mhub-list-title">
                호기
                {doneCount > 0 && (
                  <button
                    type="button"
                    className={`filter-chip mhub-done-toggle${hideDone ? '' : ' on'}`}
                    onClick={() => setHideDone((v) => !v)}
                    title={hideDone ? `끝난 호기 ${doneCount}대를 감추는 중` : '끝난 호기까지 보이는 중'}
                  >
                    {hideDone ? `끝난 호기 ${doneCount} 숨김` : `끝난 호기 ${doneCount} 표시`}
                  </button>
                )}
              </div>
              <ul>
                {list.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`mhub-item${p.id === panelId ? ' on' : ''}${p.bomLink?.projectId ? '' : ' no-bom'}`}
                      onClick={() => patch({ panel: p.id })}
                      title={p.bomLink?.projectId ? '' : 'BOM 을 아직 연결하지 않은 호기'}
                    >
                      {/* 몇 번째인지 — 긴 목록에서 위치를 잡는다 (2026-09-12 대표님 「앞에 no 표시」) */}
                      <span className="mhub-item-no">{i + 1}</span>
                      <ProjectName name={nameOf(p)} className="mhub-item-name" />
                      {p.bomLink?.variantLabel && <span className="mhub-item-tag">{p.bomLink.variantLabel}</span>}
                      {(() => {
                        const st = stateOf(p);
                        if (!st) return <span className="mhub-item-state is-none">BOM 없음</span>;
                        if (st === 'loading') return <span className="mhub-item-state is-none">…</span>;
                        return (
                          <span className="mhub-item-states">
                            <span className={`mhub-item-state ${st.paid.cls}`} title={st.paid.title}>
                              <b>도급</b>
                              {st.paid.label}
                            </span>
                            <span className={`mhub-item-state ${st.free.cls}`} title={st.free.title}>
                              <b>사급</b>
                              {st.free.label}
                            </span>
                            {st.made && (
                              <span className={`mhub-item-state ${st.made.cls}`} title={st.made.title}>
                                <b>{MADE}</b>
                                {st.made.label}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </button>
                  </li>
                ))}
                {list.length === 0 && <li className="mhub-empty">호기가 없습니다</li>}
              </ul>
            </aside>
          )}
          {!strip && (
            <div className="mhub-pick no-print">
              <Select
                value={panelId}
                onChange={(v) => patch({ panel: v })}
                options={list.map((p) => ({ value: p.id, label: nameOf(p) }))}
                placeholder="호기 선택"
                ariaLabel="호기 선택"
                native
              />
            </div>
          )}
          <div className="mhub-main">
            {panelId ? (
              <PanelMaterialsPage key={panelId} embedded panelId={panelId} />
            ) : (
              <div className="card sht-empty">
                <strong>호기를 고르세요</strong>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
