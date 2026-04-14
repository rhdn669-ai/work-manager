import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getEvents, addEvent, updateEvent, deleteEvent } from '../../services/eventService';
import Modal from '../../components/common/Modal';

const TYPE_LABEL = { event: '이벤트', notice: '공지', holiday: '휴무' };
const TYPE_COLORS = {
  event: '#3b82f6',
  notice: '#f59e0b',
  holiday: '#ef4444',
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function EventManagementPage() {
  const { userProfile } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', type: 'event', startDate: todayISO(), endDate: todayISO() });

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

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="event-management-page">
      <div className="page-header">
        <h2>이벤트 · 공지 관리</h2>
        <button className="btn btn-primary" onClick={openCreate}>+ 새 이벤트/공지</button>
      </div>

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
