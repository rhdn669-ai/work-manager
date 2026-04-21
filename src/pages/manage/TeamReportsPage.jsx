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
  const [allUsers, setAllUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [myDepts, setMyDepts] = useState([]);
  const [sites, setSites] = useState([]);
  const [report, setReport] = useState([]);
  const [rawRecords, setRawRecords] = useState([]);
  const [rawLeaves, setRawLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('members');
  const [detailUser, setDetailUser] = useState(null);

  useEffect(() => {
    if (userProfile) loadBase();
  }, [userProfile]);

  useEffect(() => {
    if (users.length > 0) generateReport();
  }, [users, year, month]);

  async function loadBase() {
    const [fetchedUsers, deps, allSites] = await Promise.all([
      getUsers(),
      getDepartments(),
      getAllSites(),
    ]);

    let scoped = fetchedUsers;
    let depts = [];
    if (!canApproveAll) {
      depts = await getDepartmentsByLeader(userProfile.uid);
      const myDeptIds = new Set(depts.map((d) => d.id));
      scoped = fetchedUsers.filter((u) => myDeptIds.has(u.departmentId));
    }

    setAllUsers(fetchedUsers);
    setUsers(scoped);
    setDepartments(deps);
    setMyDepts(depts);
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
            position: u.position || '',
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
  const userMap = Object.fromEntries(allUsers.map((u) => [u.uid, u]));

  const rows = report;
  const totalOvertimeMinutes = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalOvertimeCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeaveDays = rows.reduce((s, r) => s + r.leaveDays, 0);

  // 팀 구성 데이터
  const myTeam = myDepts[0];
  const teamMembers = myTeam
    ? allUsers.filter((u) => u.departmentId === myTeam.id).sort((a, b) => {
        if (myTeam.managerId === a.uid) return -1;
        if (myTeam.managerId === b.uid) return 1;
        return 0;
      })
    : users.filter((u) => u.role !== 'admin');

  return (
    <div className="reports-page">
      <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>

      <div className="tab-nav">
        <button type="button" className={`tab-nav-item ${activeTab === 'members' ? 'active' : ''}`} onClick={() => setActiveTab('members')}>
          팀원
        </button>
        <button type="button" className={`tab-nav-item ${activeTab === 'overtime' ? 'active' : ''}`} onClick={() => setActiveTab('overtime')}>
          잔업
        </button>
        <button type="button" className={`tab-nav-item ${activeTab === 'leave' ? 'active' : ''}`} onClick={() => setActiveTab('leave')}>
          연차
        </button>
      </div>

      {activeTab !== 'members' && (
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
      )}

      {activeTab === 'members' ? (
        teamMembers.length === 0 ? (
          <div className="card"><div className="card-body empty-state">팀원이 없습니다.</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>이름</th><th>직급</th></tr>
            </thead>
            <tbody>
              {teamMembers.map((u) => (
                <tr key={u.uid}>
                  <td>
                    <strong>{u.name}</strong>
                    {myTeam && u.uid === myTeam.managerId && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>팀장</span>}
                    {u.uid === userProfile.uid && <span className="badge badge-position" style={{ marginLeft: 6 }}>나</span>}
                  </td>
                  <td>{u.position || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <p className="text-muted">팀원이 없습니다.</p>
      ) : activeTab === 'overtime' ? (
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 48 }}>#</th>
              <th>이름</th>
              <th>총 잔업</th>
              <th>건수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.uid} onClick={() => setDetailUser(r)} style={{ cursor: 'pointer' }}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.overtimeMinutes > 0 ? formatMinutes(r.overtimeMinutes) : '-'}</td>
                <td>{r.overtimeCount > 0 ? `${r.overtimeCount}건` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>합계</strong></td>
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
              <th>연차 사용</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.uid} onClick={() => setDetailUser(r)} style={{ cursor: 'pointer' }}>
                <td>{i + 1}</td>
                <td>{r.name}</td>
                <td>{r.leaveDays > 0 ? `${r.leaveDays}일` : '-'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>합계</strong></td>
              <td><strong>{totalLeaveDays}일</strong></td>
            </tr>
          </tfoot>
        </table>
      )}

      {detailUser && (
        <EmployeeDetailModal
          user={detailUser}
          tab={activeTab === 'members' ? 'overtime' : activeTab}
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
