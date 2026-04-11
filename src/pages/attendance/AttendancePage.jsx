import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { addOvertimeRecord } from '../../services/attendanceService';
import { getToday } from '../../utils/dateUtils';
import AttendanceTabs from '../../components/common/AttendanceTabs';

export default function AttendancePage() {
  const { userProfile } = useAuth();
  const [date, setDate] = useState(getToday());
  const [hours, setHours] = useState('');
  const [minutesInput, setMinutesInput] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    const totalMinutes = (parseInt(hours || 0) * 60) + parseInt(minutesInput || 0);
    if (totalMinutes <= 0) {
      setMessage('잔업 시간을 입력해주세요.');
      return;
    }

    const isPast = date < getToday();
    setSubmitting(true);
    setMessage('');
    try {
      await addOvertimeRecord({
        userId: userProfile.uid,
        userName: userProfile.name,
        departmentId: userProfile.departmentId,
        date,
        minutes: totalMinutes,
        reason,
      });
      setHours('');
      setMinutesInput('');
      setReason('');
      setMessage(isPast
        ? '지난 날짜 잔업이 등록되었습니다. 관리자 승인 후 확정됩니다.'
        : '잔업이 등록되었습니다!'
      );
    } catch (err) {
      setMessage('등록 실패: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="attendance-page">
      <AttendanceTabs />
      <h2>잔업 등록</h2>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body">
          {message && <div className="alert alert-info">{message}</div>}
          <div className="form-row">
            <div className="form-group">
              <label>날짜</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>시간</label>
              <input type="number" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="시간" min="0" max="12" />
            </div>
            <div className="form-group">
              <label>분</label>
              <input type="number" value={minutesInput} onChange={(e) => setMinutesInput(e.target.value)} placeholder="분" min="0" max="59" />
            </div>
          </div>
          <div className="form-group">
            <label>사유</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="잔업 사유 (선택)" />
          </div>
          {date < getToday() && (
            <div className="alert alert-warning">지난 날짜는 관리자 승인이 필요합니다.</div>
          )}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '등록 중...' : '잔업 등록'}
          </button>
        </div>
      </form>
    </div>
  );
}
