import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import {
  getDepartmentOvertimeRecords,
  getAllOvertimeRecords,
  getPendingOvertimeRecords,
  approveOvertimeRecord,
  rejectOvertimeRecord,
} from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes, getDayName, formatDisplayDate } from '../../utils/dateUtils';
import StatusBadge from '../../components/common/StatusBadge';
import { useDialog } from '../../components/common/useDialog';
import Select from '../../components/common/Select';

const STATUS_LABELS = { approved: '승인', pending: '대기', rejected: '거절' };

export default function ManageOvertimePage() {
  const { userProfile, isAdmin } = useAuth();
  const { toast } = useDialog();
  const [records, setRecords] = useState([]);
  const [pendingList, setPendingList] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [, setLoading] = useState(true);

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
        isAdmin
          ? getAllOvertimeRecords(start, end)
          : getDepartmentOvertimeRecords(userProfile.departmentId, start, end),
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
    } catch {
      toast('승인 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleReject(id) {
    try {
      await rejectOvertimeRecord(id);
      await loadData();
    } catch {
      toast('거절 중 오류가 발생했습니다', 'error');
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
            <div className="table-scroll-x">
              <table className="table cards-sm">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>날짜</th>
                    <th className="num-col">잔업 시간</th>
                    <th className="hide-mobile">사유</th>
                    <th className="col-action">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingList.map((r) => (
                    <tr key={r.id}>
                      <td data-label="이름" title={r.userName || ''}>
                        {r.userName}
                      </td>
                      <td data-label="날짜">{formatDisplayDate(r.date)}</td>
                      <td data-label="잔업 시간" className="num-col">
                        {formatMinutes(r.minutes)}
                      </td>
                      <td data-label="사유" title={r.reason || ''} className="hide-mobile">
                        <span className="cell-clamp-2" style={{ maxWidth: 200 }}>
                          {r.reason || '-'}
                        </span>
                      </td>
                      <td className="col-action">
                        <div className="btn-group" style={{ alignItems: 'stretch' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            style={{ minWidth: 44, minHeight: 36 }}
                            onClick={() => handleApprove(r.id)}
                          >
                            승인
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            style={{ minWidth: 44, minHeight: 36 }}
                            onClick={() => handleReject(r.id)}
                          >
                            거절
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYear(Number(v))}
          options={[2024, 2025, 2026, 2027].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="연도 선택"
        />
        <Select
          value={month}
          onChange={(v) => setMonth(Number(v))}
          options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
      </div>

      {/* 직원별 요약 (승인분만) */}
      <div className="card">
        <div className="card-header">직원별 요약 (승인분)</div>
        <div className="card-body">
          {Object.keys(byUser).length === 0 ? (
            <p className="text-muted">해당 월의 승인된 기록이 없습니다.</p>
          ) : (
            <div className="table-scroll-x">
              <table className="table cards-sm">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th className="num-col">총 잔업</th>
                    <th className="num-col">등록 건수</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byUser).map(([uid, data]) => (
                    <tr key={uid}>
                      <td data-label="이름" title={data.name || ''}>
                        {data.name}
                      </td>
                      <td data-label="총 잔업" className="num-col">
                        {formatMinutes(data.total)}
                      </td>
                      <td data-label="등록 건수" className="num-col">
                        {data.count}건
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ verticalAlign: 'middle' }}>
                    <td data-label="이름">
                      <strong>합계</strong>
                    </td>
                    <td data-label="총 잔업" className="num-col">
                      <strong>{formatMinutes(totalMinutes)}</strong>
                    </td>
                    <td data-label="등록 건수" className="num-col">
                      <strong>{approvedRecords.length}건</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 상세 기록 */}
      {records.length > 0 && (
        <div className="card">
          <div className="card-header">상세 기록</div>
          <div className="card-body">
            <div className="table-scroll-x">
              <table className="table cards-sm">
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>날짜</th>
                    <th className="hide-mobile">요일</th>
                    <th>잔업 시간</th>
                    <th className="hide-mobile">사유</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td data-label="이름" title={r.userName || ''}>
                        {r.userName}
                      </td>
                      <td data-label="날짜">{formatDisplayDate(r.date)}</td>
                      <td data-label="요일" className="hide-mobile">
                        {getDayName(r.date)}
                      </td>
                      <td data-label="잔업 시간">{formatMinutes(r.minutes)}</td>
                      <td data-label="사유" title={r.reason || ''} className="hide-mobile">
                        <span className="cell-clamp-2" style={{ maxWidth: 200 }}>
                          {r.reason || '-'}
                        </span>
                      </td>
                      <td data-label="상태">
                        <StatusBadge status={r.status} labels={STATUS_LABELS} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
