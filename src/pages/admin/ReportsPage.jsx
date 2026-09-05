import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getAllSites } from '../../services/siteService';
import {
  getAllOvertimeRecords,
  deleteOvertimeRecord,
  updateOvertimeRecord,
  getPendingOvertimeRecords,
  approveOvertimeRecord,
  rejectOvertimeRecord,
  OVERTIME_MULTIPLIER,
} from '../../services/attendanceService';
import { getApprovedLeavesByMonth, deleteLeaveById, updateLeaveRecord } from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import { useDialog } from '../../components/common/useDialog';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import EditModeButton from '../../components/common/EditModeButton';
import LeaveManagementPage from './LeaveManagementPage';

export default function ReportsPage() {
  const { confirm, toast } = useDialog();
  const { isAdmin } = useAuth();
  const [viewMode, setViewMode] = useState('summary'); // 'summary'(직원별 집계) | 'requests'(신청 내역)
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
  const [pendingList, setPendingList] = useState([]);
  const [pendingBusy, setPendingBusy] = useState(null);

  useEffect(() => {
    loadBase();
    loadPending();
  }, []);

  useEffect(() => {
    if (users.length > 0) generateReport();
  }, [users, year, month]);

  async function loadBase() {
    const [u, d, s] = await Promise.all([getUsers(), getDepartments(), getAllSites()]);
    setUsers(u);
    setDepartments(d);
    setSites(s);
  }

  async function loadPending() {
    const list = await getPendingOvertimeRecords();
    setPendingList(list);
  }

  async function handleApprove(id) {
    setPendingBusy(id);
    try {
      await approveOvertimeRecord(id);
      await Promise.all([loadPending(), generateReport()]);
    } catch {
      toast('승인 중 오류가 발생했습니다', 'error');
    } finally {
      setPendingBusy(null);
    }
  }

  async function handleReject(id) {
    if (!(await confirm('이 잔업 신청을 거절할까요?'))) return;
    setPendingBusy(id);
    try {
      await rejectOvertimeRecord(id);
      await loadPending();
    } catch {
      toast('거절 중 오류가 발생했습니다', 'error');
    } finally {
      setPendingBusy(null);
    }
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

      // 퇴사자라도 그 달에 잔업·연차가 있었으면 집계에 남긴다.
      // 빼버리면 퇴사한 달의 정산이 어긋난다.
      const hadRecord = new Set([
        ...records.filter((r) => r.status === 'approved').map((r) => r.userId),
        ...Object.keys(leaveByUser),
      ]);
      const byUser = {};
      users
        .filter((u) => (u.isActive !== false || hadRecord.has(u.uid)) && u.role !== 'admin' && isRealStaff(u))
        .forEach((u) => {
          byUser[u.uid] = {
            name: u.name,
            resigned: u.isActive === false,
            departmentId: u.departmentId,
            overtimeMinutes: 0,
            overtimeCount: 0,
            leaveDays: leaveByUser[u.uid] || 0,
          };
        });
      records.forEach((r) => {
        if (r.status !== 'approved') return;
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
  departments.forEach((d) => {
    deptMap[d.id] = d.name;
  });
  const siteMap = { etc: '기타' };
  sites.forEach((s) => {
    siteMap[s.id] = s.name;
  });

  const rows = report;
  const totalOvertimeMinutes = rows.reduce((s, r) => s + r.overtimeMinutes, 0);

  // 잔업 Top 5 (시간·금액) + 전체 합계 금액
  const userById = Object.fromEntries(users.map((u) => [u.uid, u]));
  const calcAmount = (uid, mins) => {
    const hourlyRate = Number(userById[uid]?.hourlyRate) || 0;
    const hours = (mins || 0) / 60;
    return Math.round(hourlyRate * OVERTIME_MULTIPLIER * hours);
  };
  const topOvertime = [...rows]
    .filter((r) => r.overtimeMinutes > 0)
    .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes)
    .slice(0, 5)
    .map((r) => ({
      uid: r.uid,
      name: r.name,
      minutes: r.overtimeMinutes,
      count: r.overtimeCount,
      amount: calcAmount(r.uid, r.overtimeMinutes),
    }));
  const totalOvertimeAmount = rows.reduce((s, r) => s + calcAmount(r.uid, r.overtimeMinutes), 0);
  const totalOvertimeCount = rows.reduce((s, r) => s + r.overtimeCount, 0);
  const totalLeaveDays = rows.reduce((s, r) => s + r.leaveDays, 0);

  return (
    <div className="reports-page">
      {/* 보기 전환 탭 — 상위 도메인 탭은 항상 page-header 위 (2026-09-05 대표님 UI 기준안) */}
      <div className="tab-nav" role="tablist" aria-label="보기 전환" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tab-nav-item ${viewMode === 'summary' ? 'active' : ''}`}
          onClick={() => setViewMode('summary')}
        >
          직원별 집계
        </button>
        <button
          type="button"
          className={`tab-nav-item ${viewMode === 'requests' ? 'active' : ''}`}
          onClick={() => setViewMode('requests')}
        >
          신청 내역
        </button>
      </div>

      <div className="page-header">
        <h2>잔업 · 연차</h2>
        <div className="page-actions"></div>
      </div>

      {viewMode === 'requests' ? (
        <LeaveManagementPage embedded />
      ) : (
        <>
          <div className="ua-summary-card" style={{ marginBottom: 16 }}>
            <div className="ua-summary-title">
              <span className="ua-dot ua-dot-overtime" />
              잔업 Top · {year}년 {month}월
            </div>
            {topOvertime.length === 0 ? (
              <p className="ua-summary-empty">해당 월 잔업 기록 없음</p>
            ) : (
              <>
                <ul className="ua-summary-list">
                  {topOvertime.map((r, idx) => {
                    const maxMin = topOvertime[0]?.minutes || 1;
                    const pct = Math.max(6, Math.round((r.minutes / maxMin) * 100));
                    return (
                      <li key={r.uid}>
                        <span className={`ua-rank ${idx < 3 ? `ua-rank-${idx + 1}` : ''}`}>{idx + 1}</span>
                        <span className="ua-summary-name">{r.name}</span>
                        <span className="ua-bar" aria-hidden="true">
                          <span className="ua-bar-fill" style={{ width: `${pct}%` }} />
                        </span>
                        <strong className="ua-summary-metrics">
                          <em>{r.count}건</em>
                          <em>{formatMinutes(r.minutes)}</em>
                          <em className="ua-metric-amount">{r.amount.toLocaleString()}원</em>
                        </strong>
                      </li>
                    );
                  })}
                </ul>
                <div className="ua-summary-total">
                  <span>전체 합계</span>
                  <strong className="ua-summary-metrics">
                    <em>{totalOvertimeCount}건</em>
                    <em>{formatMinutes(totalOvertimeMinutes)}</em>
                    <em>{totalOvertimeAmount.toLocaleString()}원</em>
                  </strong>
                </div>
              </>
            )}
          </div>

          {pendingList.length > 0 && (
            <div className="pending-section">
              <div className="pending-section-title">
                승인 대기 <span className="pending-count">{pendingList.length}</span>
              </div>
              <div className="table-scroll-x">
                <table className="table cards-sm">
                  <thead>
                    <tr>
                      <th scope="col">날짜</th>
                      <th scope="col">직원</th>
                      <th scope="col">프로젝트</th>
                      <th scope="col">시간</th>
                      <th scope="col">사유</th>
                      <th scope="col" className="col-action"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingList.map((r) => (
                      <tr key={r.id}>
                        <td data-label="날짜" style={{ whiteSpace: 'nowrap' }}>
                          {r.date}
                        </td>
                        <td data-label="직원" style={{ whiteSpace: 'nowrap' }}>
                          {r.userName}
                        </td>
                        <td data-label="프로젝트" style={{ whiteSpace: 'nowrap' }}>
                          {siteMap[r.siteId] || '미지정'}
                        </td>
                        <td data-label="시간" style={{ whiteSpace: 'nowrap' }}>
                          {formatMinutes(r.minutes)}
                        </td>
                        <td data-label="사유" title={r.reason || ''} style={{ wordBreak: 'break-word' }}>
                          {r.reason || '-'}
                        </td>
                        <td className="col-action">
                          <div className="btn-group">
                            <button
                              className="btn btn-sm btn-primary"
                              disabled={pendingBusy === r.id}
                              onClick={() => handleApprove(r.id)}
                            >
                              승인
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              disabled={pendingBusy === r.id}
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
          )}

          <div className="filters">
            <Select
              value={year}
              onChange={(v) => setYear(Number(v))}
              options={[2024, 2025, 2026, 2027, 2028].map((y) => ({ value: y, label: `${y}년` }))}
              ariaLabel="연도 선택"
            />
            <Select
              value={month}
              onChange={(v) => setMonth(Number(v))}
              options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}월` }))}
              ariaLabel="월 선택"
            />
          </div>

          {loading ? (
            <Skeleton.Rows count={6} />
          ) : rows.length === 0 ? (
            <p className="text-muted">직원 정보가 없습니다.</p>
          ) : (
            <table className="table team-stats-table cards-sm">
              <thead>
                <tr>
                  {/* (2026-09-05 No 열 표준) */}
                  <th scope="col" className="col-no">
                    No
                  </th>
                  <th scope="col">이름</th>
                  <th scope="col">부서</th>
                  <th scope="col">잔업</th>
                  <th scope="col">연차</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.uid}>
                    <td className="col-no" data-label="No">
                      {i + 1}
                    </td>
                    <td data-label="이름">
                      <strong>{r.name}</strong>
                      {r.resigned && (
                        <span className="purchase-badge purchase-badge-closed" style={{ marginLeft: 6 }}>
                          퇴사
                        </span>
                      )}
                    </td>
                    <td data-label="부서">{deptMap[r.departmentId] || '-'}</td>
                    <td data-label="잔업">
                      <button
                        className="team-detail-btn"
                        onClick={() => {
                          setActiveTab('overtime');
                          setDetailUser(r);
                        }}
                      >
                        {r.overtimeMinutes > 0 ? (
                          <>
                            <strong>{formatMinutes(r.overtimeMinutes)}</strong>{' '}
                            <span className="team-detail-arrow">&rsaquo;</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </button>
                    </td>
                    <td data-label="연차">
                      <button
                        className="team-detail-btn"
                        onClick={() => {
                          setActiveTab('leave');
                          setDetailUser(r);
                        }}
                      >
                        {r.leaveDays > 0 ? (
                          <>
                            <strong>{r.leaveDays}일</strong> <span className="team-detail-arrow">&rsaquo;</span>
                          </>
                        ) : (
                          '-'
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>
                    <strong>합계 ({rows.length}명)</strong>
                  </td>
                  <td>
                    <strong>{formatMinutes(totalOvertimeMinutes)}</strong>
                  </td>
                  <td>
                    <strong>{totalLeaveDays}일</strong>
                  </td>
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
              overtimes={rawRecords.filter((r) => r.userId === detailUser.uid && r.status === 'approved')}
              leaves={rawLeaves.filter((l) => l.userId === detailUser.uid)}
              siteMap={siteMap}
              canEdit={isAdmin}
              onClose={() => setDetailUser(null)}
              onChanged={generateReport}
            />
          )}
        </>
      )}
    </div>
  );
}

