import { useState, useEffect } from 'react';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';

export default function ReportsPage() {
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [report, setReport] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    if (users.length > 0) generateReport();
  }, [users, year, month]);

  async function loadBase() {
    const [u, d] = await Promise.all([getUsers(), getDepartments()]);
    setUsers(u);
    setDepartments(d);
  }

  async function generateReport() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const [records, approvedLeaves] = await Promise.all([
        getAllOvertimeRecords(start, end),
        getApprovedLeavesByMonth(year, month),
      ]);

      // 직원별 연차 집계
      const leaveByUser = {};
      for (const l of approvedLeaves) {
        if (!leaveByUser[l.userId]) leaveByUser[l.userId] = 0;
        leaveByUser[l.userId] += l.days || 0;
      }

      // 직원별 잔업 집계
      const byUser = {};
      users.forEach((u) => {
        byUser[u.uid] = {
          name: u.name,
          departmentId: u.departmentId,
          overtimeMinutes: 0,
          overtimeCount: 0,
          leaveDays: leaveByUser[u.uid] || 0,
        };
      });
      records.forEach((r) => {
        if (byUser[r.userId]) {
          byUser[r.userId].overtimeMinutes += r.minutes || 0;
          byUser[r.userId].overtimeCount++;
        }
      });

      setReport(Object.entries(byUser)
        .map(([uid, data]) => ({ uid, ...data }))
        .filter((r) => r.overtimeCount > 0 || r.leaveDays > 0)
      );
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const deptMap = {};
  departments.forEach((d) => { deptMap[d.id] = d.name; });

  return (
    <div className="reports-page">
      <h2>직원 현황</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : report.length === 0 ? (
        <p className="text-muted">해당 월의 기록이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>부서</th>
              <th>잔업</th>
              <th>잔업 건수</th>
              <th>연차 사용</th>
            </tr>
          </thead>
          <tbody>
            {report.map((r) => (
              <tr key={r.uid}>
                <td>{r.name}</td>
                <td>{deptMap[r.departmentId] || '-'}</td>
                <td>{r.overtimeMinutes > 0 ? formatMinutes(r.overtimeMinutes) : '-'}</td>
                <td>{r.overtimeCount > 0 ? `${r.overtimeCount}건` : '-'}</td>
                <td>{r.leaveDays > 0 ? `${r.leaveDays}일` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>합계</strong></td>
              <td><strong>{formatMinutes(report.reduce((s, r) => s + r.overtimeMinutes, 0))}</strong></td>
              <td><strong>{report.reduce((s, r) => s + r.overtimeCount, 0)}건</strong></td>
              <td><strong>{report.reduce((s, r) => s + r.leaveDays, 0)}일</strong></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
