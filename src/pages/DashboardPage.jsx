import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getMyOvertimeRecords } from '../services/attendanceService';
import { getLeaveBalance, getDepartmentPendingLeaves } from '../services/leaveService';
import { getSitesByManager, getAllSites } from '../services/siteService';
import { formatMinutes, getMonthStart, getMonthEnd } from '../utils/dateUtils';

export default function DashboardPage() {
  const { userProfile, isAdmin, isManager } = useAuth();
  const [monthlyOvertime, setMonthlyOvertime] = useState(0);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [siteCount, setSiteCount] = useState(0);
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

      const [records, balance, sites] = await Promise.all([
        getMyOvertimeRecords(userProfile.uid, start, end),
        getLeaveBalance(userProfile.uid),
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
      ]);

      const total = records.reduce((sum, r) => sum + (r.minutes || 0), 0);
      setMonthlyOvertime(total);
      setOvertimeCount(records.length);
      setLeaveBalance(balance);
      setSiteCount(sites.length);

      if (isAdmin || isManager) {
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
            <div className="tile-title">잔업</div>
            <div className="tile-value">{formatMinutes(monthlyOvertime)}</div>
            <div className="tile-sub">이번 달 · {overtimeCount}건</div>
          </div>
          <div className="tile-arrow">→</div>
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
            <div className="tile-title">연차</div>
            <div className="tile-value">
              {leaveBalance ? `${leaveBalance.remainingDays}일` : '-'}
            </div>
            <div className="tile-sub">
              {leaveBalance
                ? `누적 ${leaveBalance.totalDays}일 · 사용 ${leaveBalance.usedDays}일`
                : '연차 정보 없음'}
            </div>
          </div>
          <div className="tile-arrow">→</div>
        </Link>

        {/* 현장 */}
        <Link to="/sites" className="dashboard-tile tile-site">
          <div className="tile-icon">
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
          <div className="tile-body">
            <div className="tile-title">현장</div>
            <div className="tile-value">{siteCount}개</div>
            <div className="tile-sub">
              {isAdmin ? '전체 현장' : '담당 현장'}
            </div>
          </div>
          <div className="tile-arrow">→</div>
        </Link>
      </div>

      {(isAdmin || isManager) && pendingLeaves.length > 0 && (
        <Link to="/manage/leave" className="dashboard-pending">
          <div className="pending-badge">{pendingLeaves.length}</div>
          <div>
            <strong>연차 승인 대기</strong>
            <span>지금 바로 확인해주세요</span>
          </div>
          <div className="tile-arrow">→</div>
        </Link>
      )}
    </div>
  );
}
