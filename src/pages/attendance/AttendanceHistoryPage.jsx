import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyOvertimeRecords, deleteOvertimeRecord } from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes, getDayName } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';
import AttendanceTabs from '../../components/common/AttendanceTabs';

const STATUS_LABELS = { approved: '승인', pending: '대기', rejected: '거절' };

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
      const data = await getMyOvertimeRecords(userProfile.uid, start, end);
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await deleteOvertimeRecord(id);
      await loadRecords();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  const approvedRecords = records.filter((r) => r.status === 'approved');
  const approvedMinutes = approvedRecords.reduce((sum, r) => sum + (r.minutes || 0), 0);
  const totalMinutes = records.reduce((sum, r) => sum + (r.minutes || 0), 0);

  return (
    <div className="history-page">
      <AttendanceTabs />
      <h2>잔업 이력</h2>

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
        <span>승인 잔업 <strong>{formatMinutes(approvedMinutes)}</strong></span>
        <span>전체 <strong>{formatMinutes(totalMinutes)}</strong></span>
        <span>등록 건수 <strong>{records.length}건</strong></span>
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
              <th>잔업 시간</th>
              <th>사유</th>
              <th>상태</th>
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{getDayName(r.date)}</td>
                <td>{formatMinutes(r.minutes)}</td>
                <td>{r.reason || '-'}</td>
                <td><StatusBadge status={r.status} labels={STATUS_LABELS} /></td>
                <td>
                  {r.status !== 'approved' && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(r.id)}>삭제</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
