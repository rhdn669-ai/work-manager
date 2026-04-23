import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getAllSites, getClosingItems } from '../../services/siteService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
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
  const [allItems, setAllItems] = useState([]); // { siteId, siteName, detail, dailyQuantities }
  const [leaves, setLeaves] = useState([]);
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
        const perSite = await Promise.all(
          sites.map(async (s) => {
            const items = await getClosingItems(s.id, year, month);
            return items
              .filter((it) => it.itemType === 'employee')
              .map((it) => ({ siteId: s.id, siteName: s.name, detail: it.detail, dailyQuantities: it.dailyQuantities || {} }));
          }),
        );
        setAllItems(perSite.flat());
        const lvs = await getApprovedLeavesByMonth(year, month);
        setLeaves(lvs);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    })();
  }, [sites, year, month]);

  const { rows, topUnassigned } = useMemo(() => {
    const totalDays = daysInMonth(year, month);
    // 직원명 → day → [siteName...]
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

    // 직원별 연차 맵: userId → day → leaveType
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

    const out = users.map((u) => {
      const days = [];
      let unassignedCount = 0;
      for (let d = 1; d <= totalDays; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const leaveType = nameToLeaveDay[u.name]?.[d];
        const projects = assigned[u.name]?.[d] || [];
        let type;
        if (projects.length > 0) type = 'assigned';
        else if (leaveType) type = 'leave';
        else if (isWeekend) type = 'weekend';
        else type = 'unassigned';
        days.push({ d, type, projects, leaveType });
        if (type === 'unassigned') unassignedCount++;
      }
      return { uid: u.uid, name: u.name, position: u.position || '', days, unassignedCount };
    }).sort((a, b) => b.unassignedCount - a.unassignedCount || a.name.localeCompare(b.name));

    const top = [...out].filter((r) => r.unassignedCount > 0).slice(0, 5);
    return { rows: out, topUnassigned: top };
  }, [users, allItems, leaves, year, month]);

  const totalDays = daysInMonth(year, month);
  const dayHeaders = Array.from({ length: totalDays }, (_, i) => i + 1);

  if (!isAdmin) return <div className="card"><div className="card-body empty-state">접근 권한이 없습니다.</div></div>;

  return (
    <div className="unassigned-report-page">
      <div className="page-header">
        <h2>미배정 현황</h2>
      </div>
      <p className="field-hint">선택한 월에 어느 프로젝트에도 배정되지 않은 평일을 직원별로 확인합니다. 주말·연차는 미배정 집계에서 제외됩니다.</p>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
      </div>

      {topUnassigned.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <strong style={{ fontSize: 13 }}>미배정 Top {topUnassigned.length}</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {topUnassigned.map((r) => (
                <span key={r.uid} className="badge badge-warning" style={{ fontSize: 12 }}>
                  {r.name} · {r.unassignedCount}일
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="legend" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, marginBottom: 8 }}>
        <span><span className="unassigned-cell assigned" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}></span>배정</span>
        <span><span className="unassigned-cell leave" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}></span>연차</span>
        <span><span className="unassigned-cell weekend" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}></span>주말</span>
        <span><span className="unassigned-cell unassigned" style={{ display: 'inline-block', width: 14, height: 14, verticalAlign: 'middle', marginRight: 4 }}></span>미배정</span>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="card-body empty-state">표시할 직원이 없습니다.</div></div>
      ) : (
        <div className="unassigned-table-wrap">
          <table className="unassigned-table">
            <thead>
              <tr>
                <th className="sticky-col">직원</th>
                {dayHeaders.map((d) => {
                  const dow = new Date(year, month - 1, d).getDay();
                  return <th key={d} className={`day-col ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`}>{d}</th>;
                })}
                <th className="sticky-col-right">미배정</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid}>
                  <td className="sticky-col name-col">
                    <strong>{r.name}</strong>
                    {r.position && <span className="position-tag">{r.position}</span>}
                  </td>
                  {r.days.map((c) => (
                    <td key={c.d} className={`unassigned-cell ${c.type}`}
                      title={
                        c.type === 'assigned' ? c.projects.join(', ') :
                        c.type === 'leave' ? leaveLabel(c.leaveType) :
                        c.type === 'weekend' ? '주말' : '미배정'
                      }>
                    </td>
                  ))}
                  <td className="sticky-col-right count-col">
                    <strong className={r.unassignedCount > 0 ? 'neg' : ''}>{r.unassignedCount}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
