import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { subscribePanels } from '../../services/productionService';
import { getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import {
  subscribePaidSetSettings,
  savePaidSetSettings,
  subscribeReceivedBySite,
  assignPaidSet,
  unassignPaidSet,
  topUpPaidSet,
} from '../../services/paidSetService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { computeSets, eligiblePanels, groupKey, consumedByItem, panelShortage } from '../../domain/paidSets';

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
  const [settings, setSettings] = useState(null); // null = 아직 안 읽음 (자동 지정 판단용)
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({}); // { projectId: rows[] }
  const [received, setReceived] = useState({ byItem: {}, meta: null }); // 설정한 발주 현장의 입고
  const [sites, setSites] = useState([]);
  const [materials, setMaterials] = useState({}); // { panelId: { box: items } } — 배정 호기가 실제 가져간 양
  useEffect(() => subscribeAllMaterials(setMaterials), []);
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

  // 구매 시작 호기 제한은 뺐다 — BOM 을 연결한 호기 전부, 생산현황 순서대로 (2026-09-04 대표님 「이것도 삭제」)
  const startProject = '';
  // 발주서를 셀 현장 — BOM 프로젝트와는 다른 목록이라 여기서 한 번 고른다
  const siteId = settings?.[company]?.siteId || '';
  // 전역 제외는 두지 않는다 — 기본 BOM 은 그대로, 뺄 것은 호기의 자재 체크 페이지에서 그 호기만 (2026-09-03 대표님)
  const excluded = useMemo(() => [], []);
  useEffect(() => {
    getAllSites()
      .then((rows) => setSites(rows || []))
      .catch(() => setSites([]));
  }, []);
  // 회사 이름이 든 현장(「메티스 프로버」)이 하나뿐이면 자동으로 정한다 — 고를 필요가 없다
  // (2026-09-04 대표님 「메티스 이미 지정인데 선택을 왜 해?」)
  const settingsLoaded = settings !== null;
  useEffect(() => {
    if (!settingsLoaded || siteId || sites.length === 0) return;
    const hits = sites.filter((x) => (x.name || '').includes(company));
    if (hits.length === 1)
      savePaidSetSettings(company, { siteId: hits[0].id, siteName: hits[0].name || '' }).catch(() => {});
  }, [settingsLoaded, siteId, sites, company]);
  const siteName = useMemo(
    () => sites.find((x) => x.id === siteId)?.name || settings?.[company]?.siteName || '',
    [sites, siteId, settings, company],
  );

  const eligible = useMemo(() => eligiblePanels(panels, { company, startProject }), [panels, company, startProject]);

  // 같은 BOM(프로젝트·타입)끼리 묶는다 — 세트는 타입마다 따로.
  // 타입 목록은 이 회사에서 BOM 을 연결한 호기 전부에서 뽑는다(시작 호기 앞 것 포함) —
  // 아직 273 이후 호기에 BOM 을 안 붙였어도 「몇 세트 들어왔나」는 보여야 한다.
  const groups = useMemo(() => {
    const map = new Map();
    const eligibleIds = new Set(eligible.map((p) => p.id));
    for (const p of eligiblePanels(panels, { company, startProject: '' })) {
      const k = groupKey(p);
      if (!map.has(k))
        map.set(k, {
          key: k,
          projectId: p.bomLink.projectId,
          projectName: p.bomLink.projectName || '',
          variantKey: p.bomLink.variantKey || '',
          variantLabel: p.bomLink.variantLabel || '미배정', // 타입을 안 고른 호기 (2026-09-04 대표님 「공통 말고 미배정」)
          panels: [],
        });
      if (eligibleIds.has(p.id)) map.get(k).panels.push(p);
    }
    // 타입을 고른 묶음이 먼저, 타입 미배정은 맨 뒤 (2026-09-04 대표님 「배정된 프로젝트가 먼저」)
    return [...map.values()].sort((a, b) => Number(!a.variantKey) - Number(!b.variantKey));
  }, [panels, company, eligible]);
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
  useEffect(() => {
    if (!siteId) return undefined;
    return subscribeReceivedBySite(siteId, (byItem, meta) => setReceived({ byItem, meta }));
  }, [siteId]);

  // ── 이 묶음의 셈 ──
  const variantRows = useMemo(
    () => (group ? bomItemsForVariant(bomByProject[group.projectId] || [], group.variantKey) : []),
    [group, bomByProject],
  );
  const assignedPanels = useMemo(() => (group ? group.panels.filter((p) => p.paidSet) : []), [group]);
  // 배정 호기들이 실제로 가져간 양 — 「있는 만큼만」 채워 부족이 남았으면 그만큼만 소진으로 센다
  const consumed = useMemo(
    () =>
      consumedByItem(
        variantRows,
        assignedPanels.map((p) => materials[p.id] || {}),
      ),
    [variantRows, assignedPanels, materials],
  );
  const calc = useMemo(
    () =>
      computeSets({
        rows: variantRows,
        receivedByItem: siteId ? received.byItem : {},
        assigned: assignedPanels.length,
        master: masterMap,
        exclude: excluded,
        consumedByItem: consumed,
      }),
    [variantRows, siteId, received, assignedPanels.length, masterMap, excluded, consumed],
  );
  const spareByItem = useMemo(() => Object.fromEntries(calc.items.map((it) => [it.itemId, it.spare])), [calc]);
  // 배정 호기별 부족 — 부족분 채우기 버튼은 모자란 품목에 여유가 생겼을 때만
  const shortageOf = (p) => panelShortage(variantRows, materials[p.id] || {});
  const canTopUp = (p) =>
    shortageOf(p).lines.some((l) => (excluded.includes(l.itemId) ? true : (spareByItem[l.itemId] || 0) > 0));
  const meta = siteId ? received.meta : null;
  // 배정 기준은 발주서에 적힌 세트 수다 — 현장에서 「N세트 발주」로 사 온 것이 그 수.
  // 품목 기준 셈은 「그 세트가 품목까지 다 갖춰졌나」를 보는 보조 숫자.
  const setsByDoc = Math.max(0, (Number(meta?.setCount) || 0) - assignedPanels.length);
  const canAssign = setsByDoc > 0;
  const limiterItem = calc.items.find((x) => x.itemId === calc.limiter);
  const bomLoaded = group ? group.projectId in bomByProject : false;

  const setSite = async (v) => {
    const site = sites.find((x) => x.id === v);
    try {
      await savePaidSetSettings(company, { siteId: v, siteName: site?.name || '' });
    } catch {
      toast('발주서 프로젝트 저장에 실패했습니다', 'error');
    }
  };

  const assign = async (p) => {
    if (!canAssign) {
      toast('남은 세트가 없습니다 — 발주서 입고를 먼저 확인하세요', 'error');
      return;
    }
    setBusy(p.id);
    try {
      const seq = assignedPanels.length + 1;
      const short = await assignPaidSet(p, variantRows, { by, seq, spareByItem, exclude: excluded });
      if (short > 0)
        toast(
          `${p.프로젝트} 에 ${seq}번째 세트를 배정했습니다 — 품목 ${short}줄이 모자라 그 BOX 는 아직 안 켜졌습니다 (부족 집계 확인)`,
          'error',
          0,
        );
      else toast(`${p.프로젝트} 에 ${seq}번째 세트를 배정했습니다 — 자재 도급 칸이 켜졌습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('배정에 실패했습니다', 'error', 0);
    } finally {
      setBusy('');
    }
  };
  const topUp = async (p) => {
    setBusy(p.id);
    try {
      const r = await topUpPaidSet(p, variantRows, { by, spareByItem, exclude: excluded });
      if (r.added === 0) toast('채울 수 있는 여유가 없습니다', 'error');
      else if (r.short > 0) toast(`${r.added}줄을 채웠습니다 — 아직 ${r.short}줄 부족`, 'success');
      else toast(`${r.added}줄을 채웠습니다 — 도급 자재가 다 찼습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('부족분 채우기에 실패했습니다', 'error', 0);
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
            도급 배정 <span className="pmat-title-sub">· {company}</span>
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

      {/* 조건 카드: 발주서 프로젝트 · 시작 호기(좌) · 타입 묶음(우) */}
      <div className="card sht-controls">
        <div className="sht-range">
          <span className="sht-range-label">발주서 프로젝트</span>
          {siteId ? (
            <span className="pset-site">
              {/* 회사마다 발주 현장은 하나라 바꿀 일이 없다 — 「변경」 버튼 없음 (2026-09-04 대표님) */}
              <strong>{siteName || '(이름 없음)'}</strong>
            </span>
          ) : (
            <Select
              value={siteId}
              onChange={setSite}
              options={[
                { value: '', label: '선택 안 함' },
                ...sites.map((x) => ({ value: x.id, label: x.name || x.id })),
              ]}
              placeholder="발주서 프로젝트"
              ariaLabel="발주서를 셀 프로젝트"
              native
            />
          )}
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
          <strong>BOM 을 연결한 호기가 없습니다</strong>
          <span>세트는 호기의 BOM(프로젝트·타입)으로 셉니다 — 생산현황 「상세」에서 BOM 을 연결하세요</span>
        </div>
      ) : (
        <>
          <div className="pmat-link">
            BOM <strong>{group.projectName}</strong>
            <span className={`pmat-variant${group.variantKey ? '' : ' is-common'}`}>{group.variantLabel}</span>
            {!siteId ? (
              <em className="pset-warn"> · 발주서 프로젝트를 고르지 않아 입고를 셀 수 없습니다</em>
            ) : (
              meta && (
                <span className="pset-meta">
                  · 발주서 {meta.purchases}건 · 입고 줄 {meta.lines}건
                  {meta.setCount > 0 && <> · 발주서에 적힌 세트 합 {meta.setCount}</>}
                  {meta.noItem > 0 && <em className="pset-warn"> · 품목 코드 없는 입고 {meta.noItem}줄은 못 셈</em>}
                </span>
              )
            )}
            {calc.unlinked > 0 && <em className="pset-warn"> · BOM 에 품목 미연결 도급 줄 {calc.unlinked}개</em>}
          </div>

          {/* 요약 카드 — 배정 기준은 발주서 세트 수, 품목 기준은 보조 */}
          <div className="admin-stats sht-stats">
            <div className="admin-stat">
              <div className="admin-stat-label">남은 세트</div>
              <div className="admin-stat-value">
                {setsByDoc}
                <span>세트</span>
              </div>
              <div className="admin-stat-sub">
                발주서 기준 {meta?.setCount || 0}세트 입고 − 배정 {assignedPanels.length}
              </div>
            </div>
            <div className={`admin-stat${bomLoaded && calc.sets < setsByDoc ? ' is-warning' : ''}`}>
              <div className="admin-stat-label">품목까지 갖춘 세트</div>
              <div className="admin-stat-value">
                {bomLoaded ? calc.sets : '…'}
                <span>세트</span>
              </div>
              <div className="admin-stat-sub">
                {bomLoaded && calc.sets < setsByDoc
                  ? '일부 품목이 세트 수만큼 안 들어옴'
                  : '모든 품목이 세트 수만큼 있음'}
              </div>
            </div>
            <div
              className={`admin-stat${group.panels.length - assignedPanels.length > setsByDoc ? ' is-warning' : ''}`}
            >
              <div className="admin-stat-label">미배정 호기</div>
              <div className="admin-stat-value">
                {group.panels.length - assignedPanels.length}
                <span>개</span>
              </div>
              <div className="admin-stat-sub">
                {group.panels.length - assignedPanels.length > setsByDoc
                  ? `${group.panels.length - assignedPanels.length - setsByDoc}세트분 더 사야 함`
                  : `호기 ${group.panels.length}개 중 배정 ${assignedPanels.length}`}
              </div>
            </div>
            <div className={`admin-stat${limiterItem && calc.sets < setsByDoc ? ' is-warning' : ''}`}>
              <div className="admin-stat-label">세트를 막는 품목</div>
              <div className="admin-stat-value pset-limiter">
                {limiterItem ? limiterItem.code || limiterItem.name : '—'}
              </div>
              <div className="admin-stat-sub">
                {limiterItem
                  ? `${limiterItem.name} · 여유 ${limiterItem.spare} / 세트당 ${limiterItem.perSet} → ${limiterItem.setsFrom}세트분`
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
                {group.panels.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pset-none">
                      {startProject ? `${startProject} 이후` : '이 회사'} 호기 중 이 BOM 타입을 연결한 것이 없습니다 —
                      생산현황 「상세」에서 BOM 을 연결하면 여기 나옵니다
                    </td>
                  </tr>
                )}
                {group.panels.map((p, i) => (
                  <tr key={p.id} className={p.paidSet ? 'is-done' : ''}>
                    <td className="pmat-no">{i + 1}</td>
                    <td className="pmat-code">{p.프로젝트}</td>
                    <td className="sht-drawing">{p.납기 || ''}</td>
                    <td>
                      {p.paidSet ? (
                        <>
                          <span
                            className={`status-badge ${shortageOf(p).short > 0 ? 'status-badge--progress' : 'status-badge--done'}`}
                          >
                            배정 {p.paidSet.at}
                            {p.paidSet.by ? ` · ${p.paidSet.by}` : ''}
                          </span>
                          {shortageOf(p).short > 0 && (
                            <span className="status-badge status-badge--cancel pset-short-badge">
                              부족 {shortageOf(p).short}줄
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="status-badge status-badge--wait">미배정</span>
                      )}
                    </td>
                    <td className="pmat-num">{p.paidSet ? `${p.paidSet.seq}번째` : ''}</td>
                    <td className="col-action">
                      {p.paidSet ? (
                        <>
                          {shortageOf(p).short > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              disabled={busy === p.id || !canTopUp(p)}
                              title={
                                canTopUp(p)
                                  ? '새로 들어온 여유로 모자란 줄을 채움'
                                  : '모자란 품목에 아직 여유가 없습니다'
                              }
                              onClick={() => topUp(p)}
                            >
                              부족분 채우기
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            disabled={busy === p.id}
                            onClick={() => unassign(p)}
                          >
                            배정 취소
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={busy === p.id || !canAssign || !bomLoaded}
                          title={!canAssign ? '남은 세트가 없습니다' : '세트 하나를 이 호기에'}
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
                    <tr
                      key={it.itemId}
                      className={it.excluded ? 'is-excluded' : it.itemId === calc.limiter ? 'is-partial' : ''}
                    >
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
                          className={`status-badge ${it.excluded ? 'status-badge--wait' : it.setsFrom === calc.sets ? 'status-badge--cancel' : 'status-badge--done'} sht-short`}
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
