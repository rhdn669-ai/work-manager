import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import { getMyOvertimeRecords, getPendingOvertimeRecords } from '../services/attendanceService';
import { getLeaveBalance, getMyLeaves, getAllLeavesByYear } from '../services/leaveService';
import { getSitesByManager, getAllSites } from '../services/siteService';
import { getUsers } from '../services/userService';
import { getDepartments } from '../services/departmentService';
import { getPurchases } from '../services/purchaseService';
import { getEvents } from '../services/eventService';
import { formatMinutes, getMonthStart, getMonthEnd, formatDisplayDate } from '../utils/dateUtils';
import HomeCalendar from '../components/common/HomeCalendar';
import Skeleton from '../components/common/Skeleton';

export default function DashboardPage() {
  const { userProfile, isAdmin } = useAuth();
  const [monthlyOvertime, setMonthlyOvertime] = useState(0);
  const [overtimeCount, setOvertimeCount] = useState(0);
  const [leaveBalance, setLeaveBalance] = useState(null);
  const [siteCount, setSiteCount] = useState(0);
  const [adminStats, setAdminStats] = useState({ users: 0, departments: 0 });
  const [pendingList, setPendingList] = useState([]); // 결재 대기 목록 (관리자)
  const [recentApprovals, setRecentApprovals] = useState([]); // 최근 결재 결과 (직원)
  const [notices, setNotices] = useState([]); // 공지사항
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userProfile) return;
    loadDashboard();
  }, [userProfile]);

  async function loadDashboard() {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const start = getMonthStart(year, now.getMonth() + 1);
      const end = getMonthEnd(year, now.getMonth() + 1);

      const [records, balance, sites, users, departments, events] = await Promise.all([
        isAdmin ? Promise.resolve([]) : getMyOvertimeRecords(userProfile.uid, start, end),
        isAdmin ? Promise.resolve(null) : getLeaveBalance(userProfile.uid),
        isAdmin ? getAllSites() : getSitesByManager(userProfile.uid),
        isAdmin ? getUsers() : Promise.resolve([]),
        isAdmin ? getDepartments() : Promise.resolve([]),
        getEvents().catch(() => []),
      ]);

      const activeRecords = records.filter((r) => r.status === 'approved');
      setMonthlyOvertime(activeRecords.reduce((sum, r) => sum + (r.minutes || 0), 0));
      setOvertimeCount(activeRecords.length);
      setLeaveBalance(balance);
      setSiteCount(sites.length);
      setNotices((events || []).slice(0, 4));

      if (isAdmin) {
        const activeUsers = users.filter((u) => u.isActive !== false).length;
        setAdminStats({ users: activeUsers, departments: departments.length });

        const [pendingOt, purchases, leaves] = await Promise.all([
          getPendingOvertimeRecords(),
          getPurchases(),
          getAllLeavesByYear(year).catch(() => []),
        ]);

        const userName = {};
        users.forEach((u) => {
          userName[u.uid || u.id] = u.name;
        });

        const otItems = pendingOt.map((r) => ({
          key: `ot-${r.id}`,
          badge: '잔업',
          badgeType: 'ot',
          title: r.userName || userName[r.userId] || '직원',
          sub: `잔업 ${formatMinutes(r.minutes || 0)} · ${r.date}`,
          sortKey: r.date || '',
          to: '/admin/reports',
        }));

        const leaveItems = (leaves || [])
          .filter((l) => l.status === 'pending')
          .map((l) => ({
            key: `lv-${l.id}`,
            badge: '연차',
            badgeType: 'leave',
            title: userName[l.userId] || '직원',
            sub: `연차 ${l.startDate}${l.endDate && l.endDate !== l.startDate ? ` ~ ${l.endDate}` : ''} (${l.days || 1}일)`,
            sortKey: l.startDate || '',
            to: '/admin/leaves',
          }));

        const payItems = [];
        for (const p of purchases) {
          const req = p.paymentRequested;
          if (!req) continue;
          const paid = p.supplierPaid || {};
          const unpaid = Object.keys(req).filter((k) => !paid[k]);
          if (unpaid.length === 0) continue;
          payItems.push({
            key: `pay-${p.id}`,
            badge: '결제',
            badgeType: 'pay',
            title: p.title || p.projectName || '구매 건',
            sub: `결제 대기 ${unpaid.length}건`,
            sortKey: '9999-99-99', // 결제 대기는 최상단 고정
            to: '/admin/payment',
          });
        }

        const merged = [...payItems, ...otItems, ...leaveItems]
          .sort((a, b) => (b.sortKey || '').localeCompare(a.sortKey || ''))
          .slice(0, 8);
        setPendingList(merged);
      } else {
        // 직원 — 최근 1일 결재 결과 (잔업/연차)
        const since = new Date();
        since.setDate(since.getDate() - 1);
        const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
        const myLeaves = await getMyLeaves(userProfile.uid, year).catch(() => []);
        const approvals = [];
        records.forEach((r) => {
          if ((r.status === 'approved' || r.status === 'rejected') && r.date >= sinceStr) {
            approvals.push({
              status: r.status,
              date: r.date,
              key: `ot-${r.id}`,
              label: `잔업 ${formatMinutes(r.minutes || 0)}`,
              sub: r.siteId ? sites.find((s) => s.id === r.siteId)?.name || '' : '',
            });
          }
        });
        myLeaves.forEach((l) => {
          if (
            (l.status === 'confirmed' || l.status === 'approved' || l.status === 'rejected') &&
            (l.startDate || '') >= sinceStr
          ) {
            approvals.push({
              status: l.status === 'confirmed' ? 'approved' : l.status,
              date: l.startDate,
              key: `lv-${l.id}`,
              label: `연차 ${l.startDate}${l.endDate && l.endDate !== l.startDate ? ` ~ ${l.endDate}` : ''} (${l.days || 1}일)`,
              sub: l.reason || '',
            });
          }
        });
        approvals.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setRecentApprovals(approvals.slice(0, 6));
      }
    } catch (err) {
      console.error('대시보드 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  const today = new Date();
  const weekdayKor = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()];
  const todayLabel = `${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()} (${weekdayKor})`;
  const todayLabelFull = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 (${weekdayKor})`;

  return (
    <div className="dashboard-page">
      <div className="dashboard-welcome">
        <div className="dashboard-welcome-text">
          <h2 title={userProfile?.name}>{userProfile?.name}</h2>
          <p title={userProfile?.position || (isAdmin ? '관리자' : '')}>
            {userProfile?.position || (isAdmin ? '관리자' : '')}
          </p>
        </div>
        <div className="dashboard-welcome-date" title={todayLabelFull}>
          {todayLabel}
        </div>
      </div>

      {isAdmin ? (
        <div className="dashboard-tiles dashboard-tiles-3">
          <div className="dashboard-tile tile-users is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">사용자</div>
              <div className="tile-value">
                {adminStats.users}
                <span>명</span>
              </div>
              <div className="tile-sub">활성 사용자</div>
            </div>
          </div>

          <div className="dashboard-tile tile-departments is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18" />
                <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
                <line x1="10" y1="8" x2="14" y2="8" />
                <line x1="10" y1="12" x2="14" y2="12" />
                <line x1="10" y1="16" x2="14" y2="16" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">부서</div>
              <div className="tile-value">
                {adminStats.departments}
                <span>개</span>
              </div>
              <div className="tile-sub">조직 단위</div>
            </div>
          </div>

          <div className="dashboard-tile tile-site is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 9h.01" />
                <path d="M9 13h.01" />
                <path d="M9 17h.01" />
                <path d="M15 9h.01" />
                <path d="M15 13h.01" />
                <path d="M15 17h.01" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">프로젝트</div>
              <div className="tile-value">
                {siteCount}
                <span>개</span>
              </div>
              <div className="tile-sub">등록 프로젝트</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="dashboard-tiles dashboard-tiles-3">
          <div className="dashboard-tile tile-overtime is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">이번 달 잔업</div>
              <div className="tile-value">{formatMinutes(monthlyOvertime)}</div>
              <div className="tile-sub">{overtimeCount}건 등록</div>
            </div>
          </div>

          <div className="dashboard-tile tile-leave is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">연차 잔여</div>
              <div className="tile-value">{leaveBalance ? `${leaveBalance.remainingDays}일` : '-'}</div>
              <div className="tile-sub">
                {leaveBalance ? `누적 ${leaveBalance.totalDays}일 · 사용 ${leaveBalance.usedDays}일` : '연차 정보 없음'}
              </div>
            </div>
          </div>

          <div className="dashboard-tile tile-site is-static">
            <div className="tile-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 9h.01" />
                <path d="M9 13h.01" />
                <path d="M9 17h.01" />
                <path d="M15 9h.01" />
                <path d="M15 13h.01" />
                <path d="M15 17h.01" />
              </svg>
            </div>
            <div className="tile-body">
              <div className="tile-title">담당 프로젝트</div>
              <div className="tile-value">
                {siteCount}
                <span>개</span>
              </div>
              <div className="tile-sub">진행 중</div>
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-main-grid">
        <section className="home-panel">
          <div className="home-panel-head">
            <strong>{isAdmin ? '결재 대기 목록' : '최근 결재 결과'}</strong>
            {isAdmin ? (
              <Link className="home-panel-more" to="/admin/reports">
                전체보기
              </Link>
            ) : (
              <span className="text-muted text-sm">최근 1일</span>
            )}
          </div>

          {isAdmin ? (
            pendingList.length > 0 ? (
              <ul className="home-list">
                {pendingList.map((it) => (
                  <li key={it.key} className="home-list-item">
                    <Link to={it.to} className="home-list-link">
                      <span className={`home-badge home-badge-${it.badgeType}`}>{it.badge}</span>
                      <div className="home-list-body">
                        <strong title={it.title}>{it.title}</strong>
                        <span className="home-list-sub" title={it.sub}>
                          {it.sub}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="home-empty">결재 대기 항목이 없습니다.</div>
            )
          ) : recentApprovals.length > 0 ? (
            <ul className="home-list">
              {recentApprovals.map((a) => (
                <li key={a.key} className="home-list-item">
                  <span className={`home-badge home-badge-${a.status}`}>
                    {a.status === 'approved' ? '승인' : a.status === 'rejected' ? '반려' : '대기'}
                  </span>
                  <div className="home-list-body">
                    <strong title={a.label}>{a.label}</strong>
                    {a.sub && (
                      <span className="home-list-sub" title={a.sub}>
                        {a.sub}
                      </span>
                    )}
                  </div>
                  <span className="home-list-date">{formatDisplayDate(a.date)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-empty">최근 결재 결과가 없습니다.</div>
          )}
        </section>

        <section className="home-panel">
          <div className="home-panel-head">
            <strong>공지사항</strong>
            {isAdmin && (
              <Link className="home-panel-more" to="/admin/events">
                전체보기
              </Link>
            )}
          </div>
          {notices.length > 0 ? (
            <ul className="home-list">
              {notices.map((n) => (
                <li key={n.id} className="home-list-item">
                  <span className="home-notice-dot" />
                  <div className="home-list-body">
                    <strong title={n.title}>{n.title}</strong>
                    {n.location && (
                      <span className="home-list-sub" title={n.location}>
                        {n.location}
                      </span>
                    )}
                  </div>
                  <span className="home-list-date">{formatDisplayDate(n.startDate)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-empty">등록된 공지가 없습니다.</div>
          )}
        </section>
      </div>

      <HomeCalendar />
    </div>
  );
}
