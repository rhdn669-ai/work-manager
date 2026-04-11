import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getAllSites, getSitesByManager } from '../../services/siteService';
import { getUsers } from '../../services/userService';

export default function SiteListPage() {
  const { userProfile, isAdmin } = useAuth();
  const [sites, setSites] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const navigate = useNavigate();

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    setLoading(true);
    try {
      const [list, users] = await Promise.all([
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        getUsers(),
      ]);
      setSites(list);
      setUserMap(Object.fromEntries(users.map((u) => [u.uid, u])));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openClosing(siteId) {
    navigate(`/sites/${siteId}/${year}/${month}`);
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
        <h2>현장 마감리스트</h2>
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
          <div className="card-body">
            <p className="text-muted">
              {isAdmin ? '등록된 현장이 없습니다. "현장 관리"에서 추가해주세요.' : '담당 현장이 없습니다. 관리자에게 문의해주세요.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="dashboard-grid">
          {sites.map((s) => (
            <div
              key={s.id}
              className="card"
              onClick={() => openClosing(s.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="card-header">{s.name}</div>
              <div className="card-body">
                <p className="text-sm">팀: {s.team || '-'}</p>
                <p className="text-sm">담당: {managerNames(s)}</p>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }}>
                  {year}년 {month}월 마감 열기
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
