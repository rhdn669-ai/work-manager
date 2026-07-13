import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { getLeaveBalance } from '../../services/leaveService';
import LeaveTabs from '../../components/common/LeaveTabs';
import Skeleton from '../../components/common/Skeleton';

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

  if (loading) return <Skeleton.Rows count={6} />;

  const usedPercentage =
    balance && balance.totalDays > 0 ? Math.round((balance.usedDays / balance.totalDays) * 100) : 0;

  return (
    <div className="leave-balance-page">
      <LeaveTabs />
      <h2>연차 잔여 현황</h2>

      {balance ? (
        <div className="card">
          <div className="card-body">
            <div className="balance-overview" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <div className="balance-item" style={{ flex: '1 1 50px', minWidth: 50 }}>
                <div className="balance-label" style={{ fontSize: 11 }}>
                  누적 발생
                </div>
                <div className="balance-value" style={{ fontSize: 18 }}>
                  {balance.totalDays}일
                </div>
              </div>
              <div className="balance-item" style={{ flex: '1 1 50px', minWidth: 50 }}>
                <div className="balance-label" style={{ fontSize: 11 }}>
                  사용
                </div>
                <div className="balance-value used" style={{ fontSize: 18 }}>
                  {balance.usedDays}일
                </div>
              </div>
              <div className="balance-item" style={{ flex: '1 1 50px', minWidth: 50 }}>
                <div className="balance-label" style={{ fontSize: 11 }}>
                  잔여
                </div>
                <div className="balance-value remaining" style={{ fontSize: 18 }}>
                  {balance.remainingDays}일
                </div>
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
