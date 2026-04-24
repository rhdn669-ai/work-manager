import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getEvents, addEvent, updateEvent, deleteEvent } from '../../services/eventService';
import { getKoreanHolidaysAsEvents } from '../../utils/koreanHolidays';
import Modal from '../../components/common/Modal';

const TYPE_LABEL = { event: '이벤트', notice: '공지', holiday: '휴무' };
const TYPE_COLORS = {
  event: '#3b82f6',
  notice: '#f59e0b',
  holiday: '#ef4444',
};

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayISO() { return toISO(new Date()); }

export default function EventManagementPage() {
  const { userProfile } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', type: 'event', startDate: todayISO(), endDate: todayISO() });
  const [syncing, setSyncing] = useState(false);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  // 매년 1~3월: 정부 공휴일 발표 직후 시점이므로 강조
  const isNewYearWindow = currentMonth >= 1 && currentMonth <= 3;

  // 현재 연도 한국 공휴일 중 Firestore에 아직 없는 것 개수
  const missingThisYearCount = useMemo(() => {
    const koreanEvents = getKoreanHolidaysAsEvents(currentYear);
    if (koreanEvents.length === 0) return 0;
    const existing = new Set(
      events.filter((e) => e.type === 'holiday').flatMap((e) => {
        const dates = [];
        const cur = new Date(e.startDate);
        const end = new Date(e.endDate || e.startDate);
        while (cur <= end) { dates.push(toISO(cur)); cur.setDate(cur.getDate() + 1); }
        return dates;
      }),
    );
    return koreanEvents.filter((kh) => !existing.has(kh.startDate)).length;
  }, [events, currentYear]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      setEvents(await getEvents());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditEvent(null);
    const t = todayISO();
    setForm({ title: '', description: '', type: 'event', startDate: t, endDate: t });
    setShowModal(true);
  }

  function openEdit(ev) {
    setEditEvent(ev);
    setForm({
      title: ev.title || '',
      description: ev.description || '',
      type: ev.type || 'event',
      startDate: ev.startDate || todayISO(),
      endDate: ev.endDate || ev.startDate || todayISO(),
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) { alert('제목을 입력하세요.'); return; }
    if (form.endDate < form.startDate) { alert('종료일이 시작일보다 빠릅니다.'); return; }
    try {
      const payload = {
        ...form,
        color: TYPE_COLORS[form.type] || '#3b82f6',
        createdBy: userProfile?.uid || '',
      };
      if (editEvent) {
        await updateEvent(editEvent.id, payload);
      } else {
        await addEvent(payload);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteEvent(id);
      await loadData();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  async function handleSyncKoreanHolidays() {
    const koreanEvents = getKoreanHolidaysAsEvents(currentYear);
    if (koreanEvents.length === 0) {
      alert(`${currentYear}년 한국 공휴일 데이터가 코드에 등록되어 있지 않습니다.\n개발자에게 koreanHolidays.js 업데이트를 요청하세요.`);
      return;
    }
    const existing = new Set(
      events.filter((e) => e.type === 'holiday').flatMap((e) => {
        const dates = [];
        const cur = new Date(e.startDate);
        const end = new Date(e.endDate || e.startDate);
        while (cur <= end) { dates.push(toISO(cur)); cur.setDate(cur.getDate() + 1); }
        return dates;
      }),
    );
    const toAdd = koreanEvents.filter((kh) => !existing.has(kh.startDate));
    if (toAdd.length === 0) {
      alert(`${currentYear}년 한국 공휴일은 이미 모두 등록되어 있습니다.`);
      return;
    }
    if (!confirm(`${currentYear}년 한국 공휴일 ${toAdd.length}개를 일괄 등록하시겠습니까?\n\n${toAdd.slice(0, 5).map((h) => `· ${h.startDate} ${h.title}`).join('\n')}${toAdd.length > 5 ? `\n... 외 ${toAdd.length - 5}개` : ''}`)) return;
    setSyncing(true);
    try {
      for (const kh of toAdd) {
        await addEvent({
          title: kh.title,
          description: '한국 공휴일 (자동 등록)',
          type: 'holiday',
          startDate: kh.startDate,
          endDate: kh.endDate,
          color: TYPE_COLORS.holiday,
          createdBy: userProfile?.uid || '',
        });
      }
      alert(`${toAdd.length}개 공휴일이 등록되었습니다.`);
      await loadData();
    } catch (err) {
      alert('등록 실패: ' + err.message);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="event-management-page">
      <div className="page-header">
        <h2>이벤트 · 공지 관리</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`btn btn-sm ${isNewYearWindow && missingThisYearCount > 0 ? 'btn-primary' : 'btn-outline'}`}
            onClick={handleSyncKoreanHolidays}
            disabled={syncing}
            title={`${currentYear}년 한국 공휴일을 Firestore에 일괄 등록합니다`}
          >
            {syncing ? '등록 중...' : `↻ ${currentYear}년 한국 공휴일 갱신${missingThisYearCount > 0 ? ` (${missingThisYearCount})` : ''}`}
          </button>
          <button className="btn btn-primary" onClick={openCreate}>+ 새 이벤트/공지</button>
        </div>
      </div>
      {isNewYearWindow && missingThisYearCount > 0 && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-light)' }}>
            <strong style={{ color: 'var(--primary)' }}>📅 신규 연도 알림</strong> · {currentYear}년 한국 공휴일 중 <strong>{missingThisYearCount}개</strong>가 아직 등록되지 않았습니다. 위 [↻ 갱신] 버튼을 눌러 일괄 등록하세요.
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="empty-state card"><div className="card-body">등록된 이벤트/공지가 없습니다.</div></div>
      ) : (
        <div className="event-list">
          {events.map((ev) => (
            <div className={`event-row event-type-${ev.type || 'event'}`} key={ev.id}>
              <span className="event-type-badge">{TYPE_LABEL[ev.type] || '이벤트'}</span>
              <div className="event-info">
                <div className="event-title">{ev.title}</div>
                <div className="event-meta">
                  {ev.startDate}{ev.endDate && ev.endDate !== ev.startDate ? ` ~ ${ev.endDate}` : ''}
                </div>
                {ev.description && <div className="event-desc">{ev.description}</div>}
              </div>
              <div className="event-actions">
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(ev)}>수정</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ev.id)}>삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editEvent ? '이벤트/공지 수정' : '이벤트/공지 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>유형</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="event">이벤트</option>
              <option value="notice">공지</option>
              <option value="holiday">휴무</option>
            </select>
          </div>
          <div className="form-group">
            <label>제목</label>
            <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>시작일</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })} required />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>종료일</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
            </div>
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="상세 내용 (선택)" />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editEvent ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
