import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers, getUsersByDepartment } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getLeaveBalance } from '../../services/leaveService';

export default function ManageTeamPage() {
  const { userProfile, canApproveAll } = useAuth();
  const [members, setMembers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    setLoading(true);
    try {
      const [users, depts] = await Promise.all([
        canApproveAll
          ? getUsers()
          : getUsersByDepartment(userProfile.departmentId),
        getDepartments(),
      ]);

      // 본인 제외
      const team = users.filter((u) => u.uid !== userProfile.uid);
      setMembers(team);
      setDepartments(depts);

      // 각 팀원 연차 잔여 조회
      const bals = {};
      for (const u of team) {
        const bal = await getLeaveBalance(u.uid);
        if (bal) bals[u.uid] = bal;
      }
      setBalances(bals);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const deptMap = Object.fromEntries(departments.map((d) => [d.id, d.name]));

  return (
    <div className="manage-team-page">
      <div className="page-header">
        <h2>팀 관리</h2>
      </div>

      <p className="field-hint">
        {canApproveAll
          ? '전체 직원을 표시합니다. 이 인원들의 연차를 승인할 수 있습니다.'
          : '본인 부서 팀원을 표시합니다. 이 인원들의 연차를 승인할 수 있습니다.'}
      </p>

      {members.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">팀원이 없습니다.</div>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>코드</th>
              <th>직급</th>
              {canApproveAll && <th>부서</th>}
              <th>연차 잔여</th>
              <th>사용</th>
            </tr>
          </thead>
          <tbody>
            {members.map((u) => {
              const bal = balances[u.uid];
              return (
                <tr key={u.uid}>
                  <td>
                    <strong>{u.name}</strong>
                    {u.isTeamLeader && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>팀장</span>}
                  </td>
                  <td><code>{u.code}</code></td>
                  <td>{u.position || '-'}</td>
                  {canApproveAll && <td>{deptMap[u.departmentId] || '-'}</td>}
                  <td>
                    {bal ? (
                      <strong style={{ color: 'var(--primary)' }}>{bal.remainingDays}일</strong>
                    ) : '-'}
                  </td>
                  <td>
                    {bal ? `${bal.usedDays}일 / ${bal.totalDays}일` : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
