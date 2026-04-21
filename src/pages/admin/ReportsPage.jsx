import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
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
} from '../../services/attendanceService';
import {
  getApprovedLeavesByMonth,
  deleteLeaveById,
  updateLeaveRecord,
} from '../../services/leaveService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';

export default function ReportsPage() {
  const { isAdmin } = useAuth();
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
    } catch (err) {
      alert('승인 실패: ' + err.message);
    } finally {
      setPendingBusy(null);
    }
  }

  async function handleReject(id) {
    if (!confirm('이 잔업 신청을 거절할까요?')) return;
    setPendingBusy(id);
    try {
      await rejectOvertimeRecord(id);
      await loadPending();
    } catch (err) {
      alert('거절 실패: ' + err.message);
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
      <h2>잔업 · 연차</h2>

      {pendingList.length > 0 && (
        <div className="pending-section">
          <div className="pending-section-title">
            승인 대기 <span className="pending-count">{pendingList.length}</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>날짜</th>
                <th>직원</th>
                <th>시간</th>
                <th>사유</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {pendingList.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.date}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.userName}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatMinutes(r.minutes)}</td>
                  <td>{r.reason || '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={pendingBusy === r.id}
                        onClick={() => handleApprove(r.id)}
                      >승인</button>
                      <button
                        className="btn btn-sm btn-outline"
                        style={{ color: '#dc2626', borderColor: '#dc2626' }}
                        disabled={pendingBusy === r.id}
                        onClick={() => handleReject(r.id)}
                      >거절</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
        <p className="text-muted">직원 정보가 없습니다.</p>
      ) : activeTab === 'overtime' ? (
        <table className="table table-clickable">
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
        <table className="table table-clickable">
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
          canEdit={isAdmin}
          onClose={() => setDetailUser(null)}
          onChanged={generateReport}
        />
      )}
    </div>
  );
}

export function EmployeeDetailModal({ user, tab, year, month, overtimes, leaves, siteMap, canEdit, onClose, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);

  function startEdit(row) {
    setEditingId(row.id);
    if (tab === 'overtime') {
      setEditForm({ date: row.date || '', siteId: row.siteId || '', minutes: row.minutes || 0, reason: row.reason || '' });
    } else {
      setEditForm({ startDate: row.startDate || '', endDate: row.endDate || '', days: row.days || 0, type: row.type || 'annual', reason: row.reason || '' });
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
        await updateOvertimeRecord(row.id, { date: editForm.date, siteId: editForm.siteId, minutes, reason: editForm.reason });
      } else {
        await updateLeaveRecord(row.id, { startDate: editForm.startDate, endDate: editForm.endDate, days: Number(editForm.days) || 0, type: editForm.type, reason: editForm.reason });
      }
      setEditingId(null);
      await onChanged();
    } catch (err) {
      alert('수정 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(row) {
    const msg = tab === 'overtime'
      ? '이 잔업 기록을 삭제할까요?'
      : '이 연차 기록을 삭제할까요?\n(사용일수가 자동 복원됩니다)';
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      if (tab === 'overtime') {
        await deleteOvertimeRecord(row.id);
      } else {
        await deleteLeaveById(row.id);
      }
      await onChanged();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  const overtimesSorted = [...overtimes].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const leavesSorted = [...leaves].sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{user.name} · {year}년 {month}월 {tab === 'overtime' ? '잔업' : '연차'}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tab === 'overtime' ? (
            overtimesSorted.length === 0 ? (
              <p className="text-muted text-center">등록된 잔업이 없습니다.</p>
            ) : overtimesSorted.map((r) => {
              const isEditing = editingId === r.id;
              return (
                <div key={r.id} className={`card ${isEditing ? 'card-warning' : ''}`} style={{ marginBottom: 0 }}>
                  <div className="card-body" style={{ padding: '12px 14px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="form-row">
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>날짜</label>
                            <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>시간 (분)</label>
                            <input type="number" min={0} value={editForm.minutes} onChange={(e) => setEditForm({ ...editForm, minutes: e.target.value })} />
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>프로젝트</label>
                          <select value={editForm.siteId} onChange={(e) => setEditForm({ ...editForm, siteId: e.target.value })}>
                            <option value="">-</option>
                            <option value="etc">기타</option>
                            {Object.entries(siteMap).filter(([k]) => k !== 'etc').map(([id, name]) => (
                              <option key={id} value={id}>{name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>사유</label>
                          <input type="text" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} />
                        </div>
                        <div className="btn-group">
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(r)}>저장</button>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setEditingId(null)}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{r.date}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span>{siteMap[r.siteId] || '프로젝트 미지정'}</span>
                            <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{formatMinutes(r.minutes || 0)}</span>
                            {r.reason && <span>{r.reason}</span>}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="btn-group" style={{ flexShrink: 0 }}>
                            <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(r)}>수정</button>
                            <button className="btn btn-sm btn-outline" style={{ color: '#dc2626', borderColor: '#dc2626' }} disabled={busy} onClick={() => removeRow(r)}>삭제</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            leavesSorted.length === 0 ? (
              <p className="text-muted text-center">등록된 연차가 없습니다.</p>
            ) : leavesSorted.map((l) => {
              const isEditing = editingId === l.id;
              const period = l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`;
              return (
                <div key={l.id} className={`card ${isEditing ? 'card-warning' : ''}`} style={{ marginBottom: 0 }}>
                  <div className="card-body" style={{ padding: '12px 14px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="form-row">
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>시작일</label>
                            <input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>종료일</label>
                            <input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
                          </div>
                        </div>
                        <div className="form-row">
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>일수</label>
                            <input type="number" min={0} step={0.5} value={editForm.days} onChange={(e) => setEditForm({ ...editForm, days: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label>종류</label>
                            <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}>
                              <option value="annual">연차</option>
                              <option value="half_am">오전반차</option>
                              <option value="half_pm">오후반차</option>
                              <option value="sick">병가</option>
                              <option value="special">특별휴가</option>
                            </select>
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label>사유</label>
                          <input type="text" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} />
                        </div>
                        <div className="btn-group">
                          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(l)}>저장</button>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setEditingId(null)}>취소</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{period}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <span className="badge badge-leave">{leaveTypeLabel(l.type)}</span>
                            <span style={{ color: 'var(--success)', fontWeight: 700 }}>{l.days}일</span>
                            {l.reason && <span>{l.reason}</span>}
                          </div>
                        </div>
                        {canEdit && (
                          <div className="btn-group" style={{ flexShrink: 0 }}>
                            <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>수정</button>
                            <button className="btn btn-sm btn-outline" style={{ color: '#dc2626', borderColor: '#dc2626' }} disabled={busy} onClick={() => removeRow(l)}>삭제</button>
                          </div>
                        )}
                      </div>
                    )}
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

function leaveTypeLabel(type) {
  return LEAVE_TYPE_LABELS[type] || type || '-';
}
