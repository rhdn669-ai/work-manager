import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSites, getSitesByManager, getFinanceItems, getClosingItems, createSite, updateSite, deleteSite } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import Modal from '../../components/common/Modal';

export default function SiteListPage() {
  const { userProfile, isAdmin, isExecutive } = useAuth();
  const canViewSalary = isAdmin || isExecutive;
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [siteStats, setSiteStats] = useState({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // 프로젝트 추가/수정 모달
  const [showModal, setShowModal] = useState(false);
  const [editSite, setEditSite] = useState(null);
  const [form, setForm] = useState({ name: '', team: '', managerIds: [] });
  const [managerListOpen, setManagerListOpen] = useState(false);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year, month]);

  async function loadData() {
    setLoading(true);
    try {
      const [list, userList] = await Promise.all([
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        getUsers(),
      ]);
      setSites(list);
      setUsers(userList);
      const uMap = Object.fromEntries(userList.map((u) => [u.uid, u]));
      setUserMap(uMap);

      const stats = {};
      await Promise.all(list.map(async (s) => {
        const [fins, items] = await Promise.all([
          getFinanceItems(s.id, year, month),
          getClosingItems(s.id, year, month),
        ]);
        const revenue = fins.filter((f) => f.type === 'revenue').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const expense = fins.filter((f) => f.type === 'expense').reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
        const labor = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
        stats[s.id] = { revenue, expense, labor };
      }));
      setSiteStats(stats);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function managerNames(site) {
    const ids = site.managerIds || [];
    const names = ids.map((uid) => userMap[uid]?.name).filter(Boolean);
    return names.length ? names.join(', ') : '-';
  }

  // --- 프로젝트 CRUD ---
  function openCreate() {
    setEditSite(null);
    setForm({ name: '', team: '', managerIds: [] });
    setManagerListOpen(false);
    setShowModal(true);
  }

  function openEdit(site) {
    setEditSite(site);
    setForm({ name: site.name, team: site.team || '', managerIds: site.managerIds || [] });
    setManagerListOpen(false);
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

  function toggleManager(uid) {
    setForm((f) => ({
      ...f,
      managerIds: f.managerIds.includes(uid)
        ? f.managerIds.filter((x) => x !== uid)
        : [...f.managerIds, uid],
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

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {isAdmin && sites.length > 0 && (() => {
        const allRevenue = Object.values(siteStats).reduce((s, v) => s + (v.revenue || 0), 0);
        const allExpense = Object.values(siteStats).reduce((s, v) => s + (v.expense || 0) + (v.labor || 0), 0);
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

      {sites.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">
            {isAdmin ? '등록된 프로젝트가 없습니다. 상단 "프로젝트 추가" 버튼으로 추가하세요.' : '담당 프로젝트가 없습니다. 관리자에게 문의해주세요.'}
          </div>
        </div>
      ) : (
        <div className="site-list">
          {sites.map((s) => {
            const raw = siteStats[s.id] || { revenue: 0, expense: 0, labor: 0 };
            const totalExpense = canViewSalary ? raw.expense + raw.labor : raw.expense;
            const balance = raw.revenue - totalExpense;
            return (
              <div key={s.id} className="site-row-wrapper">
                <Link to={`/sites/${s.id}/${year}/${month}`} className="site-row">
                  <div className="site-row-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/>
                      <path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/>
                      <path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/>
                    </svg>
                  </div>
                  <div className="site-row-body">
                    <div className="site-row-name">{s.name}</div>
                    <div className="site-row-meta">
                      <span className="chip chip-team">{s.team || '팀 미지정'}</span>
                      <span className="chip chip-manager">담당 {managerNames(s)}</span>
                    </div>
                    <div className="site-row-stats">
                      <span className="stat-revenue">매출 {raw.revenue.toLocaleString()}</span>
                      <span className="stat-expense">지출 {totalExpense.toLocaleString()}</span>
                      <span className={`stat-balance ${balance >= 0 ? 'positive' : 'negative'}`}>합계 {balance.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="site-row-period">
                    <div className="period-y">{year}</div>
                    <div className="period-m">{String(month).padStart(2, '0')}월</div>
                  </div>
                  <div className="site-row-arrow">→</div>
                </Link>
                {isAdmin && (
                  <div className="site-row-actions">
                    <button className="btn btn-sm btn-outline" onClick={(e) => { e.preventDefault(); openEdit(s); }}>수정</button>
                    <button className="btn btn-sm btn-danger" onClick={(e) => handleDelete(s, e)}>삭제</button>
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
            <input value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} placeholder="예: 전장 2팀" />
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
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editSite ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
