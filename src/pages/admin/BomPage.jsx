import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getBomProjects, addBomProject, deleteBomProject, saveBomProjectsOrder,
} from '../../services/bomService';
import { trashBomProject } from '../../services/trashService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';
import { useAuth } from '../../contexts/AuthContext';

// 드래그 가능한 프로젝트 행
function SortableProjectRow({ p, onOpen, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    background: isDragging ? 'var(--bg-card)' : undefined,
  };
  return (
    <tr ref={setNodeRef} style={style} className="table-clickable-row" onClick={() => onOpen(p)}>
      <td className="drag-handle-cell" data-label="" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drag-handle-btn" aria-label="드래그하여 순서 변경" title="드래그하여 순서 변경" {...attributes} {...listeners}>≡</button>
      </td>
      <td data-label="프로젝트명"><strong>{p.name}</strong></td>
      <td className="bom-project-action-col">
        <button className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>삭제</button>
      </td>
    </tr>
  );
}

export default function BomPage() {
  const { confirm, alert } = useDialog();
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function handleDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(projects, oldIndex, newIndex);
    setProjects(next);
    try {
      await saveBomProjectsOrder(next.map((p) => p.id));
    } catch (err) {
      alert('순서 저장 오류: ' + err.message);
    }
  }
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ps = await getBomProjects();
        setProjects(ps);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function openAddProject() {
    setNewProjectName('');
    setAddProjectOpen(true);
  }

  async function submitAddProject() {
    const name = newProjectName.trim();
    if (!name) { alert('프로젝트 이름을 입력하세요.'); return; }
    if (projects.some((p) => (p.name || '').trim().toLowerCase() === name.toLowerCase())) {
      alert('같은 이름의 프로젝트가 이미 있습니다.');
      return;
    }
    setAddingProject(true);
    try {
      const ref = await addBomProject(name);
      setAddProjectOpen(false);
      navigate(`/admin/purchase/bom/${ref.id}`);
    } catch (err) {
      alert('프로젝트 추가 중 오류: ' + err.message);
    } finally {
      setAddingProject(false);
    }
  }

  async function handleDeleteProject(e, project) {
    e.stopPropagation();
    if (!await confirm(`"${project.name}" 프로젝트와 등록된 BOM을 모두 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`)) return;
    try {
      await trashBomProject(project.id, userProfile?.name || ''); // 휴지통에 스냅샷 보관
      await deleteBomProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="bom-page">
      <div className="page-header">
        <h2>프로젝트별 BOM</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('/admin/purchase/trash?type=bomProject')}>🗑 휴지통</button>
          <button type="button" className="btn btn-sm btn-primary" onClick={openAddProject}>+ 프로젝트 추가</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="purchase-empty">
          등록된 프로젝트가 없습니다 — 우측 상단 "+ 프로젝트 추가"로 시작하세요.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <table className="table cards-sm sortable-rows">
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label="순서 변경"></th>
                <th>프로젝트명</th>
                <th className="bom-project-action-col">작업</th>
              </tr>
            </thead>
            <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <tbody>
                {projects.map((p) => (
                  <SortableProjectRow
                    key={p.id}
                    p={p}
                    onOpen={(pp) => navigate(`/admin/purchase/bom/${pp.id}`)}
                    onDelete={handleDeleteProject}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      )}

      <Modal isOpen={addProjectOpen} onClose={() => setAddProjectOpen(false)} title="프로젝트 추가">
        <div className="form-group">
          <label>프로젝트 이름</label>
          <input
            type="text"
            value={newProjectName}
            placeholder="예: 2026 공장동 신축"
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitAddProject(); }}
            autoFocus
          />
        </div>
        <p className="field-hint">추가 후 자동으로 BOM 편집 페이지로 이동합니다.</p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={submitAddProject}
            disabled={addingProject || !newProjectName.trim()}
          >
            {addingProject ? '추가 중…' : '추가하고 열기'}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setAddProjectOpen(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
