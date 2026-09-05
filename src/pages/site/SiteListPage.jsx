import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import {
  getAllSites,
  getSitesByManager,
  getSite,
  getFinanceItems,
  getClosingItems,
  createSite,
  updateSite,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import EditModeButton from '../../components/common/EditModeButton';
import { useDialog } from '../../components/common/useDialog';
import Skeleton from '../../components/common/Skeleton';
import { PROJECT_ICONS, getProjectIcon } from '../../config/projectIcons';
import TrashModal from '../../components/common/TrashModal';
import { trashGeneric, restoreTrashItem } from '../../services/trashService';
import { useUndo } from '../../contexts/useUndo';
import { ensureProjectFolders, organizeOrderHistory } from '../../services/fileLibraryService';

const TYPE_LABELS = { recurring: '양산', once: '단발' };
const CS_BADGE_LABEL = 'CS';
const STATUS_LABELS = { active: '진행 중', completed: '완료' };

// 아이콘 배경색 팔레트 — { key, label, bg, fg }
const ICON_COLORS = [
  { key: '', label: '기본', bg: '', fg: '' },
  { key: 'amber', label: '앰버', bg: '#fef3c7', fg: '#92400e' },
  { key: 'sky', label: '스카이', bg: '#e0f2fe', fg: '#075985' },
  { key: 'green', label: '그린', bg: '#dcfce7', fg: '#166534' },
  { key: 'rose', label: '로즈', bg: '#ffe4e6', fg: '#9f1239' },
  { key: 'violet', label: '바이올렛', bg: '#ede9fe', fg: '#5b21b6' },
  { key: 'teal', label: '틸', bg: '#ccfbf1', fg: '#115e59' },
  { key: 'slate', label: '슬레이트', bg: '#e2e8f0', fg: '#334155' },
];
function getIconColor(key) {
  return ICON_COLORS.find((c) => c.key === key) || ICON_COLORS[0];
}

export default function SiteListPage() {
  const { userProfile, isAdmin, canViewSalary, canCreateSite } = useAuth();
  const { confirm, toast } = useDialog();
  const { push: pushUndo } = useUndo();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [departments, setDepartments] = useState([]);
  const [siteStats, setSiteStats] = useState({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const urlY = Number(searchParams.get('y'));
  const urlM = Number(searchParams.get('m'));
  const year = urlY >= 2024 && urlY <= 2030 ? urlY : now.getFullYear();
  const month = urlM >= 1 && urlM <= 12 ? urlM : now.getMonth() + 1;
  function updateParams(next) {
    const merged = {
      ...(searchParams.get('filter') ? { filter: searchParams.get('filter') } : {}),
      ...(searchParams.get('y') ? { y: searchParams.get('y') } : {}),
      ...(searchParams.get('m') ? { m: searchParams.get('m') } : {}),
      ...next,
    };
    Object.keys(merged).forEach((k) => {
      if (merged[k] === '' || merged[k] == null) delete merged[k];
    });
    setSearchParams(merged, { replace: false });
  }
  const setYear = (v) => updateParams({ y: String(v) });
  const setMonth = (v) => updateParams({ m: String(v) });
  const filter = searchParams.get('filter') || 'all';
  const setFilter = (val) => updateParams({ filter: val === 'all' ? '' : val });

  // 프로젝트 추가/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [editSite, setEditSite] = useState(null);
  const [syncingFolders, setSyncingFolders] = useState(false);
  const [form, setForm] = useState({
    name: '',
    team: '',
    managerIds: [],
    projectType: 'recurring',
    status: 'active',
    startYear: null,
    startMonth: null,
    endYear: null,
    endMonth: null,
    mirrorFromSiteIds: [],
    hideRevenue: false,
    isCS: false,
  });
  const [managerListOpen, setManagerListOpen] = useState(false);
  const [mirrorListOpen, setMirrorListOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  // 잠금 토글 — 기본 잠김. 풀면 체크박스 + 선택 삭제 (2026-09-04 대표님 「잠금」 통일)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set());

  useEffect(() => {
    if (!userProfile) return;
    (async () => {
      await loadData();
    })();
  }, [userProfile, year, month, isAdmin]);

  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => {
      if (!e.target.closest('.site-row-actions')) setOpenMenuId(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  async function loadData() {
    setLoading(true);
    try {
      const [list, userList, deptList] = await Promise.all([
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        getUsers(),
        getDepartments(),
      ]);
      setSites(list);
      setUsers(userList);
      setDepartments(deptList);
      const uMap = Object.fromEntries(userList.map((u) => [u.uid, u]));
      setUserMap(uMap);

      const isOvertimeItem = (f) => {
        const d = (f.description || '').trim();
        return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-');
      };

      // 미러 소스 중 list에 없는 사이트들도 통계용으로 추가 조회 (팀장이 담당하지 않는 합산 대상 포함)
      const listIds = new Set(list.map((x) => x.id));
      const missingMirrorIds = new Set();
      for (const s of list) {
        for (const srcId of s.mirrorFromSiteIds || []) {
          if (!listIds.has(srcId)) missingMirrorIds.add(srcId);
        }
      }
      const extraMirrorSites =
        missingMirrorIds.size > 0
          ? (await Promise.all([...missingMirrorIds].map((id) => getSite(id).catch(() => null)))).filter(Boolean)
          : [];
      const statsList = [...list, ...extraMirrorSites];

      // 1단계: 모든 대상 사이트(담당 + 미러 소스) 자체 finance/공수 집계
      const rawStats = {};
      await Promise.all(
        statsList.map(async (s) => {
          const [fins, items] = await Promise.all([
            getFinanceItems(s.id, year, month),
            getClosingItems(s.id, year, month),
          ]);
          const revenue = fins.filter((f) => f.type === 'revenue').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const expense = fins
            .filter((f) => f.type === 'expense' && !isOvertimeItem(f))
            .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const overtime = fins
            .filter((f) => f.type === 'expense' && isOvertimeItem(f))
            .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
          const labor = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
          rawStats[s.id] = { revenue, expense, overtime, labor };
        }),
      );

      // 2단계: mirrorFromSiteIds로 지출 합산 (미러 소스의 expense + overtime + labor 을 타겟의 expense에 추가)
      const stats = {};
      for (const s of list) {
        const own = rawStats[s.id] || { revenue: 0, expense: 0, overtime: 0, labor: 0 };
        let mirroredExpense = 0;
        for (const srcId of s.mirrorFromSiteIds || []) {
          const src = rawStats[srcId];
          if (src) mirroredExpense += (src.expense || 0) + (src.overtime || 0) + (src.labor || 0);
        }
        stats[s.id] = { ...own, expense: own.expense + mirroredExpense };
      }
      setSiteStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // 해당 월에 실적(매출/지출/공수) 데이터가 있는지 판별
  const hasMonthData = (s) => {
    const v = siteStats[s.id];
    if (!v) return false;
    return (v.revenue || 0) > 0 || (v.expense || 0) > 0 || (v.overtime || 0) > 0 || (v.labor || 0) > 0;
  };

  // 선택한 년/월이 프로젝트 시작 월 이전인지
  const isBeforeStart = (s) => {
    if (!s.startYear || !s.startMonth) return false;
    if (year < s.startYear) return true;
    if (year === s.startYear && month < s.startMonth) return true;
    return false;
  };

  // 선택한 년/월이 프로젝트 마감 월 이후인지
  const isAfterEnd = (s) => {
    if (!s.endYear || !s.endMonth) return false;
    if (year > s.endYear) return true;
    if (year === s.endYear && month > s.endMonth) return true;
    return false;
  };

  // 필터링된 프로젝트
  const filtered = sites.filter((s) => {
    if (isBeforeStart(s)) return false;
    const st = s.status || 'active';
    const pt = s.projectType || 'recurring';

    if (st === 'completed') {
      if (isAfterEnd(s)) return false;
      if (filter === 'completed') return true;
      return filter === 'all' && hasMonthData(s);
    }

    // 활성 프로젝트: 마감 월 이후 숨김
    if (isAfterEnd(s)) return false;
    if (filter === 'completed') return false;
    if (pt === 'once') return true;
    if (filter === 'recurring') return pt === 'recurring';
    if (filter === 'once') return pt === 'once';
    return true;
  });

  const filterCounts = {
    all: sites.filter((s) => {
      if (isBeforeStart(s)) return false;
      const st = s.status || 'active';
      if (st === 'completed') return hasMonthData(s);
      if (isAfterEnd(s)) return false;
      return true;
    }).length,
    recurring: sites.filter(
      (s) =>
        !isBeforeStart(s) &&
        !isAfterEnd(s) &&
        (s.projectType || 'recurring') === 'recurring' &&
        (s.status || 'active') === 'active',
    ).length,
    once: sites.filter(
      (s) => !isBeforeStart(s) && !isAfterEnd(s) && s.projectType === 'once' && (s.status || 'active') === 'active',
    ).length,
    completed: sites.filter((s) => !isBeforeStart(s) && !isAfterEnd(s) && s.status === 'completed').length,
  };

  function managerNameArr(site) {
    const ids = site.managerIds || [];
    return ids.map((uid) => userMap[uid]?.name).filter(Boolean);
  }

  function periodLabel(site) {
    const sy = site.startYear;
    const sm = site.startMonth;
    const ey = site.endYear;
    const em = site.endMonth;
    if (!sy) return '';
    let label = `${sy}.${String(sm).padStart(2, '0')}~`;
    if (ey) label += `${ey}.${String(em).padStart(2, '0')}`;
    return label;
  }

  // --- 프로젝트 CRUD ---
  function openCreate() {
    setEditSite(null);
    setForm({
      name: '',
      team: '',
      managerIds: [],
      projectType: 'recurring',
      status: 'active',
      startYear: year,
      startMonth: month,
      endYear: null,
      endMonth: null,
      mirrorFromSiteIds: [],
      hideRevenue: false,
      isCS: false,
      icon: '',
      iconColor: '',
    });
    setManagerListOpen(false);
    setMirrorListOpen(false);
    setShowModal(true);
  }

  function openEdit(site) {
    setEditSite(site);
    setForm({
      name: site.name,
      team: site.team || '',
      managerIds: site.managerIds || [],
      projectType: site.projectType || 'recurring',
      status: site.status || 'active',
      startYear: site.startYear || null,
      startMonth: site.startMonth || null,
      endYear: site.endYear || null,
      endMonth: site.endMonth || null,
      mirrorFromSiteIds: site.mirrorFromSiteIds || [],
      hideRevenue: !!site.hideRevenue,
      isCS: !!site.isCS,
      icon: site.icon || '',
      iconColor: site.iconColor || '',
    });
    setManagerListOpen(false);
    setMirrorListOpen(false);
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editSite) {
        await updateSite(editSite.id, { ...form });
      } else {
        await createSite({ ...form });
        // 신규 프로젝트 → 자료실에 표준 폴더(발주이력/자료/견적/BOM) 자동 생성
        ensureProjectFolders(form.name, userProfile).catch((err) =>
          console.warn('[자료실] 프로젝트 폴더 생성 실패:', err),
        );
      }
      setShowModal(false);
      await loadData();
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // 기존 모든 프로젝트의 자료실 표준 폴더를 일괄 생성·동기화 (idempotent)
  async function handleSyncFolders() {
    if (
      !(await confirm(
        '모든 프로젝트의 자료실 폴더(발주이력·자료·견적·BOM)를 생성·동기화할까요?\n이미 있는 폴더는 그대로 두고 빠진 것만 만듭니다.',
      ))
    )
      return;
    setSyncingFolders(true);
    try {
      const all = await getAllSites();
      let ok = 0;
      for (const s of all) {
        try {
          await ensureProjectFolders(s.name, userProfile);
          ok++;
        } catch (err) {
          console.warn('[자료실] 폴더 동기화 실패:', s.name, err);
        }
      }
      // 기존 발주이력 파일을 발주월 폴더로 일괄 정리
      let movedMsg = '';
      try {
        const moved = await organizeOrderHistory(userProfile);
        if (moved > 0) movedMsg = `\n발주서 ${moved}건을 월별 폴더로 정리했습니다.`;
      } catch (err) {
        console.warn('[자료실] 발주이력 월별 정리 실패:', err);
      }
      toast(`${ok}/${all.length}개 프로젝트의 자료실 폴더를 동기화했습니다.${movedMsg}`);
    } catch {
      toast('동기화 중 오류가 발생했습니다', 'error');
    } finally {
      setSyncingFolders(false);
    }
  }

  // 프로젝트 하나를 휴지통으로 — deletePicked가 항목마다 호출한다
  async function trashSite(site) {
    const tid = await trashGeneric('sites', site.id, { title: site.name }, userProfile?.name || '');
    if (tid)
      pushUndo(`프로젝트 "${site.name}" 삭제`, async () => {
        await restoreTrashItem(tid);
        await loadData();
      });
  }

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set());
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

  // 고른 프로젝트를 한꺼번에 — 확인 한 번 후 trashSite로 하나씩 보낸다
  async function deletePicked() {
    const targets = sites.filter((s) => pick.has(s.id));
    if (targets.length === 0) return;
    if (
      !(await confirm(
        `고른 프로젝트 ${targets.length}건을 휴지통으로 이동하시겠습니까?\n(기존 마감 데이터는 남습니다)`,
      ))
    )
      return;
    try {
      for (const s of targets) await trashSite(s);
      setPick(new Set());
      await loadData();
      toast(`${targets.length}건을 휴지통으로 옮겼습니다.`);
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleToggleStatus(site, e) {
    e.preventDefault();
    e.stopPropagation();
    const next = (site.status || 'active') === 'active' ? 'completed' : 'active';
    const msg =
      next === 'completed'
        ? `"${site.name}" 프로젝트를 완료 처리하시겠습니까?`
        : `"${site.name}" 프로젝트를 다시 활성화하시겠습니까?`;
    if (!(await confirm(msg))) return;
    try {
      await updateSite(site.id, { status: next });
      await loadData();
    } catch {
      toast('상태 변경 중 오류가 발생했습니다', 'error');
    }
  }

  function toggleManager(uid) {
    setForm((f) => ({
      ...f,
      managerIds: f.managerIds.includes(uid) ? f.managerIds.filter((x) => x !== uid) : [...f.managerIds, uid],
    }));
  }

  function toggleMirrorSite(sid) {
    setForm((f) => ({
      ...f,
      mirrorFromSiteIds: f.mirrorFromSiteIds.includes(sid)
        ? f.mirrorFromSiteIds.filter((x) => x !== sid)
        : [...f.mirrorFromSiteIds, sid],
    }));
  }

  // 퇴사자는 앞으로 고르는 자리에 나오지 않는다 (과거 기록의 이름은 그대로 남는다)
  const candidates = users.filter((u) => u.role !== 'admin' && u.isActive !== false);

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="site-list-page">
      {/* 필터 탭 (제목 위 — 상단 탭 표준) */}
      <div className="tab-nav">
        {[
          { key: 'all', label: '전체' },
          { key: 'recurring', label: '양산' },
          { key: 'once', label: '단발' },
          { key: 'completed', label: '완료' },
        ].map((t) => (
          <button
            key={t.key}
            className={`tab-nav-item ${filter === t.key ? 'active' : ''}`}
            onClick={() => setFilter(t.key)}
          >
            {t.label}{' '}
            {filterCounts[t.key] > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{filterCounts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="page-header">
        <h2>프로젝트</h2>
        {(isAdmin || canCreateSite) && (
          <div className="page-actions">
            {isAdmin && (
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={handleSyncFolders}
                disabled={syncingFolders}
              >
                <Icon name="folder" className="btn-ic" />
                {syncingFolders ? '동기화 중…' : '자료실 폴더 동기화'}
              </button>
            )}
            {isAdmin && (
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
                <Icon name="trash" className="btn-ic" />
                휴지통
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={openCreate}>
              <Icon name="plus" className="btn-ic" />
              프로젝트 추가
            </button>
            {isAdmin && <EditModeButton on={editMode} onToggle={toggleEditMode} />}
          </div>
        )}
      </div>

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYear(Number(v))}
          options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="년 선택"
        />
        <Select
          value={month}
          onChange={(v) => setMonth(Number(v))}
          options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
      </div>

      {(isAdmin || canViewSalary) &&
        filtered.length > 0 &&
        (() => {
          const allRevenue = filtered.reduce((s, site) => {
            if (site.hideRevenue) return s;
            return s + ((siteStats[site.id] || {}).revenue || 0);
          }, 0);
          const allExpense = filtered.reduce((s, site) => {
            const v = siteStats[site.id] || {};
            const ov = canViewSalary ? v.overtime || 0 : 0;
            const lb = canViewSalary ? v.labor || 0 : 0;
            return s + (v.expense || 0) + ov + lb;
          }, 0);
          const allBalance = allRevenue - allExpense;
          return (
            <div
              className="total-summary-bar"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginBottom: 8,
                ...(typeof window !== 'undefined' && window.innerWidth <= 360
                  ? { flexDirection: 'column', gap: 2 }
                  : {}),
              }}
            >
              <div className="total-summary-item" style={{ flex: '1 1 auto' }}>
                <span className="label">{filter === 'completed' ? '누적 매출' : '전체 매출'}</span>
                <strong
                  className="stat-revenue"
                  style={{ color: 'var(--primary, #002050)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {allRevenue.toLocaleString()}원
                </strong>
              </div>
              <div className="total-summary-item" style={{ flex: '1 1 auto' }}>
                <span className="label">{filter === 'completed' ? '누적 지출' : '전체 지출'}</span>
                <strong
                  className="stat-expense"
                  style={{ color: 'var(--primary, #002050)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {allExpense.toLocaleString()}원
                </strong>
              </div>
              <div className="total-summary-item" style={{ flex: '1 1 auto' }}>
                <span className="label">합계</span>
                <strong
                  className={allBalance >= 0 ? 'stat-balance positive' : 'stat-balance negative'}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {allBalance.toLocaleString()}원
                </strong>
              </div>
            </div>
          );
        })()}

      {editMode && pick.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">
            <strong>{pick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={deletePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">
            {filter === 'completed'
              ? '완료된 프로젝트가 없습니다.'
              : isAdmin
                ? '등록된 프로젝트가 없습니다. 상단 "프로젝트 추가" 버튼으로 추가하세요.'
                : '담당 프로젝트가 없습니다. 관리자에게 문의해주세요.'}
          </div>
        </div>
      ) : (
        <div className="site-list">
          {[...filtered]
            .sort((a, b) => {
              // 핀 고정 카드 — 항상 최상단, 정의된 순서대로 (띄어쓰기 변형 모두 매칭)
              const PINNED = ['본사업무', '프로버지원'];
              const normalize = (s) => (s || '').replace(/\s+/g, '');
              const aPin = PINNED.indexOf(normalize(a.name));
              const bPin = PINNED.indexOf(normalize(b.name));
              if (aPin !== -1 && bPin !== -1) return aPin - bPin;
              if (aPin !== -1) return -1;
              if (bPin !== -1) return 1;
              return 0;
            })
            .map((s) => {
              const pt = s.projectType || 'recurring';
              const st = s.status || 'active';
              const hideRev = !!s.hideRevenue;
              const period = periodLabel(s);

              // 단발성: 전체 누적 통계 / 양산: 선택 월 통계
              const raw = siteStats[s.id] || { revenue: 0, expense: 0, overtime: 0, labor: 0 };
              const overtimeShown = canViewSalary ? raw.overtime || 0 : 0;
              const laborShown = canViewSalary ? raw.labor : 0;
              const expenseOnly = raw.expense + overtimeShown;
              const totalExpense = expenseOnly + laborShown;
              const revenueShown = hideRev ? 0 : raw.revenue;
              const balance = revenueShown - totalExpense;
              // 흑자/적자 색 표식용은 권한 무관하게 전체 데이터로 계산 (숫자 자체는 비공개여도 부호는 표시)
              const fullBalance =
                (hideRev ? 0 : raw.revenue || 0) - ((raw.expense || 0) + (raw.overtime || 0) + (raw.labor || 0));

              const checked = pick.has(s.id);
              return (
                <div key={s.id} className={`site-row-wrapper${checked ? ' is-checked' : ''}`}>
                  {isAdmin && editMode && (
                    <div
                      style={{ position: 'absolute', top: 6, left: 6, zIndex: 3 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="sel-check"
                        checked={checked}
                        onChange={() => togglePick(s.id)}
                        aria-label="삭제할 프로젝트 고르기"
                      />
                    </div>
                  )}
                  <Link
                    to={`/sites/${s.id}/${year}/${month}`}
                    className={`site-row ${st === 'completed' ? 'site-row-completed' : ''} ${!hideRev ? (fullBalance >= 0 ? 'site-row-balance-pos' : 'site-row-balance-neg') : ''}`}
                    style={checked ? { background: 'var(--primary-softer, #f0f3f8)' } : undefined}
                  >
                    <div
                      className="site-row-icon site-row-icon-responsive"
                      style={(() => {
                        const c = getIconColor(s.iconColor);
                        return {
                          width: 44,
                          height: 44,
                          flexShrink: 0,
                          ...(c.bg ? { background: c.bg, color: c.fg } : {}),
                        };
                      })()}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        {(() => {
                          const customIcon = s.icon ? getProjectIcon(s.icon) : null;
                          if (customIcon) return customIcon.paths;
                          return pt === 'once' ? (
                            <>
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                              <line x1="16" y1="13" x2="8" y2="13" />
                              <line x1="16" y1="17" x2="8" y2="17" />
                            </>
                          ) : (
                            <>
                              <path d="M3 21h18" />
                              <path d="M5 21V7l7-4 7 4v14" />
                              <path d="M9 9h.01" />
                              <path d="M9 13h.01" />
                              <path d="M9 17h.01" />
                              <path d="M15 9h.01" />
                              <path d="M15 13h.01" />
                              <path d="M15 17h.01" />
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    <div className="site-row-body">
                      <div className="site-row-name">
                        <span
                          className="site-row-name-text"
                          title={s.name}
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'keep-all',
                            overflowWrap: 'anywhere',
                            minWidth: 0,
                          }}
                        >
                          {s.name}
                        </span>
                      </div>
                      <div className="site-row-badges">
                        <span className={`site-type-badge site-type-${pt}`}>{TYPE_LABELS[pt]}</span>
                        {s.isCS && (
                          <span className="site-type-badge site-type-cs" title="CS업무: 매일 다른 현장 방문">
                            {CS_BADGE_LABEL}
                          </span>
                        )}
                        {st === 'completed' && (
                          <span className="site-status-badge site-status-completed">{STATUS_LABELS[st]}</span>
                        )}
                        <span
                          className="chip chip-team"
                          title={s.team || '팀 미지정'}
                          style={{ padding: '2px 6px', minWidth: 0 }}
                        >
                          {s.team || '팀 미지정'}
                        </span>
                      </div>
                      <div className="site-row-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, minWidth: 0 }}>
                        {managerNameArr(s).length > 0 ? (
                          managerNameArr(s).map((name) => (
                            <span
                              key={name}
                              className="chip chip-manager"
                              title={name}
                              style={{ padding: '2px 6px', whiteSpace: 'nowrap' }}
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="chip chip-manager" style={{ padding: '2px 6px' }}>
                            담당 미지정
                          </span>
                        )}
                        {period && (
                          <span className="chip chip-period" title={period} style={{ padding: '2px 6px' }}>
                            {period}
                          </span>
                        )}
                      </div>
                    </div>
                    {(canViewSalary || isAdmin) && (st !== 'completed' || hasMonthData(s)) && (
                      <div className="site-row-stats-panel site-row-stats-responsive">
                        {!hideRev && (
                          <div className="stat-row" style={{ minHeight: 24, display: 'flex', alignItems: 'center' }}>
                            <span>매출</span>
                            <strong
                              className="stat-revenue"
                              style={{
                                textAlign: 'right',
                                color: 'var(--primary, #002050)',
                                fontVariantNumeric: 'tabular-nums',
                                lineHeight: 1,
                              }}
                            >
                              {raw.revenue.toLocaleString()}원
                            </strong>
                          </div>
                        )}
                        <div className="stat-row" style={{ minHeight: 24, display: 'flex', alignItems: 'center' }}>
                          <span>지출</span>
                          <strong
                            className="stat-expense"
                            style={{
                              textAlign: 'right',
                              color: 'var(--primary, #002050)',
                              fontVariantNumeric: 'tabular-nums',
                              lineHeight: 1,
                            }}
                          >
                            {expenseOnly.toLocaleString()}원
                          </strong>
                        </div>
                        {canViewSalary && raw.labor > 0 && (
                          <div
                            className="stat-row stat-row-labor-hide"
                            style={{ minHeight: 24, display: 'flex', alignItems: 'center' }}
                          >
                            <span>인건비</span>
                            <strong
                              className="stat-expense"
                              style={{
                                textAlign: 'right',
                                color: 'var(--primary, #002050)',
                                fontVariantNumeric: 'tabular-nums',
                                lineHeight: 1,
                              }}
                            >
                              {raw.labor.toLocaleString()}원
                            </strong>
                          </div>
                        )}
                        {!hideRev && (
                          <div
                            className="stat-row stat-balance-row"
                            style={{ minHeight: 24, display: 'flex', alignItems: 'center' }}
                          >
                            <span>합계</span>
                            <strong
                              className={`stat-balance ${balance >= 0 ? 'positive' : 'negative'}`}
                              style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
                            >
                              {balance >= 0 ? '+' : ''}
                              {balance.toLocaleString()}원
                            </strong>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="site-row-period">
                      <div className="period-y">{year}</div>
                      <div className="period-m">{String(month).padStart(2, '0')}월</div>
                    </div>
                    <div className="site-row-arrow" style={{ flexShrink: 0 }}>
                      <Icon name="chevronRight" size={16} />
                    </div>
                  </Link>
                  {isAdmin && (
                    <div className="site-row-actions">
                      <button
                        type="button"
                        className="site-row-menu-btn"
                        aria-label="관리 메뉴"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === s.id ? null : s.id);
                        }}
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>
                      {openMenuId === s.id && (
                        <div
                          className="site-row-menu"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <button
                            type="button"
                            className="site-row-menu-item"
                            style={{
                              minHeight: 36,
                              padding: '8px 12px',
                              fontSize: 13,
                              lineHeight: 1.2,
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setOpenMenuId(null);
                              openEdit(s);
                            }}
                          >
                            수정
                          </button>
                          {st === 'completed' && (
                            <button
                              type="button"
                              className="site-row-menu-item"
                              style={{
                                minHeight: 36,
                                padding: '8px 12px',
                                fontSize: 13,
                                lineHeight: 1.2,
                                display: 'flex',
                                alignItems: 'center',
                              }}
                              onClick={(e) => {
                                setOpenMenuId(null);
                                handleToggleStatus(s, e);
                              }}
                            >
                              재활성
                            </button>
                          )}
                          {/* 행별 삭제는 뺐다 — 「잠금」 풀고 체크 → 선택 삭제 (2026-09-04 대표님 「잠금」 통일) */}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['sites']}
        title="프로젝트 휴지통"
        onChange={() => loadData()}
      />

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editSite ? '프로젝트 수정' : '프로젝트 추가'}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>프로젝트명 *</label>
            <input
              aria-label="프로젝트명"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>팀</label>
            <Select
              value={form.team}
              onChange={(v) => setForm({ ...form, team: v })}
              options={departments.map((d) => ({ value: d.name, label: d.name }))}
              placeholder="팀 선택"
              ariaLabel="팀 선택"
            />
          </div>
          <div className="form-group">
            <label>프로젝트 유형</label>
            <div className="btn-group">
              <button
                type="button"
                className={`btn btn-sm ${form.projectType === 'recurring' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm({ ...form, projectType: 'recurring' })}
              >
                양산형
              </button>
              <button
                type="button"
                className={`btn btn-sm ${form.projectType === 'once' ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setForm({ ...form, projectType: 'once' })}
              >
                단발성
              </button>
            </div>
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!form.isCS}
                onChange={(e) => setForm({ ...form, isCS: e.target.checked })}
                style={{ width: 'auto', minHeight: 'auto', margin: 0 }}
              />
              <span>CS업무 (직원이 매일 다른 현장 방문)</span>
            </label>
            <p className="field-hint" style={{ marginTop: 4 }}>
              체크 시 공수표 셀을 탭하면 모달이 열려 <strong>공수와 현장명</strong>을 함께 입력할 수 있습니다.
            </p>
          </div>
          <div className="form-group">
            <label>
              아이콘 <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(선택, 미선택 시 유형별 기본)</span>
            </label>
            <div className="icon-picker-grid">
              <button
                type="button"
                className={`icon-picker-item ${!form.icon ? 'is-selected' : ''}`}
                onClick={() => setForm({ ...form, icon: '' })}
                title="기본"
              >
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>기본</span>
              </button>
              {PROJECT_ICONS.map((ic) => {
                const c = getIconColor(form.iconColor);
                return (
                  <button
                    key={ic.key}
                    type="button"
                    className={`icon-picker-item ${form.icon === ic.key ? 'is-selected' : ''}`}
                    onClick={() => setForm({ ...form, icon: ic.key })}
                    title={ic.label}
                    aria-label={ic.label}
                    style={c.bg ? { background: c.bg, color: c.fg } : undefined}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22">
                      {ic.paths}
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="form-group">
            <label>
              아이콘 배경색 <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(선택)</span>
            </label>
            <div className="color-picker-grid">
              {ICON_COLORS.map((c) => (
                <button
                  key={c.key || 'default'}
                  type="button"
                  className={`color-picker-item ${form.iconColor === c.key ? 'is-selected' : ''}`}
                  onClick={() => setForm({ ...form, iconColor: c.key })}
                  title={c.label}
                  aria-label={c.label}
                  style={c.bg ? { background: c.bg, borderColor: c.fg + '33' } : undefined}
                >
                  {c.bg ? '' : <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>기본</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작 년/월</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select
                  value={form.startYear || ''}
                  onChange={(v) => setForm({ ...form, startYear: v ? Number(v) : null })}
                  options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: String(y) }))}
                  placeholder="-"
                  ariaLabel="시작 년"
                />
                <Select
                  value={form.startMonth || ''}
                  onChange={(v) => setForm({ ...form, startMonth: v ? Number(v) : null })}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
                  placeholder="-"
                  ariaLabel="시작 월"
                />
              </div>
            </div>
            <div className="form-group">
              <label>
                종료 년/월 <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(선택)</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <Select
                  value={form.endYear || ''}
                  onChange={(v) => setForm({ ...form, endYear: v ? Number(v) : null })}
                  options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: String(y) }))}
                  placeholder="미정"
                  ariaLabel="종료 년"
                />
                <Select
                  value={form.endMonth || ''}
                  onChange={(v) => setForm({ ...form, endMonth: v ? Number(v) : null })}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
                  placeholder="-"
                  ariaLabel="종료 월"
                />
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>담당자 선택</label>
            <button
              type="button"
              className="select-dropdown-toggle"
              onClick={() => setManagerListOpen(!managerListOpen)}
            >
              <span>{form.managerIds.length > 0 ? `${form.managerIds.length}명 선택됨` : '담당자를 선택하세요'}</span>
              <span
                className="select-dropdown-arrow"
                style={{ display: 'inline-flex', transform: managerListOpen ? 'rotate(180deg)' : 'none' }}
              >
                <Icon name="chevronDown" size={16} />
              </span>
            </button>
            {managerListOpen && (
              <div className="select-dropdown-list">
                {candidates.map((u) => {
                  const checked = form.managerIds.includes(u.uid);
                  return (
                    <label key={u.uid} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleManager(u.uid)} />
                      <span className="select-list-name">{u.name}</span>
                      <span className="select-list-sub">
                        {u.code}
                        {u.position && ` · ${u.position}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>
              지출 합산 대상 프로젝트 <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(선택)</span>
            </label>
            <p className="field-hint" style={{ marginTop: 0, marginBottom: 6 }}>
              선택한 프로젝트의 지출이 이 프로젝트 화면에 읽기 전용으로 표시되고 합계에 포함됩니다.
            </p>
            <button type="button" className="select-dropdown-toggle" onClick={() => setMirrorListOpen(!mirrorListOpen)}>
              <span>
                {form.mirrorFromSiteIds.length > 0
                  ? `${form.mirrorFromSiteIds.length}개 선택됨`
                  : '합산할 프로젝트를 선택하세요'}
              </span>
              <span
                className="select-dropdown-arrow"
                style={{ display: 'inline-flex', transform: mirrorListOpen ? 'rotate(180deg)' : 'none' }}
              >
                <Icon name="chevronDown" size={16} />
              </span>
            </button>
            {mirrorListOpen && (
              <div className="select-dropdown-list">
                {sites
                  .filter((s) => s.id !== editSite?.id)
                  .map((s) => {
                    const checked = form.mirrorFromSiteIds.includes(s.id);
                    return (
                      <label key={s.id} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleMirrorSite(s.id)} />
                        <span className="select-list-name">{s.name}</span>
                        <span className="select-list-sub">{s.team || '팀 미지정'}</span>
                      </label>
                    );
                  })}
                {sites.filter((s) => s.id !== editSite?.id).length === 0 && (
                  <div className="select-list-item" style={{ color: 'var(--text-muted)' }}>
                    선택할 다른 프로젝트가 없습니다.
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.hideRevenue}
                onChange={(e) => setForm({ ...form, hideRevenue: e.target.checked })}
                style={{ width: 'auto', minHeight: 'auto', margin: 0 }}
              />
              <span>매출 섹션 숨기기 (지원성 프로젝트)</span>
            </label>
            <p className="field-hint" style={{ marginTop: 4 }}>
              체크 시 이 프로젝트의 마감 화면·목록에서 매출이 표시되지 않고 합계 계산에서도 제외됩니다.
            </p>
          </div>
          {/* (2026-09-05 대표님 UI 기준안) 모달 푸터 순서: 취소(왼쪽)→확인(오른쪽) */}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
              취소
            </button>
            <button type="submit" className="btn btn-primary">
              {editSite ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
