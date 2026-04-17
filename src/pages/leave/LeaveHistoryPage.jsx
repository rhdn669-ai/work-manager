import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyLeaves, cancelLeave } from '../../services/leaveService';
import { LEAVE_TYPE_LABELS } from '../../utils/constants';
import LeaveTabs from '../../components/common/LeaveTabs';

export default function LeaveHistoryPage() {
  const { userProfile } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadLeaves();
  }, [userProfile, year]);

  async function loadLeaves() {
    setLoading(true);
    try {
      const data = await getMyLeaves(userProfile.uid, year);
      setLeaves(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(leaveId) {
    if (!confirm('정말 취소하시겠습니까?')) return;
    try {
      await cancelLeave(leaveId);
      await loadLeaves();
    } catch (err) {
      alert('취소 중 오류가 발생했습니다.');
    }
  }

  return (
    <div className="leave-history-page">
      <LeaveTabs />
      <h2>연차 사용 이력</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : leaves.length === 0 ? (
        <p className="text-muted">해당 연도의 기록이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
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
                <td>{LEAVE_TYPE_LABELS[l.type]}</td>
                <td>{l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`}</td>
                <td>{l.days}일</td>
                <td>{l.reason || '-'}</td>
                <td>
                  {l.status === 'confirmed' && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleCancel(l.id)}>취소</button>
                  )}
                  {l.status === 'cancelled' && <span className="text-sm text-muted">취소됨</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
