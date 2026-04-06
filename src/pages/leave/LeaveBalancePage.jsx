import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getLeaveBalance } from '../../services/leaveService';

export default function LeaveBalancePage() {
  const { userProfile } = useAuth();
  const [balance, setBalance] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadBalance();
  }, [userProfile, year]);

  async function loadBalance() {
    setLoading(true);
    try {
      const data = await getLeaveBalance(userProfile.uid, year);
      setBalance(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const usedPercentage = balance ? Math.round((balance.usedDays / balance.totalDays) * 100) : 0;

  return (
    <div className="leave-balance-page">
      <h2>연차 잔여 현황</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {balance ? (
        <div className="card">
          <div className="card-body">
            <div className="balance-overview">
              <div className="balance-item">
                <div className="balance-label">총 연차</div>
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
            <p className="text-muted">해당 연도의 연차 정보가 없습니다. 관리자에게 문의해주세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
