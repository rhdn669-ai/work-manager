import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCorners,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { getTasks, addTask, updateTask, setTaskStatus } from '../../services/taskService';
import { trashGeneric } from '../../services/trashService';
import { getUsers } from '../../services/userService';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from './useDialog';
import Modal from './Modal';
import Select from './Select';
import Icon from './Icon';
import EditModeButton from './EditModeButton';
import { isRealStaff } from '../../utils/workspace';

const COLS = [
  { key: 'todo', label: '할 일' },
  { key: 'doing', label: '진행중' },
  { key: 'done', label: '완료' },
];

const PRIORITY = {
  high: { label: '높음', cls: 'high' },
  normal: { label: '보통', cls: 'normal' },
  low: { label: '낮음', cls: 'low' },
};

const EMPTY = { title: '', assigneeId: '', dueDate: '', priority: 'normal', memo: '', status: 'todo' };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 마감일 → D-day 남은 일수 (오늘=0, 미래=양수, 지남=음수)
function ddayDiff(dueDate) {
  if (!dueDate) return null;
  const today = new Date(todayStr());
  const due = new Date(dueDate);
  return Math.round((due - today) / 86400000);
}
// 남은 일수 → 라벨
function ddayLabel(diff) {
  if (diff == null) return '';
  if (diff === 0) return 'D-DAY';
  return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}
// 남은 일수 → 긴급도 색상 클래스 (urgent=빨강 / soon=앰버 / safe=회색)
function ddayLevel(diff) {
  if (diff == null) return '';
  if (diff <= 0) return 'urgent'; // 오늘·지남
  if (diff <= 3) return 'soon'; // 임박(3일 이내)
  return 'safe'; // 여유
}

// 등록일 표시 (Firestore Timestamp 또는 Date) → YY.MM.DD
function fmtCreated(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getFullYear()).slice(2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function TaskCard({ t, editMode, onEdit, onDelete, onMove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: t.id,
    disabled: !editMode,
  });
  const style = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : undefined,
    // 「순서 변경」이 꺼져 있으면 잡히는 카드가 아니다 — 커서도 세로 스크롤도 평소대로
    cursor: editMode ? undefined : 'default',
    touchAction: editMode ? undefined : 'auto',
  };
  const pr = PRIORITY[t.priority] || PRIORITY.normal;
  const colIdx = COLS.findIndex((c) => c.key === (t.status || 'todo'));
  const stopAll = (e) => {
    e.stopPropagation();
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="kb-card task-card"
      {...(editMode ? attributes : {})}
      {...(editMode ? listeners : {})}
    >
      <div className="task-card__top">
        <span className={`task-prio task-prio--${pr.cls}`}>{pr.label}</span>
        <div
          className="task-card__actions"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="btn btn-sm btn-outline" onClick={() => onEdit(t)}>
            수정
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => onDelete(t)}
            aria-label="삭제"
            title="삭제"
          >
            <Icon name="trash" className="btn-ic" />
          </button>
        </div>
      </div>
      <div className="task-card__title" title={t.title}>
        {t.title}
      </div>
      {t.memo && (
        <div className="task-card__memo" title={t.memo}>
          {t.memo}
        </div>
      )}
      {(t.assigneeName || t.dueDate || t.createdAt) && (
        <div className="task-card__foot">
          {t.assigneeName && (
            <span className="task-meta" title={t.assigneeName}>
              <Icon name="user" className="task-ic" />
              {t.assigneeName}
            </span>
          )}
          {t.createdAt && (
            <span className="task-meta" title={`등록 ${fmtCreated(t.createdAt)}`}>
              <Icon name="clock" className="task-ic" />
              {fmtCreated(t.createdAt)}
            </span>
          )}
          {t.dueDate &&
            (t.status === 'done' ? (
              <span className="task-meta" title={`마감 ${t.dueDate}`}>
                <Icon name="calendar" className="task-ic" />
                {t.dueDate.slice(5)}
              </span>
            ) : (
              <span className={`task-dday task-dday--${ddayLevel(ddayDiff(t.dueDate))}`} title={`마감 ${t.dueDate}`}>
                {ddayLabel(ddayDiff(t.dueDate))}
              </span>
            ))}
        </div>
      )}
      {/* 모바일 전용 — 화살표로 단계 이동 (드래그 대신) */}
      {onMove && (
        <div className="task-move no-print" onClick={stopAll} onPointerDown={stopAll}>
          <button
            type="button"
            className="task-move__btn"
            disabled={colIdx <= 0}
            onClick={() => onMove(t.id, -1)}
            aria-label="이전 단계로"
          >
            <Icon name="chevronLeft" className="btn-ic" />
            {colIdx > 0 ? COLS[colIdx - 1].label : ''}
          </button>
          <button
            type="button"
            className="task-move__btn"
            disabled={colIdx >= COLS.length - 1}
            onClick={() => onMove(t.id, 1)}
            aria-label="다음 단계로"
          >
            {colIdx < COLS.length - 1 ? COLS[colIdx + 1].label : ''}
            <Icon name="chevronRight" className="btn-ic" />
          </button>
        </div>
      )}
    </div>
  );
}

