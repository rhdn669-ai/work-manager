import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getDepartmentPendingLeaves, approveLeave, rejectLeave } from '../../services/leaveService';
import { getUser } from '../../services/userService';
import { LEAVE_TYPE_LABELS } from '../../utils/constants';
import Modal from '../../components/common/Modal';

export default function ManageLeavePage() {
  const { userProfile } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [userNames, setUserNames] = useState({});

  useEffect(() => {
    if (userProfile) loadPending();
  }, [userProfile]);

  async function loadPending() {
    setLoading(true);
    try {
      const data = await getDepartmentPendingLeaves(userProfile.departmentId);
      setLeaves(data);

      // 사용자 이름 조회
      const names = {};
      for (const l of data) {
        if (!names[l.userId]) {
          const u = await getUser(l.userId);
          names[l.userId] = u?.name || '알 수 없음';
        }
      }
      setUserNames(names);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(leaveId) {
    if (!confirm('승인하시겠습니까?')) return;
    try {
      await approveLeave(leaveId, userProfile.uid);
      await loadPending();
    } catch (err) {
      alert('승인 처리 중 오류가 발생했습니다.');
    }
  }

  async function handleReject() {
    if (!rejectModal) return;
    try {
      await rejectLeave(rejectModal, rejectReason);
      setRejectModal(null);
      setRejectReason('');
      await loadPending();
    } catch (err) {
      alert('거절 처리 중 오류가 발생했습니다.');
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="manage-leave-page">
      <h2>연차 승인 관리</h2>

      {leaves.length === 0 ? (
        <p className="text-muted">대기 중인 연차 신청이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>신청자</th>
              <th>종류</th>
              <th>기간</th>
              <th>일수</th>
              <th>사유</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td>{userNames[l.userId] || l.userId}</td>
                <td>{LEAVE_TYPE_LABELS[l.type]}</td>
                <td>{l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`}</td>
                <td>{l.days}일</td>
                <td>{l.reason || '-'}</td>
                <td>
                  <div className="btn-group">
                    <button className="btn btn-sm btn-primary" onClick={() => handleApprove(l.id)}>승인</button>
                    <button className="btn btn-sm btn-danger" onClick={() => setRejectModal(l.id)}>거절</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal isOpen={!!rejectModal} onClose={() => setRejectModal(null)} title="연차 거절">
        <div className="form-group">
          <label>거절 사유</label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="거절 사유를 입력해주세요"
            rows={3}
          />
        </div>
        <div className="modal-actions">
          <button className="btn btn-danger" onClick={handleReject}>거절</button>
          <button className="btn btn-outline" onClick={() => setRejectModal(null)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
