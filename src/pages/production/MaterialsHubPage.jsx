import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import ViewSwitch from '../../components/common/ViewSwitch';
import Select from '../../components/common/Select';
import { subscribePanels } from '../../services/productionService';
import { COMPANIES } from '../../domain/production';
import PanelMaterialsPage from './PanelMaterialsPage';
import PaidSetsPage from './PaidSetsPage';
import ShortagePage from './ShortagePage';

// 자재 허브 — 호기 자재 체크 · 도급 배정 · 부족 집계를 한 화면의 탭 3개로
// (2026-09-05 대표님 안 B 2단계 「자재 화면 3 → 1」). 옛 주소(/production/:id/materials,
// /production/shortage, /production/paid-sets)는 라우터가 여기로 넘긴다.
//   ?company=메티스&tab=check|paid|shortage&panel=<호기 id>
const TABS = [
  { value: 'check', label: '호기 체크' },
  { value: 'paid', label: '도급 배정' },
  { value: 'shortage', label: '부족 집계' },
];

export default function MaterialsHubPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'check';
  const panelId = sp.get('panel') || '';
  const [panels, setPanels] = useState([]);
  useEffect(() => subscribePanels(setPanels), []);

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
                    <span className="mhub-item-name">{nameOf(p)}</span>
                    {p.bomLink?.variantLabel && <span className="mhub-item-tag">{p.bomLink.variantLabel}</span>}
                    {p.paidSet && <span className="mhub-item-dot" title="도급 세트 배정됨" />}
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
      ) : tab === 'paid' ? (
        <PaidSetsPage embedded />
      ) : (
        <ShortagePage embedded />
      )}
    </div>
  );
}
