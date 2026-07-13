import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSitesByManager, getClosingItems } from '../../services/siteService';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';

export default function MyProjectsPage() {
  const { userProfile } = useAuth();
  const [sites, setSites] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [siteOutsource, setSiteOutsource] = useState({});
  const [outsourceAttendance, setOutsourceAttendance] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCalDay, setSelectedCalDay] = useState(null);
  const [calSiteId, setCalSiteId] = useState('all');

  useEffect(() => {
    if (userProfile?.uid) loadSites();
  }, [userProfile?.uid]);

  useEffect(() => {
    if (sites.length > 0) loadMonthData();
    else {
      setSiteOutsource({});
      setOutsourceAttendance({});
    }
  }, [sites, year, month]);

  async function loadSites() {
    setLoading(true);
    try {
      const mySites = await getSitesByManager(userProfile.uid);
      setSites(mySites.filter((s) => s.status !== 'completed'));
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
              siteId: s.id,
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

  // 캘린더에 표시할 출근 데이터 — 'all'이면 전체, 아니면 해당 사이트만
  const filteredAttendance = useMemo(() => {
    if (calSiteId === 'all') return outsourceAttendance;
    const out = {};
    Object.entries(outsourceAttendance).forEach(([date, evs]) => {
      const filtered = evs.filter((e) => e.siteId === calSiteId);
      if (filtered.length > 0) out[date] = filtered;
    });
    return out;
  }, [outsourceAttendance, calSiteId]);

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

  // itemType별 단위 표기
  // freelancer/vendor(인원·업체일당) = 공수, daily(일용직) = 시간, vendor_case(업체 프로젝트) = 댓
  function qtyLabel(q, itemType) {
    const unit = itemType === 'daily' ? '시간' : itemType === 'vendor_case' ? '댓' : '공수';
    return `${q}${unit}`;
  }

  const todayRef = new Date();

  return (
    <div className="reports-page">
      <h2>외주</h2>

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

      {loading && <Skeleton.Rows count={6} />}

      {!loading && rows.length === 0 && (
        <div className="card">
          <div className="card-body empty-state">담당하는 활성 프로젝트가 없습니다.</div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="team-calendar-section" style={{ marginTop: 12 }}>
          <div
            className="tab-nav tab-nav-scroll"
            role="tablist"
            aria-label="프로젝트별 외주 출근"
            style={{
              overflowX: 'auto',
              flexWrap: 'nowrap',
              WebkitOverflowScrolling: 'touch',
              gap: 8,
              paddingRight: 16,
            }}
          >
            <button
              type="button"
              role="tab"
              className={`tab-nav-item ${calSiteId === 'all' ? 'active' : ''}`}
              style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                setCalSiteId('all');
                setSelectedCalDay(null);
              }}
            >
              전체
            </button>
            {sites.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                className={`tab-nav-item ${calSiteId === s.id ? 'active' : ''}`}
                style={{ whiteSpace: 'nowrap' }}
                title={s.name}
                onClick={() => {
                  setCalSiteId(s.id);
                  setSelectedCalDay(null);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="team-calendar-head">
            <div className="team-calendar-title">
              <strong>외주 출근</strong>
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
                  const events = filteredAttendance[dateStr] || [];
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
                      style={{
                        minHeight: 'clamp(42px, 8vw, 56px)',
                        display: 'flex',
                        flexDirection: 'column',
                        contain: 'layout',
                      }}
                      onClick={() => setSelectedCalDay(selectedCalDay === dateStr ? null : dateStr)}
                      disabled={events.length === 0}
                    >
                      <span className="team-cal-day">{d}</span>
                      <div className="team-cal-events team-cal-events-dots" style={{ marginTop: 'auto' }}>
                        {visible.map((e, i) => (
                          <span
                            key={i}
                            className="team-cal-ev-dot team-cal-ev-overtime"
                            title={`${e.label} · ${qtyLabel(e.qty, e.itemType)} · ${e.siteName}`}
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
              const evs = filteredAttendance[selectedCalDay] || [];
              const [, mm, dd] = selectedCalDay.split('-');
              return (
                <div className="team-calendar-day-detail">
                  <div
                    className="team-calendar-day-detail-head"
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <strong>
                      {Number(mm)}/{Number(dd)}
                    </strong>
                    <span className="team-calendar-hint">· {evs.length}명</span>
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
                    {evs.map((e, i) => (
                      <li key={i} className="has-link" style={{ minHeight: 44 }}>
                        <Link
                          to={`/sites/${e.siteId}/${year}/${month}`}
                          className="team-calendar-day-link"
                          title={`${e.siteName} 마감 페이지로 이동`}
                          style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 44, padding: '10px 12px' }}
                        >
                          <span className="team-cal-ev-dot team-cal-ev-overtime" />
                          <strong className="u-ellipsis-1" title={e.label}>
                            {e.label}
                          </strong>
                          <span className="team-calendar-ev-detail">{qtyLabel(e.qty, e.itemType)}</span>
                          {e.siteName && (
                            <span className="team-calendar-ev-site u-ellipsis-1" title={e.siteName}>
                              {e.siteName}
                            </span>
                          )}
                        </Link>
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
