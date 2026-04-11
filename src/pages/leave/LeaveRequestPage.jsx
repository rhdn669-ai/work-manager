import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { requestLeave, getLeaveBalance } from '../../services/leaveService';
import { LEAVE_TYPES, LEAVE_TYPE_LABELS } from '../../utils/constants';
import { getBusinessDays } from '../../utils/dateUtils';

export default function LeaveRequestPage() {
  const { userProfile } = useAuth();
  const [type, setType] = useState(LEAVE_TYPES.ANNUAL);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function calculateDays() {
    if (!startDate || !endDate) return 0;
    if (type === LEAVE_TYPES.HALF_AM || type === LEAVE_TYPES.HALF_PM) return 0.5;
    return getBusinessDays(startDate, endDate);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    const days = calculateDays();

    if (days <= 0) {
      setError('올바른 날짜를 선택해주세요.');
      return;
    }

    // 잔여 연차 확인
    const balance = await getLeaveBalance(userProfile.uid);
    if (balance && balance.remainingDays < days) {
      setError(`잔여 연차가 부족합니다. (잔여: ${balance.remainingDays}일, 신청: ${days}일)`);
      return;
    }

    setLoading(true);
    try {
      await requestLeave({
        userId: userProfile.uid,
        departmentId: userProfile.departmentId,
        type,
        startDate,
        endDate: type === LEAVE_TYPES.HALF_AM || type === LEAVE_TYPES.HALF_PM ? startDate : endDate,
        days,
        reason,
      });
      setMessage('연차 신청이 완료되었습니다. 승인을 기다려주세요.');
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err) {
      setError('신청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const isHalf = type === LEAVE_TYPES.HALF_AM || type === LEAVE_TYPES.HALF_PM;
  const days = calculateDays();

  return (
    <div className="leave-request-page">
      <h2>연차 신청</h2>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body">
          {error && <div className="alert alert-error">{error}</div>}
          {message && <div className="alert alert-success">{message}</div>}

          <div className="form-group">
            <label>휴가 종류</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(LEAVE_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            {!isHalf && (
              <div className="form-group">
                <label>종료일</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  required
                />
              </div>
            )}
          </div>

          {days > 0 && (
            <div className="leave-days-info">
              차감일수: <strong>{days}일</strong>
            </div>
          )}

          <div className="form-group">
            <label>사유</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="사유를 입력해주세요 (선택)"
              rows={3}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '신청 중...' : '신청하기'}
          </button>
        </div>
      </form>
    </div>
  );
}
