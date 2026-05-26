import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getBomProjects, addBomProject, deleteBomProject,
} from '../../services/bomService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

export default function BomPage() {
  const { confirm, alert } = useDialog();
  const navigate = useNavigate();
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
    if (!await confirm(`"${project.name}" 프로젝트와 등록된 BOM을 모두 삭제하시겠습니까?`)) return;
    try {
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
          <button type="button" className="btn btn-primary" onClick={openAddProject}>+ 프로젝트 추가</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="purchase-empty">
          등록된 프로젝트가 없습니다 — 우측 상단 "+ 프로젝트 추가"로 시작하세요.
        </p>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>프로젝트명</th>
              <th className="bom-project-action-col">작업</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr
                key={p.id}
                className="table-clickable-row"
                onClick={() => navigate(`/admin/purchase/bom/${p.id}`)}
              >
                <td data-label="프로젝트명"><strong>{p.name}</strong></td>
                <td className="bom-project-action-col">
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={(e) => handleDeleteProject(e, p)}
                  >삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
