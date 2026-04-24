import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { requestLeave } from '../../services/leaveService';
import { getEvents } from '../../services/eventService';
import { LEAVE_TYPES, LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import { getBusinessDaysExcludingHolidays, buildHolidaySet } from '../../utils/dateUtils';
import LeaveTabs from '../../components/common/LeaveTabs';

export default function LeaveRequestPage() {
  const { userProfile } = useAuth();
  const [type, setType] = useState(LEAVE_TYPES.ANNUAL);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [holidayEvents, setHolidayEvents] = useState([]);

  useEffect(() => {
    getEvents().then((evs) => setHolidayEvents(evs.filter((e) => e.type === 'holiday'))).catch(() => {});
  }, []);
  const holidaySet = useMemo(() => buildHolidaySet(holidayEvents), [holidayEvents]);

  function calculateDays() {
    if (!startDate) return 0;
    if (type === LEAVE_TYPES.HALF_AM || type === LEAVE_TYPES.HALF_PM) return 0.5;
    if (QUARTER_LEAVE_TYPES.includes(type)) return 0.25;
    if (!endDate) return 0;
    return getBusinessDaysExcludingHolidays(startDate, endDate, holidaySet);
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

    setLoading(true);
    try {
      await requestLeave({
        userId: userProfile.uid,
        departmentId: userProfile.departmentId,
        type,
        startDate,
        endDate: isSingleDay ? startDate : endDate,
        days,
        reason,
      });
      setMessage('연차가 등록되었습니다.');
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err) {
      setError('신청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  const isSingleDay =
    type === LEAVE_TYPES.HALF_AM ||
    type === LEAVE_TYPES.HALF_PM ||
    QUARTER_LEAVE_TYPES.includes(type);
  const days = calculateDays();

  return (
    <div className="leave-request-page">
      <LeaveTabs />
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
            {!isSingleDay && (
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
              <span className="text-muted text-sm" style={{ marginLeft: 8 }}>(주말·휴일 제외)</span>
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
