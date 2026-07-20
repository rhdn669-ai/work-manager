import { useState, useEffect } from 'react';
import { getDepartments, addDepartment, updateDepartment } from '../../services/departmentService';
import { getUsers } from '../../services/userService';
import { ensureDeptChannel, deleteDeptChannel } from '../../services/channelService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';

function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return vw;
}

export default function DepartmentManagementPage() {
  const { confirm, toast } = useDialog();
  const { userProfile } = useAuth();
  const vw = useViewportWidth();
  const isXSmall = vw <= 360;
  const [trashOpen, setTrashOpen] = useState(false);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editDept, setEditDept] = useState(null);
  const [form, setForm] = useState({ name: '', managerId: '' });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [d, u] = await Promise.all([getDepartments(), getUsers()]);
      setDepartments(d);
      setUsers(u);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditDept(null);
    setForm({ name: '', managerId: '' });
    setShowModal(true);
  }

  function openEdit(dept) {
    setEditDept(dept);
    setForm({ name: dept.name, managerId: dept.managerId || '' });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editDept) {
        await updateDepartment(editDept.id, form);
        await ensureDeptChannel(editDept.id, form.name);
      } else {
        const ref = await addDepartment(form);
        await ensureDeptChannel(ref.id, form.name);
      }
      setShowModal(false);
      await loadData();
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(dept) {
    if (
      !(await confirm({
        title: '부서 삭제',
        message: `"${dept.name}" 부서를 삭제할까요?\n휴지통에서 복원할 수 있습니다.`,
      }))
    )
      return;
    try {
      await trashGeneric(
        'departments',
        dept.id,
        {
          title: dept.name,
          summary: userMap[dept.managerId] ? `부서장 ${userMap[dept.managerId]}` : '',
        },
        userProfile?.name || '',
      );
      await deleteDeptChannel(dept.id);
      toast('휴지통으로 이동했습니다.');
      await loadData();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  const userMap = {};
  users.forEach((u) => {
    userMap[u.uid] = u.name;
  });

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="dept-management-page">
      <div className="page-header">
        <h2>부서 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            부서 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['departments']}
        title="부서 휴지통"
        onChange={loadData}
      />

      <div className="table-scroll-x">
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>부서명</th>
              <th>부서장</th>
              <th className="col-action">작업</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.id}>
                <td data-label="부서명" title={d.name} style={{ wordBreak: 'break-word', minWidth: 100 }}>
                  {d.name}
                </td>
                <td
                  data-label="부서장"
                  title={userMap[d.managerId] || ''}
                  style={{ wordBreak: 'break-word', minWidth: 0, ...(isXSmall ? { maxWidth: 100 } : {}) }}
                >
                  <span className="u-wrap">{userMap[d.managerId] || '-'}</span>
                </td>
                <td className="col-action">
                  <div className="btn-group" style={{ gap: 'var(--space-2)' }}>
                    <button className="btn btn-sm btn-outline" style={{ padding: '0 8px' }} onClick={() => openEdit(d)}>
                      수정
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      style={{ padding: '0 8px' }}
                      onClick={() => handleDelete(d)}
                    >
                      <Icon name="trash" className="btn-ic" />
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editDept ? '부서 수정' : '부서 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>부서명</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>부서장</label>
            <Select
              value={form.managerId}
              onChange={(v) => setForm({ ...form, managerId: v })}
              options={users
                .filter((u) => u.role === 'manager' || u.role === 'admin')
                .map((u) => ({ value: u.uid, label: u.name }))}
              ariaLabel="부서장 선택"
              placeholder="선택"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
              취소
            </button>
            <button type="submit" className="btn btn-primary">
              {editDept ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
