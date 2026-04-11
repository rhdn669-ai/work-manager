import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getMyOvertimeRecords } from '../services/attendanceService';
import { getLeaveBalance, getDepartmentPendingLeaves } from '../services/leaveService';
import { formatMinutes, getMonthStart, getMonthEnd } from '../utils/dateUtils';

export default function DashboardPage() {
  const { userProfile, isAdmin, isManager } = useAuth();
  const [monthlyOvertime, setMonthlyOvertime] = useState(0);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [pendingLeaves, setPendingLeaves] = useState([]);
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

      const [records, balance] = await Promise.all([
        getMyOvertimeRecords(userProfile.uid, start, end),
        getLeaveBalance(userProfile.uid),
      ]);

      const total = records.reduce((sum, r) => sum + (r.minutes || 0), 0);
      setMonthlyOvertime(total);
      setOvertimeCount(records.length);
      setLeaveBalance(balance);

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
      <h2>대시보드</h2>
      <p className="welcome">안녕하세요, {userProfile?.name}님!</p>

      <div className="dashboard-grid">
        {/* 이번 달 잔업 */}
        <div className="card">
          <div className="card-header">이번 달 잔업</div>
          <div className="card-body">
            <div className="stat-big">{formatMinutes(monthlyOvertime)}</div>
            <p className="text-sm text-center">{overtimeCount}건 등록</p>
          </div>
        </div>

        {/* 잔여 연차 */}
        <div className="card">
          <div className="card-header">연차 현황</div>
          <div className="card-body">
            {leaveBalance ? (
              <>
                <div className="stat-row">
                  <span>총 연차</span>
                  <strong>{leaveBalance.totalDays}일</strong>
                </div>
                <div className="stat-row">
                  <span>사용</span>
                  <strong>{leaveBalance.usedDays}일</strong>
                </div>
                <div className="stat-row highlight">
                  <span>잔여</span>
                  <strong>{leaveBalance.remainingDays}일</strong>
                </div>
              </>
            ) : (
              <p className="text-muted">연차 정보가 없습니다.</p>
            )}
          </div>
        </div>

        {/* 관리자/부서장: 승인 대기 */}
        {(isAdmin || isManager) && (
          <div className="card">
            <div className="card-header">승인 대기</div>
            <div className="card-body">
              {pendingLeaves.length > 0 ? (
                <div className="stat-big">{pendingLeaves.length}건</div>
              ) : (
                <p className="text-muted">대기 중인 신청이 없습니다.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
