import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getBomProjects,
  addBomProject,
  deleteBomProject,
  saveBomProjectsOrder,
  duplicateBomProject,
  getBomBySite,
} from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import { bomStats } from '../../domain/bomStats';
// getBomProjects는 undo 복원 후 목록 갱신에도 사용
import { trashBomProject } from '../../services/trashService';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Icon from '../../components/common/Icon';
import EditModeButton from '../../components/common/EditModeButton';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';
import { useAuth } from '../../contexts/useAuth';
import { useUndo } from '../../contexts/useUndo';
import { restoreTrashItem } from '../../services/trashService';

const won = (n) => `${Math.round(n || 0).toLocaleString()}원`;

// 드래그 가능한 프로젝트 행 — 「순서·삭제」가 꺼져 있으면 끌 수도 고를 수도 없다
function SortableProjectRow({ p, stat, editMode, checked, onCheck, onOpen, onCopy, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
    disabled: !editMode,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    background: isDragging ? 'var(--bg-card)' : undefined,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`table-clickable-row${checked ? ' is-checked' : ''}`}
      onClick={() => onOpen(p)}
    >
      <td className="drag-handle-cell" data-label="" onClick={(e) => e.stopPropagation()}>
        {editMode && (
          <input
            type="checkbox"
            className="sel-check"
            checked={checked}
            onChange={() => onCheck(p.id)}
            aria-label="삭제할 프로젝트 고르기"
          />
        )}
        <button
          type="button"
          className="drag-handle-btn"
          aria-label="드래그하여 순서 변경"
          title="드래그하여 순서 변경"
          {...attributes}
          {...listeners}
        >
          <Icon name="move" />
        </button>
      </td>
      <td data-label="프로젝트명" title={p.name || ''}>
        <strong className="u-ellipsis-1" title={p.name || ''}>
          {p.name}
        </strong>
      </td>
      <td data-label="품목 수" className="u-num">
        {stat ? `${stat.count.toLocaleString()}개` : '—'}
      </td>
      <td data-label="개별수량 합" className="u-num">
        {stat ? `${stat.qty.toLocaleString()}개` : '—'}
      </td>
      <td data-label="예상 총액" className="u-num">
        {stat ? (
          <>
            <strong>{won(stat.amount)}</strong>
            {stat.freeCount > 0 && (
              <span className="bom-card-free" title="고객사 제공 자재는 금액에서 뺀다">
                사급 {stat.freeCount}건 제외
              </span>
            )}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="bom-project-action-col action-cell">
        <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onCopy(e, p)}>
          <Icon name="copy" className="btn-ic" />
          복사
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>
          <Icon name="trash" className="btn-ic" />
          삭제
        </button>
      </td>
    </tr>
  );
}

