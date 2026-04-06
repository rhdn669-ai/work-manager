import { useState, useEffect } from 'react';
import { getUsers, updateUser, createUser } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { initLeaveBalance } from '../../services/leaveService';
import Modal from '../../components/common/Modal';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({
    name: '', code: '', role: 'employee', departmentId: '', joinDate: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [u, d] = await Promise.all([getUsers(), getDepartments()]);
      setUsers(u);
      setDepartments(d);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditUser(null);
    setForm({ name: '', code: '', role: 'employee', departmentId: '', joinDate: '' });
    setShowModal(true);
  }

  function openEdit(user) {
    setEditUser(user);
    setForm({
      name: user.name, code: user.code || '',
      role: user.role, departmentId: user.departmentId || '', joinDate: user.joinDate || '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (editUser) {
        await updateUser(editUser.uid, {
          name: form.name, code: form.code, role: form.role,
          departmentId: form.departmentId, joinDate: form.joinDate,
        });
      } else {
        const userId = 'user_' + Date.now();
        await createUser(userId, {
          uid: userId, name: form.name, code: form.code, role: form.role,
          departmentId: form.departmentId, joinDate: form.joinDate,
        });
        const year = new Date().getFullYear();
        await initLeaveBalance(userId, form.joinDate, year);
      }
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleInitLeave(user) {
    const year = new Date().getFullYear();
    try {
      const days = await initLeaveBalance(user.uid, user.joinDate, year);
      alert(`${user.name}님의 ${year}년 연차가 ${days}일로 설정되었습니다.`);
    } catch (err) {
      alert('연차 초기화 오류: ' + err.message);
    }
  }

  const deptMap = {};
  departments.forEach((d) => { deptMap[d.id] = d.name; });

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="user-management-page">
      <div className="page-header">
        <h2>사용자 관리</h2>
        <button className="btn btn-primary" onClick={openCreate}>사용자 추가</button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>코드</th>
            <th>역할</th>
            <th>부서</th>
            <th>입사일</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.uid}>
              <td>{u.name}</td>
              <td><code>{u.code}</code></td>
              <td>
                <span className={`badge badge-role-${u.role}`}>
                  {u.role === 'admin' ? '관리자' : u.role === 'manager' ? '부서장' : '직원'}
                </span>
              </td>
              <td>{deptMap[u.departmentId] || '-'}</td>
              <td>{u.joinDate || '-'}</td>
              <td>
                <div className="btn-group">
                  <button className="btn btn-sm btn-outline" onClick={() => openEdit(u)}>수정</button>
                  <button className="btn btn-sm btn-secondary" onClick={() => handleInitLeave(u)}>연차설정</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editUser ? '사용자 수정' : '사용자 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>이름</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>로그인 코드</label>
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="예: 1234" required />
          </div>
          <div className="form-group">
            <label>역할</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="employee">직원</option>
              <option value="manager">부서장</option>
              <option value="admin">관리자</option>
            </select>
          </div>
          <div className="form-group">
            <label>부서</label>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">선택</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>입사일</label>
            <input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} required />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editUser ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
