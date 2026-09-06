import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import ProjectName from '../../components/common/ProjectName';
import ViewSwitch from '../../components/common/ViewSwitch';
import Select from '../../components/common/Select';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { panelShortageBySupply } from '../../domain/paidSets';
import { COMPANIES } from '../../domain/production';
import PanelMaterialsPage from './PanelMaterialsPage';
import ShortagePage from './ShortagePage';

// 자재 허브 — 호기 자재 체크 · 도급 배정 · 부족 집계를 한 화면의 탭 3개로
// (2026-09-05 대표님 안 B 2단계 「자재 화면 3 → 1」). 옛 주소(/production/:id/materials,
// /production/shortage, /production/paid-sets)는 라우터가 여기로 넘긴다.
//   ?company=메티스&tab=check|paid|shortage&panel=<호기 id>
// 「도급 배정」 탭은 뺐다 — 발주서에 호기를 걸면 입고 때 자동 배정되므로 (2026-09-05 대표님)
const TABS = [
  { value: 'check', label: '호기 체크' },
  { value: 'shortage', label: '부족 집계' },
];

export default function MaterialsHubPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'check';
  const panelId = sp.get('panel') || '';
  const [panels, setPanels] = useState([]);
  useEffect(() => subscribePanels(setPanels), []);
  // 호기 점 색 — 초록: 도급 다 들어옴 · 주황: 배정됐는데 부족 · 없음: 아직 발주에 안 걸림
  const [materials, setMaterials] = useState({});
  const [bomRowsByProject, setBomRowsByProject] = useState({});
  useEffect(() => subscribeAllMaterials(setMaterials), []);

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

  // 호기 목록 — 생산현황 순서 그대로, BOM 을 연결한 호기가 먼저
  const list = useMemo(() => {
    const mine = panels.filter((p) => !p.회사 || p.회사 === company);
    return [...mine.filter((p) => p.bomLink?.projectId), ...mine.filter((p) => !p.bomLink?.projectId)];
  }, [panels, company]);
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
    const rows = bomItemsForVariant(bomRowsByProject[p.bomLink.projectId] || [], p.bomLink.variantKey || '');
    const s = panelShortageBySupply(rows, materials[p.id] || {});
    const one = (kind, k) => {
      if (s[k].total === 0) return { cls: 'is-none', label: '–', title: `${kind} 줄 없음` };
      if (k === 'paid' && !p.paidSet)
        return { cls: 'is-wait', label: '대기', title: '발주서에 이 호기를 걸면 입고 때 채워집니다' };
      return s[k].short > 0
        ? { cls: 'is-short', label: String(s[k].short), title: `${kind} ${s[k].short}줄 부족` }
        : { cls: 'is-ok', label: '완료', title: `${kind} 자재 다 들어옴` };
    };
    return { paid: one('도급', 'paid'), free: one('사급', 'free') };
  };
  const nameOf = (p) => `${p.프로젝트 || ''}${p.호기 ? ` ${p.호기}` : ''}`.trim() || '(이름 없음)';
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

      {tab === 'check' ? (
        <div className="mhub-body">
          {/* 호기 목록 — PC 는 왼쪽 세로, 모바일은 위쪽 선택 상자 */}
          <aside className="mhub-list no-print">
            <div className="mhub-list-title">호기</div>
            <ul>
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`mhub-item${p.id === panelId ? ' on' : ''}${p.bomLink?.projectId ? '' : ' no-bom'}`}
                    onClick={() => patch({ panel: p.id })}
                    title={p.bomLink?.projectId ? '' : 'BOM 을 아직 연결하지 않은 호기'}
                  >
                    <ProjectName name={nameOf(p)} className="mhub-item-name" />
                    {p.bomLink?.variantLabel && <span className="mhub-item-tag">{p.bomLink.variantLabel}</span>}
                    {(() => {
                      const st = stateOf(p);
                      if (!st) return <span className="mhub-item-state is-none">BOM 없음</span>;
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
                        </span>
                      );
                    })()}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="mhub-empty">호기가 없습니다</li>}
            </ul>
          </aside>
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
      ) : (
        <ShortagePage embedded />
      )}
    </div>
  );
}
