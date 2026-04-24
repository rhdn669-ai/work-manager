import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getDepartments, getDepartmentsByLeader } from '../../services/departmentService';
import { getAllSites } from '../../services/siteService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import { EmployeeDetailModal } from '../admin/ReportsPage';

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
    const [fetchedUsers, deps, allSites] = await Promise.all([
      getUsers(),
      getDepartments(),
      getAllSites(),
    ]);

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
  sites.forEach((s) => { siteMap[s.id] = s.name; });

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

  const rows = teamMembers.filter((u) => u.isActive !== false && u.role !== 'admin').map((u) => ({
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

  // === 팀원 일정 캘린더 (본인 제외) ===
  const userMap = Object.fromEntries(allUsers.map((u) => [u.uid, u]));
  const teammateIds = useMemo(() => {
    const ids = new Set(teamMembers.map((u) => u.uid));
    ids.delete(userProfile?.uid);
    return ids;
  // teamMembers/userProfile.uid 기반이므로 deps 지정 시 무한 루프 우려, 직접 계산 후 메모만 사용
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamMembers.length, userProfile?.uid]);

  const calendarEventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => { (map[date] = map[date] || []).push(ev); };
    rawLeaves.filter((l) => teammateIds.has(l.userId)).forEach((l) => {
      const from = new Date(l.startDate);
      const to = new Date(l.endDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const u = userMap[l.userId];
        push(dateStr, { userId: l.userId, kind: 'leave', type: l.type, label: u?.name || '?' });
      }
    });
    rawRecords.filter((r) => r.status === 'approved' && teammateIds.has(r.userId)).forEach((r) => {
      const u = userMap[r.userId];
      push(r.date, { userId: r.userId, kind: 'overtime', minutes: r.minutes || 0, label: u?.name || '?' });
    });
    return map;
  }, [rawLeaves, rawRecords, teammateIds, year, month, userMap]);

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
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }
    return weeks;
  }
  function shiftMonth(delta) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    else if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
    setSelectedCalDay(null);
  }
  const todayRef = new Date();

  return (
    <div className="reports-page">
      <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="card-body empty-state">팀원이 없습니다.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="table team-stats-table team-stats-4col">
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
                  <td>
                    <strong>{r.name}</strong>
                    {r.isLeader && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>팀장</span>}
                    {r.isSubLeader && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>부팀장</span>}
                    {r.isMe && <span className="badge badge-position" style={{ marginLeft: 6 }}>나</span>}
                  </td>
                  <td>{r.position || '-'}</td>
                  <td>
                    <button className="team-detail-btn" onClick={() => openDetail(r, 'overtime')}>
                      {r.overtimeMinutes > 0 ? <><strong>{formatMinutes(r.overtimeMinutes)}</strong> <span className="team-detail-arrow">&rsaquo;</span></> : '-'}
                    </button>
                  </td>
                  <td>
                    <button className="team-detail-btn" onClick={() => openDetail(r, 'leave')}>
                      {r.leaveDays > 0 ? <><strong>{r.leaveDays}일</strong> <span className="team-detail-arrow">&rsaquo;</span></> : '-'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>합계 ({rows.length}명)</strong></td>
                <td><strong>{formatMinutes(totalOT)}</strong></td>
                <td><strong>{totalLeave}일</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* 팀원 일정 캘린더 — 본인 잔업/연차 제외 */}
      {!loading && rows.length > 0 && (
        <div className="team-calendar-section">
          <div className="team-calendar-head">
            <div className="team-calendar-title">
              <strong>팀원 일정</strong>
              <span className="team-calendar-hint">· 본인 잔업/연차 제외</span>
            </div>
            <div className="team-calendar-nav">
              <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftMonth(-1)} aria-label="이전 달">‹</button>
              <span className="team-calendar-ym">{year}년 {month}월</span>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftMonth(1)} aria-label="다음 달">›</button>
            </div>
          </div>

          <div className="team-calendar">
            <div className="team-calendar-dow-row">
              {['일','월','화','수','목','금','토'].map((dn, i) => (
                <div key={dn} className={`team-calendar-dow ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`}>{dn}</div>
              ))}
            </div>
            {buildCalendarWeeks(year, month).map((wk, wi) => (
              <div className="team-calendar-row" key={wi}>
                {wk.map((d, di) => {
                  if (d === null) return <div className="team-cal-cell team-cal-empty" key={di} />;
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const events = calendarEventsByDate[dateStr] || [];
                  const isToday =
                    year === todayRef.getFullYear() &&
                    month === todayRef.getMonth() + 1 &&
                    d === todayRef.getDate();
                  const isSunday = di === 0;
                  const isSaturday = di === 6;
                  const visible = events.slice(0, 3);
                  const extra = events.length - visible.length;
                  return (
                    <button
                      type="button"
                      key={di}
                      className={`team-cal-cell ${events.length > 0 ? 'has-events' : ''} ${isToday ? 'is-today' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${selectedCalDay === dateStr ? 'is-selected' : ''}`}
                      onClick={() => setSelectedCalDay(selectedCalDay === dateStr ? null : dateStr)}
                      disabled={events.length === 0}
                    >
                      <span className="team-cal-day">{d}</span>
                      <div className="team-cal-events">
                        {visible.map((e, i) => (
                          <span
                            key={i}
                            className={`team-cal-ev team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`}
                            title={`${e.label} · ${e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}`}
                          >
                            {e.label}
                          </span>
                        ))}
                        {extra > 0 && <span className="team-cal-ev-more">+{extra}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {selectedCalDay && (() => {
            const evs = calendarEventsByDate[selectedCalDay] || [];
            const [, mm, dd] = selectedCalDay.split('-');
            return (
              <div className="team-calendar-day-detail">
                <div className="team-calendar-day-detail-head">
                  <strong>{Number(mm)}월 {Number(dd)}일</strong>
                  <span className="team-calendar-hint">· {evs.length}건</span>
                  <button type="button" className="team-calendar-close" onClick={() => setSelectedCalDay(null)} aria-label="닫기">✕</button>
                </div>
                <ul className="team-calendar-day-list">
                  {evs.map((e, i) => (
                    <li key={i}>
                      <span className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`} />
                      <strong>{e.label}</strong>
                      <span className="team-calendar-ev-detail">
                        {e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}
                      </span>
                    </li>
                  ))}
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
