import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getSitesByManager, getClosingItems } from '../../services/siteService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';

export default function MyProjectsPage() {
  const { userProfile } = useAuth();
  const [sites, setSites] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [rawRecords, setRawRecords] = useState([]);
  const [rawLeaves, setRawLeaves] = useState([]);
  const [siteEmployees, setSiteEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCalDay, setSelectedCalDay] = useState(null);

  useEffect(() => {
    if (userProfile?.uid) loadBase();
  }, [userProfile?.uid]);

  useEffect(() => {
    if (sites.length > 0) loadMonthData();
    else { setRawRecords([]); setRawLeaves([]); setSiteEmployees({}); }
  }, [sites, year, month]);

  async function loadBase() {
    setLoading(true);
    try {
      const [mySites, users] = await Promise.all([
        getSitesByManager(userProfile.uid),
        getUsers(),
      ]);
      setSites(mySites);
      setAllUsers(users);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthData() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const [records, leaves, ...closings] = await Promise.all([
        getAllOvertimeRecords(start, end),
        getApprovedLeavesByMonth(year, month),
        ...sites.map((s) => getClosingItems(s.id, year, month)),
      ]);
      setRawRecords(records);
      setRawLeaves(leaves);
      const empMap = {};
      sites.forEach((s, i) => {
        const items = closings[i] || [];
        const names = new Set();
        items.forEach((it) => {
          if (it.itemType === 'employee' && it.detail) names.add(it.detail);
        });
        empMap[s.id] = Array.from(names);
      });
      setSiteEmployees(empMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const userByName = useMemo(() => {
    const map = {};
    allUsers.forEach((u) => { if (u.name) map[u.name] = u; });
    return map;
  }, [allUsers]);

  const userByUid = useMemo(
    () => Object.fromEntries(allUsers.map((u) => [u.uid, u])),
    [allUsers],
  );

  const rows = useMemo(() => {
    return sites.map((s) => {
      const employees = siteEmployees[s.id] || [];
      const employeeUids = new Set(employees.map((n) => userByName[n]?.uid).filter(Boolean));
      const ot = rawRecords
        .filter((r) => r.status === 'approved' && r.siteId === s.id)
        .reduce((sum, r) => sum + (r.minutes || 0), 0);
      const leaveDays = rawLeaves
        .filter((l) => employeeUids.has(l.userId))
        .reduce((sum, l) => sum + (l.days || 0), 0);
      return {
        siteId: s.id,
        siteName: s.name,
        memberCount: employees.length,
        overtimeMinutes: ot,
        leaveDays,
      };
    });
  }, [sites, siteEmployees, rawRecords, rawLeaves, userByName]);

  const totalMembers = rows.reduce((s, r) => s + r.memberCount, 0);
  const totalOT = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalLeave = rows.reduce((s, r) => s + r.leaveDays, 0);

  const calendarEventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => { (map[date] = map[date] || []).push(ev); };
    const mySiteIds = new Set(sites.map((s) => s.id));

    rawRecords
      .filter((r) => r.status === 'approved' && mySiteIds.has(r.siteId))
      .forEach((r) => {
        const u = userByUid[r.userId];
        const s = sites.find((x) => x.id === r.siteId);
        push(r.date, {
          kind: 'overtime',
          minutes: r.minutes || 0,
          label: u?.name || '?',
          siteName: s?.name || '',
        });
      });

    const allEmployeeUids = new Set();
    Object.values(siteEmployees).forEach((names) => {
      names.forEach((n) => {
        const u = userByName[n];
        if (u?.uid) allEmployeeUids.add(u.uid);
      });
    });
    rawLeaves
      .filter((l) => allEmployeeUids.has(l.userId))
      .forEach((l) => {
        const from = new Date(l.startDate);
        const to = new Date(l.endDate);
        for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
          if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const u = userByUid[l.userId];
          push(dateStr, { kind: 'leave', type: l.type, label: u?.name || '?' });
        }
      });

    return map;
  }, [sites, siteEmployees, rawRecords, rawLeaves, userByName, userByUid, year, month]);

  function shiftMonth(delta) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y -= 1; }
    else if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
    setSelectedCalDay(null);
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

  function leaveTypeLabel(t) {
    if (t === 'half_am') return '오전반차';
    if (t === 'half_pm') return '오후반차';
    if (t === 'sick') return '병가';
    if (t === 'quarter_1' || t === 'quarter_2' || t === 'quarter_3' || t === 'quarter_4') return '반반차';
    return '연차';
  }

  const todayRef = new Date();

  return (
    <div className="reports-page">
      <h2>내 프로젝트</h2>

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
        <div className="card"><div className="card-body empty-state">담당하는 프로젝트가 없습니다.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="table team-stats-table team-stats-4col">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>인원</th>
                <th>잔업</th>
                <th>연차</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.siteId}>
                  <td><strong>{r.siteName}</strong></td>
                  <td>{r.memberCount > 0 ? `${r.memberCount}명` : '-'}</td>
                  <td>{r.overtimeMinutes > 0 ? <strong>{formatMinutes(r.overtimeMinutes)}</strong> : '-'}</td>
                  <td>{r.leaveDays > 0 ? <strong>{r.leaveDays}일</strong> : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>합계 ({rows.length}개)</strong></td>
                <td><strong>{totalMembers}명</strong></td>
                <td><strong>{formatMinutes(totalOT)}</strong></td>
                <td><strong>{totalLeave}일</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="team-calendar-section">
          <div className="team-calendar-head">
            <div className="team-calendar-title">
              <strong>프로젝트 일정</strong>
            </div>
            <div className="team-calendar-nav">
              <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftMonth(-1)} aria-label="이전 달">‹</button>
              <span className="team-calendar-ym">{year}년 {month}월</span>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftMonth(1)} aria-label="다음 달">›</button>
            </div>
          </div>

          <div className="team-calendar">
            <div className="team-calendar-dow-row">
              {['일', '월', '화', '수', '목', '금', '토'].map((dn, i) => (
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
                      <div className="team-cal-events team-cal-events-dots">
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

          {selectedCalDay && (() => {
            const evs = calendarEventsByDate[selectedCalDay] || [];
            const [, mm, dd] = selectedCalDay.split('-');
            return (
              <div className="team-calendar-day-detail">
                <div className="team-calendar-day-detail-head">
                  <strong>{Number(mm)}/{Number(dd)}</strong>
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
                      {e.kind === 'overtime' && e.siteName && (
                        <span className="team-calendar-ev-site">{e.siteName}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
