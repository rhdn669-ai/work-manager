import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getAttendanceByRange } from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatTime, formatMinutes, getDayName } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';

const STATUS_LABELS = {
  working: '근무중',
  completed: '완료',
  absent: '결근',
  leave: '휴가',
};

export default function AttendanceHistoryPage() {
  const { userProfile } = useAuth();
  const [records, setRecords] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadRecords();
  }, [userProfile, year, month]);

  async function loadRecords() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const data = await getAttendanceByRange(userProfile.uid, start, end);
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const totalWorkMinutes = records.reduce((sum, r) => sum + (r.workMinutes || 0), 0);
  const totalOvertimeMinutes = records.reduce((sum, r) => sum + (r.overtimeMinutes || 0), 0);

  return (
    <div className="history-page">
      <h2>출퇴근 이력</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
      </div>

      <div className="summary-bar">
        <span>근무일수: <strong>{records.filter((r) => r.status === 'completed').length}일</strong></span>
        <span>총 근무시간: <strong>{formatMinutes(totalWorkMinutes)}</strong></span>
        <span>총 초과근무: <strong>{formatMinutes(totalOvertimeMinutes)}</strong></span>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : records.length === 0 ? (
        <p className="text-muted">해당 월의 기록이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>요일</th>
              <th>출근</th>
              <th>퇴근</th>
              <th>근무시간</th>
              <th>초과근무</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{getDayName(r.date)}</td>
                <td>{formatTime(r.checkIn)}</td>
                <td>{r.checkOut ? formatTime(r.checkOut) : '-'}</td>
                <td>{formatMinutes(r.workMinutes)}</td>
                <td>{formatMinutes(r.overtimeMinutes)}</td>
                <td><StatusBadge status={r.status} labels={STATUS_LABELS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