export default function BomPage() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const { push: pushUndo } = useUndo();
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
    } catch {
      toast('순서 저장 중 오류가 발생했습니다', 'error');
    }
  }
  const [trashOpen, setTrashOpen] = useState(false);
  // 순서·삭제 토글 — 기본 꺼짐. 화면을 나가면 저절로 꺼진다(여기 state 뿐)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set()); // 골라 둔 프로젝트 id
  const [projects, setProjects] = useState([]);
  const [stats, setStats] = useState({}); // projectId → { count, qty, amount }
  const [loading, setLoading] = useState(true);

  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [addingProject, setAddingProject] = useState(false);

  // BOM 복사 — { project, name } | null
  const [copyTarget, setCopyTarget] = useState(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const ps = await getBomProjects();
        setProjects(ps);
        loadStats(ps); // 목록 렌더 후 프로젝트별 합계는 백그라운드로 채움
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 프로젝트별 품목 수·개별수량 합·예상 총액 — 상세 화면의 「예상 합계」와 같은 셈(domain/bomStats):
  // 마스터 표준단가 우선, 사급은 금액에서 제외 (2026-09-03 대표님 「카드와 안의 금액이 다름」)
  async function loadStats(ps) {
    try {
      const master = await getPurchaseItems();
      const priceById = new Map(master.map((m) => [m.id, m.standardPrice]));
      const entries = await Promise.all(
        ps.map(async (p) => {
          const items = await getBomBySite(p.id);
          return [p.id, bomStats(items, priceById)];
        }),
      );
      setStats(Object.fromEntries(entries));
    } catch (err) {
      console.error('BOM 합계 계산 실패', err);
    }
  }

  function openAddProject() {
    setNewProjectName('');
    setAddProjectOpen(true);
  }

  async function submitAddProject() {
    const name = newProjectName.trim();
    if (!name) {
      alert('프로젝트 이름을 입력하세요.');
      return;
    }
    if (projects.some((p) => (p.name || '').trim().toLowerCase() === name.toLowerCase())) {
      alert('같은 이름의 프로젝트가 이미 있습니다.');
      return;
    }
    setAddingProject(true);
    try {
      const ref = await addBomProject(name);
      setAddProjectOpen(false);
      navigate(`/admin/purchase/bom/${ref.id}`);
    } catch {
      toast('프로젝트 추가 중 오류가 발생했습니다', 'error');
    } finally {
      setAddingProject(false);
    }
  }

  function openCopyProject(e, project) {
    e.stopPropagation();
    setCopyTarget({ project, name: `${project.name} (복사)` });
  }

  async function submitCopyProject() {
    const name = (copyTarget?.name || '').trim();
    if (!name) {
      alert('새 프로젝트 이름을 입력하세요.');
      return;
    }
    if (projects.some((p) => (p.name || '').trim().toLowerCase() === name.toLowerCase())) {
      alert('같은 이름의 프로젝트가 이미 있습니다.');
      return;
    }
    setCopying(true);
    try {
      const newId = await duplicateBomProject(copyTarget.project.id, name);
      setCopyTarget(null);
      toast(`"${copyTarget.project.name}" BOM을 복사했습니다.`);
      navigate(`/admin/purchase/bom/${newId}`);
    } catch {
      toast('복사 중 오류가 발생했습니다', 'error');
    } finally {
      setCopying(false);
    }
  }

  async function handleDeleteProject(e, project) {
    e.stopPropagation();
    if (
      !(await confirm(
        `"${project.name}" 프로젝트와 등록된 BOM을 모두 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`,
      ))
    )
      return;
    try {
      const tid = await trashBomProject(project.id, userProfile?.name || '');
      await deleteBomProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (tid)
        pushUndo(`BOM 프로젝트 "${project.name}" 삭제`, async () => {
          await restoreTrashItem(tid);
          const ps = await getBomProjects();
          setProjects(ps);
          loadStats(ps);
        });
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set()); // 끄면 골라 둔 것도 함께 푼다
      return !v;
    });
  }

  function togglePick(id) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 고른 프로젝트를 한꺼번에 — 행별 「삭제」와 같은 길(휴지통)로 하나씩 보낸다
  async function deletePicked() {
    const targets = projects.filter((p) => pick.has(p.id));
    if (targets.length === 0) return;
    if (
      !(await confirm(
        `고른 프로젝트 ${targets.length}건과 등록된 BOM을 모두 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`,
      ))
    )
      return;
    try {
      for (const p of targets) {
        await trashBomProject(p.id, userProfile?.name || '');
        await deleteBomProject(p.id);
      }
      const ids = new Set(targets.map((p) => p.id));
      setProjects((prev) => prev.filter((p) => !ids.has(p.id)));
      setPick(new Set());
      toast(`${targets.length}건을 휴지통으로 옮겼습니다.`);
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className={`bom-page${editMode ? '' : ' editmode-off'}`}>
      <style>{`
        .bom-page .table tbody tr { min-height: 44px; }
        .bom-page .table thead tr { height: 44px; }
      `}</style>
      <div className="page-header">
        <h2>프로젝트별 BOM</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openAddProject}>
            <Icon name="plus" className="btn-ic" />
            프로젝트 추가
          </button>
          <EditModeButton on={editMode} onToggle={toggleEditMode} label="순서·삭제" />
        </div>
      </div>

      {editMode && pick.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">
            <strong>{pick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={deletePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="purchase-empty">등록된 프로젝트가 없습니다 — 우측 상단 "프로젝트 추가"로 시작하세요.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="table-scroll-x">
            <table className="table cards-sm sortable-rows">
              <thead>
                <tr>
                  <th scope="col" style={{ width: editMode ? 62 : 36 }} aria-label="순서 변경"></th>
                  <th scope="col">프로젝트명</th>
                  <th scope="col" style={{ width: 90 }} className="u-num">
                    품목 수
                  </th>
                  <th scope="col" style={{ width: 110 }} className="u-num">
                    개별수량 합
                  </th>
                  <th scope="col" style={{ width: 160 }} className="u-num">
                    예상 총액
                  </th>
                  <th scope="col" className="bom-project-action-col">
                    작업
                  </th>
                </tr>
              </thead>
              <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {projects.map((p) => (
                    <SortableProjectRow
                      key={p.id}
                      p={p}
                      stat={stats[p.id]}
                      editMode={editMode}
                      checked={pick.has(p.id)}
                      onCheck={togglePick}
                      onOpen={(pp) => navigate(`/admin/purchase/bom/${pp.id}`)}
                      onCopy={openCopyProject}
                      onDelete={handleDeleteProject}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </div>
        </DndContext>
      )}

      <Modal isOpen={addProjectOpen} onClose={() => setAddProjectOpen(false)} title="프로젝트 추가">
        <div className="form-group">
          <label>프로젝트 이름</label>
          <input
            aria-label="프로젝트 이름"
            type="text"
            value={newProjectName}
            placeholder="예: 2026 공장동 신축"
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAddProject();
            }}
            autoFocus
          />
        </div>
        <p className="field-hint">추가 후 자동으로 BOM 편집 페이지로 이동합니다.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setAddProjectOpen(false)}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submitAddProject}
            disabled={addingProject || !newProjectName.trim()}
          >
            {addingProject ? '추가 중…' : '추가하고 열기'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!copyTarget} onClose={() => setCopyTarget(null)} title="BOM 복사">
        {copyTarget && (
          <>
            <p className="field-hint">
              「<strong>{copyTarget.project.name}</strong>」의 품목 전체(BOX·순서 포함)를 새 프로젝트로 복사합니다.
            </p>
            <div className="form-group">
              <label>새 프로젝트 이름</label>
              <input
                aria-label="새 프로젝트 이름"
                type="text"
                value={copyTarget.name}
                onChange={(e) => setCopyTarget((t) => ({ ...t, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCopyProject();
                }}
                autoFocus
              />
            </div>
            <p className="field-hint">복사 후 자동으로 새 BOM 편집 페이지로 이동합니다.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setCopyTarget(null)}>
                취소
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={submitCopyProject}
                disabled={copying || !(copyTarget.name || '').trim()}
              >
                {copying ? '복사 중…' : '복사하고 열기'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['bomProject']}
        title="프로젝트 BOM 휴지통"
        onChange={() => {}}
      />
    </div>
  );
}
