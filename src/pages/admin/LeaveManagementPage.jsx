import { useState, useEffect, useMemo } from 'react';
import { getAllLeavesByYear, editLeaveWithBalance, cancelLeave } from '../../services/leaveService';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getEvents } from '../../services/eventService';
import { LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import { getBusinessDaysExcludingHolidays, buildHolidaySet } from '../../utils/dateUtils';

const STATUS_STYLES = {
  confirmed: { color: 'var(--success)', label: '승인됨' },
  pending:   { color: 'var(--text-muted)', label: '대기중' },
  cancelled: { color: 'var(--text-muted)', label: '취소됨' },
  rejected:  { color: 'var(--danger)', label: '반려됨' },
};

const STATUS_OPTIONS = [
  { value: 'all',       label: '전체 상태' },
  { value: 'confirmed', label: '승인됨' },
  { value: 'pending',   label: '대기중' },
  { value: 'rejected',  label: '반려됨' },
  { value: 'cancelled', label: '취소됨' },
];

function isSingleDayType(type) {
  return type === 'half_am' || type === 'half_pm' || QUARTER_LEAVE_TYPES.includes(type);
}

function calcDays(type, startDate, endDate, holidaySet) {
  if (!type || !startDate) return 0;
  if (type === 'half_am' || type === 'half_pm') return 0.5;
  if (QUARTER_LEAVE_TYPES.includes(type)) return 0.25;
  if (!endDate) return 0;
  return getBusinessDaysExcludingHolidays(startDate, endDate, holidaySet);
}

export default function LeaveManagementPage() {
  const [leaves, setLeaves] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [holidayEvents, setHolidayEvents] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0);
  const [status, setStatus] = useState('all');
  const [deptId, setDeptId] = useState('all');
  const [userId, setUserId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([getUsers(), getDepartments(), getEvents()])
      .then(([u, d, evs]) => {
        setUsers(u);
        setDepartments(d);
        setHolidayEvents(evs.filter((e) => e.type === 'holiday'));
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => { loadLeaves(); }, [year]);

  const holidaySet = useMemo(() => buildHolidaySet(holidayEvents), [holidayEvents]);

  async function loadLeaves() {
    setLoading(true);
    try {
      const data = await getAllLeavesByYear(year);
      setLeaves(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const userMap = useMemo(() => {
    const m = {};
    users.forEach((u) => { m[u.uid] = u; });
    return m;
  }, [users]);

  const deptMap = useMemo(() => {
    const m = {};
    departments.forEach((d) => { m[d.id] = d.name; });
    return m;
  }, [departments]);

  const filteredUserOptions = useMemo(() => {
    if (deptId === 'all') return users;
    return users.filter((u) => u.departmentId === deptId);
  }, [users, deptId]);

  const filtered = useMemo(() => {
    return leaves.filter((l) => {
      if (status !== 'all' && l.status !== status) return false;
      if (userId !== 'all' && l.userId !== userId) return false;
      if (deptId !== 'all') {
        const u = userMap[l.userId];
        if (!u || u.departmentId !== deptId) return false;
      }
      if (month > 0) {
        const mm = String(month).padStart(2, '0');
        const monthStart = `${year}-${mm}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const monthEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
        if ((l.endDate || l.startDate) < monthStart || l.startDate > monthEnd) return false;
      }
      return true;
    });
  }, [leaves, status, userId, deptId, month, year, userMap]);

  const stats = useMemo(() => {
    const s = { total: 0, confirmed: 0, pending: 0, rejected: 0, cancelled: 0, days: 0 };
    filtered.forEach((l) => {
      s.total += 1;
      s[l.status] = (s[l.status] || 0) + 1;
      if (l.status === 'confirmed') s.days += (Number(l.days) || 0);
    });
    return s;
  }, [filtered]);

  function formatDays(d) {
    return Number(d).toFixed(2).replace(/\.?0+$/, '');
  }

  function startEdit(l) {
    setEditingId(l.id);
    setEditForm({
      type: l.type,
      startDate: l.startDate,
      endDate: l.endDate,
      reason: l.reason || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  function handleTypeChange(type) {
    const single = isSingleDayType(type);
    setEditForm((f) => ({
      ...f,
      type,
      endDate: single ? f.startDate : f.endDate,
    }));
  }

  async function handleCancel(l) {
    const targetUser = userMap[l.userId];
    const who = targetUser ? `${targetUser.name} 직원의 ` : '';
    if (!confirm(`${who}${l.startDate} 연차 신청을 취소(반려)하시겠습니까?`)) return;
    setBusy(true);
    try {
      await cancelLeave(l.id);
      await loadLeaves();
    } catch (err) {
      alert('취소 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(l) {
    const single = isSingleDayType(editForm.type);
    const endDate = single ? editForm.startDate : editForm.endDate;
    const newDays = calcDays(editForm.type, editForm.startDate, endDate, holidaySet);

    if (newDays <= 0) {
      alert('올바른 날짜를 선택해주세요.');
      return;
    }

    setBusy(true);
    try {
      await editLeaveWithBalance(l.id, l.userId, {
        type: editForm.type,
        startDate: editForm.startDate,
        endDate,
        days: newDays,
        reason: editForm.reason,
      }, l.days);
      setEditingId(null);
      await loadLeaves();
    } catch (err) {
      alert('수정 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leave-management-page">
      <h2>연차 신청 목록</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          <option value={0}>전체 월</option>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setUserId('all'); }}>
          <option value="all">전체 부서</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="all">전체 직원</option>
          {filteredUserOptions.map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
        </select>
      </div>

      <div className="total-summary-bar">
        <div className="total-summary-item">
          <span className="label">전체 신청</span>
          <strong>{stats.total}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인됨</span>
          <strong className="stat-revenue">{stats.confirmed}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">대기·반려·취소</span>
          <strong>{stats.pending + stats.rejected + stats.cancelled}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인 합계</span>
          <strong className="stat-revenue">{formatDays(stats.days)}일</strong>
        </div>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="card-body empty-state">조건에 맞는 연차 신청이 없습니다.</div></div>
      ) : (
        <div className="record-list">
          {filtered.map((l) => {
            const isEditing = editingId === l.id;
            const u = userMap[l.userId];
            const statusStyle = STATUS_STYLES[l.status] || {};
            const period = l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`;
            const userName = u ? u.name : '(알 수 없음)';
            const deptName = u && u.departmentId ? deptMap[u.departmentId] || '' : '';
            const previewDays = calcDays(editForm.type, editForm.startDate,
              isSingleDayType(editForm.type) ? editForm.startDate : editForm.endDate, holidaySet);
            const canEdit = l.status !== 'cancelled';

            return (
              <div key={l.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{userName}</span>
                        {u?.position && <span className={`badge badge-position-${u.position}`}>{u.position}</span>}
                        {deptName && <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>· {deptName}</span>}
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>휴가 종류</label>
                        <select value={editForm.type} onChange={(e) => handleTypeChange(e.target.value)}>
                          {Object.entries(LEAVE_TYPE_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-row" style={{ gap: 8 }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>시작일</label>
                          <input
                            type="date"
                            value={editForm.startDate}
                            onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                          />
                        </div>
                        {!isSingleDayType(editForm.type) && (
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: 12 }}>종료일</label>
                            <input
                              type="date"
                              value={editForm.endDate}
                              min={editForm.startDate}
                              onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                            />
                          </div>
                        )}
                      </div>
                      {previewDays > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-light)' }}>
                          차감일수: <strong style={{ color: 'var(--primary)' }}>{previewDays}일</strong>
                          {previewDays !== l.days && (
                            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                              (기존 {l.days}일 → {previewDays > l.days ? '+' : ''}{(previewDays - l.days).toFixed(2).replace(/\.?0+$/, '')}일)
                            </span>
                          )}
                        </div>
                      )}
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>사유</label>
                        <input
                          type="text"
                          value={editForm.reason}
                          onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                          placeholder="사유 (선택)"
                        />
                      </div>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(l)}>저장</button>
                        <button className="btn btn-sm btn-outline" disabled={busy} onClick={cancelEdit}>닫기</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>{userName}</span>
                          {u?.position && <span className={`badge badge-position-${u.position}`}>{u.position}</span>}
                          {deptName && <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>· {deptName}</span>}
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{period}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{l.days}일</span>
                          <span>{LEAVE_TYPE_LABELS[l.type] || l.type}</span>
                          {l.reason && <span style={{ color: 'var(--text-muted)' }}>{l.reason}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                        <span style={{ color: statusStyle.color, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}>
                          {statusStyle.label}
                        </span>
                        {canEdit && (
                          <div className="btn-group">
                            <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>수정</button>
                            <button className="btn btn-sm btn-danger-outline" disabled={busy} onClick={() => handleCancel(l)}>취소</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
