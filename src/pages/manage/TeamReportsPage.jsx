import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getDepartments, getDepartmentsByLeader } from '../../services/departmentService';
import { getAllSites } from '../../services/siteService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import { EmployeeDetailModal } from '../admin/ReportsPage';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';

export default function TeamReportsPage() {
  const { userProfile, isAdmin, canApproveAll } = useAuth();
  const [allUsers, setAllUsers] = useState([]);
  const [scopedUsers, setScopedUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [myDepts, setMyDepts] = useState([]);
  const [sites, setSites] = useState([]);
  const [rawRecords, setRawRecords] = useState([]);
  const [rawLeaves, setRawLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [detailUser, setDetailUser] = useState(null);
  const [detailTab, setDetailTab] = useState('overtime');
  const [selectedCalDay, setSelectedCalDay] = useState(null);

  useEffect(() => {
    if (userProfile) loadBase();
  }, [userProfile]);

  useEffect(() => {
    if (scopedUsers.length > 0) loadMonthData();
  }, [scopedUsers, year, month]);

  async function loadBase() {
    setLoading(true);
    const [fetchedUsers, deps, allSites] = await Promise.all([getUsers(), getDepartments(), getAllSites()]);

    let scoped = fetchedUsers;
    let depts = [];
    if (!canApproveAll) {
      depts = await getDepartmentsByLeader(userProfile.uid);
      const myDeptIds = new Set(depts.map((d) => d.id));
      scoped = fetchedUsers.filter((u) => myDeptIds.has(u.departmentId));
    }

    setAllUsers(fetchedUsers);
    setScopedUsers(scoped);
    setDepartments(deps);
    setMyDepts(depts);
    setSites(allSites);
  }

  async function loadMonthData() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const [records, approvedLeaves] = await Promise.all([
        getAllOvertimeRecords(start, end),
        getApprovedLeavesByMonth(year, month),
      ]);
      setRawRecords(records);
      setRawLeaves(approvedLeaves);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const siteMap = { etc: '기타' };
  sites.forEach((s) => {
    siteMap[s.id] = s.name;
  });

  const myTeam = myDepts[0];

  // 팀원 목록 + 잔업/연차 데이터 합산
  const rankOf = (uid) => (myTeam?.managerId === uid ? 0 : myTeam?.subManagerId === uid ? 1 : 2);
  const teamMembers = myTeam
    ? allUsers.filter((u) => u.departmentId === myTeam.id).sort((a, b) => rankOf(a.uid) - rankOf(b.uid))
    : scopedUsers.filter((u) => u.role !== 'admin');

  const overtimeByUser = {};
  rawRecords.forEach((r) => {
    if (r.status !== 'approved') return;
    if (!overtimeByUser[r.userId]) overtimeByUser[r.userId] = { minutes: 0, count: 0 };
    overtimeByUser[r.userId].minutes += r.minutes || 0;
    overtimeByUser[r.userId].count++;
  });

  const leaveByUser = {};
  rawLeaves.forEach((l) => {
    if (!leaveByUser[l.userId]) leaveByUser[l.userId] = 0;
    leaveByUser[l.userId] += l.days || 0;
  });

  const rows = teamMembers
    .filter((u) => u.isActive !== false && u.role !== 'admin')
    .map((u) => ({
      uid: u.uid,
      name: u.name,
      position: u.position || '',
      isLeader: myTeam && u.uid === myTeam.managerId,
      isSubLeader: myTeam && u.uid === myTeam.subManagerId,
      isMe: u.uid === userProfile.uid,
      overtimeMinutes: overtimeByUser[u.uid]?.minutes || 0,
      overtimeCount: overtimeByUser[u.uid]?.count || 0,
      leaveDays: leaveByUser[u.uid] || 0,
      departmentId: u.departmentId,
    }));

  const totalOT = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalOTCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeave = rows.reduce((s, r) => s + r.leaveDays, 0);

  function openDetail(row, tab) {
    setDetailUser(row);
    setDetailTab(tab);
  }

  // === 팀원 일정 캘린더 (본인 포함) ===
  const userMap = Object.fromEntries(allUsers.map((u) => [u.uid, u]));
  const teammateIds = useMemo(() => {
    return new Set(teamMembers.map((u) => u.uid));
    // teamMembers 기반이므로 deps 지정 시 무한 루프 우려, 직접 계산 후 메모만 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamMembers.length]);

  const calendarEventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => {
      (map[date] = map[date] || []).push(ev);
    };
    rawLeaves
      .filter((l) => teammateIds.has(l.userId))
      .forEach((l) => {
        const from = new Date(l.startDate);
        const to = new Date(l.endDate);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const u = userMap[l.userId];
          push(dateStr, { userId: l.userId, kind: 'leave', type: l.type, label: u?.name || '?' });
        }
      });
    rawRecords
      .filter((r) => r.status === 'approved' && teammateIds.has(r.userId))
      .forEach((r) => {
        const u = userMap[r.userId];
        push(r.date, {
          userId: r.userId,
          kind: 'overtime',
          minutes: r.minutes || 0,
          label: u?.name || '?',
          siteId: r.siteId || '',
          siteName: r.siteId ? siteMap[r.siteId] || '' : '',
        });
      });
    return map;
  }, [rawLeaves, rawRecords, teammateIds, year, month, userMap, siteMap]);

  function leaveTypeLabel(t) {
    if (t === 'half_am') return '오전반차';
    if (t === 'half_pm') return '오후반차';
    if (t === 'sick') return '병가';
    if (t === 'quarter_1' || t === 'quarter_2' || t === 'quarter_3' || t === 'quarter_4') return '반반차';
    return '연차';
  }
  function buildCalendarWeeks(y, m) {
    const firstDow = new Date(y, m - 1, 1).getDay();
    const totalDays = new Date(y, m, 0).getDate();
    const weeks = [];
    let week = new Array(firstDow).fill(null);
    for (let d = 1; d <= totalDays; d++) {
      week.push(d);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }
  function shiftMonth(delta) {
    let y = year;
    let m = month + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setYear(y);
    setMonth(m);
    setSelectedCalDay(null);
  }
  const todayRef = new Date();

  return (
    <div className="reports-page">
      <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYear(Number(v))}
          options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="연도 선택"
        />
        <Select
          value={month}
          onChange={(v) => setMonth(Number(v))}
          options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
      </div>

      {loading ? (
        <Skeleton.Rows count={6} />
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">팀원이 없습니다.</div>
        </div>
      ) : (
        <div className="table-wrap table-scroll-x">
          <table className="table team-stats-table team-stats-4col cards-sm">
            <thead>
              <tr>
                <th>이름</th>
                <th>직급</th>
                <th>잔업</th>
                <th>연차</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid}>
                  <td data-label="이름" title={r.name}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flexWrap: 'wrap', rowGap: 2 }}>
                      <strong title={r.name} className="u-ellipsis-1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 60, flexShrink: 1, minHeight: 22 }}>{r.name}</strong>
                      {r.isLeader && (
                        <span className="badge badge-role-manager" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: 22, minHeight: 22 }}>
                          팀장
                        </span>
                      )}
                      {r.isSubLeader && (
                        <span className="badge badge-role-manager" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: 22, minHeight: 22 }}>
                          부팀장
                        </span>
                      )}
                      {r.isMe && (
                        <span className="badge badge-position" style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, height: 22, minHeight: 22 }}>
                          나
                        </span>
                      )}
                    </div>
                  </td>
                  <td data-label="직급" title={r.position || ''}>{r.position || '-'}</td>
                  <td data-label="잔업">
                    <button type="button" className="team-detail-btn" style={{ width: '100%', alignItems: 'center', gap: 4, minHeight: 36 }} onClick={() => openDetail(r, 'overtime')}>
                      {r.overtimeMinutes > 0 ? (
                        <>
                          <strong>{formatMinutes(r.overtimeMinutes)}</strong>{' '}
                          <Icon name="chevronRight" className="team-detail-arrow" />
                        </>
                      ) : (
                        '-'
                      )}
                    </button>
                  </td>
                  <td data-label="연차">
                    <button type="button" className="team-detail-btn" style={{ width: '100%', alignItems: 'center', gap: 4, minHeight: 36 }} onClick={() => openDetail(r, 'leave')}>
                      {r.leaveDays > 0 ? (
                        <>
                          <strong>{r.leaveDays}일</strong> <Icon name="chevronRight" className="team-detail-arrow" />
                        </>
                      ) : (
                        '-'
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} data-label="합계">
                  <strong>합계 ({rows.length}명)</strong>
                </td>
                <td data-label="잔업">
                  <strong>{formatMinutes(totalOT)}</strong>
                </td>
                <td data-label="연차">
                  <strong>{totalLeave}일</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 팀원 일정 캘린더 — 본인 포함 */}
      {!loading && rows.length > 0 && (
        <div className="team-calendar-section">
          <div className="team-calendar-head">
            <div className="team-calendar-title">
              <strong>팀원 일정</strong>
            </div>
            <div className="team-calendar-nav">
              <button
                type="button"
                className="btn btn-sm btn-outline btn-icon"
                onClick={() => shiftMonth(-1)}
                aria-label="이전 달"
                title="이전 달"
              >
                <Icon name="chevronRight" className="btn-ic" style={{ transform: 'rotate(180deg)' }} />
              </button>
              <span className="team-calendar-ym">
                {year}년 {month}월
              </span>
              <button
                type="button"
                className="btn btn-sm btn-outline btn-icon"
                onClick={() => shiftMonth(1)}
                aria-label="다음 달"
                title="다음 달"
              >
                <Icon name="chevronRight" className="btn-ic" />
              </button>
            </div>
          </div>

          <div className="team-calendar team-calendar-compact-xs">
            <div className="team-calendar-dow-row">
              {['일', '월', '화', '수', '목', '금', '토'].map((dn, i) => (
                <div key={dn} className={`team-calendar-dow ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`}>
                  {dn}
                </div>
              ))}
            </div>
            {buildCalendarWeeks(year, month).map((wk, wi) => (
              <div className="team-calendar-row" key={wi}>
                {wk.map((d, di) => {
                  if (d === null) return <div className="team-cal-cell team-cal-empty" key={di} />;
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const events = calendarEventsByDate[dateStr] || [];
                  const isToday =
                    year === todayRef.getFullYear() && month === todayRef.getMonth() + 1 && d === todayRef.getDate();
                  const isSunday = di === 0;
                  const isSaturday = di === 6;
                  const visible = events.slice(0, 3);
                  const extra = events.length - visible.length;
                  return (
                    <button
                      type="button"
                      key={di}
                      className={`team-cal-cell ${events.length > 0 ? 'has-events' : ''} ${isToday ? 'is-today' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${selectedCalDay === dateStr ? 'is-selected' : ''}`}
                      style={{ minHeight: 'clamp(42px, 8vw, 56px)', display: 'flex', flexDirection: 'column' }}
                      onClick={() => setSelectedCalDay(selectedCalDay === dateStr ? null : dateStr)}
                      disabled={events.length === 0}
                    >
                      <span className="team-cal-day">{d}</span>
                      <div className="team-cal-events team-cal-events-dots" style={{ marginTop: 'auto' }}>
                        {visible.map((e, i) => (
                          <span
                            key={i}
                            className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`}
                            title={`${e.label} · ${e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}`}
                          />
                        ))}
                        {extra > 0 && <span className="team-cal-ev-more">+{extra}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {selectedCalDay &&
            (() => {
              const evs = calendarEventsByDate[selectedCalDay] || [];
              const [, mm, dd] = selectedCalDay.split('-');
              return (
                <div className="team-calendar-day-detail">
                  <div className="team-calendar-day-detail-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>
                      {Number(mm)}월 {Number(dd)}일
                    </strong>
                    <span className="team-calendar-hint">· {evs.length}건</span>
                    <button
                      type="button"
                      className="team-calendar-close"
                      onClick={() => setSelectedCalDay(null)}
                      aria-label="닫기"
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                  <ul className="team-calendar-day-list">
                    {evs.map((e, i) => {
                      const linkable = e.kind === 'overtime' && !!e.siteId;
                      const inner = (
                        <>
                          <span
                            className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`}
                          />
                          <strong className="u-ellipsis-1" title={e.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' }}>{e.label}</strong>
                          <span className="team-calendar-ev-detail">
                            {e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}
                          </span>
                          {e.kind === 'overtime' && e.siteName && (
                            <span className="team-calendar-ev-site u-ellipsis-1" title={e.siteName}>{e.siteName}</span>
                          )}
                        </>
                      );
                      return linkable ? (
                        <li key={i} className="has-link" style={{ minHeight: 48 }}>
                          <Link
                            to={`/sites/${e.siteId}/${year}/${month}`}
                            className="team-calendar-day-link"
                            title={`${e.siteName} 마감 페이지로 이동`}
                            style={{ display: 'flex', alignItems: 'center', minHeight: 48 }}
                          >
                            {inner}
                          </Link>
                        </li>
                      ) : (
                        <li key={i} style={{ minHeight: 48, display: 'flex', alignItems: 'center' }}>{inner}</li>
                      );
                    })}
                  </ul>
                </div>
              );
            })()}
        </div>
      )}

      {detailUser && (
        <EmployeeDetailModal
          user={detailUser}
          tab={detailTab}
          year={year}
          month={month}
          overtimes={rawRecords.filter((r) => r.userId === detailUser.uid && r.status === 'approved')}
          leaves={rawLeaves.filter((l) => l.userId === detailUser.uid)}
          siteMap={siteMap}
          canEdit={isAdmin}
          onClose={() => setDetailUser(null)}
          onChanged={loadMonthData}
        />
      )}
    </div>
  );
}
