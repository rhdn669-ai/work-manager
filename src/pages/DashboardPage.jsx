import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getMyOvertimeRecords, getPendingOvertimeRecords } from '../services/attendanceService';
import { getLeaveBalance, getMyLeaves } from '../services/leaveService';
import { getSitesByManager, getAllSites } from '../services/siteService';
import { getUsers } from '../services/userService';
import { getDepartments } from '../services/departmentService';
import { formatMinutes, getMonthStart, getMonthEnd } from '../utils/dateUtils';
import HomeCalendar from '../components/common/HomeCalendar';

export default function DashboardPage() {
  const { userProfile, isAdmin, isManager, canApproveLeave } = useAuth();
  const [monthlyOvertime, setMonthlyOvertime] = useState(0);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [siteCount, setSiteCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [adminStats, setAdminStats] = useState({ users: 0, activeUsers: 0, departments: 0 });
  const [recentApprovals, setRecentApprovals] = useState([]); // 최근 결재 결과 (비관리자)
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

      const activeRecords = records.filter((r) => r.status === 'approved');
      const total = activeRecords.reduce((sum, r) => sum + (r.minutes || 0), 0);
      setMonthlyOvertime(total);
      setOvertimeCount(activeRecords.length);
      setLeaveBalance(balance);
      setSiteCount(sites.length);

      if (isAdmin) {
        const activeUsers = users.filter((u) => u.isActive !== false).length;
        setAdminStats({
          users: users.length,
          activeUsers,
          departments: departments.length,
        });
        const pending = await getPendingOvertimeRecords();
        setPendingCount(pending.length);
      } else {
        // 비관리자 — 최근 14일 결재 결과 (잔업/연차)
        const since = new Date(); since.setDate(since.getDate() - 1);
        const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
        const myLeaves = await getMyLeaves(userProfile.uid, now.getFullYear()).catch(() => []);
        const otRecent = records;
        const approvals = [];
        otRecent.forEach((r) => {
          if ((r.status === 'approved' || r.status === 'rejected') && r.date >= sinceStr) {
            approvals.push({
              kind: 'overtime',
              status: r.status,
              date: r.date,
              key: `ot-${r.id}`,
              label: `잔업 ${formatMinutes(r.minutes || 0)}`,
              sub: r.siteId ? (sites.find((s) => s.id === r.siteId)?.name || '') : '',
            });
          }
        });
        myLeaves.forEach((l) => {
          if ((l.status === 'confirmed' || l.status === 'approved' || l.status === 'rejected') && (l.startDate || '') >= sinceStr) {
            approvals.push({
              kind: 'leave',
              status: l.status === 'confirmed' ? 'approved' : l.status,
              date: l.startDate,
              key: `lv-${l.id}`,
              label: `연차 ${l.startDate}${l.endDate && l.endDate !== l.startDate ? ` ~ ${l.endDate}` : ''} (${l.days || 1}일)`,
              sub: l.reason || '',
            });
          }
        });
        approvals.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setRecentApprovals(approvals.slice(0, 5));
      }

    } catch (err) {
      console.error('대시보드 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const today = new Date();
  const weekdayKor = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()];
  const todayLabel = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${weekdayKor})`;

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <div className="dashboard-welcome-text">
          <h2>{userProfile?.name}</h2>
          <p>{userProfile?.position || (isAdmin ? '관리자' : '')}</p>
        </div>
        <div className="dashboard-welcome-date">{todayLabel}</div>
      </div>

      {isAdmin && (
        <div className="dashboard-tiles">
          <div className="dashboard-tile tile-users is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">사용자</div>
              <div className="tile-value">{adminStats.users}<span style={{ fontSize: 13, marginLeft: 3 }}>명</span></div>
              <div className="tile-sub">활성 {adminStats.activeUsers}명</div>
            </div>
          </div>

          <div className="dashboard-tile tile-departments is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18"/>
                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/>
                <line x1="10" y1="8" x2="14" y2="8"/>
                <line x1="10" y1="12" x2="14" y2="12"/>
                <line x1="10" y1="16" x2="14" y2="16"/>
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">부서</div>
              <div className="tile-value">{adminStats.departments}<span style={{ fontSize: 13, marginLeft: 3 }}>개</span></div>
              <div className="tile-sub">조직 단위</div>
            </div>
          </div>

          <div className="dashboard-tile tile-site is-static">
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
              <div className="tile-title">프로젝트</div>
              <div className="tile-value">{siteCount}<span style={{ fontSize: 13, marginLeft: 3 }}>개</span></div>
              <div className="tile-sub">등록 프로젝트</div>
            </div>
          </div>

          <Link
            to="/admin/reports"
            className={`dashboard-tile tile-pending ${pendingCount > 0 ? 'is-urgent' : ''}`}
          >
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">잔업 승인 대기</div>
              <div className="tile-value">{pendingCount}<span style={{ fontSize: 13, marginLeft: 3 }}>건</span></div>
              <div className="tile-sub">{pendingCount > 0 ? '탭해서 승인' : '대기 없음'}</div>
            </div>
          </Link>
        </div>
      )}

      {!isAdmin && (
        <div className="dashboard-tiles">
          {/* 잔업 (지표 카드 - 클릭 불가) */}
          <div className="dashboard-tile tile-overtime is-static">
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
          </div>

          {/* 연차 (지표 카드 - 클릭 불가) */}
          <div className="dashboard-tile tile-leave is-static">
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
          </div>

          {/* 팀장의 "팀원 잔업·연차" 타일은 우리 팀 탭으로 이동했으므로 홈에선 숨김 */}
        </div>
      )}

      {!isAdmin && recentApprovals.length > 0 && (
        <div className="approvals-widget">
          <div className="approvals-widget-head">
            <strong>최근 결재 결과</strong>
            <span className="text-muted text-sm">최근 1일</span>
          </div>
          <ul className="approvals-list">
            {recentApprovals.map((a) => (
              <li key={a.key} className={`approval-item approval-${a.status}`}>
                <span className={`approval-badge approval-badge-${a.status}`}>
                  {a.status === 'approved' ? '승인' : a.status === 'rejected' ? '반려' : '대기'}
                </span>
                <div className="approval-body">
                  <strong>{a.label}</strong>
                  {a.sub && <span className="approval-sub">{a.sub}</span>}
                </div>
                <span className="approval-date">{a.date}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <HomeCalendar />
    </div>
  );
}
