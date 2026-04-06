import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getDepartmentOvertimeSummaries, getOvertimeWarningLevel } from '../../services/overtimeService';
import { getUsersByDepartment } from '../../services/userService';
import { getWeekStart, formatMinutes } from '../../utils/dateUtils';
import { WEEKLY_OVERTIME_LIMIT } from '../../utils/constants';

export default function ManageOvertimePage() {
  const { userProfile } = useAuth();
  const [summaries, setSummaries] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    try {
      const weekStart = getWeekStart(new Date());
      const [overtimeData, members] = await Promise.all([
        getDepartmentOvertimeSummaries(userProfile.departmentId, weekStart),
        getUsersByDepartment(userProfile.departmentId),
      ]);
      setSummaries(overtimeData);
      setUsers(members);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  const summaryMap = {};
  summaries.forEach((s) => { summaryMap[s.userId] = s; });

  return (
    <div className="manage-overtime-page">
      <h2>부서원 초과근무 현황</h2>
      <p className="text-sm">이번 주 ({getWeekStart(new Date())} ~)</p>

      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>초과근무</th>
            <th>한도 대비</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const s = summaryMap[u.uid];
            const minutes = s?.totalOvertimeMinutes || 0;
            const pct = Math.round((minutes / WEEKLY_OVERTIME_LIMIT) * 100);
            const level = getOvertimeWarningLevel(minutes);
            return (
              <tr key={u.uid}>
                <td>{u.name}</td>
                <td>{formatMinutes(minutes)}</td>
                <td>
                  <div className="overtime-bar-sm">
                    <div className={`overtime-fill overtime-${level}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                  <span className="text-sm">{pct}%</span>
                </td>
                <td>
                  <span className={`badge badge-${level}`}>
                    {level === 'danger' ? '초과' : level === 'warning' ? '경고' : level === 'caution' ? '주의' : '정상'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
