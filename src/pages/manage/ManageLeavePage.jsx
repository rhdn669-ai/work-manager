import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyLeaves } from '../../services/leaveService';
import { getDepartmentsByLeader } from '../../services/departmentService';
import { getUsers } from '../../services/userService';
import { LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS } from '../../utils/constants';
import StatusBadge from '../../components/common/StatusBadge';

export default function ManageLeavePage() {
  const { userProfile, canApproveAll } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userMap, setUserMap] = useState({});
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year]);

  async function loadData() {
    setLoading(true);
    try {
      const [users, depts] = await Promise.all([getUsers(), getDepartmentsByLeader(userProfile.uid)]);
      const uMap = Object.fromEntries(users.map((u) => [u.uid, u.name]));
      setUserMap(uMap);

      let targetUserIds = [];
      if (canApproveAll) {
        targetUserIds = users.map((u) => u.uid);
      } else {
        // 팀장: 내 팀원만
        const myDeptIds = depts.map((d) => d.id);
        targetUserIds = users.filter((u) => myDeptIds.includes(u.departmentId)).map((u) => u.uid);
      }

      let allLeaves = [];
      for (const uid of targetUserIds) {
        const ul = await getMyLeaves(uid, year);
        allLeaves = [...allLeaves, ...ul];
      }
      allLeaves.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
      setLeaves(allLeaves);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="manage-leave-page">
      <h2>연차 신청 현황</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      {leaves.length === 0 ? (
        <p className="text-muted">해당 연도의 연차 신청 내역이 없습니다.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>이름</th>
              <th>종류</th>
              <th>기간</th>
              <th>일수</th>
              <th>사유</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {leaves.map((l) => (
              <tr key={l.id}>
                <td>{userMap[l.userId] || l.userId}</td>
                <td>{LEAVE_TYPE_LABELS[l.type]}</td>
                <td>{l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`}</td>
                <td>{l.days}일</td>
                <td>{l.reason || '-'}</td>
                <td><StatusBadge status={l.status} labels={LEAVE_STATUS_LABELS} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
