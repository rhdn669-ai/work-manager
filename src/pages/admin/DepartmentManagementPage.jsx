import { useState, useEffect } from 'react';
import { getDepartments, addDepartment, updateDepartment, deleteDepartment } from '../../services/departmentService';
import { getUsers } from '../../services/userService';
import { ensureDeptChannel, deleteDeptChannel } from '../../services/channelService';
import Modal from '../../components/common/Modal';

export default function DepartmentManagementPage() {
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
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      await deleteDepartment(id);
      await deleteDeptChannel(id);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  const userMap = {};
  users.forEach((u) => { userMap[u.uid] = u.name; });

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="dept-management-page">
      <div className="page-header">
        <h2>부서 관리</h2>
        <button className="btn btn-primary" onClick={openCreate}>부서 추가</button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>부서명</th>
            <th>부서장</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {departments.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>{userMap[d.managerId] || '-'}</td>
              <td>
                <div className="btn-group">
                  <button className="btn btn-sm btn-outline" onClick={() => openEdit(d)}>수정</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d.id)}>삭제</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editDept ? '부서 수정' : '부서 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>부서명</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>부서장</label>
            <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
              <option value="">선택</option>
              {users.filter((u) => u.role === 'manager' || u.role === 'admin').map((u) => (
                <option key={u.uid} value={u.uid}>{u.name}</option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editDept ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
