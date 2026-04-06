import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { addOvertimeRecord, getMyOvertimeRecords, deleteOvertimeRecord } from '../../services/attendanceService';
import { formatMinutes, getToday, getMonthStart, getMonthEnd } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';

const STATUS_LABELS = { approved: '승인', pending: '대기', rejected: '거절' };

export default function AttendancePage() {
  const { userProfile } = useAuth();
  const [date, setDate] = useState(getToday());
  const [hours, setHours] = useState('');
  const [minutesInput, setMinutesInput] = useState('');
  const [reason, setReason] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  const now = new Date();
  const [year] = useState(now.getFullYear());
  const [month] = useState(now.getMonth() + 1);

  useEffect(() => {
    if (userProfile) loadRecords();
  }, [userProfile]);

  async function loadRecords() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const data = await getMyOvertimeRecords(userProfile.uid, start, end);
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

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
      await loadRecords();
    } catch (err) {
      setMessage('등록 실패: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteOvertimeRecord(id);
      await loadRecords();
    } catch (err) {
      alert('삭제 실패');
    }
  }

  const approvedRecords = records.filter((r) => r.status === 'approved');
  const totalMonthMinutes = approvedRecords.reduce((sum, r) => sum + (r.minutes || 0), 0);

  return (
    <div className="attendance-page">
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

      <div className="summary-bar">
        <span>이번 달 승인 잔업: <strong>{formatMinutes(totalMonthMinutes)}</strong></span>
        <span>등록 건수: <strong>{records.length}건</strong></span>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : records.length === 0 ? (
        <p className="text-muted">이번 달 잔업 기록이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>잔업 시간</th>
              <th>사유</th>
              <th>상태</th>
              <th>삭제</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{formatMinutes(r.minutes)}</td>
                <td>{r.reason || '-'}</td>
                <td><StatusBadge status={r.status} labels={STATUS_LABELS} /></td>
                <td>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
