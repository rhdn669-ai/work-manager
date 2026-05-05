import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getSitesByManager, getClosingItems } from '../../services/siteService';

export default function MyProjectsPage() {
  const { userProfile } = useAuth();
  const [sites, setSites] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [siteOutsource, setSiteOutsource] = useState({});
  const [outsourceAttendance, setOutsourceAttendance] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCalDay, setSelectedCalDay] = useState(null);

  useEffect(() => {
    if (userProfile?.uid) loadSites();
  }, [userProfile?.uid]);

  useEffect(() => {
    if (sites.length > 0) loadMonthData();
    else { setSiteOutsource({}); setOutsourceAttendance({}); }
  }, [sites, year, month]);

  async function loadSites() {
    setLoading(true);
    try {
      const mySites = await getSitesByManager(userProfile.uid);
      setSites(mySites);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadMonthData() {
    setLoading(true);
    try {
      const closings = await Promise.all(sites.map((s) => getClosingItems(s.id, year, month)));
      const outMap = {};
      const attendance = {};
      const monthStr = `${year}-${String(month).padStart(2, '0')}`;
      sites.forEach((s, i) => {
        const items = closings[i] || [];
        const outNames = new Set();
        items.forEach((it) => {
          if (!it.itemType || it.itemType === 'employee') return;
          if (!it.detail) return;
          outNames.add(`${it.itemType}::${it.vendor || ''}::${it.detail}`);
          const dq = it.dailyQuantities || {};
          Object.entries(dq).forEach(([day, qty]) => {
            const q = Number(qty) || 0;
            if (q <= 0) return;
            const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
            (attendance[dateStr] = attendance[dateStr] || []).push({
              label: it.detail,
              vendor: it.vendor || '',
              qty: q,
              siteName: s.name,
              itemType: it.itemType,
            });
          });
        });
        outMap[s.id] = Array.from(outNames);
      });
      setSiteOutsource(outMap);
      setOutsourceAttendance(attendance);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    return sites.map((s) => ({
      siteId: s.id,
      siteName: s.name,
      outsourceCount: (siteOutsource[s.id] || []).length,
    }));
  }, [sites, siteOutsource]);

  const totalOutsource = rows.reduce((s, r) => s + r.outsourceCount, 0);

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

  function qtyLabel(q) {
    if (q === 1) return '1일';
    if (q === 0.5) return '0.5일';
    return `${q}일`;
  }

  const todayRef = new Date();

  return (
    <div className="reports-page">
      <h2>외주</h2>

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
          <table className="table team-stats-table">
            <thead>
              <tr>
                <th>프로젝트</th>
                <th>외주 인원</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.siteId}>
                  <td><strong>{r.siteName}</strong></td>
                  <td>{r.outsourceCount > 0 ? `${r.outsourceCount}명` : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>합계 ({rows.length}개)</strong></td>
                <td><strong>{totalOutsource}명</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="team-calendar-section">
          <div className="team-calendar-head">
            <div className="team-calendar-title">
              <strong>외주 출근</strong>
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
                  const events = outsourceAttendance[dateStr] || [];
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
                            className="team-cal-ev-dot team-cal-ev-overtime"
                            title={`${e.label} · ${qtyLabel(e.qty)} · ${e.siteName}`}
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
            const evs = outsourceAttendance[selectedCalDay] || [];
            const [, mm, dd] = selectedCalDay.split('-');
            return (
              <div className="team-calendar-day-detail">
                <div className="team-calendar-day-detail-head">
                  <strong>{Number(mm)}/{Number(dd)}</strong>
                  <span className="team-calendar-hint">· {evs.length}명</span>
                  <button type="button" className="team-calendar-close" onClick={() => setSelectedCalDay(null)} aria-label="닫기">✕</button>
                </div>
                <ul className="team-calendar-day-list">
                  {evs.map((e, i) => (
                    <li key={i}>
                      <span className="team-cal-ev-dot team-cal-ev-overtime" />
                      <strong>{e.label}</strong>
                      <span className="team-calendar-ev-detail">{qtyLabel(e.qty)}</span>
                      {e.siteName && <span className="team-calendar-ev-site">{e.siteName}</span>}
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
