import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getDepartmentTodayAttendance, getDepartmentAttendanceByRange } from '../../services/attendanceService';
import { getUsersByDepartment } from '../../services/userService';
import { formatTime, formatMinutes, getToday, getMonthStart, getMonthEnd } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';

const STATUS_LABELS = { working: '근무중', completed: '완료', absent: '결근', leave: '휴가' };

export default function ManageAttendancePage() {
  const { userProfile, isAdmin } = useAuth();
  const [todayRecords, setTodayRecords] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    try {
      const deptId = userProfile.departmentId;
      const [records, members] = await Promise.all([
        getDepartmentTodayAttendance(deptId),
        getUsersByDepartment(deptId),
      ]);
      setTodayRecords(records);
      setUsers(members);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  // 사용자별 출퇴근 매핑
  const recordMap = {};
  todayRecords.forEach((r) => { recordMap[r.userId] = r; });

  return (
    <div className="manage-attendance-page">
      <h2>부서원 출퇴근 현황</h2>
      <p className="page-date">오늘: {getToday()}</p>

      <div className="summary-bar">
        <span>총 인원: <strong>{users.length}명</strong></span>
        <span>출근: <strong>{todayRecords.length}명</strong></span>
        <span>미출근: <strong>{users.length - todayRecords.length}명</strong></span>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>출근</th>
            <th>퇴근</th>
            <th>근무시간</th>
            <th>초과근무</th>
            <th>상태</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const r = recordMap[u.uid];
            return (
              <tr key={u.uid}>
                <td>{u.name}</td>
                <td>{r ? formatTime(r.checkIn) : '-'}</td>
                <td>{r?.checkOut ? formatTime(r.checkOut) : '-'}</td>
                <td>{r ? formatMinutes(r.workMinutes) : '-'}</td>
                <td>{r ? formatMinutes(r.overtimeMinutes) : '-'}</td>
                <td>
                  {r ? (
                    <StatusBadge status={r.status} labels={STATUS_LABELS} />
                  ) : (
                    <span className="badge badge-absent">미출근</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
