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
  const [activeTab, setActiveTab] = useState('overtime');

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

      const leaveByUser = {};
      for (const l of approvedLeaves) {
        if (!leaveByUser[l.userId]) leaveByUser[l.userId] = 0;
        leaveByUser[l.userId] += l.days || 0;
      }

      const byUser = {};
      users
        .filter((u) => u.isActive !== false && u.role !== 'admin')
        .forEach((u) => {
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

      setReport(Object.entries(byUser).map(([uid, data]) => ({ uid, ...data })));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const deptMap = {};
  departments.forEach((d) => { deptMap[d.id] = d.name; });

  const rows = report;
  const totalOvertimeMinutes = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalOvertimeCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeaveDays = rows.reduce((s, r) => s + r.leaveDays, 0);

  return (
    <div className="reports-page">
      <h2>잔업·연차</h2>

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

      <div className="tab-nav">
        <button
          type="button"
          className={`tab-nav-item ${activeTab === 'overtime' ? 'active' : ''}`}
          onClick={() => setActiveTab('overtime')}
        >
          잔업
        </button>
        <button
          type="button"
          className={`tab-nav-item ${activeTab === 'leave' ? 'active' : ''}`}
          onClick={() => setActiveTab('leave')}
        >
          연차
        </button>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <p className="text-muted">직원 정보가 없습니다.</p>
      ) : activeTab === 'overtime' ? (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>이름</th>
              <th>부서</th>
              <th>총 잔업</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.uid}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{deptMap[r.departmentId] || '-'}</td>
                <td>{r.overtimeMinutes > 0 ? formatMinutes(r.overtimeMinutes) : '-'}</td>
                <td>{r.overtimeCount > 0 ? `${r.overtimeCount}건` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><strong>합계</strong></td>
              <td><strong>{formatMinutes(totalOvertimeMinutes)}</strong></td>
              <td><strong>{totalOvertimeCount}건</strong></td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>이름</th>
              <th>부서</th>
              <th>연차 사용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.uid}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{deptMap[r.departmentId] || '-'}</td>
                <td>{r.leaveDays > 0 ? `${r.leaveDays}일` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}><strong>합계</strong></td>
              <td><strong>{totalLeaveDays}일</strong></td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
