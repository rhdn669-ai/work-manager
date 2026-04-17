import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getDepartments, getDepartmentsByLeader } from '../../services/departmentService';
import { getAllSites } from '../../services/siteService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import { EmployeeDetailModal } from '../admin/ReportsPage';

export default function TeamReportsPage() {
  const { userProfile, canApproveAll } = useAuth();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sites, setSites] = useState([]);
  const [report, setReport] = useState([]);
  const [rawRecords, setRawRecords] = useState([]);
  const [rawLeaves, setRawLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overtime');
  const [detailUser, setDetailUser] = useState(null);

  useEffect(() => {
    if (userProfile) loadBase();
  }, [userProfile]);

  useEffect(() => {
    if (users.length > 0) generateReport();
  }, [users, year, month]);

  async function loadBase() {
    const [allUsers, deps, allSites] = await Promise.all([
      getUsers(),
      getDepartments(),
      getAllSites(),
    ]);

    let scoped = allUsers;
    if (!canApproveAll) {
      const myDepts = await getDepartmentsByLeader(userProfile.uid);
      const myDeptIds = new Set(myDepts.map((d) => d.id));
      scoped = allUsers.filter((u) => myDeptIds.has(u.departmentId));
    }

    setUsers(scoped);
    setDepartments(deps);
    setSites(allSites);
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
      setRawRecords(records);
      setRawLeaves(approvedLeaves);

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
  const siteMap = { etc: '기타' };
  sites.forEach((s) => { siteMap[s.id] = s.name; });

  const rows = report;
  const totalOvertimeMinutes = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalOvertimeCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeaveDays = rows.reduce((s, r) => s + r.leaveDays, 0);

  return (
    <div className="reports-page">
      <h2>팀원 잔업 · 연차</h2>

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
        <p className="text-muted">팀원이 없습니다.</p>
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
              <tr key={r.uid} onClick={() => setDetailUser(r)} style={{ cursor: 'pointer' }}>
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
              <tr key={r.uid} onClick={() => setDetailUser(r)} style={{ cursor: 'pointer' }}>
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

      {detailUser && (
        <EmployeeDetailModal
          user={detailUser}
          tab={activeTab}
          year={year}
          month={month}
          overtimes={rawRecords.filter((r) => r.userId === detailUser.uid)}
          leaves={rawLeaves.filter((l) => l.userId === detailUser.uid)}
          siteMap={siteMap}
          canEdit={false}
          onClose={() => setDetailUser(null)}
          onChanged={generateReport}
        />
      )}
    </div>
  );
}
