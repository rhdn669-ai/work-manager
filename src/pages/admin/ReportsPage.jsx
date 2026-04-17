import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getAllSites } from '../../services/siteService';
import {
  getAllOvertimeRecords,
  deleteOvertimeRecord,
  updateOvertimeRecord,
} from '../../services/attendanceService';
import {
  getApprovedLeavesByMonth,
  deleteLeaveById,
  updateLeaveReason,
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

  useEffect(() => {
    loadBase();
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
      setEditForm({ minutes: row.minutes || 0, reason: row.reason || '' });
    } else {
      setEditForm({ reason: row.reason || '' });
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
        await updateOvertimeRecord(row.id, { minutes, reason: editForm.reason });
      } else {
        await updateLeaveReason(row.id, editForm.reason);
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
    const label = tab === 'overtime' ? '이 잔업 기록' : '이 연차 기록';
    if (!confirm(`${label}을(를) 삭제할까요?\n(연차 삭제 시 사용일수가 자동 복원됩니다)`)) return;
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
      <div className="modal" style={{ maxWidth: 900, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>
            {user.name} · {year}년 {month}월 {tab === 'overtime' ? '잔업' : '연차'} 내역
          </h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {tab === 'overtime' ? (
            overtimesSorted.length === 0 ? (
              <p className="text-muted">등록된 잔업이 없습니다.</p>
            ) : (
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 96, whiteSpace: 'nowrap' }}>날짜</th>
                    <th style={{ whiteSpace: 'nowrap' }}>프로젝트</th>
                    <th style={{ width: 100, whiteSpace: 'nowrap' }}>시간</th>
                    <th style={{ whiteSpace: 'nowrap' }}>비고</th>
                    <th style={{ width: 100, whiteSpace: 'nowrap' }}>상태</th>
                    {canEdit && <th style={{ width: 130, whiteSpace: 'nowrap' }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {overtimesSorted.map((r) => {
                    const isEditing = editingId === r.id;
                    return (
                      <tr key={r.id}>
                        <td>{r.date}</td>
                        <td>{siteMap[r.siteId] || '-'}</td>
                        <td>
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              value={editForm.minutes}
                              onChange={(e) => setEditForm({ ...editForm, minutes: e.target.value })}
                              style={{ width: 80 }}
                            />
                          ) : formatMinutes(r.minutes || 0)}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editForm.reason}
                              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                              style={{ width: '100%' }}
                            />
                          ) : (r.reason || '-')}
                        </td>
                        <td>
                          <span className={`badge badge-${r.status}`}>{statusLabel(r.status)}</span>
                        </td>
                        {canEdit && (
                          <td>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(r)}>저장</button>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setEditingId(null)}>취소</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(r)}>수정</button>
                                <button
                                  className="btn btn-sm btn-outline"
                                  style={{ color: '#dc2626', borderColor: '#dc2626' }}
                                  disabled={busy}
                                  onClick={() => removeRow(r)}
                                >
                                  삭제
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          ) : (
            leavesSorted.length === 0 ? (
              <p className="text-muted">등록된 연차가 없습니다.</p>
            ) : (
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 190, whiteSpace: 'nowrap' }}>기간</th>
                    <th style={{ width: 64, whiteSpace: 'nowrap' }}>일수</th>
                    <th style={{ width: 90, whiteSpace: 'nowrap' }}>종류</th>
                    <th style={{ whiteSpace: 'nowrap' }}>사유</th>
                    {canEdit && <th style={{ width: 130, whiteSpace: 'nowrap' }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {leavesSorted.map((l) => {
                    const isEditing = editingId === l.id;
                    const period = l.startDate === l.endDate
                      ? l.startDate
                      : `${l.startDate} ~ ${l.endDate}`;
                    return (
                      <tr key={l.id}>
                        <td>{period}</td>
                        <td>{l.days}일</td>
                        <td>{leaveTypeLabel(l.type)}</td>
                        <td>
                          {isEditing ? (
                            <input
                              type="text"
                              value={editForm.reason}
                              onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                              style={{ width: '100%' }}
                            />
                          ) : (l.reason || '-')}
                        </td>
                        {canEdit && (
                          <td>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(l)}>저장</button>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setEditingId(null)}>취소</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>수정</button>
                                <button
                                  className="btn btn-sm btn-outline"
                                  style={{ color: '#dc2626', borderColor: '#dc2626' }}
                                  disabled={busy}
                                  onClick={() => removeRow(l)}
                                >
                                  삭제
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function statusLabel(status) {
  switch (status) {
    case 'approved': return '승인';
    case 'pending': return '대기';
    case 'rejected': return '거절';
    default: return status || '-';
  }
}

import { LEAVE_TYPE_LABELS } from '../../utils/constants';

function leaveTypeLabel(type) {
  return LEAVE_TYPE_LABELS[type] || type || '-';
}
