import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getTodayAttendance } from '../services/attendanceService';
import { getWeeklySummary, getOvertimeWarningLevel } from '../services/overtimeService';
import { getLeaveBalance } from '../services/leaveService';
import { getDepartmentPendingLeaves } from '../services/leaveService';
import { formatTime, formatMinutes } from '../utils/dateUtils';
import { WEEKLY_OVERTIME_LIMIT } from '../utils/constants';

export default function DashboardPage() {
  const { userProfile, isAdmin, isManager } = useAuth();
  const [todayRecord, setTodayRecord] = useState(null);
  const [weeklySummary, setWeeklySummary] = useState(null);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [pendingLeaves, setPendingLeaves] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    loadDashboard();
  }, [userProfile]);

  async function loadDashboard() {
    try {
      const [attendance, overtime, balance] = await Promise.all([
        getTodayAttendance(userProfile.uid),
        getWeeklySummary(userProfile.uid, new Date()),
        getLeaveBalance(userProfile.uid, new Date().getFullYear()),
      ]);
      setTodayRecord(attendance);
      setWeeklySummary(overtime);
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

  const warningLevel = weeklySummary ? getOvertimeWarningLevel(weeklySummary.totalOvertimeMinutes) : 'safe';

  return (
    <div className="dashboard-page">
      <h2>대시보드</h2>
      <p className="welcome">안녕하세요, {userProfile?.name}님!</p>

      <div className="dashboard-grid">
        {/* 오늘 출퇴근 상태 */}
        <div className="card">
          <div className="card-header">오늘 출퇴근</div>
          <div className="card-body">
            {todayRecord ? (
              <>
                <div className="stat-row">
                  <span>출근</span>
                  <strong>{formatTime(todayRecord.checkIn)}</strong>
                </div>
                <div className="stat-row">
                  <span>퇴근</span>
                  <strong>{todayRecord.checkOut ? formatTime(todayRecord.checkOut) : '근무 중'}</strong>
                </div>
                {todayRecord.workMinutes != null && (
                  <div className="stat-row">
                    <span>근무시간</span>
                    <strong>{formatMinutes(todayRecord.workMinutes)}</strong>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted">아직 출근 기록이 없습니다.</p>
            )}
          </div>
        </div>

        {/* 주간 초과근무 */}
        <div className={`card card-${warningLevel}`}>
          <div className="card-header">이번 주 초과근무</div>
          <div className="card-body">
            {weeklySummary ? (
              <>
                <div className="stat-big">
                  {formatMinutes(weeklySummary.totalOvertimeMinutes)}
                </div>
                <div className="overtime-bar">
                  <div
                    className={`overtime-fill overtime-${warningLevel}`}
                    style={{ width: `${Math.min(100, (weeklySummary.totalOvertimeMinutes / WEEKLY_OVERTIME_LIMIT) * 100)}%` }}
                  />
                </div>
                <p className="text-sm">한도: {formatMinutes(WEEKLY_OVERTIME_LIMIT)}</p>
                {warningLevel === 'danger' && <p className="text-danger">주간 연장근로 한도를 초과했습니다!</p>}
                {warningLevel === 'warning' && <p className="text-warning">주간 연장근로 한도의 83%에 도달했습니다.</p>}
              </>
            ) : (
              <p className="text-muted">초과근무 기록이 없습니다.</p>
            )}
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
