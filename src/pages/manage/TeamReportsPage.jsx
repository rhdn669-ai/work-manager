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
  const [allUsers, setAllUsers] = useState([]);
  const [scopedUsers, setScopedUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [myDepts, setMyDepts] = useState([]);
  const [sites, setSites] = useState([]);
  const [rawRecords, setRawRecords] = useState([]);
  const [rawLeaves, setRawLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [detailUser, setDetailUser] = useState(null);
  const [detailTab, setDetailTab] = useState('overtime');

  useEffect(() => {
    if (userProfile) loadBase();
  }, [userProfile]);

  useEffect(() => {
    if (scopedUsers.length > 0) loadMonthData();
  }, [scopedUsers, year, month]);

  async function loadBase() {
    setLoading(true);
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
    setScopedUsers(scoped);
    setDepartments(deps);
    setMyDepts(depts);
    setSites(allSites);
  }

  async function loadMonthData() {
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
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const siteMap = { etc: '기타' };
  sites.forEach((s) => { siteMap[s.id] = s.name; });

  const myTeam = myDepts[0];

  // 팀원 목록 + 잔업/연차 데이터 합산
  const teamMembers = myTeam
    ? allUsers.filter((u) => u.departmentId === myTeam.id).sort((a, b) => {
        if (myTeam.managerId === a.uid) return -1;
        if (myTeam.managerId === b.uid) return 1;
        return 0;
      })
    : scopedUsers.filter((u) => u.role !== 'admin');

  const overtimeByUser = {};
  rawRecords.forEach((r) => {
    if (!overtimeByUser[r.userId]) overtimeByUser[r.userId] = { minutes: 0, count: 0 };
    overtimeByUser[r.userId].minutes += r.minutes || 0;
    overtimeByUser[r.userId].count++;
  });

  const leaveByUser = {};
  rawLeaves.forEach((l) => {
    if (!leaveByUser[l.userId]) leaveByUser[l.userId] = 0;
    leaveByUser[l.userId] += l.days || 0;
  });

  const rows = teamMembers.filter((u) => u.isActive !== false && u.role !== 'admin').map((u) => ({
    uid: u.uid,
    name: u.name,
    position: u.position || '',
    isLeader: myTeam && u.uid === myTeam.managerId,
    isMe: u.uid === userProfile.uid,
    overtimeMinutes: overtimeByUser[u.uid]?.minutes || 0,
    overtimeCount: overtimeByUser[u.uid]?.count || 0,
    leaveDays: leaveByUser[u.uid] || 0,
    departmentId: u.departmentId,
  }));

  const totalOT = rows.reduce((s, r) => s + r.overtimeMinutes, 0);
  const totalOTCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeave = rows.reduce((s, r) => s + r.leaveDays, 0);

  function openDetail(row, tab) {
    setDetailUser(row);
    setDetailTab(tab);
  }

  return (
    <div className="reports-page">
      <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>

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
      ) : rows.length === 0 ? (
        <div className="card"><div className="card-body empty-state">팀원이 없습니다.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>이름</th>
                <th>직급</th>
                <th>잔업</th>
                <th>건수</th>
                <th>연차</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid}>
                  <td>
                    <strong>{r.name}</strong>
                    {r.isLeader && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>팀장</span>}
                    {r.isMe && <span className="badge badge-position" style={{ marginLeft: 6 }}>나</span>}
                  </td>
                  <td>{r.position || '-'}</td>
                  <td
                    style={{ cursor: 'pointer' }}
                    onClick={() => openDetail(r, 'overtime')}
                  >
                    {r.overtimeMinutes > 0 ? <strong style={{ color: 'var(--primary)' }}>{formatMinutes(r.overtimeMinutes)}</strong> : '-'}
                  </td>
                  <td
                    style={{ cursor: 'pointer' }}
                    onClick={() => openDetail(r, 'overtime')}
                  >
                    {r.overtimeCount > 0 ? `${r.overtimeCount}건` : '-'}
                  </td>
                  <td
                    style={{ cursor: 'pointer' }}
                    onClick={() => openDetail(r, 'leave')}
                  >
                    {r.leaveDays > 0 ? <strong style={{ color: 'var(--success)' }}>{r.leaveDays}일</strong> : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><strong>합계 ({rows.length}명)</strong></td>
                <td><strong>{formatMinutes(totalOT)}</strong></td>
                <td><strong>{totalOTCount}건</strong></td>
                <td><strong>{totalLeave}일</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {detailUser && (
        <EmployeeDetailModal
          user={detailUser}
          tab={detailTab}
          year={year}
          month={month}
          overtimes={rawRecords.filter((r) => r.userId === detailUser.uid)}
          leaves={rawLeaves.filter((l) => l.userId === detailUser.uid)}
          siteMap={siteMap}
          canEdit={false}
          onClose={() => setDetailUser(null)}
          onChanged={loadMonthData}
        />
      )}
    </div>
  );
}
