import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getEvents } from '../../services/eventService';
import { getMyOvertimeRecords, getAllOvertimeRecords } from '../../services/attendanceService';
import { getMyLeaves, getApprovedLeavesByMonth } from '../../services/leaveService';
import { getUsers } from '../../services/userService';
import { getMyPersonalEvents, addPersonalEvent, deletePersonalEvent } from '../../services/personalEventService';
import { LEAVE_TYPE_LABELS } from '../../utils/constants';
import Modal from './Modal';

const TYPE_LABEL = { event: '이벤트', notice: '공지', holiday: '휴무', overtime: '잔업', leave: '연차', personal: '내 일정' };

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

export default function HomeCalendar() {
  const { userProfile, isAdmin, canApproveAll, canApproveLeave } = useAuth();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  });
  const [events, setEvents] = useState([]);
  const [overtimes, setOvertimes] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [personalEvents, setPersonalEvents] = useState([]);
  const [userNameMap, setUserNameMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showPersonalModal, setShowPersonalModal] = useState(false);
  const [personalForm, setPersonalForm] = useState({ title: '', startDate: '', endDate: '', note: '' });
  const [personalBusy, setPersonalBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const year = cursor.y;
      const month = cursor.m;
      const startISO = `${year}-${pad(month)}-01`;
      const endISO = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;

      const rawEvents = await getEvents().catch((err) => { console.error('이벤트 로드 실패', err); return []; });
      // 관리자가 아닌 경우 공지(notice)만 표시, 관리자는 모든 이벤트/공지/휴무 표시
      const evs = isAdmin ? rawEvents : rawEvents.filter((e) => (e.type || 'event') === 'notice');

      let ots = [];
      let lvs = [];
      let users = [];

      if (isAdmin && canApproveAll) {
        // 관리자는 전체 인원 조회
        [ots, lvs, users] = await Promise.all([
          getAllOvertimeRecords(startISO, endISO).catch((err) => { console.error('잔업 로드 실패', err); return []; }),
          getApprovedLeavesByMonth(year, month).catch((err) => { console.error('연차 로드 실패', err); return []; }),
          getUsers().catch((err) => { console.error('사용자 로드 실패', err); return []; }),
        ]);
      } else if (userProfile?.uid) {
        // 비관리자(팀장 포함)는 본인 데이터만 — 팀 데이터는 "우리 팀" 탭 캘린더에서 확인
        [ots, lvs] = await Promise.all([
          getMyOvertimeRecords(userProfile.uid, startISO, endISO).catch((err) => { console.error('잔업 로드 실패', err); return []; }),
          getMyLeaves(userProfile.uid, year).catch((err) => { console.error('연차 로드 실패', err); return []; }),
        ]);
      }

      // 본인 개인 일정 로드
      const personal = userProfile?.uid
        ? await getMyPersonalEvents(userProfile.uid, year, month).catch(() => [])
        : [];

      if (!active) return;
      setEvents(evs);
      setOvertimes(ots);
      setLeaves(lvs);
      setPersonalEvents(personal);
      const nameMap = {};
      users.forEach((u) => { nameMap[u.uid] = u.name; });
      setUserNameMap(nameMap);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [userProfile?.uid, isAdmin, canApproveAll, canApproveLeave, cursor.y, cursor.m]);

  async function reloadPersonal() {
    if (!userProfile?.uid) return;
    const list = await getMyPersonalEvents(userProfile.uid, cursor.y, cursor.m).catch(() => []);
    setPersonalEvents(list);
  }

  function openAddPersonal(dateISO) {
    const d = dateISO || selectedDate || toISO(new Date());
    setPersonalForm({ title: '', startDate: d, endDate: d, note: '' });
    setShowPersonalModal(true);
  }

  async function handleSavePersonal(e) {
    e.preventDefault();
    if (!personalForm.title.trim()) { alert('제목을 입력해주세요.'); return; }
    if (!personalForm.startDate) { alert('시작일을 선택해주세요.'); return; }
    setPersonalBusy(true);
    try {
      await addPersonalEvent({
        userId: userProfile.uid,
        title: personalForm.title,
        startDate: personalForm.startDate,
        endDate: personalForm.endDate || personalForm.startDate,
        note: personalForm.note,
      });
      setShowPersonalModal(false);
      await reloadPersonal();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    } finally {
      setPersonalBusy(false);
    }
  }

  async function handleDeletePersonal(id) {
    if (!confirm('이 일정을 삭제하시겠습니까?')) return;
    try {
      await deletePersonalEvent(id);
      await reloadPersonal();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

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

    const inMonthEvents = events
      .filter((e) => (e.endDate || e.startDate) >= monthStart && e.startDate <= monthEnd)
      .map((e) => ({ ...e, _kind: 'event', type: e.type || 'event', _start: e.startDate, _end: e.endDate || e.startDate }));

    const inMonthOvertimes = overtimes
      .filter((o) => o.status === 'approved' && o.date >= monthStart && o.date <= monthEnd)
      .map((o) => {
        const showName = (canApproveLeave) && o.userId !== userProfile?.uid;
        const who = showName ? (o.userName || userNameMap[o.userId] || '') : '';
        return {
          ...o,
          _kind: 'overtime',
          type: 'overtime',
          _start: o.date,
          _end: o.date,
          _who: who,
          title: `${who ? who + ' · ' : ''}잔업 ${formatMinutes(o.minutes || 0)}`,
        };
      });

    const inMonthLeaves = leaves
      .filter((l) => (l.status === 'approved' || l.status === 'confirmed') && (l.endDate || l.startDate) >= monthStart && l.startDate <= monthEnd)
      .map((l) => {
        const showName = (canApproveLeave) && l.userId !== userProfile?.uid;
        const who = showName ? (userNameMap[l.userId] || '') : '';
        const leaveLabel = LEAVE_TYPE_LABELS[l.type] || '연차';
        return {
          ...l,
          _kind: 'leave',
          type: 'leave',
          _start: l.startDate,
          _end: l.endDate || l.startDate,
          _who: who,
          title: `${who ? who + ' · ' : ''}${leaveLabel}`,
        };
      });

    const inMonthPersonal = personalEvents
      .filter((p) => (p.endDate || p.startDate) >= monthStart && p.startDate <= monthEnd)
      .map((p) => ({
        ...p,
        _kind: 'personal',
        type: 'personal',
        _start: p.startDate,
        _end: p.endDate || p.startDate,
      }));

    const all = [...inMonthEvents, ...inMonthLeaves, ...inMonthOvertimes, ...inMonthPersonal];

    const byDay = {};
    all.forEach((e) => {
      for (let d = 1; d <= totalDays; d++) {
        const iso = `${y}-${pad(m)}-${pad(d)}`;
        if (iso >= e._start && iso <= e._end) {
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(e);
        }
      }
    });
    return { weeks: ws, eventsByDay: byDay, monthEvents: all };
  }, [cursor, events, overtimes, leaves, personalEvents, canApproveLeave, userNameMap, userProfile?.uid]);

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
    ? monthEvents.filter((e) => selectedDate >= e._start && selectedDate <= e._end)
    : [];

  return (
    <div className="home-calendar card">
      <div className="home-calendar-head">
        <div className="home-calendar-title">
          <h3>{cursor.y}년 {cursor.m}월</h3>
          <span className="home-calendar-sub">{isAdmin ? '사내 캘린더' : '내 일정 · 공지'}</span>
        </div>
        <div className="home-calendar-nav">
          <button type="button" className="cal-nav-btn" onPointerDown={(e) => { e.preventDefault(); prev(); }} aria-label="이전 달">‹</button>
          <button type="button" className="cal-today-btn" onPointerDown={(e) => { e.preventDefault(); goToday(); }}>오늘</button>
          <button type="button" className="cal-nav-btn" onPointerDown={(e) => { e.preventDefault(); next(); }} aria-label="다음 달">›</button>
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
                      onPointerDown={(e) => {
                        e.preventDefault();
                        setSelectedDate(iso);
                        if (userProfile?.uid) openAddPersonal(iso);
                      }}
                    >
                      <span className="home-cal-date">{d}</span>
                      <div className="home-cal-events">
                        {dayEvents.slice(0, 3).map((e, ei) => {
                          const lbl = e._kind === 'overtime' || e._kind === 'leave'
                            ? (e._who || userNameMap[e.userId] || (TYPE_LABEL[e.type] || '일정'))
                            : e.title;
                          return (
                            <span
                              key={ei}
                              className={`home-cal-ev type-${e.type || 'event'}`}
                              title={e.title}
                            >
                              {lbl}
                            </span>
                          );
                        })}
                        {dayEvents.length > 3 && <span className="home-cal-ev-more">+{dayEvents.length - 3}</span>}
                      </div>
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
                    <div className={`home-cal-item type-${e.type}`} key={`${e._kind}-${e.id}`}>
                      <span className="home-cal-badge">{TYPE_LABEL[e.type] || '일정'}</span>
                      <div className="home-cal-item-body">
                        <div className="home-cal-item-title">{e.title}</div>
                        {e._kind === 'event' && e.description && <div className="home-cal-item-desc">{e.description}</div>}
                        {e._kind === 'leave' && (
                          <div className="home-cal-item-meta">
                            {e._start}{e._end && e._end !== e._start ? ` ~ ${e._end}` : ''} · {e.days}일
                          </div>
                        )}
                        {e._kind === 'overtime' && e.reason && <div className="home-cal-item-desc">{e.reason}</div>}
                        {e._kind === 'personal' && (
                          <>
                            {e.note && <div className="home-cal-item-desc">{e.note}</div>}
                            {e._end !== e._start && (
                              <div className="home-cal-item-meta">{e._start} ~ {e._end}</div>
                            )}
                          </>
                        )}
                      </div>
                      {e._kind === 'personal' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-outline"
                          onClick={() => handleDeletePersonal(e.id)}
                          style={{ flexShrink: 0 }}
                        >삭제</button>
                      )}
                    </div>
                  ))
                )}
              </>
            ) : monthEvents.length > 0 ? (
              <>
                <div className="home-cal-list-head">이번 달 일정 ({monthEvents.length})</div>
                {monthEvents.slice(0, 6).map((e) => (
                  <div className={`home-cal-item type-${e.type}`} key={`${e._kind}-${e.id}`}>
                    <span className="home-cal-badge">{TYPE_LABEL[e.type] || '일정'}</span>
                    <div className="home-cal-item-body">
                      <div className="home-cal-item-title">{e.title}</div>
                      <div className="home-cal-item-meta">
                        {e._start}{e._end && e._end !== e._start ? ` ~ ${e._end}` : ''}
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

      <Modal isOpen={showPersonalModal} onClose={() => setShowPersonalModal(false)} title={`내 일정 추가 · ${personalForm.startDate || ''}`}>
        <form onSubmit={handleSavePersonal}>
          <div className="form-group">
            <label>제목 *</label>
            <input
              value={personalForm.title}
              onChange={(e) => setPersonalForm({ ...personalForm, title: e.target.value })}
              placeholder="일정 제목"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>메모</label>
            <textarea
              rows={2}
              value={personalForm.note}
              onChange={(e) => setPersonalForm({ ...personalForm, note: e.target.value })}
            />
          </div>
          <p className="field-hint">본인만 볼 수 있는 개인 일정입니다.</p>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={personalBusy}>
              {personalBusy ? '저장 중...' : '추가'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setShowPersonalModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
