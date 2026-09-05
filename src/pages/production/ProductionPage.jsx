import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { getBomProjects, getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { panelShortage } from '../../domain/paidSets';
import Icon from '../../components/common/Icon';
import TrashModal from '../../components/common/TrashModal';
import EditModeButton from '../../components/common/EditModeButton';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { canProduction, isDefectOnly, canEnterProduction } from '../../utils/workspace';
import { monthlyCounts, monthLabel, basisLabel } from '../../domain/monthlyLoad';
import { subscribePanels, addPanel, trashPanel } from '../../services/productionService';
import { backfillNcrFromPanels } from '../../services/qualityRecordService';
import ProductionPanelModal from './ProductionPanelModal';
import ShipPhotoModal from './ShipPhotoModal';
import ProductionImportModal from './ProductionImportModal';
import ProductionMatrix from './ProductionMatrix';
import {
  BUPMOK,
  JAIP,
  COMPANIES,
  TASK_CFG,
  TASK_LABEL,
  OVERALL_CFG,
  OVERALL_ORDER,
  getDday,
  emptyPanel,
  napgiColorOf,
  unresolvedDefectParts,
  jaipRollup,
} from '../../domain/production';
import '../../styles/production.css';

/* ── 공용 조각 (legacy 이식) ── */
function DdayBadge({ date, os }) {
  if (os === '출고숨김') return <span className="badge badge-sm dd-hide">숨김</span>;
  if (os === '출고완료') return <span className="badge badge-sm dd-done">출고</span>;
  if (!date) return <span className="dd-none">-</span>;
  const d = getDday(date);
  const cls = d < 0 ? 'dd-over' : d <= 3 ? 'dd-urgent' : d <= 7 ? 'dd-soon' : 'dd-ok';
  return <span className={`badge badge-sm ${cls}`}>{d < 0 ? `D+${-d}` : d === 0 ? 'D-Day' : `D-${d}`}</span>;
}
function Prog({ val, hasIssue }) {
  const fill = hasIssue ? 'var(--danger)' : val === 100 ? 'var(--success)' : 'var(--primary)';
  return (
    <div className="prog-cell">
      <div className="prog-track">
        <div className="prog-fill" style={{ width: `${val}%`, background: fill }} />
      </div>
      <b style={{ color: fill }}>{val}%</b>
    </div>
  );
}
function Dots({ panel }) {
  const states = BUPMOK.map((b) => (panel.부품상태 || {})[b] || '대기');
  return (
    <div className="parts-mini">
      {states.map((s, i) => (
        <i
          key={i}
          title={`${BUPMOK[i]}: ${TASK_LABEL[s] || s}`}
          style={{ background: (TASK_CFG[s] || TASK_CFG['대기']).dot }}
        />
      ))}
    </div>
  );
}
function JaipDots({ panel }) {
  const st = jaipRollup(panel);
  const n = JAIP.filter((k) => st[k]).length;
  return (
    <div className="jaip-dots">
      {JAIP.map((k) => (
        <i key={k} title={k} className={st[k] ? 'on' : ''} />
      ))}
      <b className={n === JAIP.length ? 'full' : ''}>
        {n}/{JAIP.length}
      </b>
    </div>
  );
}
function OverallBadge({ status }) {
  const c = OVERALL_CFG[status] || OVERALL_CFG['대기중'];
  return (
    <span className="badge" style={{ background: c.bg, color: c.fg }}>
      <span className="dot" style={{ background: c.fg }} />
      {status}
    </span>
  );
}
const mmdd = (d) => (d ? String(d).slice(5) : '-');

/* ── 불량현황 집계 (legacy collectWorkerStats 이식) ── */
function collectWorkerStats(panels) {
  const stats = {};
  panels.forEach((p) => {
    const insp = p.검수 || {};
    const workers = insp.공정작업자 || {};
    BUPMOK.forEach((b) => {
      const worker = workers[b];
      if (!worker) return;
      if (!stats[worker]) stats[worker] = { 담당: 0, 불량건: [] };
      stats[worker].담당++;
      [1, 2].forEach((n) => {
        const sec = insp[`차${n}`]?.공정비고?.[b] || { 항목: [] };
        (sec.항목 || []).forEach((item) => {
          if (!item.내용 && !item.사진) return; // 사진만 있는 불량도 집계
          stats[worker].불량건.push({
            proj: p.프로젝트,
            호기: p.호기,
            공정: b,
            차수: `${n}차`,
            유형: item.유형 || '',
            내용: item.내용 || '(사진 불량)',
            완료: !!item.완료,
          });
        });
      });
    });
  });
  return stats;
}

const VIEWS = ['현황', '불량현황', '통계'];

export default function ProductionPage() {
  const { userProfile, isAdmin } = useAuth();
  const { confirm } = useDialog();
  const navigate = useNavigate();
  const [panels, setPanels] = useState([]);
  // BOM 프로젝트(타입 목록) — 표의 「자재」 칸에서 타입을 고른다 (2026-09-03 대표님)
  const [bomProjects, setBomProjects] = useState([]);
  // 자재 현황 배지 — 호기별 도급 부족 줄 수·미배정 호기 수 (2026-09-05 대표님 「자재 현황으로 직관적인 버튼」)
  const [materials, setMaterials] = useState({}); // { panelId: { box: items } }
  const [bomRowsByProject, setBomRowsByProject] = useState({});
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  useEffect(() => {
    getBomProjects()
      .then((list) => setBomProjects(list || []))
      .catch(() => setBomProjects([]));
  }, []);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('현황');
  const [q, setQ] = useState('');
  const [company, setCompany] = useState(COMPANIES[0]); // 메티스 · 디에이치 (전체 탭 없음 — 대표님 지시)
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [hideShipped, setHideShipped] = useState(true);
  // 순서 이동·선택 삭제 잠금 — 기본은 잠김, 화면을 나가면 다시 잠긴다 (2026-09-03 대표님
  // 「실수로 옮겨버리는 경우가 많아서」)
  const [editMode, setEditMode] = useState(false);
  // 모바일 카드용 선택 삭제 — 데스크탑 표(ProductionMatrix)는 자체 선택을 갖고 있어 별개로 둔다
  // (2026-09-04 대표님 「잠금」 통일)
  const [pick, setPick] = useState(() => new Set());
  const [openId, setOpenId] = useState(null);
  const [openMode, setOpenMode] = useState('info'); // 'info'(기본정보) | 'defect'(부품 불량) | 'ship'(출고사진)
  const [openPart, setOpenPart] = useState(null); // defect 모드일 때 대상 BOX
  const [showImport, setShowImport] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  // 편집 권한과 불량 권한을 나눈다 —
  //   canEdit  : 자재 입고·일정·판넬 추가/삭제까지 (생산·품질 권한자)
  //   canDefect: 불량 확인·조치만 (현장 공용 아이디도 포함)
  const defectOnly = isDefectOnly(userProfile);
  // 공용 아이디는 여러 사람이 함께 쓴다. 계정 이름("공용아이디")으로 남기면 누가 했는지 알 수 없어,
  // 쓰는 사람 이름을 한 번 받아 이 브라우저에 기억해 둔다 (2026-08-22 대표님).
  const [sharedWorker, setSharedWorker] = useState(() => sessionStorage.getItem('wmSharedWorker') || '');
  const [askWorker, setAskWorker] = useState('');
  const workerName = defectOnly ? sharedWorker : userProfile?.name || '';
  function saveWorker(name) {
    const v = String(name || '').trim();
    if (!v) return;
    sessionStorage.setItem('wmSharedWorker', v);
    setSharedWorker(v);
  }
  const allowed = canEnterProduction(userProfile); // 화면에 들어올 수 있는가
  const canEdit = canProduction(userProfile); // 표를 고칠 수 있는가
  const backfilled = useRef(false);
  useEffect(() => {
    if (!allowed) return undefined;
    const unsub = subscribePanels((rows) => {
      setPanels(rows);
      setLoading(false);
      // 연동을 붙이기 전부터 쌓여 있던 불량도 품질보증 부적합 실적에 올린다(최초 1회).
      // 값이 같으면 쓰지 않으므로 두 번째부터는 읽기만 하고 끝난다. 동시 등록 충돌을 피해 관리자에서만.
      if (isAdmin && !backfilled.current) {
        backfilled.current = true;
        backfillNcrFromPanels().catch((e) => console.error('[quality] 소급 연동 실패:', e));
      }
    });
    return unsub;
  }, [allowed, isAdmin]);

  const allNapgi = useMemo(() => [...new Set(panels.map((p) => p.납기).filter(Boolean))], [panels]);

  const filtered = useMemo(() => {
    return panels.filter((p) => {
      const shipped = p.overallStatus === '출고완료' || p.overallStatus === '출고숨김';
      // 회사 미지정 판넬은 어느 탭에서든 표시(유실 방지) — 지정되면 해당 탭에만
      if (p.회사 && p.회사 !== company) return false;
      if (hideShipped && shipped) return false;
      if (urgentOnly && (getDday(p.납기) > 7 || shipped)) return false;
      if (q) {
        const hay = `${p.프로젝트} ${p.호기} ${p.자재} ${p.기구제작} ${p.비고 || ''} ${p.정역}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [panels, q, company, urgentOnly, hideShipped]);

  const openPanel = openId ? panels.find((p) => p.id === openId) : null;

  // 칸별 컨텍스트 모달 진입 — 프로젝트 칸→기본정보, 불량 칸→그 부품 불량
  const openModal = (id, mode = 'info', part = null) => {
    setOpenId(id);
    setOpenMode(mode);
    setOpenPart(part);
  };

  // 표에 빈 줄만 하나 늘린다 — 모달을 띄우지 않는다 (2026-08-12 대표님, 엑셀처럼).
  // 이름·호기는 표에서 바로 쳐 넣으면 된다.
  async function handleAdd() {
    await addPanel(emptyPanel({ 회사: company }));
  }

  async function handleRemove(e, p) {
    e.stopPropagation();
    const name = `${p.프로젝트 || '이 판넬'}${p.호기 ? ` · ${p.호기}` : ''}`;
    if (
      !(await confirm({
        title: '판넬 삭제',
        message: `"${name}"을(를) 삭제할까요?\n삭제해도 휴지통에서 복원할 수 있습니다.`,
      }))
    )
      return;
    await trashPanel(p, userProfile?.name || '');
    if (openId === p.id) setOpenId(null);
  }

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set()); // 잠그면 골라 둔 것도 함께 푼다
      return !v;
    });
  }

  function togglePick(id) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 모바일 카드에서 고른 판넬을 한꺼번에 휴지통으로 (2026-09-04 대표님 「잠금」 통일 — 카드별 삭제 버튼 폐지)
  async function deletePickedMobile() {
    const targets = filtered.filter((p) => pick.has(p.id));
    if (targets.length === 0) return;
    if (
      !(await confirm({
        title: '판넬 삭제',
        message: `고른 판넬 ${targets.length}대를 삭제할까요?\n삭제해도 휴지통에서 복원할 수 있습니다.`,
      }))
    )
      return;
    for (const p of targets) {
      await trashPanel(p, userProfile?.name || '');
    }
    setPick(new Set());
  }

  /* ── 통계 파생 ── */
  const stats = useMemo(() => {
    const target = panels.filter((p) => !p.회사 || p.회사 === company);
    const byStatus = Object.fromEntries(OVERALL_ORDER.map((s) => [s, 0]));
    let urgent = 0;
    for (const p of target) {
      byStatus[p.overallStatus] = (byStatus[p.overallStatus] || 0) + 1;
      const d = getDday(p.납기);
      if (d <= 3 && p.overallStatus !== '출고완료' && p.overallStatus !== '출고숨김') urgent++;
    }
    const active = target.filter((p) => p.overallStatus !== '출고완료' && p.overallStatus !== '출고숨김').length;
    return { byStatus, urgent, active, total: target.length };
  }, [panels, company]);

  const workerStats = useMemo(() => {
    const target = panels.filter((p) => !p.회사 || p.회사 === company);
    return Object.entries(collectWorkerStats(target))
      .filter(([, v]) => v.담당 > 0)
      .map(([name, v]) => {
        const total = v.불량건.length;
        const open = v.불량건.filter((d) => !d.완료).length;
        const rate = v.담당 > 0 ? Math.round((total / v.담당) * 100) : 0;
        // 유형별 건수 — 많은 순. 같은 작업자가 어떤 불량을 반복하는지 한눈에 본다.
        const byType = Object.entries(
          v.불량건.reduce((acc, d) => {
            const k = d.유형 || '유형 미지정';
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {}),
        ).sort((a, b) => b[1] - a[1]);
        return { name, 담당: v.담당, total, open, rate, items: v.불량건, byType };
      })
      .sort((a, b) => b.rate - a.rate || b.open - a.open);
  }, [panels, company]);
  const maxRate = Math.max(...workerStats.map((s) => s.rate), 1);

  // 이 회사 호기가 쓰는 BOM 줄 — 프로젝트마다 한 번
  const companyPanels = useMemo(() => panels.filter((p) => !p.회사 || p.회사 === company), [panels, company]);
  useEffect(() => {
    const ids = [...new Set(companyPanels.map((p) => p.bomLink?.projectId).filter(Boolean))].filter(
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
  }, [companyPanels, bomRowsByProject]);
  const matStatus = useMemo(() => {
    const shortByPanel = {};
    let short = 0;
    let unassigned = 0;
    for (const p of companyPanels) {
      const pid = p.bomLink?.projectId;
      if (!pid || p.출고완료 || p.강제종결) continue;
      // 배정 안 한 호기는 「미배정」이지 「부족」이 아니다 — 부족은 배정된 호기만 센다
      if (!p.paidSet) {
        unassigned += 1;
        continue;
      }
      const rows = bomItemsForVariant(bomRowsByProject[pid] || [], p.bomLink.variantKey || '');
      const n = panelShortage(rows, materials[p.id] || {}).short;
      if (n > 0) {
        shortByPanel[p.id] = n;
        short += n;
      }
    }
    return { shortByPanel, short, unassigned };
  }, [companyPanels, bomRowsByProject, materials]);

  if (userProfile && !allowed) return <Navigate to="/dashboard" replace />;

  // 공용 아이디인데 이름을 아직 안 적었다면 먼저 묻는다.
  // 이름 없이 조치하면 기록에 「공용아이디」만 남아 나중에 누가 했는지 알 수 없다.
  if (defectOnly && !sharedWorker) {
    return (
      <div className="pr-page">
        <div className="pr-worker-ask">
          <h2>작업자 이름</h2>
          <p>공용 아이디입니다. 오늘 쓰시는 분 이름을 적어 주세요. 불량 등록·조치에 이 이름이 남습니다.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveWorker(askWorker);
            }}
          >
            <input
              type="text"
              value={askWorker}
              onChange={(e) => setAskWorker(e.target.value)}
              placeholder="예: 김신혜"
              aria-label="작업자 이름"
              autoFocus
            />
            <button type="submit" className="btn btn-primary" disabled={!askWorker.trim()}>
              시작하기
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="pr-page">
      <div className="page-header">
        <h2>
          생산현황
          {/* 현장 공용 아이디 — 어느 계정으로 보고 있는지만 조용히 알린다 (2026-08-22 대표님) */}
          {defectOnly && (
            <button
              type="button"
              className="pr-shared-tag"
              title="이름을 바꾸려면 누르세요"
              onClick={() => {
                setAskWorker(sharedWorker);
                setSharedWorker('');
              }}
            >
              공용 아이디 · {sharedWorker}
            </button>
          )}
        </h2>
        <div className="page-actions">
          {/* 다른 화면으로 가는 버튼은 툴바가 아니라 머리 줄 (2026-09-05 대표님 UI 기준안) */}
          <button
            type="button"
            className={`btn btn-sm btn-outline mat-status-btn${matStatus.short > 0 ? ' has-short' : ''}`}
            onClick={() =>
              navigate(
                `/production/materials?company=${encodeURIComponent(company)}&tab=${matStatus.short > 0 ? 'shortage' : 'check'}`,
              )
            }
            title={
              matStatus.short > 0 ? `도급 부족 ${matStatus.short}줄 — 부족 집계로` : '부족 없음 — 호기 자재 체크로'
            }
          >
            <Icon name="archive" className="btn-ic" />
            자재 현황
            {matStatus.short > 0 ? (
              <span className="mat-badge is-short">부족 {matStatus.short}</span>
            ) : (
              <span className="mat-badge is-ok">
                <Icon name="check" />
              </span>
            )}
            {matStatus.unassigned > 0 && <span className="mat-badge is-wait">미배정 {matStatus.unassigned}</span>}
          </button>
          {/* 권한자는 적고 고칠 수 있고, 지우는 것만 관리자 (2026-08-12 대표님 — 관리자·권한자 2단계) */}
          {isAdmin && (
            <button className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
              <Icon name="trash" className="btn-ic" />
              휴지통
            </button>
          )}
          {/* 현장 공용 아이디(불량 조치 전용)는 표를 늘리거나 지우지 않는다 */}
          {canEdit && (
            <>
              <button className="btn btn-sm btn-outline" onClick={() => setShowImport(true)}>
                <Icon name="image" className="btn-ic" />
                사진 가져오기
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd}>
                <Icon name="plus" className="btn-ic" />
                판넬 추가
              </button>
              <EditModeButton on={editMode} onToggle={toggleEditMode} />
            </>
          )}
        </div>
      </div>

      {/* 회사 탭 — 메티스 · 디에이치 */}
      <div className="company-tabs">
        {COMPANIES.map((c) => (
          <button key={c} className={`company-tab ${company === c ? 'on' : ''}`} onClick={() => setCompany(c)}>
            {c}
            <b>{panels.filter((p) => (p.회사 || '') === c).length}</b>
          </button>
        ))}
        <ViewSwitch
          className="company-tabs-right"
          options={VIEWS.map((v) => ({ value: v, label: v }))}
          value={view}
          onChange={setView}
          ariaLabel="보기"
        />
      </div>

      {/* 월별 대수 — 회사마다 세는 날이 다르다(메티스=출하, 디에이치=I/O CHECK).
          달은 25일에 끊는다: 26일에 나가는 판넬은 다음 달 몫이다. */}
      {monthlyCounts(panels, company).length > 0 && (
        <div className="pr-month-load">
          <span className="pr-month-load-title">
            월별 대수<em>{basisLabel(company)} 기준 · 25일 마감</em>
          </span>
          {monthlyCounts(panels, company).map(({ month, count }) => (
            <span key={month} className="pr-month-chip">
              {monthLabel(month)}
              <b>{count}</b>
            </span>
          ))}
        </div>
      )}

      {view === '현황' && (
        <>
          <div className="board-toolbar">
            <div className="search-box">
              <Icon name="search" />
              <input placeholder="프로젝트·호기·자재·납입처 검색" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {/* 켜고 끄는 필터 — 세그먼트와 다른 부품 (2026-09-05 대표님 UI 기준안) */}
            <button
              type="button"
              className={`filter-chip${urgentOnly ? ' on' : ''}`}
              onClick={() => setUrgentOnly((v) => !v)}
            >
              긴급 D-7
            </button>
            <button
              type="button"
              className={`filter-chip${hideShipped ? ' on' : ''}`}
              onClick={() => setHideShipped((v) => !v)}
            >
              출고 숨김
            </button>
          </div>

          {loading ? (
            <div className="empty">불러오는 중…</div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <Icon name="list" style={{ width: 40, height: 40 }} />
              <div>표시할 판넬이 없습니다</div>
            </div>
          ) : (
            <>
              <ProductionMatrix
                panels={filtered}
                canEdit={canEdit}
                canDefect={allowed}
                company={company}
                checkerName={workerName}
                onOpen={openModal}
                onRemove={handleRemove}
                onMaterials={(id) =>
                  navigate(`/production/materials?tab=check&panel=${id}&company=${encodeURIComponent(company)}`)
                }
                orderPool={panels.filter((p) => !p.회사 || p.회사 === company)}
                bomProjects={bomProjects}
                editMode={editMode}
                shortByPanel={matStatus.shortByPanel}
              />

              {/* 모바일 카드 */}
              {isAdmin && editMode && pick.size > 0 && (
                <div className="sel-bar">
                  <span className="sel-count">
                    <strong>{pick.size}</strong>대 골랐습니다
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={deletePickedMobile}>
                    <Icon name="trash" className="btn-ic" />
                    선택 삭제
                  </button>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
                    선택 해제
                  </button>
                </div>
              )}
              <div className="board-cards">
                {filtered.map((p) => {
                  const nc = napgiColorOf(allNapgi, p.납기 || '');
                  const d1 = unresolvedDefectParts(p, 1);
                  const d2 = unresolvedDefectParts(p, 2);
                  return (
                    <div
                      key={p.id}
                      className={`card pcard${editMode && pick.has(p.id) ? ' is-checked' : ''}`}
                      style={{ borderLeft: `4px solid ${d1.length || d2.length ? 'var(--danger)' : nc}` }}
                      onClick={() => openModal(p.id, 'info')}
                    >
                      <div className="pcard-top">
                        {/* 잠금 풀고 체크 → 선택 삭제 (2026-09-04 대표님 「잠금」 통일) */}
                        {isAdmin && editMode && (
                          <input
                            type="checkbox"
                            className="sel-check"
                            checked={pick.has(p.id)}
                            onChange={() => togglePick(p.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="삭제할 판넬 고르기"
                            style={{ flexShrink: 0, marginTop: 2 }}
                          />
                        )}
                        <div className="grow">
                          <div className="proj-name">
                            {p.프로젝트 || '—'}
                            {p.bomLink?.projectId && (
                              <button
                                type="button"
                                className="mx-mat-btn"
                                title="구성품 입고 체크 (BOM)"
                                aria-label="구성품 입고 체크"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(
                                    `/production/materials?tab=check&panel=${p.id}&company=${encodeURIComponent(company)}`,
                                  );
                                }}
                              >
                                <Icon name="list" />
                              </button>
                            )}
                          </div>
                          <div className="proj-sub">
                            {p.호기 || '호기 미정'} · {p.정역 || '-'} · {p.기구제작 || '-'} · {p.자재 || '-'}
                          </div>
                        </div>
                        <OverallBadge status={p.overallStatus} />
                      </div>
                      {(d1.length > 0 || d2.length > 0) && (
                        <div className="defect-tags" style={{ marginBottom: 8 }}>
                          {d1.length > 0 && (
                            <span className="dtag d1">
                              <Icon name="alert" className="btn-ic" />
                              1차 {d1.join(', ')}
                            </span>
                          )}
                          {d2.length > 0 && (
                            <span className="dtag d2">
                              <Icon name="alert" className="btn-ic" />
                              2차 {d2.join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                      <Prog val={p.progress} hasIssue={Object.values(p.부품상태 || {}).some((s) => s === '문제')} />
                      <div className="pcard-parts">
                        <Dots panel={p} />
                        <JaipDots panel={p} />
                      </div>
                      <div className="pcard-foot">
                        <span>
                          납기 <b style={{ color: nc }}>{mmdd(p.납기)}</b>
                        </span>
                        <DdayBadge date={p.납기} os={p.overallStatus} />
                        {/* 카드별 삭제 버튼 폐지 — 잠금 풀고 체크 → 선택 삭제 (2026-09-04 대표님 「잠금」 통일) */}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {view === '불량현황' && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <SummaryCard label="작업자" value={workerStats.length} color="var(--primary)" />
            <SummaryCard label="총 불량" value={workerStats.reduce((a, s) => a + s.total, 0)} color="var(--warning)" />
            <SummaryCard label="미조치" value={workerStats.reduce((a, s) => a + s.open, 0)} color="var(--danger)" />
          </div>
          {workerStats.length === 0 ? (
            <div className="empty">
              <Icon name="alert" style={{ width: 40, height: 40 }} />
              <div>작업자가 배정된 공정이 없습니다</div>
              <div style={{ fontSize: 'var(--font-sm)' }}>판넬 상세에서 부품별 작업자를 입력하면 집계됩니다</div>
            </div>
          ) : (
            workerStats.map((s) => {
              const rateColor =
                s.rate >= 50
                  ? 'var(--danger)'
                  : s.rate >= 25
                    ? 'var(--warning)'
                    : s.rate > 0
                      ? '#975a16'
                      : 'var(--success)';
              return (
                <div className="card" key={s.name} style={{ marginBottom: 12, overflow: 'hidden' }}>
                  <div
                    style={{ padding: '14px 16px', borderBottom: s.items.length ? '1px solid var(--border)' : 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <b>{s.name}</b>
                      <span
                        className="badge badge-sm"
                        style={{ background: 'var(--grey-100)', color: 'var(--text-light)' }}
                      >
                        담당 {s.담당}건
                      </span>
                      {s.open > 0 && (
                        <span
                          className="badge badge-sm"
                          style={{ background: 'var(--status-cancel-bg)', color: 'var(--status-cancel-fg)' }}
                        >
                          미조치 {s.open}
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto', fontWeight: 700, color: rateColor }}>불량률 {s.rate}%</span>
                    </div>
                    {s.byType.length > 0 && (
                      <div className="worker-types">
                        {s.byType.map(([t, n]) => (
                          <span key={t} className={`worker-type ${t === '유형 미지정' ? 'is-none' : ''}`}>
                            {t}
                            <b>{n}</b>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="prog-track" style={{ height: 8 }}>
                      <div
                        style={{
                          width: `${Math.max((s.rate / maxRate) * 100, 2)}%`,
                          height: '100%',
                          background: rateColor,
                          borderRadius: 10,
                        }}
                      />
                    </div>
                  </div>
                  {s.items.length > 0 && (
                    <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {s.items.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span
                            className="badge badge-sm"
                            style={{
                              background: d.완료 ? 'var(--status-done-bg)' : 'var(--status-cancel-bg)',
                              color: d.완료 ? 'var(--status-done-fg)' : 'var(--status-cancel-fg)',
                            }}
                          >
                            {d.완료 ? '조치' : '미조치'}
                          </span>
                          <span className={`worker-type sm ${d.유형 ? '' : 'is-none'}`}>{d.유형 || '유형 미지정'}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-sm)' }}>
                            {d.proj} · {d.호기} · {d.공정} · {d.차수}
                          </span>
                          <span style={{ flex: 1, minWidth: 120 }}>{d.내용}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {view === '통계' && (
        <div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <SummaryCard label="전체 판넬" value={stats.total} color="var(--primary)" />
            <SummaryCard label="진행 중" value={stats.active} color="var(--accent)" />
            <SummaryCard label="긴급(D-3)" value={stats.urgent} color="var(--danger)" />
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 'var(--font-lg)', fontWeight: 600, marginBottom: 14 }}>종합상태 분포</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {OVERALL_ORDER.map((s) => {
                const n = stats.byStatus[s] || 0;
                const pct = stats.total ? Math.round((n / stats.total) * 100) : 0;
                const c = OVERALL_CFG[s];
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ width: 68, fontSize: 'var(--font-base)', color: 'var(--text-light)' }}>{s}</div>
                    <div className="prog-track" style={{ flex: 1, height: 10 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: c.fg, borderRadius: 10 }} />
                    </div>
                    <b style={{ width: 28, textAlign: 'right' }}>{n}</b>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 출고사진 — 표의 「출고사진」 칸을 누르면 그 박스 다섯 면을 등록·확인한다 */}
      {openPanel && openMode === 'ship' && (
        <ShipPhotoModal
          panel={openPanel}
          box={openPart}
          canEdit={allowed}
          checkerName={workerName}
          onClose={() => setOpenId(null)}
        />
      )}
      {openPanel && openMode !== 'ship' && (
        <ProductionPanelModal
          panel={openPanel}
          panels={panels}
          mode={openMode}
          part={openPart}
          canEdit={canEdit}
          canDefect={allowed}
          checkerName={workerName}
          onClose={() => setOpenId(null)}
        />
      )}
      {showImport && <ProductionImportModal company={company} onClose={() => setShowImport(false)} />}
      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['productionPanels']}
        title="생산현황 휴지통"
      />
    </div>
  );
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>{label}</div>
      <div
        style={{
          fontSize: 'var(--font-2xl)',
          fontWeight: 700,
          color,
          marginTop: 'var(--space-1)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  );
}
