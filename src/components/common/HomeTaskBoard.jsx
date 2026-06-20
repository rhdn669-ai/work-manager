import { useState, useEffect } from 'react';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { getTasks, addTask, updateTask, setTaskStatus, deleteTask } from '../../services/taskService';
import { getUsers } from '../../services/userService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from './DialogProvider';
import Modal from './Modal';
import Select from './Select';
import Icon from './Icon';

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

function TaskCard({ t, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id });
  const style = {
    transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
    opacity: isDragging ? 0.4 : undefined,
  };
  const pr = PRIORITY[t.priority] || PRIORITY.normal;
  const overdue = t.dueDate && t.status !== 'done' && t.dueDate < todayStr();
  return (
    <div ref={setNodeRef} style={style} className="kb-card task-card" {...attributes} {...listeners}>
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
      {(t.assigneeName || t.dueDate) && (
        <div className="task-card__foot">
          {t.assigneeName && (
            <span className="task-meta" title={t.assigneeName}>
              <Icon name="user" className="task-ic" />
              {t.assigneeName}
            </span>
          )}
          {t.dueDate && (
            <span className={`task-meta task-due${overdue ? ' is-overdue' : ''}`} title={`마감 ${t.dueDate}`}>
              <Icon name="calendar" className="task-ic" />
              {t.dueDate.slice(5)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function TaskColumn({ col, cards, onAdd, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={`kb-col ${isOver ? 'is-over' : ''}`}>
      <div className="kb-col__head">
        <span className="kb-col__title">{col.label}</span>
        <span className="kb-col__count">{cards.length}</span>
      </div>
      <div className="kb-col__body">
        {cards.map((t) => (
          <TaskCard key={t.id} t={t} onEdit={onEdit} onDelete={onDelete} />
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
  const { confirm, alert } = useDialog();
  const { userProfile, isAdmin, isExecutive } = useAuth();
  const canSeeAll = isAdmin || isExecutive;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
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
      setUsers(u.filter((x) => x.isActive !== false));
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
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  }

  async function remove(t) {
    if (!(await confirm({ title: '업무 삭제', message: `"${t.title}" 업무를 삭제할까요?` }))) return;
    setTasks((prev) => prev.filter((x) => x.id !== t.id));
    try {
      await deleteTask(t.id);
    } catch (err) {
      alert('삭제 실패: ' + err.message);
      load();
    }
  }

  async function handleBoardDrag(event) {
    const { active, over } = event;
    if (!over) return;
    const id = active.id;
    const newStatus = over.id;
    const card = tasks.find((t) => t.id === id);
    if (!card || !COLS.some((c) => c.key === newStatus) || (card.status || 'todo') === newStatus) return;
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    try {
      await setTaskStatus(id, newStatus);
    } catch (err) {
      alert('상태 변경 실패: ' + err.message);
      load();
    }
  }

  const visibleTasks = canSeeAll
    ? tasks
    : tasks.filter((t) => !t.assigneeId || t.assigneeId === userProfile?.uid);

  const groups = COLS.map((col) => ({ col, cards: visibleTasks.filter((t) => (t.status || 'todo') === col.key) }));

  return (
    <section className="home-task-board">
      <div className="home-task-board__head">
        <h3>회사 주요업무 진행상황</h3>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => openAdd('todo')}>
          <Icon name="plus" className="btn-ic" />
          업무 추가
        </button>
      </div>

      {loading ? (
        <p className="text-muted">불러오는 중...</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleBoardDrag}>
          <div className="table-scroll-x">
            <div className="kb-board task-board">
              {groups.map(({ col, cards }) => (
                <TaskColumn key={col.key} col={col} cards={cards} onAdd={openAdd} onEdit={openEdit} onDelete={remove} />
              ))}
            </div>
          </div>
        </DndContext>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editId ? '업무 수정' : '업무 추가'}>
        <div className="task-form">
          <label className="task-form__label">제목</label>
          <input
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
