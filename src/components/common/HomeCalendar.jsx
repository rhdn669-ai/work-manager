import { useState, useEffect, useMemo } from 'react';
import { getEvents } from '../../services/eventService';

const TYPE_LABEL = { event: '이벤트', notice: '공지', holiday: '휴무' };

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

export default function HomeCalendar() {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await getEvents();
        if (active) setEvents(list);
      } catch (err) {
        console.error('이벤트 로드 실패', err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const { weeks, eventsByDay, monthEvents } = useMemo(() => {
    const y = cursor.y, m = cursor.m;
    const first = new Date(y, m - 1, 1);
    const totalDays = new Date(y, m, 0).getDate();
    const firstDow = first.getDay();
    const ws = [];
    let week = new Array(firstDow).fill(null);
    for (let d = 1; d <= totalDays; d++) {
      week.push(d);
      if (week.length === 7) { ws.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      ws.push(week);
    }
    const monthStart = `${y}-${pad(m)}-01`;
    const monthEnd = `${y}-${pad(m)}-${pad(totalDays)}`;
    const inMonth = events.filter((e) => {
      const s = e.startDate;
      const en = e.endDate || e.startDate;
      return en >= monthStart && s <= monthEnd;
    });
    const byDay = {};
    inMonth.forEach((e) => {
      const s = e.startDate;
      const en = e.endDate || e.startDate;
      for (let d = 1; d <= totalDays; d++) {
        const iso = `${y}-${pad(m)}-${pad(d)}`;
        if (iso >= s && iso <= en) {
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(e);
        }
      }
    });
    return { weeks: ws, eventsByDay: byDay, monthEvents: inMonth };
  }, [cursor, events]);

  function prev() {
    setSelectedDate(null);
    setCursor((c) => c.m === 1 ? { y: c.y - 1, m: 12 } : { y: c.y, m: c.m - 1 });
  }
  function next() {
    setSelectedDate(null);
    setCursor((c) => c.m === 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m: c.m + 1 });
  }
  function goToday() {
    const d = new Date();
    setCursor({ y: d.getFullYear(), m: d.getMonth() + 1 });
    setSelectedDate(toISO(d));
  }

  const today = toISO(new Date());
  const selectedEvents = selectedDate
    ? events.filter((e) => {
        const s = e.startDate;
        const en = e.endDate || e.startDate;
        return selectedDate >= s && selectedDate <= en;
      })
    : [];

  return (
    <div className="home-calendar card">
      <div className="home-calendar-head">
        <div className="home-calendar-title">
          <h3>{cursor.y}년 {cursor.m}월</h3>
          <span className="home-calendar-sub">사내 캘린더</span>
        </div>
        <div className="home-calendar-nav">
          <button type="button" className="cal-nav-btn" onClick={prev} aria-label="이전 달">‹</button>
          <button type="button" className="cal-today-btn" onClick={goToday}>오늘</button>
          <button type="button" className="cal-nav-btn" onClick={next} aria-label="다음 달">›</button>
        </div>
      </div>

      {loading ? (
        <div className="home-calendar-loading">로딩 중...</div>
      ) : (
        <>
          <div className="home-calendar-grid">
            <div className="home-cal-row home-cal-dow">
              {['일','월','화','수','목','금','토'].map((dn, i) => (
                <div key={dn} className={`home-cal-dow-cell ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{dn}</div>
              ))}
            </div>
            {weeks.map((wk, wi) => (
              <div className="home-cal-row" key={wi}>
                {wk.map((d, di) => {
                  if (d === null) return <div className="home-cal-cell empty" key={di} />;
                  const iso = `${cursor.y}-${pad(cursor.m)}-${pad(d)}`;
                  const dayEvents = eventsByDay[d] || [];
                  const isToday = iso === today;
                  const isSelected = iso === selectedDate;
                  return (
                    <button
                      type="button"
                      key={di}
                      className={`home-cal-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${di === 0 ? 'sunday' : ''} ${di === 6 ? 'saturday' : ''}`}
                      onClick={() => setSelectedDate(iso)}
                    >
                      <span className="home-cal-date">{d}</span>
                      <span className="home-cal-dots">
                        {dayEvents.slice(0, 3).map((e, ei) => (
                          <span key={ei} className={`home-cal-dot type-${e.type || 'event'}`} />
                        ))}
                        {dayEvents.length > 3 && <span className="home-cal-more">+{dayEvents.length - 3}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="home-calendar-list">
            {selectedDate ? (
              <>
                <div className="home-cal-list-head">{selectedDate}</div>
                {selectedEvents.length === 0 ? (
                  <div className="home-cal-list-empty">이 날짜의 일정이 없습니다.</div>
                ) : (
                  selectedEvents.map((e) => (
                    <div className={`home-cal-item type-${e.type || 'event'}`} key={e.id}>
                      <span className="home-cal-badge">{TYPE_LABEL[e.type] || '이벤트'}</span>
                      <div className="home-cal-item-body">
                        <div className="home-cal-item-title">{e.title}</div>
                        {e.description && <div className="home-cal-item-desc">{e.description}</div>}
                      </div>
                    </div>
                  ))
                )}
              </>
            ) : monthEvents.length > 0 ? (
              <>
                <div className="home-cal-list-head">이번 달 일정 ({monthEvents.length})</div>
                {monthEvents.slice(0, 5).map((e) => (
                  <div className={`home-cal-item type-${e.type || 'event'}`} key={e.id}>
                    <span className="home-cal-badge">{TYPE_LABEL[e.type] || '이벤트'}</span>
                    <div className="home-cal-item-body">
                      <div className="home-cal-item-title">{e.title}</div>
                      <div className="home-cal-item-meta">
                        {e.startDate}{e.endDate && e.endDate !== e.startDate ? ` ~ ${e.endDate}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="home-cal-list-empty">이번 달 등록된 일정이 없습니다.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
