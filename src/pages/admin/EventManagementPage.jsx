import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getEvents, addEvent, updateEvent } from '../../services/eventService';
import { trashGeneric } from '../../services/trashService';
import { getKoreanHolidaysAsEvents } from '../../utils/koreanHolidays';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/DialogProvider';

function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return vw;
}

const TYPE_LABEL = { event: '이벤트', notice: '공지', holiday: '휴무' };
const TYPE_COLORS = {
  event: 'var(--primary)',
  notice: 'var(--accent)',
  holiday: 'var(--danger)',
};

function pad(n) {
  return String(n).padStart(2, '0');
}
function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayISO() {
  return toISO(new Date());
}

export default function EventManagementPage() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const vw = useViewportWidth();
  const isNarrow = vw < 480;
  const isXSmall = vw <= 360;
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'event',
    startDate: todayISO(),
    endDate: todayISO(),
  });
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
      events
        .filter((e) => e.type === 'holiday')
        .flatMap((e) => {
          const dates = [];
          const cur = new Date(e.startDate);
          const end = new Date(e.endDate || e.startDate);
          while (cur <= end) {
            dates.push(toISO(cur));
            cur.setDate(cur.getDate() + 1);
          }
          return dates;
        }),
    );
    return koreanEvents.filter((kh) => !existing.has(kh.startDate)).length;
  }, [events, currentYear]);

  useEffect(() => {
    loadData();
  }, []);

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
    if (!form.title.trim()) {
      alert('제목을 입력하세요.');
      return;
    }
    if (form.endDate < form.startDate) {
      alert('종료일이 시작일보다 빠릅니다.');
      return;
    }
    try {
      const payload = {
        ...form,
        color: TYPE_COLORS[form.type] || 'var(--primary)',
        createdBy: userProfile?.uid || '',
      };
      if (editEvent) {
        await updateEvent(editEvent.id, payload);
      } else {
        await addEvent(payload);
      }
      setShowModal(false);
      await loadData();
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(ev) {
    if (
      !(await confirm({
        title: '이벤트/공지 삭제',
        message: `"${ev.title}"을(를) 삭제할까요?\n휴지통에서 복원할 수 있습니다.`,
      }))
    )
      return;
    try {
      await trashGeneric(
        'events',
        ev.id,
        {
          title: ev.title,
          summary: [TYPE_LABEL[ev.type] || '이벤트', ev.startDate].filter(Boolean).join(' · '),
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      await loadData();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleSyncKoreanHolidays() {
    const koreanEvents = getKoreanHolidaysAsEvents(currentYear);
    if (koreanEvents.length === 0) {
      alert(
        `${currentYear}년 한국 공휴일 데이터가 코드에 등록되어 있지 않습니다.\n개발자에게 koreanHolidays.js 업데이트를 요청하세요.`,
      );
      return;
    }
    const existing = new Set(
      events
        .filter((e) => e.type === 'holiday')
        .flatMap((e) => {
          const dates = [];
          const cur = new Date(e.startDate);
          const end = new Date(e.endDate || e.startDate);
          while (cur <= end) {
            dates.push(toISO(cur));
            cur.setDate(cur.getDate() + 1);
          }
          return dates;
        }),
    );
    const toAdd = koreanEvents.filter((kh) => !existing.has(kh.startDate));
    if (toAdd.length === 0) {
      alert(`${currentYear}년 한국 공휴일은 이미 모두 등록되어 있습니다.`);
      return;
    }
    if (
      !(await confirm(
        `${currentYear}년 한국 공휴일 ${toAdd.length}개를 일괄 등록하시겠습니까?\n\n${toAdd
          .slice(0, 5)
          .map((h) => `· ${h.startDate} ${h.title}`)
          .join('\n')}${toAdd.length > 5 ? `\n... 외 ${toAdd.length - 5}개` : ''}`,
      ))
    )
      return;
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
      toast(`${toAdd.length}개 공휴일이 등록되었습니다.`);
      await loadData();
    } catch {
      toast('등록 중 오류가 발생했습니다', 'error');
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="event-management-page">
      <div className="page-header">
        <h2>이벤트 · 공지 관리</h2>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setTrashOpen(true)}
            style={isNarrow ? { fontSize: 12 } : undefined}
          >
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className={`btn btn-sm ${isNewYearWindow && missingThisYearCount > 0 ? 'btn-primary' : 'btn-outline'}`}
            onClick={handleSyncKoreanHolidays}
            disabled={syncing}
            title={`${currentYear}년 한국 공휴일을 Firestore에 일괄 등록합니다`}
            style={{ whiteSpace: 'nowrap', ...(isNarrow ? { fontSize: 12 } : {}) }}
          >
            {syncing ? (
              '등록 중...'
            ) : (
              <>
                <Icon name="restore" className="btn-ic" />
                {`${currentYear}년 한국 공휴일 갱신${missingThisYearCount > 0 ? ` (${missingThisYearCount})` : ''}`}
              </>
            )}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            style={isNarrow ? { fontSize: 12 } : undefined}
          >
            <Icon name="plus" className="btn-ic" />새 이벤트/공지
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['events']}
        title="이벤트 휴지통"
        onChange={loadData}
      />

      {isNewYearWindow && missingThisYearCount > 0 && (
        <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text-light)' }}>
            <strong
              style={{
                color: 'var(--primary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                verticalAlign: 'middle',
              }}
            >
              <Icon name="calendar" size={14} /> 신규 연도 알림
            </strong>{' '}
            · {currentYear}년 한국 공휴일 중 <strong>{missingThisYearCount}개</strong>가 아직 등록되지 않았습니다. 위
            [갱신] 버튼을 눌러 일괄 등록하세요.
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="empty-state card">
          <div className="card-body">등록된 이벤트/공지가 없습니다.</div>
        </div>
      ) : (
        <div className="event-list">
          {events.map((ev) => (
            <div
              className={`event-row event-type-${ev.type || 'event'}`}
              key={ev.id}
              style={{
                padding: isXSmall ? '6px 8px' : '8px 10px',
                flexDirection: isNarrow ? 'column' : undefined,
                flexWrap: isNarrow ? 'wrap' : undefined,
                gap: isNarrow ? 6 : undefined,
              }}
            >
              <span className="event-type-badge">{TYPE_LABEL[ev.type] || '이벤트'}</span>
              <div className="event-info" style={{ minWidth: 0 }}>
                <div
                  className="event-title"
                  title={ev.title}
                  style={{
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                    maxWidth: '100%',
                    whiteSpace: 'normal',
                    display: '-webkit-box',
                    WebkitLineClamp: isXSmall ? 1 : 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {ev.title}
                </div>
                <div
                  className="event-meta"
                  title={`${ev.startDate}${ev.endDate && ev.endDate !== ev.startDate ? ` ~ ${ev.endDate}` : ''}`}
                >
                  {ev.startDate}
                  {ev.endDate && ev.endDate !== ev.startDate ? ` ~ ${ev.endDate}` : ''}
                </div>
                {ev.description && (
                  <div
                    className="event-desc event-desc-collapse"
                    title={ev.description}
                    style={{
                      wordBreak: 'break-word',
                      overflowWrap: 'break-word',
                      maxWidth: '100%',
                      whiteSpace: 'normal',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {ev.description}
                  </div>
                )}
              </div>
              <div
                className="event-actions"
                style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'flex-start' }}
              >
                <button className="btn btn-sm btn-outline" onClick={() => openEdit(ev)}>
                  수정
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(ev)}>
                  <Icon name="trash" className="btn-ic" />
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editEvent ? '이벤트/공지 수정' : '이벤트/공지 추가'}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>유형</label>
            <Select
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v })}
              options={[
                { value: 'event', label: '이벤트' },
                { value: 'notice', label: '공지' },
                { value: 'holiday', label: '휴무' },
              ]}
              ariaLabel="유형 선택"
            />
          </div>
          <div className="form-group">
            <label>제목</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>시작일</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) =>
                  setForm({
                    ...form,
                    startDate: e.target.value,
                    endDate: form.endDate < e.target.value ? e.target.value : form.endDate,
                  })
                }
                required
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>종료일</label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label>내용</label>
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="상세 내용 (선택)"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
              취소
            </button>
            <button type="submit" className="btn btn-primary">
              {editEvent ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