export function EmployeeDetailModal({
  user,
  tab,
  year,
  month,
  overtimes,
  leaves,
  siteMap,
  canEdit,
  onClose,
  onChanged,
}) {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);
  // 잠금 — 풀었을 때만 체크박스 + 「선택 삭제」 (2026-09-04 대표님 「잠금」 통일)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set());

  function startEdit(row) {
    setEditingId(row.id);
    if (tab === 'overtime') {
      setEditForm({
        date: row.date || '',
        siteId: row.siteId || '',
        minutes: row.minutes || 0,
        reason: row.reason || '',
      });
    } else {
      setEditForm({
        startDate: row.startDate || '',
        endDate: row.endDate || '',
        days: row.days || 0,
        type: row.type || 'annual',
        reason: row.reason || '',
      });
    }
  }

  async function saveEdit(row) {
    setBusy(true);
    try {
      if (tab === 'overtime') {
        const minutes = Number(editForm.minutes);
        if (!Number.isFinite(minutes) || minutes < 0) {
          alert('유효한 분(minutes)을 입력하세요.');
          setBusy(false);
          return;
        }
        await updateOvertimeRecord(row.id, {
          date: editForm.date,
          siteId: editForm.siteId,
          minutes,
          reason: editForm.reason,
        });
      } else {
        await updateLeaveRecord(row.id, {
          startDate: editForm.startDate,
          endDate: editForm.endDate,
          days: Number(editForm.days) || 0,
          type: editForm.type,
          reason: editForm.reason,
        });
      }
      setEditingId(null);
      await onChanged();
    } catch {
      toast('수정 중 오류가 발생했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set());
      return !v;
    });
  }

  function togglePick(id) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const overtimesSorted = [...overtimes].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const leavesSorted = [...leaves].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  // 고른 기록을 한꺼번에 — 행별 「삭제」와 같은 길(휴지통)로 하나씩 보낸다
  async function deletePicked() {
    const list = tab === 'overtime' ? overtimesSorted : leavesSorted;
    const targets = list.filter((r) => pick.has(r.id));
    if (targets.length === 0) return;
    if (!(await confirm(`고른 ${targets.length}건을 휴지통으로 보내시겠습니까?`))) return;
    setBusy(true);
    try {
      for (const row of targets) {
        if (tab === 'overtime') {
          await deleteOvertimeRecord(row.id, userProfile?.name || '');
        } else {
          await deleteLeaveById(row.id, userProfile?.name || '');
        }
      }
      setPick(new Set());
      await onChanged();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {user.name} · {year}년 {month}월 {tab === 'overtime' ? '잔업' : '연차'}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {canEdit && <EditModeButton on={editMode} onToggle={toggleEditMode} />}
            <button className="modal-close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {editMode && pick.size > 0 && (
            <div className="sel-bar">
              <span className="sel-count">
                <strong>{pick.size}</strong>건 골랐습니다
              </span>
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={deletePicked}>
                <Icon name="trash" className="btn-ic" />
                선택 삭제
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
                선택 해제
              </button>
            </div>
          )}
          {tab === 'overtime' ? (
            overtimesSorted.length === 0 ? (
              <p className="text-muted text-center">등록된 잔업이 없습니다.</p>
            ) : (
              overtimesSorted.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <div
                    key={r.id}
                    className={`card ${isEditing ? 'card-warning' : ''}${pick.has(r.id) ? ' is-checked' : ''}`}
                    style={{ marginBottom: 0 }}
                  >
                    <div className="card-body" style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
                      {editMode && !isEditing && (
                        <input
                          type="checkbox"
                          className="sel-check"
                          checked={pick.has(r.id)}
                          onChange={() => togglePick(r.id)}
                          aria-label="삭제할 잔업 기록 고르기"
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div className="form-row">
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>날짜</label>
                                <input
                                  aria-label="날짜"
                                  type="date"
                                  value={editForm.date}
                                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                                />
                              </div>
                              <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>시간 (분)</label>
                                <input
                                  aria-label="시간 (분)"
                                  type="number"
                                  min={0}
                                  value={editForm.minutes}
                                  onChange={(e) => setEditForm({ ...editForm, minutes: e.target.value })}
                                />
                              </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>프로젝트</label>
                              <Select
                                value={editForm.siteId}
                                onChange={(v) => setEditForm({ ...editForm, siteId: v })}
                                options={[
                                  { value: 'etc', label: '기타' },
                                  ...Object.entries(siteMap)
                                    .filter(([k]) => k !== 'etc')
                                    .map(([id, name]) => ({ value: id, label: name })),
                                ]}
                                placeholder="-"
                                ariaLabel="프로젝트 선택"
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>사유</label>
                              <input
                                aria-label="사유"
                                type="text"
                                value={editForm.reason}
                                onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                              />
                            </div>
                            <div className="btn-group">
                              <button
                                className="btn btn-sm btn-outline"
                                disabled={busy}
                                onClick={() => setEditingId(null)}
                              >
                                취소
                              </button>
                              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(r)}>
                                저장
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{r.date}</div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: 'var(--text-light)',
                                  display: 'flex',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span>{siteMap[r.siteId] || '프로젝트 미지정'}</span>
                                <span style={{ color: 'var(--primary)', fontWeight: 700 }}>
                                  {formatMinutes(r.minutes || 0)}
                                </span>
                                {r.reason && <span>{r.reason}</span>}
                              </div>
                            </div>
                            {canEdit && (
                              <div className="btn-group" style={{ flexShrink: 0 }}>
                                <button
                                  className="btn btn-sm btn-outline"
                                  disabled={busy || !editMode}
                                  title={editMode ? '' : '수정하려면 「잠금」을 푸세요'}
                                  onClick={() => startEdit(r)}
                                >
                                  수정
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )
          ) : leavesSorted.length === 0 ? (
            <p className="text-muted text-center">등록된 연차가 없습니다.</p>
          ) : (
            leavesSorted.map((l) => {
              const isEditing = editingId === l.id;
              const period = l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`;
              return (
                <div
                  key={l.id}
                  className={`card ${isEditing ? 'card-warning' : ''}${pick.has(l.id) ? ' is-checked' : ''}`}
                  style={{ marginBottom: 0 }}
                >
                  <div className="card-body" style={{ padding: '12px 14px', display: 'flex', gap: 10 }}>
                    {editMode && !isEditing && (
                      <input
                        type="checkbox"
                        className="sel-check"
                        checked={pick.has(l.id)}
                        onChange={() => togglePick(l.id)}
                        aria-label="삭제할 연차 기록 고르기"
                        style={{ marginTop: 3, flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div className="form-row">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>시작일</label>
                              <input
                                aria-label="시작일"
                                type="date"
                                value={editForm.startDate}
                                onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>종료일</label>
                              <input
                                aria-label="종료일"
                                type="date"
                                value={editForm.endDate}
                                onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                              />
                            </div>
                          </div>
                          <div className="form-row">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>일수</label>
                              <input
                                aria-label="일수"
                                type="number"
                                min={0}
                                step={0.5}
                                value={editForm.days}
                                onChange={(e) => setEditForm({ ...editForm, days: e.target.value })}
                              />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label>종류</label>
                              <Select
                                value={editForm.type}
                                onChange={(v) => setEditForm({ ...editForm, type: v })}
                                options={[
                                  { value: 'annual', label: '연차' },
                                  { value: 'half_am', label: '오전반차' },
                                  { value: 'half_pm', label: '오후반차' },
                                  { value: 'sick', label: '병가' },
                                  { value: 'special', label: '특별휴가' },
                                ]}
                                ariaLabel="휴가 종류 선택"
                              />
                            </div>
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>사유</label>
                            <input
                              aria-label="사유"
                              type="text"
                              value={editForm.reason}
                              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                            />
                          </div>
                          <div className="btn-group">
                            <button
                              className="btn btn-sm btn-outline"
                              disabled={busy}
                              onClick={() => setEditingId(null)}
                            >
                              취소
                            </button>
                            <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(l)}>
                              저장
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{period}</div>
                            <div
                              style={{
                                fontSize: 12,
                                color: 'var(--text-light)',
                                display: 'flex',
                                gap: 8,
                                flexWrap: 'wrap',
                              }}
                            >
                              <span className="badge badge-leave">{leaveTypeLabel(l.type)}</span>
                              <span style={{ color: 'var(--success)', fontWeight: 700 }}>{l.days}일</span>
                              {l.reason && <span>{l.reason}</span>}
                            </div>
                          </div>
                          {canEdit && (
                            <div className="btn-group" style={{ flexShrink: 0 }}>
                              <button
                                className="btn btn-sm btn-outline"
                                disabled={busy || !editMode}
                                title={editMode ? '' : '수정하려면 「잠금」을 푸세요'}
                                onClick={() => startEdit(l)}
                              >
                                수정
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

import { LEAVE_TYPE_LABELS } from '../../utils/constants';
import { isRealStaff } from '../../utils/workspace';

function leaveTypeLabel(type) {
  return LEAVE_TYPE_LABELS[type] || type || '-';
}
