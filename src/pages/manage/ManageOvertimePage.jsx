import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  getDepartmentOvertimeRecords, getAllOvertimeRecords,
  getPendingOvertimeRecords, approveOvertimeRecord, rejectOvertimeRecord,
} from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes, getDayName } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';

const STATUS_LABELS = { approved: '승인', pending: '대기', rejected: '거절' };

export default function ManageOvertimePage() {
  const { userProfile, isAdmin } = useAuth();
  const [records, setRecords] = useState([]);
  const [pendingList, setPendingList] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile, year, month]);

  async function loadData() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const deptId = isAdmin ? null : userProfile.departmentId;
      const [data, pending] = await Promise.all([
        isAdmin ? getAllOvertimeRecords(start, end) : getDepartmentOvertimeRecords(userProfile.departmentId, start, end),
        getPendingOvertimeRecords(deptId),
      ]);
      setRecords(data);
      setPendingList(pending);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id) {
    try {
      await approveOvertimeRecord(id);
      await loadData();
    } catch (err) {
      alert('승인 실패');
    }
  }

  async function handleReject(id) {
    try {
      await rejectOvertimeRecord(id);
      await loadData();
    } catch (err) {
      alert('거절 실패');
    }
  }

  // 승인된 기록만 직원별 합산
  const approvedRecords = records.filter((r) => r.status === 'approved');
  const byUser = {};
  approvedRecords.forEach((r) => {
    if (!byUser[r.userId]) byUser[r.userId] = { name: r.userName, total: 0, count: 0 };
    byUser[r.userId].total += r.minutes || 0;
    byUser[r.userId].count++;
  });
  const totalMinutes = approvedRecords.reduce((sum, r) => sum + (r.minutes || 0), 0);

  return (
    <div className="manage-overtime-page">
      <h2>부서원 잔업 현황</h2>

      {/* 승인 대기 */}
      {pendingList.length > 0 && (
        <div className="card card-warning">
          <div className="card-header">승인 대기 ({pendingList.length}건)</div>
          <div className="card-body">
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>날짜</th>
                  <th>잔업 시간</th>
                  <th>사유</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {pendingList.map((r) => (
                  <tr key={r.id}>
                    <td>{r.userName}</td>
                    <td>{r.date}</td>
                    <td>{formatMinutes(r.minutes)}</td>
                    <td>{r.reason || '-'}</td>
                    <td>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-primary" onClick={() => handleApprove(r.id)}>승인</button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleReject(r.id)}>거절</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
      </div>

      {/* 직원별 요약 (승인분만) */}
      <div className="card">
        <div className="card-header">직원별 요약 (승인분)</div>
        <div className="card-body">
          {Object.keys(byUser).length === 0 ? (
            <p className="text-muted">해당 월의 승인된 기록이 없습니다.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>총 잔업</th>
                  <th>등록 건수</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byUser).map(([uid, data]) => (
                  <tr key={uid}>
                    <td>{data.name}</td>
                    <td>{formatMinutes(data.total)}</td>
                    <td>{data.count}건</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td><strong>합계</strong></td>
                  <td><strong>{formatMinutes(totalMinutes)}</strong></td>
                  <td><strong>{approvedRecords.length}건</strong></td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* 상세 기록 */}
      {records.length > 0 && (
        <div className="card">
          <div className="card-header">상세 기록</div>
          <div className="card-body">
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>날짜</th>
                  <th>요일</th>
                  <th>잔업 시간</th>
                  <th>사유</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.userName}</td>
                    <td>{r.date}</td>
                    <td>{getDayName(r.date)}</td>
                    <td>{formatMinutes(r.minutes)}</td>
                    <td>{r.reason || '-'}</td>
                    <td><StatusBadge status={r.status} labels={STATUS_LABELS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
