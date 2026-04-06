import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getTodayAttendance, checkIn, checkOut } from '../../services/attendanceService';
import { updateWeeklySummary } from '../../services/overtimeService';
import { formatTime, formatMinutes, getToday } from '../../utils/dateUtils';

export default function AttendancePage() {
  const { userProfile } = useAuth();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (userProfile) loadToday();
  }, [userProfile]);

  async function loadToday() {
    try {
      const data = await getTodayAttendance(userProfile.uid);
      setRecord(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckIn() {
    setActionLoading(true);
    setMessage('');
    try {
      await checkIn(userProfile.uid, userProfile.departmentId);
      await loadToday();
      setMessage('출근이 기록되었습니다!');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCheckOut() {
    if (!record) return;
    setActionLoading(true);
    setMessage('');
    try {
      const result = await checkOut(record.id, record.checkIn);
      // 주간 초과근무 요약 갱신
      await updateWeeklySummary(userProfile.uid, userProfile.departmentId, new Date());
      await loadToday();
      setMessage(`퇴근이 기록되었습니다! 근무시간: ${formatMinutes(result.workMinutes)}`);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return (
    <div className="attendance-page">
      <h2>출퇴근</h2>
      <p className="page-date">{getToday()} ({['일','월','화','수','목','금','토'][now.getDay()]}요일)</p>

      <div className="attendance-clock">
        <div className="current-time">{timeStr}</div>
      </div>

      {message && <div className="alert alert-info">{message}</div>}

      <div className="attendance-actions">
        {!record ? (
          <button
            className="btn btn-primary btn-lg"
            onClick={handleCheckIn}
            disabled={actionLoading}
          >
            {actionLoading ? '처리 중...' : '출근하기'}
          </button>
        ) : record.status === 'working' ? (
          <button
            className="btn btn-secondary btn-lg"
            onClick={handleCheckOut}
            disabled={actionLoading}
          >
            {actionLoading ? '처리 중...' : '퇴근하기'}
          </button>
        ) : (
          <div className="attendance-done">오늘 근무가 완료되었습니다.</div>
        )}
      </div>

      {record && (
        <div className="attendance-detail card">
          <div className="card-header">오늘 기록</div>
          <div className="card-body">
            <div className="stat-row">
              <span>출근 시간</span>
              <strong>{formatTime(record.checkIn)}</strong>
            </div>
            <div className="stat-row">
              <span>퇴근 시간</span>
              <strong>{record.checkOut ? formatTime(record.checkOut) : '-'}</strong>
            </div>
            {record.workMinutes != null && (
              <>
                <div className="stat-row">
                  <span>근무 시간</span>
                  <strong>{formatMinutes(record.workMinutes)}</strong>
                </div>
                <div className="stat-row">
                  <span>초과근무</span>
                  <strong>{formatMinutes(record.overtimeMinutes)}</strong>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
