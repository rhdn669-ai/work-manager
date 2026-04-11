import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getLeaveBalance } from '../../services/leaveService';

export default function LeaveBalancePage() {
  const { userProfile } = useAuth();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadBalance();
  }, [userProfile]);

  async function loadBalance() {
    setLoading(true);
    try {
      const data = await getLeaveBalance(userProfile.uid);
      setBalance(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const usedPercentage = balance && balance.totalDays > 0
    ? Math.round((balance.usedDays / balance.totalDays) * 100)
    : 0;

  return (
    <div className="leave-balance-page">
      <h2>연차 잔여 현황</h2>

      {balance ? (
        <div className="card">
          <div className="card-body">
            <div className="balance-overview">
              <div className="balance-item">
                <div className="balance-label">누적 발생</div>
                <div className="balance-value">{balance.totalDays}일</div>
              </div>
              <div className="balance-item">
                <div className="balance-label">사용</div>
                <div className="balance-value used">{balance.usedDays}일</div>
              </div>
              <div className="balance-item">
                <div className="balance-label">잔여</div>
                <div className="balance-value remaining">{balance.remainingDays}일</div>
              </div>
            </div>

            <div className="balance-bar">
              <div className="balance-fill" style={{ width: `${usedPercentage}%` }} />
            </div>
            <p className="text-sm text-center">{usedPercentage}% 사용</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body">
            <p className="text-muted">연차 정보가 없습니다. 관리자에게 문의해주세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