function TaskColumn({ col, cards, editMode, onAdd, onEdit, onDelete, onMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={`kb-col task-col--${col.key} ${isOver ? 'is-over' : ''}`}>
      <div className="kb-col__head">
        <span className="kb-col__title">{col.label}</span>
        <span className="kb-col__count">{cards.length}</span>
      </div>
      <div className="kb-col__body">
        {cards.map((t) => (
          <TaskCard key={t.id} t={t} editMode={editMode} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />
        ))}
        <button type="button" className="task-add-btn" onClick={() => onAdd(col.key)}>
          <Icon name="plus" className="btn-ic" />
          업무 추가
        </button>
      </div>
    </div>
  );
}

export default function HomeTaskBoard() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile, isAdmin, isExecutive } = useAuth();
  const canSeeAll = isAdmin || isExecutive;
  // PC: 마우스로 즉시 드래그. 모바일: 길게 눌러야(220ms) 드래그 시작 →
  // 짧은 터치·이동은 그대로 세로 스크롤이 되어 스크롤이 막히지 않는다.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  // 「순서 변경」 토글 — 기본 꺼짐. 켜야만 카드를 끌어 단계를 옮길 수 있다(실수로 옮기는 것 방지).
  const [editMode, setEditMode] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const [t, u] = await Promise.all([getTasks(), getUsers().catch(() => [])]);
      setTasks(t);
      setUsers(u.filter((x) => x.isActive !== false && isRealStaff(x)));
    } catch (err) {
      console.error('업무 보드 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }

  function openAdd(status) {
    setEditId(null);
    setForm({ ...EMPTY, status: status || 'todo' });
    setModalOpen(true);
  }

  function openEdit(t) {
    setEditId(t.id);
    setForm({
      title: t.title || '',
      assigneeId: t.assigneeId || '',
      dueDate: t.dueDate || '',
      priority: t.priority || 'normal',
      memo: t.memo || '',
      status: t.status || 'todo',
    });
    setModalOpen(true);
  }

  async function save() {
    if (!form.title.trim()) {
      alert('업무 제목을 입력하세요.');
      return;
    }
    const assignee = users.find((u) => u.uid === form.assigneeId);
    const payload = { ...form, title: form.title.trim(), assigneeName: assignee?.name || '' };
    try {
      if (editId) await updateTask(editId, payload);
      else await addTask(payload);
      setModalOpen(false);
      await load();
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  }

  async function remove(t) {
    if (!(await confirm({ title: '업무 삭제', message: `"${t.title}" 업무를 삭제할까요?` }))) return;
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await trashGeneric('tasks', t.id, { title: t.title || '업무' }, userProfile?.name || '');
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
      load();
    }
  }

  // 모바일: 화살표로 단계 이동 (이전/다음 상태로)
  async function moveStatus(id, dir) {
    const card = tasks.find((t) => t.id === id);
    if (!card) return;
    const cur = COLS.findIndex((c) => c.key === (card.status || 'todo'));
    const next = COLS[cur + dir];
    if (!next) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: next.key } : t)));
    try {
      await setTaskStatus(id, next.key);
    } catch {
      toast('상태 변경 중 오류가 발생했습니다', 'error');
      load();
    }
  }

  async function handleBoardDrag(event) {
    const { active, over } = event;
    if (!editMode || !over) return;
    const id = active.id;
    const newStatus = over.id;
    const card = tasks.find((t) => t.id === id);
    if (!card || !COLS.some((c) => c.key === newStatus) || (card.status || 'todo') === newStatus) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    try {
      await setTaskStatus(id, newStatus);
    } catch {
      toast('상태 변경 중 오류가 발생했습니다', 'error');
      load();
    }
  }

  const visibleTasks = canSeeAll ? tasks : tasks.filter((t) => !t.assigneeId || t.assigneeId === userProfile?.uid);

  const groups = COLS.map((col) => ({ col, cards: visibleTasks.filter((t) => (t.status || 'todo') === col.key) }));

  return (
    <section className="home-task-board">
      <div className="home-task-board__head">
        <h3>회사 주요업무 진행상황</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => openAdd('todo')}>
            <Icon name="plus" className="btn-ic" />
            업무 추가
          </button>
          <EditModeButton on={editMode} onToggle={() => setEditMode((v) => !v)} />
        </div>
      </div>

      {loading ? (
        <p className="text-muted">불러오는 중...</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleBoardDrag}>
          <div className="table-scroll-x">
            <div className="kb-board task-board">
              {groups.map(({ col, cards }) => (
                <TaskColumn
                  key={col.key}
                  col={col}
                  cards={cards}
                  editMode={editMode}
                  onAdd={openAdd}
                  onEdit={openEdit}
                  onDelete={remove}
                  onMove={moveStatus}
                />
              ))}
            </div>
          </div>
        </DndContext>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? '업무 수정' : '업무 추가'}>
        <div className="task-form">
          <label className="task-form__label">제목</label>
          <input
            aria-label="제목"
            type="text"
            className="task-form__input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="업무 제목"
            autoFocus
          />

          <div className="task-form__row">
            <div>
              <label className="task-form__label">담당자</label>
              <Select
                value={form.assigneeId}
                onChange={(v) => setForm((f) => ({ ...f, assigneeId: v }))}
                options={[{ value: '', label: '미지정' }, ...users.map((u) => ({ value: u.uid, label: u.name }))]}
                ariaLabel="담당자 선택"
              />
            </div>
            <div>
              <label className="task-form__label">우선순위</label>
              <Select
                value={form.priority}
                onChange={(v) => setForm((f) => ({ ...f, priority: v }))}
                options={Object.entries(PRIORITY).map(([k, v]) => ({ value: k, label: v.label }))}
                ariaLabel="우선순위 선택"
              />
            </div>
          </div>

          <div className="task-form__row">
            <div>
              <label className="task-form__label">마감일</label>
              <input
                aria-label="마감일"
                type="date"
                className="task-form__input"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
            <div>
              <label className="task-form__label">단계</label>
              <Select
                value={form.status}
                onChange={(v) => setForm((f) => ({ ...f, status: v }))}
                options={COLS.map((c) => ({ value: c.key, label: c.label }))}
                ariaLabel="단계 선택"
              />
            </div>
          </div>

          <label className="task-form__label">설명/메모</label>
          <textarea
            aria-label="설명/메모"
            className="task-form__input task-form__textarea"
            value={form.memo}
            onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            placeholder="업무 상세 내용"
            rows={3}
          />

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={save}>
              {editId ? '저장' : '추가'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
