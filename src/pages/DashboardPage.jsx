import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getMyOvertimeRecords } from '../services/attendanceService';
import { getLeaveBalance, getDepartmentPendingLeaves } from '../services/leaveService';
import { getSitesByManager, getAllSites } from '../services/siteService';
import { getUsers } from '../services/userService';
import { getDepartments } from '../services/departmentService';
import { formatMinutes, getMonthStart, getMonthEnd } from '../utils/dateUtils';

export default function DashboardPage() {
  const { userProfile, isAdmin, isManager, isTeamLeader } = useAuth();
  const canApprove = isAdmin || isTeamLeader;
  const [monthlyOvertime, setMonthlyOvertime] = useState(0);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [siteCount, setSiteCount] = useState(0);
  const [adminStats, setAdminStats] = useState({ users: 0, activeUsers: 0, departments: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    loadDashboard();
  }, [userProfile]);

  async function loadDashboard() {
    try {
      const now = new Date();
      const start = getMonthStart(now.getFullYear(), now.getMonth() + 1);
      const end = getMonthEnd(now.getFullYear(), now.getMonth() + 1);

      const [records, balance, sites, users, departments] = await Promise.all([
        isAdmin ? Promise.resolve([]) : getMyOvertimeRecords(userProfile.uid, start, end),
        isAdmin ? Promise.resolve(null) : getLeaveBalance(userProfile.uid),
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        isAdmin ? getUsers() : Promise.resolve([]),
        isAdmin ? getDepartments() : Promise.resolve([]),
      ]);

      const total = records.reduce((sum, r) => sum + (r.minutes || 0), 0);
      setMonthlyOvertime(total);
      setOvertimeCount(records.length);
      setLeaveBalance(balance);
      setSiteCount(sites.length);

      if (isAdmin) {
        const activeUsers = users.filter((u) => u.isActive !== false).length;
        setAdminStats({
          users: users.length,
          activeUsers,
          departments: departments.length,
        });
      }

      if (canApprove && userProfile.departmentId) {
        const pending = await getDepartmentPendingLeaves(userProfile.departmentId);
        setPendingLeaves(pending);
      }
    } catch (err) {
      console.error('대시보드 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <h2>안녕하세요, {userProfile?.name}님</h2>
        <p>오늘도 좋은 하루 되세요.</p>
      </div>

      {isAdmin && (
        <div className="admin-stats">
          <div className="admin-stat">
            <div className="admin-stat-label">사용자</div>
            <div className="admin-stat-value">{adminStats.users}<span>명</span></div>
            <div className="admin-stat-sub">활성 {adminStats.activeUsers}명</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-label">부서</div>
            <div className="admin-stat-value">{adminStats.departments}<span>개</span></div>
            <div className="admin-stat-sub">조직 단위</div>
          </div>
          <div className="admin-stat">
            <div className="admin-stat-label">현장</div>
            <div className="admin-stat-value">{siteCount}<span>개</span></div>
            <div className="admin-stat-sub">등록 현장</div>
          </div>
          <Link
            to="/manage/leave"
            className={`admin-stat admin-stat-link ${pendingLeaves.length > 0 ? 'is-warning' : ''}`}
          >
            <div className="admin-stat-label">승인 대기</div>
            <div className="admin-stat-value">{pendingLeaves.length}<span>건</span></div>
            <div className="admin-stat-sub">{pendingLeaves.length > 0 ? '탭해서 처리' : '모두 처리됨'}</div>
          </Link>
        </div>
      )}

      {!isAdmin && (
        <div className="dashboard-tiles">
          {/* 잔업 */}
          <Link to="/attendance" className="dashboard-tile tile-overtime">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">이번 달 잔업</div>
              <div className="tile-value">{formatMinutes(monthlyOvertime)}</div>
              <div className="tile-sub">{overtimeCount}건 등록</div>
            </div>
          </Link>

          {/* 연차 */}
          <Link to="/leave/balance" className="dashboard-tile tile-leave">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">연차 잔여</div>
              <div className="tile-value">
                {leaveBalance ? `${leaveBalance.remainingDays}일` : '-'}
              </div>
              <div className="tile-sub">
                {leaveBalance
                  ? `누적 ${leaveBalance.totalDays}일 · 사용 ${leaveBalance.usedDays}일`
                  : '연차 정보 없음'}
              </div>
            </div>
          </Link>

          {canApprove && (
            <Link
              to="/manage/leave"
              className={`dashboard-tile tile-pending ${pendingLeaves.length > 0 ? 'is-urgent' : ''}`}
            >
              <div className="tile-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 11l3 3L22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
              </div>
              <div className="tile-body">
                <div className="tile-title">승인 대기</div>
                <div className="tile-value">{pendingLeaves.length}<span style={{ fontSize: 13, marginLeft: 3 }}>건</span></div>
                <div className="tile-sub">
                  {pendingLeaves.length > 0 ? '탭해서 처리' : '모두 처리됨'}
                </div>
              </div>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
