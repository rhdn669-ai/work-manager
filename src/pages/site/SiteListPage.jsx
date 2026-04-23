import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSites, getSitesByManager, getFinanceItems, getClosingItems, createSite, updateSite, deleteSite } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import Modal from '../../components/common/Modal';

const TYPE_LABELS = { recurring: '양산', once: '단발' };
const STATUS_LABELS = { active: '진행 중', completed: '완료' };

export default function SiteListPage() {
  const { userProfile, isAdmin, isExecutive, canViewSalary } = useAuth();
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [departments, setDepartments] = useState([]);
  const [siteStats, setSiteStats] = useState({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [filter, setFilter] = useState('all'); // all | recurring | once | completed

  // 프로젝트 추가/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [editSite, setEditSite] = useState(null);
  const [form, setForm] = useState({
    name: '', team: '', managerIds: [],
    projectType: 'recurring', status: 'active',
    startYear: null, startMonth: null, endYear: null, endMonth: null,
    mirrorFromSiteIds: [], hideRevenue: false,
  });
  const [managerListOpen, setManagerListOpen] = useState(false);
  const [mirrorListOpen, setMirrorListOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year, month]);

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

      const isOvertimeItem = (f) => { const d = (f.description || '').trim(); return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-'); };

      // 1단계: 각 사이트의 자체 finance/공수 집계
      const rawStats = {};
      await Promise.all(list.map(async (s) => {
        const [fins, items] = await Promise.all([
          getFinanceItems(s.id, year, month),
          getClosingItems(s.id, year, month),
        ]);
        const revenue = fins.filter((f) => f.type === 'revenue').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const expense = fins.filter((f) => f.type === 'expense' && !isOvertimeItem(f)).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const overtime = fins.filter((f) => f.type === 'expense' && isOvertimeItem(f)).reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const labor = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
        rawStats[s.id] = { revenue, expense, overtime, labor };
      }));

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

  // 필터링된 프로젝트
  const filtered = sites.filter((s) => {
    const st = s.status || 'active';
    const pt = s.projectType || 'recurring';
    if (filter === 'completed') return st === 'completed';
    if (isBeforeStart(s)) return false; // 시작 월 이전은 모든 탭에서 숨김
    if (filter === 'recurring') return pt === 'recurring' && st === 'active';
    if (filter === 'once') return pt === 'once' && st === 'active';
    // 'all' = 활성 프로젝트 + 해당 월에 데이터가 있는 완료 프로젝트
    if (st === 'active') return true;
    return hasMonthData(s);
  });

  const filterCounts = {
    all: sites.filter((s) => {
      if (isBeforeStart(s)) return false;
      const st = s.status || 'active';
      if (st === 'active') return true;
      return hasMonthData(s);
    }).length,
    recurring: sites.filter((s) => !isBeforeStart(s) && (s.projectType || 'recurring') === 'recurring' && (s.status || 'active') === 'active').length,
    once: sites.filter((s) => !isBeforeStart(s) && s.projectType === 'once' && (s.status || 'active') === 'active').length,
    completed: sites.filter((s) => s.status === 'completed').length,
  };

  function managerNames(site) {
    const ids = site.managerIds || [];
    const names = ids.map((uid) => userMap[uid]?.name).filter(Boolean);
    return names.length ? names.join(', ') : '-';
  }

  function periodLabel(site) {
    const sy = site.startYear; const sm = site.startMonth;
    const ey = site.endYear; const em = site.endMonth;
    if (!sy) return '';
    let label = `${sy}.${String(sm).padStart(2, '0')}~`;
    if (ey) label += `${ey}.${String(em).padStart(2, '0')}`;
    return label;
  }

  // --- 프로젝트 CRUD ---
  function openCreate() {
    setEditSite(null);
    setForm({
      name: '', team: '', managerIds: [],
      projectType: 'recurring', status: 'active',
      startYear: year, startMonth: month, endYear: null, endMonth: null,
      mirrorFromSiteIds: [], hideRevenue: false,
    });
    setManagerListOpen(false);
    setMirrorListOpen(false);
    setShowModal(true);
  }

  function openEdit(site) {
    setEditSite(site);
    setForm({
      name: site.name, team: site.team || '', managerIds: site.managerIds || [],
      projectType: site.projectType || 'recurring', status: site.status || 'active',
      startYear: site.startYear || null, startMonth: site.startMonth || null,
      endYear: site.endYear || null, endMonth: site.endMonth || null,
      mirrorFromSiteIds: site.mirrorFromSiteIds || [], hideRevenue: !!site.hideRevenue,
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
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(site, e) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`"${site.name}" 프로젝트를 삭제하시겠습니까?\n(기존 마감 데이터는 남습니다)`)) return;
    try {
      await deleteSite(site.id);
      await loadData();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  async function handleToggleStatus(site, e) {
    e.preventDefault();
    e.stopPropagation();
    const next = (site.status || 'active') === 'active' ? 'completed' : 'active';
    const msg = next === 'completed' ? `"${site.name}" 프로젝트를 완료 처리하시겠습니까?` : `"${site.name}" 프로젝트를 다시 활성화하시겠습니까?`;
    if (!confirm(msg)) return;
    try {
      await updateSite(site.id, { status: next });
      await loadData();
    } catch (err) {
      alert('상태 변경 오류: ' + err.message);
    }
  }

  function toggleManager(uid) {
    setForm((f) => ({
      ...f,
      managerIds: f.managerIds.includes(uid)
        ? f.managerIds.filter((x) => x !== uid)
        : [...f.managerIds, uid],
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

  const candidates = users.filter((u) => u.role !== 'admin');

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="site-list-page">
      <div className="page-header">
        <h2>프로젝트</h2>
        {isAdmin && <button className="btn btn-primary" onClick={openCreate}>프로젝트 추가</button>}
      </div>

      {/* 필터 탭 */}
      <div className="tab-nav" style={{ marginBottom: 12 }}>
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
            {t.label} {filterCounts[t.key] > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{filterCounts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {isAdmin && filtered.length > 0 && filter !== 'completed' && (() => {
        const allRevenue = filtered.reduce((s, site) => {
          if (site.hideRevenue) return s;
          return s + ((siteStats[site.id] || {}).revenue || 0);
        }, 0);
        const allExpense = filtered.reduce((s, site) => {
          const v = siteStats[site.id] || {};
          return s + (v.expense || 0) + (v.overtime || 0) + (v.labor || 0);
        }, 0);
        const allBalance = allRevenue - allExpense;
        return (
          <div className="total-summary-bar">
            <div className="total-summary-item">
              <span className="label">전체 매출</span>
              <strong className="stat-revenue">{allRevenue.toLocaleString()}원</strong>
            </div>
            <div className="total-summary-item">
              <span className="label">전체 지출</span>
              <strong className="stat-expense">{allExpense.toLocaleString()}원</strong>
            </div>
            <div className="total-summary-item">
              <span className="label">합계</span>
              <strong className={allBalance >= 0 ? 'stat-balance positive' : 'stat-balance negative'}>{allBalance.toLocaleString()}원</strong>
            </div>
          </div>
        );
      })()}

      {filtered.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">
            {filter === 'completed' ? '완료된 프로젝트가 없습니다.' :
             isAdmin ? '등록된 프로젝트가 없습니다. 상단 "프로젝트 추가" 버튼으로 추가하세요.' : '담당 프로젝트가 없습니다. 관리자에게 문의해주세요.'}
          </div>
        </div>
      ) : (
        <div className="site-list">
          {filtered.map((s) => {
            const raw = siteStats[s.id] || { revenue: 0, expense: 0, overtime: 0, labor: 0 };
            const hideRev = !!s.hideRevenue;
            const revenueShown = hideRev ? 0 : raw.revenue;
            const expenseOnly = raw.expense + raw.overtime;
            const totalExpense = canViewSalary ? expenseOnly + raw.labor : expenseOnly;
            const balance = revenueShown - totalExpense;
            const pt = s.projectType || 'recurring';
            const st = s.status || 'active';
            const period = periodLabel(s);
            return (
              <div key={s.id} className="site-row-wrapper">
                <Link to={`/sites/${s.id}/${year}/${month}`} className={`site-row ${st === 'completed' ? 'site-row-completed' : ''}`}>
                  <div className="site-row-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {pt === 'once' ? (
                        <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>
                      ) : (
                        <><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/><path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/></>
                      )}
                    </svg>
                  </div>
                  <div className="site-row-body">
                    <div className="site-row-name">
                      {s.name}
                      <span className={`site-type-badge site-type-${pt}`}>{TYPE_LABELS[pt]}</span>
                      {st === 'completed' && <span className="site-status-badge site-status-completed">{STATUS_LABELS[st]}</span>}
                    </div>
                    <div className="site-row-meta">
                      <span className="chip chip-team">{s.team || '팀 미지정'}</span>
                      <span className="chip chip-manager">담당 {managerNames(s)}</span>
                      {period && <span className="chip chip-period">{period}</span>}
                    </div>
                    {(st !== 'completed' || hasMonthData(s)) && (
                      <div className="site-row-stats">
                        {!hideRev && <span className="stat-revenue">매출 {raw.revenue.toLocaleString()}</span>}
                        <span className="stat-expense">지출 {expenseOnly.toLocaleString()}</span>
                        {canViewSalary && <span className="stat-expense">공수 {raw.labor.toLocaleString()}</span>}
                        {!hideRev && <span className={`stat-balance ${balance >= 0 ? 'positive' : 'negative'}`}>합계 {balance.toLocaleString()}</span>}
                      </div>
                    )}
                  </div>
                  <div className="site-row-period">
                    <div className="period-y">{year}</div>
                    <div className="period-m">{String(month).padStart(2, '0')}월</div>
                  </div>
                  <div className="site-row-arrow">&rarr;</div>
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
                      <div className="site-row-menu" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                        <button type="button" className="site-row-menu-item" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(null); openEdit(s); }}>수정</button>
                        {st === 'completed' && (
                          <button type="button" className="site-row-menu-item" onClick={(e) => { setOpenMenuId(null); handleToggleStatus(s, e); }}>재활성</button>
                        )}
                        <button type="button" className="site-row-menu-item site-row-menu-danger" onClick={(e) => { setOpenMenuId(null); handleDelete(s, e); }}>삭제</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editSite ? '프로젝트 수정' : '프로젝트 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>프로젝트명 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>팀</label>
            <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
              <option value="">팀 선택</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>프로젝트 유형</label>
            <div className="btn-group">
              <button type="button" className={`btn btn-sm ${form.projectType === 'recurring' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setForm({ ...form, projectType: 'recurring' })}>양산형</button>
              <button type="button" className={`btn btn-sm ${form.projectType === 'once' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setForm({ ...form, projectType: 'once' })}>단발성</button>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시작 년/월</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={form.startYear || ''} onChange={(e) => setForm({ ...form, startYear: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">-</option>
                  {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={form.startMonth || ''} onChange={(e) => setForm({ ...form, startMonth: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">-</option>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>종료 년/월 <span style={{ fontSize: 11, color: '#9ca3af' }}>(선택)</span></label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={form.endYear || ''} onChange={(e) => setForm({ ...form, endYear: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">미정</option>
                  {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select value={form.endMonth || ''} onChange={(e) => setForm({ ...form, endMonth: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">-</option>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="form-group">
            <label>담당자 선택</label>
            <button type="button" className="select-dropdown-toggle" onClick={() => setManagerListOpen(!managerListOpen)}>
              <span>{form.managerIds.length > 0 ? `${form.managerIds.length}명 선택됨` : '담당자를 선택하세요'}</span>
              <span className="select-dropdown-arrow">{managerListOpen ? '▲' : '▼'}</span>
            </button>
            {managerListOpen && (
              <div className="select-dropdown-list">
                {candidates.map((u) => {
                  const checked = form.managerIds.includes(u.uid);
                  return (
                    <label key={u.uid} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleManager(u.uid)} />
                      <span className="select-list-name">{u.name}</span>
                      <span className="select-list-sub">{u.code}{u.position && ` · ${u.position}`}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="form-group">
            <label>지출 합산 대상 프로젝트 <span style={{ fontSize: 11, color: '#9ca3af' }}>(선택)</span></label>
            <p className="field-hint" style={{ marginTop: 0, marginBottom: 6 }}>
              선택한 프로젝트의 지출이 이 프로젝트 화면에 읽기 전용으로 표시되고 합계에 포함됩니다.
            </p>
            <button type="button" className="select-dropdown-toggle" onClick={() => setMirrorListOpen(!mirrorListOpen)}>
              <span>{form.mirrorFromSiteIds.length > 0 ? `${form.mirrorFromSiteIds.length}개 선택됨` : '합산할 프로젝트를 선택하세요'}</span>
              <span className="select-dropdown-arrow">{mirrorListOpen ? '▲' : '▼'}</span>
            </button>
            {mirrorListOpen && (
              <div className="select-dropdown-list">
                {sites.filter((s) => s.id !== editSite?.id).map((s) => {
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
                  <div className="select-list-item" style={{ color: '#9ca3af' }}>선택할 다른 프로젝트가 없습니다.</div>
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
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editSite ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
