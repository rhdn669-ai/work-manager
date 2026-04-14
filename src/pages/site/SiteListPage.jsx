import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSites, getSitesByManager, getFinanceItems, getClosingItems } from '../../services/siteService';
import { getUsers } from '../../services/userService';

export default function SiteListPage() {
  const { userProfile, isAdmin } = useAuth();
  const [sites, setSites] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [siteStats, setSiteStats] = useState({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year, month]);

  async function loadData() {
    setLoading(true);
    try {
      const [list, users] = await Promise.all([
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        getUsers(),
      ]);
      setSites(list);
      setUserMap(Object.fromEntries(users.map((u) => [u.uid, u])));

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

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="site-list-page">
      <div className="page-header">
        <h2>프로젝트 마감리스트</h2>
      </div>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {sites.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">
            {isAdmin ? '등록된 프로젝트가 없습니다. "프로젝트 관리"에서 추가해주세요.' : '담당 프로젝트가 없습니다. 관리자에게 문의해주세요.'}
          </div>
        </div>
      ) : (
        <div className="site-list">
          {sites.map((s) => {
            const raw = siteStats[s.id] || { revenue: 0, expense: 0, labor: 0 };
            const totalExpense = raw.expense + raw.labor;
            const balance = raw.revenue - totalExpense;
            return (
              <Link
                key={s.id}
                to={`/sites/${s.id}/${year}/${month}`}
                className="site-row"
              >
                <div className="site-row-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 21h18"/>
                    <path d="M5 21V7l7-4 7 4v14"/>
                    <path d="M9 9h.01"/>
                    <path d="M9 13h.01"/>
                    <path d="M9 17h.01"/>
                    <path d="M15 9h.01"/>
                    <path d="M15 13h.01"/>
                    <path d="M15 17h.01"/>
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
            );
          })}
        </div>
      )}
    </div>
  );
}
