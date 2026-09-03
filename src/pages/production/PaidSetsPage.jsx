import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { subscribePanels } from '../../services/productionService';
import { getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import {
  subscribePaidSetSettings,
  savePaidSetSettings,
  subscribeReceivedBySite,
  assignPaidSet,
  unassignPaidSet,
} from '../../services/paidSetService';
import { computeSets, eligiblePanels, groupKey, panelSeq } from '../../domain/paidSets';

// 도급 세트 (2026-09-03 대표님 「메티스 도급 자재를 273호기부터 우리가 구매 — 몇 세트 입고됐고
// 어느 호기에 배정할지」).
//
// 세트 = 한 호기분 도급 BOM. 발주서(프로젝트 = 그 BOM 프로젝트) 입고 합에서 배정한 만큼을 빼고
// 세트당 수량으로 나눈 몫의 최솟값이 「남은 세트」다. 배정하면 그 호기의 도급 줄이 BOM 수량으로
// 채워지고 자재 도급 칸이 켜진다.
export default function PaidSetsPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const company = sp.get('company') || '메티스';
  const by = userProfile?.name || '';

  const [panels, setPanels] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState({});
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({}); // { projectId: rows[] }
  const [receivedBySite, setReceivedBySite] = useState({}); // { projectId: { byItem, meta } }
  const [groupSel, setGroupSel] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(
    () =>
      subscribePanels((rows) => {
        setPanels(rows.filter((p) => !p.회사 || p.회사 === company));
        setLoaded(true);
      }),
    [company],
  );
  useEffect(() => subscribePaidSetSettings(setSettings), []);
  useEffect(() => subscribePurchaseItems(setMaster), []);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  const startProject = settings?.[company]?.startProject || '';
  // 시작 호기 후보 — 이 회사 호기 이름(번호순)
  const projectNames = useMemo(() => {
    const seen = new Set();
    return panels
      .map((p) => (p.프로젝트 || '').trim())
      .filter((n) => n && !seen.has(n) && seen.add(n))
      .sort((a, b) => panelSeq(a) - panelSeq(b) || a.localeCompare(b));
  }, [panels]);

  const eligible = useMemo(() => eligiblePanels(panels, { company, startProject }), [panels, company, startProject]);

  // 같은 BOM(프로젝트·타입)끼리 묶는다 — 세트는 타입마다 따로
  const groups = useMemo(() => {
    const map = new Map();
    for (const p of eligible) {
      const k = groupKey(p);
      if (!map.has(k))
        map.set(k, {
          key: k,
          projectId: p.bomLink.projectId,
          projectName: p.bomLink.projectName || '',
          variantKey: p.bomLink.variantKey || '',
          variantLabel: p.bomLink.variantLabel || '공통',
          panels: [],
        });
      map.get(k).panels.push(p);
    }
    return [...map.values()];
  }, [eligible]);
  const group = groups.find((g) => g.key === groupSel) || groups[0] || null;

  // 묶음마다 BOM 한 번, 발주 입고 구독 한 번
  useEffect(() => {
    const ids = [...new Set(groups.map((g) => g.projectId))].filter((id) => !(id in bomByProject));
    if (ids.length === 0) return undefined;
    let alive = true;
    Promise.all(ids.map((id) => getBomBySite(id).then((rows) => [id, rows || []]))).then((pairs) => {
      if (alive) setBomByProject((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      alive = false;
    };
  }, [groups, bomByProject]);
  const projectIds = useMemo(() => [...new Set(groups.map((g) => g.projectId))].join(','), [groups]);
  useEffect(() => {
    const ids = projectIds ? projectIds.split(',') : [];
    const unsubs = ids.map((id) =>
      subscribeReceivedBySite(id, (byItem, meta) => setReceivedBySite((prev) => ({ ...prev, [id]: { byItem, meta } }))),
    );
    return () => unsubs.forEach((u) => u());
  }, [projectIds]);

  // ── 이 묶음의 셈 ──
  const variantRows = useMemo(
    () => (group ? bomItemsForVariant(bomByProject[group.projectId] || [], group.variantKey) : []),
    [group, bomByProject],
  );
  const assignedPanels = useMemo(() => (group ? group.panels.filter((p) => p.paidSet) : []), [group]);
  const calc = useMemo(
    () =>
      computeSets({
        rows: variantRows,
        receivedByItem: group ? receivedBySite[group.projectId]?.byItem || {} : {},
        assigned: assignedPanels.length,
        master: masterMap,
      }),
    [variantRows, group, receivedBySite, assignedPanels.length, masterMap],
  );
  const meta = group ? receivedBySite[group.projectId]?.meta : null;
  const limiterItem = calc.items.find((x) => x.itemId === calc.limiter);
  const bomLoaded = group ? group.projectId in bomByProject : false;

  const setStart = async (v) => {
    try {
      await savePaidSetSettings(company, { startProject: v });
    } catch {
      toast('시작 호기 저장에 실패했습니다', 'error');
    }
  };

  const assign = async (p) => {
    if (calc.sets <= 0) {
      toast('남은 세트가 없습니다 — 입고를 먼저 확인하세요', 'error');
      return;
    }
    setBusy(p.id);
    try {
      const seq = assignedPanels.length + 1;
      await assignPaidSet(p, variantRows, { by, seq });
      toast(`${p.프로젝트} 에 ${seq}번째 세트를 배정했습니다 — 자재 도급 칸이 켜졌습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('배정에 실패했습니다', 'error', 0);
    } finally {
      setBusy('');
    }
  };
  const unassign = async (p) => {
    if (
      !(await confirm(
        `${p.프로젝트} 의 세트 배정을 취소하시겠습니까? 도급 줄 수량이 0 이 되고 자재 도급 칸이 꺼집니다.`,
      ))
    )
      return;
    setBusy(p.id);
    try {
      await unassignPaidSet(p, variantRows, { by });
      toast(`${p.프로젝트} 배정을 취소했습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('취소에 실패했습니다', 'error', 0);
    } finally {
      setBusy('');
    }
  };

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/production', { replace: true }));

  if (!loaded)
    return (
      <div className="page">
        <p className="text-muted">불러오는 중…</p>
      </div>
    );

  return (
    <div className="page pmat-page pset-page">
      <div className="page-header">
        <div>
          <button type="button" className="btn btn-sm btn-outline" onClick={back}>
            <Icon name="chevronLeft" className="btn-ic" />
            생산현황
          </button>
          <h2 className="page-title pmat-title">
            도급 세트 <span className="pmat-title-sub">· {company}</span>
          </h2>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate(`/production/shortage?company=${encodeURIComponent(company)}`)}
          >
            <Icon name="list" className="btn-ic" />
            부족 집계
          </button>
        </div>
      </div>

      {/* 조건 카드: 시작 호기(좌) · 타입 묶음(우) */}
      <div className="card sht-controls">
        <div className="sht-range">
          <span className="sht-range-label">우리가 구매 시작한 호기</span>
          <Select
            value={startProject}
            onChange={setStart}
            options={[{ value: '', label: '전체 (제한 없음)' }, ...projectNames.map((n) => ({ value: n, label: n }))]}
            placeholder="시작 호기"
            ariaLabel="구매 시작 호기"
            native
          />
        </div>
        {groups.length > 1 && (
          <div className="sht-kinds" role="tablist" aria-label="BOM 타입">
            {groups.map((g) => (
              <button
                key={g.key}
                type="button"
                role="tab"
                aria-selected={group?.key === g.key}
                className={`bom-supply-tab${group?.key === g.key ? ' on' : ''}`}
                onClick={() => setGroupSel(g.key)}
              >
                {g.variantLabel}
                <b>{g.panels.length}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {!group ? (
        <div className="card sht-empty">
          <Icon name="alert" className="sht-empty-ic is-warn" />
          <strong>배정할 호기가 없습니다</strong>
          <span>
            {startProject ? `${startProject} 이후` : '이 회사'} 호기 중 BOM 을 연결한 것이 없습니다 — 생산현황
            「상세」에서 BOM 을 연결하세요
          </span>
        </div>
      ) : (
        <>
          <div className="pmat-link">
            BOM <strong>{group.projectName}</strong>
            <span className={`pmat-variant${group.variantKey ? '' : ' is-common'}`}>{group.variantLabel}</span>
            {meta && (
              <span className="pset-meta">
                · 발주서 {meta.purchases}건 · 입고 줄 {meta.lines}건
                {meta.noItem > 0 && <em className="pset-warn"> · 품목 코드 없는 입고 {meta.noItem}줄은 못 셈</em>}
              </span>
            )}
            {calc.unlinked > 0 && <em className="pset-warn"> · BOM 에 품목 미연결 도급 줄 {calc.unlinked}개</em>}
          </div>

          {/* 요약 카드 */}
          <div className="admin-stats sht-stats">
            <div className="admin-stat">
              <div className="admin-stat-label">남은 세트</div>
              <div className="admin-stat-value">
                {bomLoaded ? calc.sets : '…'}
                <span>세트</span>
              </div>
              <div className="admin-stat-sub">지금 배정할 수 있는 수</div>
            </div>
            <div className="admin-stat">
              <div className="admin-stat-label">배정한 세트</div>
              <div className="admin-stat-value">
                {assignedPanels.length}
                <span>세트</span>
              </div>
              <div className="admin-stat-sub">호기 {group.panels.length}개 중</div>
            </div>
            <div
              className={`admin-stat${group.panels.length - assignedPanels.length > calc.sets ? ' is-warning' : ''}`}
            >
              <div className="admin-stat-label">미배정 호기</div>
              <div className="admin-stat-value">
                {group.panels.length - assignedPanels.length}
                <span>개</span>
              </div>
              <div className="admin-stat-sub">
                {group.panels.length - assignedPanels.length > calc.sets
                  ? `${group.panels.length - assignedPanels.length - calc.sets}세트분 더 사야 함`
                  : '세트가 충분함'}
              </div>
            </div>
            <div
              className={`admin-stat${limiterItem && calc.sets < group.panels.length - assignedPanels.length ? ' is-warning' : ''}`}
            >
              <div className="admin-stat-label">세트를 막는 품목</div>
              <div className="admin-stat-value pset-limiter">
                {limiterItem ? limiterItem.code || limiterItem.name : '—'}
              </div>
              <div className="admin-stat-sub">
                {limiterItem
                  ? `${limiterItem.name} · 여유 ${limiterItem.spare} / 세트당 ${limiterItem.perSet}`
                  : '도급 품목 없음'}
              </div>
            </div>
          </div>

          {/* 호기 배정 */}
          <h3 className="pset-h">호기 배정</h3>
          <div className="table-scroll-x">
            <table className="table pmat-table sht-table pset-panels">
              <colgroup>
                {[48, 200, 120, null, 130, 140].map((w, i) => (
                  <col key={i} style={w ? { width: w } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th scope="col" className="pmat-no">
                    No
                  </th>
                  <th scope="col">호기</th>
                  <th scope="col">판넬납기</th>
                  <th scope="col">배정</th>
                  <th scope="col" className="pmat-num">
                    세트
                  </th>
                  <th scope="col" className="col-action">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {group.panels.map((p, i) => (
                  <tr key={p.id} className={p.paidSet ? 'is-done' : ''}>
                    <td className="pmat-no">{i + 1}</td>
                    <td className="pmat-code">{p.프로젝트}</td>
                    <td className="sht-drawing">{p.납기 || ''}</td>
                    <td>
                      {p.paidSet ? (
                        <span className="status-badge status-badge--done">
                          배정 {p.paidSet.at}
                          {p.paidSet.by ? ` · ${p.paidSet.by}` : ''}
                        </span>
                      ) : (
                        <span className="status-badge status-badge--wait">미배정</span>
                      )}
                    </td>
                    <td className="pmat-num">{p.paidSet ? `${p.paidSet.seq}번째` : ''}</td>
                    <td className="col-action">
                      {p.paidSet ? (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          disabled={busy === p.id}
                          onClick={() => unassign(p)}
                        >
                          배정 취소
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={busy === p.id || calc.sets <= 0 || !bomLoaded}
                          title={calc.sets <= 0 ? '남은 세트가 없습니다' : '세트 하나를 이 호기에'}
                          onClick={() => assign(p)}
                        >
                          세트 배정
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 품목별 입고 */}
          <h3 className="pset-h">품목별 입고 (도급)</h3>
          {calc.items.length === 0 ? (
            <div className="card sht-empty">
              <strong>도급 품목이 없습니다</strong>
              <span>이 BOM 에 도급 줄이 없거나 품목이 연결되지 않았습니다</span>
            </div>
          ) : (
            <div className="table-scroll-x">
              <table className="table pmat-table sht-table pset-items">
                <colgroup>
                  {[48, 130, null, null, 90, 90, 90, 90, 100].map((w, i) => (
                    <col key={i} style={w ? { width: w } : undefined} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="pmat-no">
                      No
                    </th>
                    <th scope="col">코드</th>
                    <th scope="col">품명</th>
                    <th scope="col">규격</th>
                    <th scope="col" className="pmat-num">
                      세트당
                    </th>
                    <th scope="col" className="pmat-num">
                      입고 합
                    </th>
                    <th scope="col" className="pmat-num">
                      배정 소진
                    </th>
                    <th scope="col" className="pmat-num">
                      여유
                    </th>
                    <th scope="col" className="pmat-num">
                      세트분
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calc.items.map((it, i) => (
                    <tr key={it.itemId} className={it.itemId === calc.limiter ? 'is-partial' : ''}>
                      <td className="pmat-no">{i + 1}</td>
                      <td className="pmat-code">{it.code}</td>
                      <td className="sht-name">{it.name}</td>
                      <td className="sht-spec" title={it.spec}>
                        {it.spec}
                      </td>
                      <td className="pmat-num">{it.perSet}</td>
                      <td className="pmat-num">{it.received}</td>
                      <td className="pmat-num">{it.consumed}</td>
                      <td className={`pmat-num${it.spare < 0 ? ' is-short' : ''}`}>{it.spare}</td>
                      <td className="pmat-num">
                        <span
                          className={`status-badge ${it.setsFrom === calc.sets ? 'status-badge--cancel' : 'status-badge--done'} sht-short`}
                        >
                          {it.setsFrom}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
