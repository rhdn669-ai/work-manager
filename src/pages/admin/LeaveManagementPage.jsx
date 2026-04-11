import { useState, useEffect } from 'react';
import { getUsers } from '../../services/userService';
import { getLeaveBalance, initLeaveBalance, updateLeaveBalanceDirect } from '../../services/leaveService';
import Modal from '../../components/common/Modal';

export default function LeaveManagementPage() {
  const [users, setUsers] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ totalDays: 0, usedDays: 0 });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const userList = await getUsers();
      setUsers(userList);

      const balMap = {};
      for (const u of userList) {
        const bal = await getLeaveBalance(u.uid);
        if (bal) balMap[u.uid] = bal;
      }
      setBalances(balMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(user) {
    const bal = balances[user.uid];
    setEditTarget(user);
    setForm({
      totalDays: bal ? bal.totalDays : 0,
      usedDays: bal ? bal.usedDays : 0,
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      const total = Number(form.totalDays);
      const used = Number(form.usedDays);
      await updateLeaveBalanceDirect(editTarget.uid, {
        totalDays: total,
        usedDays: used,
        remainingDays: total - used,
      });
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('수정 중 오류: ' + err.message);
    }
  }

  async function handleRecalcAll() {
    if (!confirm('입사일 기준으로 전체 사용자의 누적 발생 연차를 재계산하시겠습니까?\n(기존 사용 일수는 유지됩니다)')) return;
    try {
      for (const u of users) {
        if (u.joinDate) {
          await initLeaveBalance(u.uid, u.joinDate);
        }
      }
      await loadData();
      alert('재계산 완료');
    } catch (err) {
      alert('재계산 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="leave-management-page">
      <div className="page-header">
        <h2>연차 관리</h2>
        <button className="btn btn-primary" onClick={handleRecalcAll}>전체 누적 연차 재계산</button>
      </div>

      <p className="text-muted text-sm">
        ※ 미사용 연월차는 이월되며, 입사일부터 현재까지 누적 발생한 총 연월차가 표시됩니다.
      </p>

      <table className="table">
        <thead>
          <tr>
            <th>코드</th>
            <th>이름</th>
            <th>입사일</th>
            <th>누적 발생</th>
            <th>사용</th>
            <th>잔여</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const bal = balances[u.uid];
            return (
              <tr key={u.uid}>
                <td><code>{u.code}</code></td>
                <td>{u.name}</td>
                <td>{u.joinDate || '-'}</td>
                <td>{bal ? bal.totalDays + '일' : '-'}</td>
                <td>{bal ? bal.usedDays + '일' : '-'}</td>
                <td>{bal ? bal.remainingDays + '일' : '-'}</td>
                <td>
                  <button className="btn btn-sm btn-outline" onClick={() => openEdit(u)}>수정</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? `${editTarget.name} - 연차 수정` : ''}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>누적 발생 (일)</label>
            <input type="number" step="0.5" min="0" value={form.totalDays}
              onChange={(e) => setForm({ ...form, totalDays: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>사용 연차 (일)</label>
            <input type="number" step="0.5" min="0" value={form.usedDays}
              onChange={(e) => setForm({ ...form, usedDays: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>잔여 연차</label>
            <input type="text" value={`${(Number(form.totalDays) - Number(form.usedDays))}일`} disabled />
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">수정</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
