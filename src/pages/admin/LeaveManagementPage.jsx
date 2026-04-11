import { useState, useEffect } from 'react';
import { getUsers } from '../../services/userService';
import { getLeaveBalance, initLeaveBalance, setLeaveRemaining } from '../../services/leaveService';
import Modal from '../../components/common/Modal';

export default function LeaveManagementPage() {
  const [users, setUsers] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [remaining, setRemaining] = useState(0);

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
    setRemaining(bal ? bal.remainingDays : 0);
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await setLeaveRemaining(editTarget.uid, Number(remaining));
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('수정 중 오류: ' + err.message);
    }
  }

  async function handleSyncAll() {
    if (!confirm('전체 사용자의 입사일을 연차 데이터에 동기화하시겠습니까?\n(사용 일수는 유지됩니다)')) return;
    try {
      for (const u of users) {
        if (u.joinDate) {
          await initLeaveBalance(u.uid, u.joinDate);
        }
      }
      await loadData();
      alert('동기화 완료');
    } catch (err) {
      alert('동기화 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="leave-management-page">
      <div className="page-header">
        <h2>연차 관리</h2>
        <button className="btn btn-primary" onClick={handleSyncAll}>전체 입사일 동기화</button>
      </div>

      <p className="text-muted text-sm">
        ※ 누적 발생은 입사일 기준으로 실시간 계산됩니다. 시간이 지나면 월차/연차가 자동으로 추가됩니다.<br />
        ※ "수정"에서 현재 잔여만 입력하면 됩니다. 이후 발생분은 시스템이 자동 반영합니다.
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
                  <button className="btn btn-sm btn-outline" onClick={() => openEdit(u)} disabled={!bal}>수정</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTarget ? `${editTarget.name} - 현재 잔여 연차 설정` : ''}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>현재 잔여 연차 (일)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={remaining}
              onChange={(e) => setRemaining(e.target.value)}
              required
              autoFocus
            />
            <small className="text-muted">
              오늘 시점의 잔여 일수를 입력하세요.<br />
              이후 시간이 지나면 근속에 따른 발생분이 자동으로 추가됩니다.
            </small>
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">저장</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
