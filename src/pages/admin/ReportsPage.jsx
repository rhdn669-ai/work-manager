import { useState, useEffect } from 'react';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
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
      const records = await getAllOvertimeRecords(start, end);

      // 직원별 집계
      const byUser = {};
      users.forEach((u) => {
        byUser[u.uid] = { name: u.name, departmentId: u.departmentId, total: 0, count: 0 };
      });
      records.forEach((r) => {
        if (byUser[r.userId]) {
          byUser[r.userId].total += r.minutes || 0;
          byUser[r.userId].count++;
        }
      });

      setReport(Object.entries(byUser).map(([uid, data]) => ({ uid, ...data })));
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
      <h2>전사 리포트</h2>

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
        <button className="btn btn-primary" onClick={generateReport} disabled={loading}>
          {loading ? '생성 중...' : '리포트 생성'}
        </button>
      </div>

      {report.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>부서</th>
              <th>총 잔업</th>
              <th>등록 건수</th>
            </tr>
          </thead>
          <tbody>
            {report.filter((r) => r.count > 0).map((r) => (
              <tr key={r.uid}>
                <td>{r.name}</td>
                <td>{deptMap[r.departmentId] || '-'}</td>
                <td>{formatMinutes(r.total)}</td>
                <td>{r.count}건</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>합계</strong></td>
              <td><strong>{formatMinutes(report.reduce((s, r) => s + r.total, 0))}</strong></td>
              <td><strong>{report.reduce((s, r) => s + r.count, 0)}건</strong></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
