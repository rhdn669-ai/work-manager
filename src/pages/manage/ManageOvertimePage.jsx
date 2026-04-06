import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getDepartmentOvertimeRecords, getAllOvertimeRecords } from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes, getDayName } from '../../utils/dateUtils';

export default function ManageOvertimePage() {
  const { userProfile, isAdmin } = useAuth();
  const [records, setRecords] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year, month]);

  async function loadData() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const data = isAdmin
        ? await getAllOvertimeRecords(start, end)
        : await getDepartmentOvertimeRecords(userProfile.departmentId, start, end);
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // 직원별 합산
  const byUser = {};
  records.forEach((r) => {
    if (!byUser[r.userId]) byUser[r.userId] = { name: r.userName, total: 0, count: 0 };
    byUser[r.userId].total += r.minutes || 0;
    byUser[r.userId].count++;
  });

  const totalMinutes = records.reduce((sum, r) => sum + (r.minutes || 0), 0);

  return (
    <div className="manage-overtime-page">
      <h2>부서원 잔업 현황</h2>

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

      {/* 직원별 요약 */}
      <div className="card">
        <div className="card-header">직원별 요약</div>
        <div className="card-body">
          {Object.keys(byUser).length === 0 ? (
            <p className="text-muted">해당 월의 기록이 없습니다.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>총 잔업</th>
                  <th>등록 건수</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byUser).map(([uid, data]) => (
                  <tr key={uid}>
                    <td>{data.name}</td>
                    <td>{formatMinutes(data.total)}</td>
                    <td>{data.count}건</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>합계</strong></td>
                  <td><strong>{formatMinutes(totalMinutes)}</strong></td>
                  <td><strong>{records.length}건</strong></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* 상세 기록 */}
      {records.length > 0 && (
        <div className="card">
          <div className="card-header">상세 기록</div>
          <div className="card-body">
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>날짜</th>
                  <th>요일</th>
                  <th>잔업 시간</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.userName}</td>
                    <td>{r.date}</td>
                    <td>{getDayName(r.date)}</td>
                    <td>{formatMinutes(r.minutes)}</td>
                    <td>{r.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
