import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getAllSites, getClosingItems } from '../../services/siteService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import { QUARTER_LEAVE_TYPES } from '../../utils/constants';

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function leaveLabel(type) {
  if (!type) return '';
  if (type === 'half_am') return '오전반차';
  if (type === 'half_pm') return '오후반차';
  if (QUARTER_LEAVE_TYPES.includes(type)) return '반반차';
  if (type === 'sick') return '병가';
  return '연차';
}

export default function UnassignedReportPage() {
  const { isAdmin } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [overtimes, setOvertimes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [u, s] = await Promise.all([getUsers(), getAllSites()]);
        setUsers(u.filter((x) => x.role !== 'admin' && x.isActive !== false));
        setSites(s);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (sites.length === 0) return;
    (async () => {
      setLoading(true);
      try {
        const start = getMonthStart(year, month);
        const end = getMonthEnd(year, month);
        const [perSite, lvs, ots] = await Promise.all([
          Promise.all(
            sites.map(async (s) => {
              const items = await getClosingItems(s.id, year, month);
              return items
                .filter((it) => it.itemType === 'employee')
                .map((it) => ({ siteId: s.id, siteName: s.name, detail: it.detail, dailyQuantities: it.dailyQuantities || {} }));
            }),
          ),
          getApprovedLeavesByMonth(year, month),
          getAllOvertimeRecords(start, end),
        ]);
        setAllItems(perSite.flat());
        setLeaves(lvs);
        setOvertimes(ots.filter((o) => o.status === 'approved'));
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [sites, year, month]);

  const { rows, topUnassigned, topOverlap } = useMemo(() => {
    const totalDays = daysInMonth(year, month);
    const assigned = {};
    for (const it of allItems) {
      if (!it.detail) continue;
      if (!assigned[it.detail]) assigned[it.detail] = {};
      for (const [dStr, q] of Object.entries(it.dailyQuantities || {})) {
        const d = Number(dStr);
        if (!q || Number(q) <= 0) continue;
        if (!assigned[it.detail][d]) assigned[it.detail][d] = [];
        if (!assigned[it.detail][d].includes(it.siteName)) {
          assigned[it.detail][d].push(it.siteName);
        }
      }
    }

    const userIdToName = Object.fromEntries(users.map((u) => [u.uid, u.name]));
    const nameToLeaveDay = {};
    for (const l of leaves) {
      const name = userIdToName[l.userId];
      if (!name) continue;
      const s = new Date(l.startDate);
      const e = new Date(l.endDate);
      const cur = new Date(s);
      while (cur <= e) {
        if (cur.getFullYear() === year && cur.getMonth() + 1 === month) {
          const d = cur.getDate();
          if (!nameToLeaveDay[name]) nameToLeaveDay[name] = {};
          if (!nameToLeaveDay[name][d]) nameToLeaveDay[name][d] = l.type || 'annual';
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    // 잔업: userName → day → { minutes, siteNames: Set<string> }
    const siteIdToName = Object.fromEntries(sites.map((s) => [s.id, s.name]));
    const nameToOvertime = {};
    for (const o of overtimes) {
      const name = o.userName || userIdToName[o.userId];
      if (!name) continue;
      const d = new Date(o.date);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
      const day = d.getDate();
      if (!nameToOvertime[name]) nameToOvertime[name] = {};
      if (!nameToOvertime[name][day]) nameToOvertime[name][day] = { minutes: 0, siteNames: new Set() };
      nameToOvertime[name][day].minutes += (o.minutes || 0);
      if (o.siteId) {
        const sn = o.siteId === 'etc' ? '기타' : siteIdToName[o.siteId];
        if (sn) nameToOvertime[name][day].siteNames.add(sn);
      }
    }

    const leaveTypeToClass = (t) => {
      if (!t) return null;
      if (t === 'half_am' || t === 'half_pm') return 'leave-half';
      if (QUARTER_LEAVE_TYPES.includes(t)) return 'leave-quarter';
      if (t === 'sick') return 'leave-sick';
      return 'leave-annual';
    };

    const out = users.map((u) => {
      const days = [];
      let unassignedCount = 0;
      let overlapCount = 0;
      for (let d = 1; d <= totalDays; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const leaveType = nameToLeaveDay[u.name]?.[d];
        const projects = assigned[u.name]?.[d] || [];
        const otInfo = nameToOvertime[u.name]?.[d];
        const overtimeMin = otInfo?.minutes || 0;
        const otSiteNames = otInfo ? [...otInfo.siteNames] : [];
        let type;
        if (projects.length > 1) type = 'overlap';
        else if (projects.length === 1) type = 'assigned';
        else if (leaveType) type = leaveTypeToClass(leaveType);
        else if (isWeekend) type = 'weekend';
        else if (overtimeMin > 0) type = 'assigned';
        else type = 'unassigned';
        days.push({ d, type, projects, leaveType, overtimeMin, otSiteNames });
        if (type === 'unassigned') unassignedCount++;
        if (type === 'overlap') overlapCount++;
      }
      return { uid: u.uid, name: u.name, position: u.position || '', days, unassignedCount, overlapCount };
    });

    const topU = [...out].filter((r) => r.unassignedCount > 0).sort((a, b) => b.unassignedCount - a.unassignedCount).slice(0, 5);
    const topO = [...out].filter((r) => r.overlapCount > 0).sort((a, b) => b.overlapCount - a.overlapCount).slice(0, 5);
    const sorted = out.sort((a, b) =>
      (b.unassignedCount + b.overlapCount) - (a.unassignedCount + a.overlapCount) || a.name.localeCompare(b.name),
    );
    return { rows: sorted, topUnassigned: topU, topOverlap: topO };
  }, [users, allItems, leaves, overtimes, year, month]);

  const totalDays = daysInMonth(year, month);
  const dayHeaders = Array.from({ length: totalDays }, (_, i) => i + 1);

  if (!isAdmin) return <div className="card"><div className="card-body empty-state">접근 권한이 없습니다.</div></div>;

  return (
    <div className="unassigned-report-page">
      <div className="page-header">
        <h2>미배정 · 중복배정 현황</h2>
      </div>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      <div className="ua-top-grid">
        <div className="ua-summary-card">
          <div className="ua-summary-title">
            <span className="ua-dot ua-dot-unassigned" />
            미배정 Top
          </div>
          {topUnassigned.length === 0 ? (
            <p className="ua-summary-empty">미배정 직원 없음</p>
          ) : (
            <ul className="ua-summary-list">
              {topUnassigned.map((r) => (
                <li key={r.uid}><span>{r.name}</span><strong>{r.unassignedCount}일</strong></li>
              ))}
            </ul>
          )}
        </div>
        <div className="ua-summary-card">
          <div className="ua-summary-title">
            <span className="ua-dot ua-dot-overlap" />
            중복배정 Top
          </div>
          {topOverlap.length === 0 ? (
            <p className="ua-summary-empty">중복배정 없음</p>
          ) : (
            <ul className="ua-summary-list">
              {topOverlap.map((r) => (
                <li key={r.uid}><span>{r.name}</span><strong>{r.overlapCount}일</strong></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="ua-legend">
        <span><span className="ua-legend-swatch assigned" />배정</span>
        <span><span className="ua-legend-swatch overlap" />중복배정</span>
        <span><span className="ua-legend-swatch leave-annual" />연차</span>
        <span><span className="ua-legend-swatch leave-half" />반차</span>
        <span><span className="ua-legend-swatch leave-quarter" />반반차</span>
        <span><span className="ua-legend-swatch leave-sick" />병가</span>
        <span><span className="ua-legend-swatch weekend" />주말</span>
        <span><span className="ua-legend-swatch unassigned" />미배정</span>
        <span><span className="ua-legend-dot" />잔업</span>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="card-body empty-state">표시할 직원이 없습니다.</div></div>
      ) : (
        <div className="ua-timeline">
          <div className="ua-timeline-header">
            <div className="ua-timeline-name-col">직원</div>
            <div className="ua-timeline-days" style={{ gridTemplateColumns: `repeat(${totalDays}, 1fr)` }}>
              {dayHeaders.map((d) => {
                const dow = new Date(year, month - 1, d).getDay();
                return <span key={d} className={`day-label ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`}>{d}</span>;
              })}
            </div>
            <div className="ua-timeline-stats-col">현황</div>
          </div>

          <div className="ua-timeline-list">
            {rows.map((r) => (
              <div className="ua-timeline-row" key={r.uid}>
                <div className="ua-timeline-name-col">
                  <strong>{r.name}</strong>
                  {r.position && <span className="position-tag">{r.position}</span>}
                </div>
                <div className="ua-timeline-bar" style={{ gridTemplateColumns: `repeat(${totalDays}, 1fr)` }}>
                  {r.days.map((c) => {
                    const hasOT = c.overtimeMin > 0;
                    const isLeave = c.type.startsWith('leave-');
                    let baseTitle;
                    if (c.type === 'overlap') baseTitle = `중복배정: ${c.projects.join(', ')}`;
                    else if (c.type === 'assigned') {
                      if (c.projects.length > 0) baseTitle = c.projects.join(', ');
                      else if (c.otSiteNames.length > 0) baseTitle = `잔업: ${c.otSiteNames.join(', ')}`;
                      else baseTitle = '잔업';
                    } else if (isLeave) baseTitle = leaveLabel(c.leaveType);
                    else if (c.type === 'weekend') baseTitle = '주말';
                    else baseTitle = '미배정';
                    const title = hasOT ? `${baseTitle} · 잔업 ${formatMinutes(c.overtimeMin)}` : baseTitle;
                    return (
                      <div
                        key={c.d}
                        className={`ua-timeline-seg ${c.type} ${hasOT ? 'has-overtime' : ''}`}
                        title={`${c.d}일 · ${title}`}
                      />
                    );
                  })}
                </div>
                <div className="ua-timeline-stats-col">
                  <div className="ua-timeline-stat">
                    <span>미배정</span>
                    <strong className={r.unassignedCount > 0 ? 'neg' : ''}>{r.unassignedCount}</strong>
                  </div>
                  <div className="ua-timeline-stat">
                    <span>중복</span>
                    <strong className={r.overlapCount > 0 ? 'warn' : ''}>{r.overlapCount}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
