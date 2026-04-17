import { useState, useEffect } from 'react';
import { getUsers, updateUser, createUser, deleteUser } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { initLeaveBalance, getLeaveBalance, setLeaveRemaining } from '../../services/leaveService';
import { POSITIONS } from '../../utils/constants';
import Modal from '../../components/common/Modal';

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({
    name: '', code: '', role: 'employee', position: '', departmentId: '', joinDate: '', fixedCost: '', hourlyRate: '',
    leaveRemaining: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [u, d] = await Promise.all([getUsers(), getDepartments()]);
      setUsers(u);
      setDepartments(d);

      const balMap = {};
      await Promise.all(u.map(async (usr) => {
        const bal = await getLeaveBalance(usr.uid).catch(() => null);
        if (bal) balMap[usr.uid] = bal;
      }));
      setBalances(balMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncAll() {
    if (!confirm('전체 사용자의 입사일을 연차 데이터에 동기화하시겠습니까?\n(사용 일수는 유지됩니다)')) return;
    try {
      for (const u of users) {
        if (u.joinDate) await initLeaveBalance(u.uid, u.joinDate);
      }
      await loadData();
      alert('동기화 완료');
    } catch (err) {
      alert('동기화 오류: ' + err.message);
    }
  }

  function openCreate() {
    setEditUser(null);
    setForm({ name: '', code: '', role: 'employee', position: '', departmentId: '', joinDate: '', fixedCost: '', hourlyRate: '', leaveRemaining: '' });
    setShowModal(true);
  }

  function openEdit(user) {
    const bal = balances[user.uid];
    setEditUser(user);
    setForm({
      name: user.name, code: user.code || '',
      role: user.role, position: user.position || '', departmentId: user.departmentId || '', joinDate: user.joinDate || '',
      fixedCost: user.fixedCost || '', hourlyRate: user.hourlyRate || '',
      leaveRemaining: bal ? String(bal.remainingDays) : '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      let targetUid;
      if (editUser) {
        targetUid = editUser.uid;
        await updateUser(editUser.uid, {
          name: form.name, code: form.code, role: form.role,
          position: form.position, departmentId: form.departmentId, joinDate: form.joinDate,
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
        });
        await initLeaveBalance(editUser.uid, form.joinDate);
      } else {
        const userId = 'user_' + Date.now();
        targetUid = userId;
        await createUser(userId, {
          uid: userId, name: form.name, code: form.code, role: form.role,
          position: form.position, departmentId: form.departmentId, joinDate: form.joinDate,
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
        });
        await initLeaveBalance(userId, form.joinDate);
      }

      // 연차 잔여 조정: 편집 중 현재 잔여와 다르면 업데이트
      if (form.leaveRemaining !== '' && !isNaN(Number(form.leaveRemaining))) {
        const currentBal = editUser ? balances[editUser.uid] : null;
        const newRemaining = Number(form.leaveRemaining);
        if (!currentBal || currentBal.remainingDays !== newRemaining) {
          await setLeaveRemaining(targetUid, newRemaining);
        }
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(user) {
    if (!confirm(`"${user.name}" 직원을 삭제하시겠습니까?`)) return;
    try {
      await deleteUser(user.uid);
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  const deptMap = {};
  departments.forEach((d) => { deptMap[d.id] = d.name; });

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="user-management-page">
      <div className="page-header">
        <h2>직원 관리</h2>
        <div className="btn-group" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={openCreate}>직원 추가</button>
          <button className="btn btn-outline" onClick={handleSyncAll}>연차 동기화</button>
        </div>
      </div>
      <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
        ※ 누적 연차는 입사일 기준 자동 계산됩니다. "연차 수정"은 현재 잔여만 입력하면 이후 발생분은 자동 반영됩니다.
      </p>

      <table className="table user-management-table table-clickable">
        <thead>
          <tr>
            <th>이름</th>
            <th>코드</th>
            <th>직급</th>
            <th>부서</th>
            <th>고정비용</th>
            <th>시급</th>
            <th>입사일</th>
            <th>연차 (누적/사용/잔여)</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const bal = balances[u.uid];
            return (
              <tr key={u.uid} onClick={() => openEdit(u)} style={{ cursor: 'pointer' }}>
                <td>{u.name}</td>
                <td><code>{u.code}</code></td>
                <td>
                  <span className={`badge badge-position${u.position ? `-${u.position}` : ''}`}>
                    {u.position || '-'}
                  </span>
                </td>
                <td>{deptMap[u.departmentId] || '-'}</td>
                <td>{u.fixedCost ? Number(u.fixedCost).toLocaleString() + '원' : '-'}</td>
                <td>{u.hourlyRate ? Number(u.hourlyRate).toLocaleString() + '원' : '-'}</td>
                <td>{u.joinDate || '-'}</td>
                <td>
                  {bal ? (
                    <span className="leave-balance-cell">
                      <span className="leave-total">{bal.totalDays}</span>
                      <span className="leave-sep">/</span>
                      <span className="leave-used">{bal.usedDays}</span>
                      <span className="leave-sep">/</span>
                      <strong className="leave-remaining">{bal.remainingDays}</strong>
                    </span>
                  ) : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editUser ? '사용자 수정' : '직원 추가'}>
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
            <label>직급</label>
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">없음</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
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
            <label>고정비용 (월급, 원)</label>
            <input type="number" value={form.fixedCost} onChange={(e) => setForm({ ...form, fixedCost: e.target.value })} placeholder="예: 3000000" />
          </div>
          <div className="form-group">
            <label>시급 (잔업 단가, 원)</label>
            <input type="number" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} placeholder="예: 15000" />
          </div>
          <div className="form-group">
            <label>입사일</label>
            <input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} required />
          </div>
          {editUser && balances[editUser.uid] && (
            <div className="form-group">
              <label>
                잔여 연차 조정 (일)
                <span className="text-muted text-sm" style={{ marginLeft: 8, fontWeight: 400 }}>
                  누적 {balances[editUser.uid].totalDays}일 · 사용 {balances[editUser.uid].usedDays}일
                </span>
              </label>
              <input type="number" step="0.25" min="0" value={form.leaveRemaining} onChange={(e) => setForm({ ...form, leaveRemaining: e.target.value })} placeholder="현재 잔여 일수" />
              <small className="text-muted">
                현재 잔여 일수를 입력하면 반영됩니다. 이후 발생분은 자동 계산됩니다.
              </small>
            </div>
          )}
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            {editUser ? (
              <button type="button" className="btn btn-danger" onClick={() => handleDelete(editUser)}>삭제</button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
              <button type="submit" className="btn btn-primary">{editUser ? '수정' : '추가'}</button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
