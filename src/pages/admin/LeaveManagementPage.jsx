import { useState, useEffect, useMemo } from 'react';
import { getAllLeavesByYear, editLeaveWithBalance, cancelLeave, deleteLeaveById } from '../../services/leaveService';
import {
  getAllOvertimeRecords,
  approveOvertimeRecord,
  rejectOvertimeRecord,
  updateOvertimeRecord,
  deleteOvertimeRecord,
} from '../../services/attendanceService';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getEvents } from '../../services/eventService';
import { getAllSites } from '../../services/siteService';
import { LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import { getBusinessDaysExcludingHolidays, buildHolidaySet, formatMinutes } from '../../utils/dateUtils';
import Modal from '../../components/common/Modal';

const LEAVE_STATUS_STYLES = {
  confirmed: { color: 'var(--success)', label: '승인됨' },
  pending:   { color: 'var(--text-muted)', label: '대기중' },
  cancelled: { color: 'var(--text-muted)', label: '취소됨' },
  rejected:  { color: 'var(--danger)', label: '반려됨' },
};
const LEAVE_STATUS_OPTIONS = [
  { value: 'all',       label: '전체 상태' },
  { value: 'confirmed', label: '승인됨' },
  { value: 'pending',   label: '대기중' },
  { value: 'rejected',  label: '반려됨' },
  { value: 'cancelled', label: '취소됨' },
];

const OVERTIME_STATUS_STYLES = {
  approved: { color: 'var(--success)', label: '승인됨' },
  pending:  { color: '#92400e', label: '승인 대기', bg: '#fef3c7' },
  rejected: { color: 'var(--danger)', label: '거절됨' },
};
const OVERTIME_STATUS_OPTIONS = [
  { value: 'all',      label: '전체 상태' },
  { value: 'pending',  label: '승인 대기' },
  { value: 'approved', label: '승인됨' },
  { value: 'rejected', label: '거절됨' },
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
function formatDays(d) {
  return Number(d).toFixed(2).replace(/\.?0+$/, '');
}

export default function LeaveManagementPage() {
  // 공통
  const [activeTab, setActiveTab] = useState('leave');
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [sites, setSites] = useState([]);
  const [holidayEvents, setHolidayEvents] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0);
  const [deptId, setDeptId] = useState('all');
  const [userId, setUserId] = useState('all');

  // 연차
  const [leaves, setLeaves] = useState([]);
  const [leaveStatus, setLeaveStatus] = useState('all');
  const [leaveLoading, setLeaveLoading] = useState(true);
  const [editingLeaveId, setEditingLeaveId] = useState(null);
  const [editLeaveForm, setEditLeaveForm] = useState({});
  const [leaveBusy, setLeaveBusy] = useState(false);

  // 잔업
  const [overtimes, setOvertimes] = useState([]);
  const [otStatus, setOtStatus] = useState('all');
  const [otSiteId, setOtSiteId] = useState('all');
  const [otLoading, setOtLoading] = useState(true);
  const [editingOtId, setEditingOtId] = useState(null);
  const [editOtForm, setEditOtForm] = useState({});
  const [otBusy, setOtBusy] = useState(null); // id 또는 null

  // 취소/거절 사유 입력 모달 상태
  const [reasonModal, setReasonModal] = useState(null);
  // { kind: 'leave-cancel' | 'overtime-reject', target: object, reason: string }

  useEffect(() => {
    Promise.all([getUsers(), getDepartments(), getEvents(), getAllSites()])
      .then(([u, d, evs, s]) => {
        setUsers(u);
        setDepartments(d);
        setHolidayEvents(evs.filter((e) => e.type === 'holiday'));
        setSites(s);
      })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => { loadLeaves(); loadOvertimes(); }, [year]);

  const holidaySet = useMemo(() => buildHolidaySet(holidayEvents), [holidayEvents]);

  async function loadLeaves() {
    setLeaveLoading(true);
    try {
      setLeaves(await getAllLeavesByYear(year));
    } catch (err) { console.error(err); } finally { setLeaveLoading(false); }
  }
  async function loadOvertimes() {
    setOtLoading(true);
    try {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      setOvertimes(await getAllOvertimeRecords(start, end));
    } catch (err) { console.error(err); } finally { setOtLoading(false); }
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
  const siteMap = useMemo(() => {
    const m = { etc: '기타' };
    sites.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [sites]);

  const filteredUserOptions = useMemo(() => {
    if (deptId === 'all') return users;
    return users.filter((u) => u.departmentId === deptId);
  }, [users, deptId]);

  function inMonthRange(startDateStr, endDateStr) {
    if (month === 0) return true;
    const mm = String(month).padStart(2, '0');
    const monthStart = `${year}-${mm}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return !((endDateStr || startDateStr) < monthStart || startDateStr > monthEnd);
  }

  // === 연차 필터/통계 ===
  const filteredLeaves = useMemo(() => leaves.filter((l) => {
    if (leaveStatus !== 'all' && l.status !== leaveStatus) return false;
    if (userId !== 'all' && l.userId !== userId) return false;
    if (deptId !== 'all') {
      const u = userMap[l.userId];
      if (!u || u.departmentId !== deptId) return false;
    }
    return inMonthRange(l.startDate, l.endDate);
  }), [leaves, leaveStatus, userId, deptId, month, year, userMap]);

  const leaveStats = useMemo(() => {
    const s = { total: 0, confirmed: 0, pending: 0, rejected: 0, cancelled: 0, days: 0 };
    filteredLeaves.forEach((l) => {
      s.total += 1;
      s[l.status] = (s[l.status] || 0) + 1;
      if (l.status === 'confirmed') s.days += (Number(l.days) || 0);
    });
    return s;
  }, [filteredLeaves]);

  // === 잔업 필터/통계 ===
  const filteredOvertimes = useMemo(() => overtimes.filter((r) => {
    if (otStatus !== 'all' && r.status !== otStatus) return false;
    if (userId !== 'all' && r.userId !== userId) return false;
    if (deptId !== 'all') {
      const u = userMap[r.userId];
      if (!u || u.departmentId !== deptId) return false;
    }
    if (otSiteId !== 'all' && (r.siteId || 'etc') !== otSiteId) return false;
    return inMonthRange(r.date, r.date);
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [overtimes, otStatus, otSiteId, userId, deptId, month, year, userMap]);

  const otStats = useMemo(() => {
    const s = { total: 0, approved: 0, pending: 0, rejected: 0, minutes: 0 };
    filteredOvertimes.forEach((r) => {
      s.total += 1;
      s[r.status] = (s[r.status] || 0) + 1;
      if (r.status === 'approved') s.minutes += (Number(r.minutes) || 0);
    });
    return s;
  }, [filteredOvertimes]);

  // === 연차 핸들러 ===
  function startEditLeave(l) {
    setEditingLeaveId(l.id);
    setEditLeaveForm({ type: l.type, startDate: l.startDate, endDate: l.endDate, reason: l.reason || '' });
  }
  function cancelEditLeave() { setEditingLeaveId(null); setEditLeaveForm({}); }
  function handleLeaveTypeChange(type) {
    const single = isSingleDayType(type);
    setEditLeaveForm((f) => ({ ...f, type, endDate: single ? f.startDate : f.endDate }));
  }
  function handleCancelLeave(l) {
    setReasonModal({ kind: 'leave-cancel', target: l, reason: l.cancelReason || '' });
  }
  async function confirmReason() {
    if (!reasonModal) return;
    const { kind, target, reason } = reasonModal;
    const trimmed = (reason || '').trim();
    if (kind === 'leave-cancel') {
      setLeaveBusy(true);
      try { await cancelLeave(target.id, trimmed); await loadLeaves(); setReasonModal(null); }
      catch (err) { alert('취소 실패: ' + err.message); }
      finally { setLeaveBusy(false); }
    } else if (kind === 'overtime-reject') {
      setOtBusy(target.id);
      try { await rejectOvertimeRecord(target.id, trimmed); await loadOvertimes(); setReasonModal(null); }
      catch (err) { alert('거절 실패: ' + err.message); }
      finally { setOtBusy(null); }
    }
  }
  async function handleDeleteLeave(l) {
    const u = userMap[l.userId];
    if (!confirm(`${u ? u.name + ' 직원의 ' : ''}${l.startDate} 연차 신청을 영구 삭제합니다.\n\n취소된 항목은 복구할 수 없습니다. 계속하시겠습니까?`)) return;
    setLeaveBusy(true);
    try { await deleteLeaveById(l.id); await loadLeaves(); }
    catch (err) { alert('삭제 실패: ' + err.message); }
    finally { setLeaveBusy(false); }
  }
  async function saveLeave(l) {
    const single = isSingleDayType(editLeaveForm.type);
    const endDate = single ? editLeaveForm.startDate : editLeaveForm.endDate;
    const newDays = calcDays(editLeaveForm.type, editLeaveForm.startDate, endDate, holidaySet);
    if (newDays <= 0) { alert('올바른 날짜를 선택해주세요.'); return; }
    setLeaveBusy(true);
    try {
      await editLeaveWithBalance(l.id, l.userId, {
        type: editLeaveForm.type,
        startDate: editLeaveForm.startDate,
        endDate,
        days: newDays,
        reason: editLeaveForm.reason,
      }, l.days);
      setEditingLeaveId(null);
      await loadLeaves();
    } catch (err) { alert('수정 실패: ' + err.message); }
    finally { setLeaveBusy(false); }
  }

  // === 잔업 핸들러 ===
  function startEditOt(r) {
    setEditingOtId(r.id);
    setEditOtForm({
      date: r.date,
      hours: String(Math.floor((r.minutes || 0) / 60)),
      minutesPart: String((r.minutes || 0) % 60),
      siteId: r.siteId || '',
      reason: r.reason || '',
    });
  }
  function cancelEditOt() { setEditingOtId(null); setEditOtForm({}); }
  async function saveOt(r) {
    const total = (parseInt(editOtForm.hours || 0) * 60) + parseInt(editOtForm.minutesPart || 0);
    if (total <= 0) { alert('잔업 시간을 입력해주세요.'); return; }
    if (!editOtForm.siteId) { alert('프로젝트를 선택해주세요.'); return; }
    setOtBusy(r.id);
    try {
      await updateOvertimeRecord(r.id, {
        date: editOtForm.date,
        minutes: total,
        siteId: editOtForm.siteId,
        reason: editOtForm.reason,
      });
      setEditingOtId(null);
      await loadOvertimes();
    } catch (err) { alert('수정 실패: ' + err.message); }
    finally { setOtBusy(null); }
  }
  async function approveOt(r) {
    setOtBusy(r.id);
    try { await approveOvertimeRecord(r.id); await loadOvertimes(); }
    catch (err) { alert('승인 실패: ' + err.message); }
    finally { setOtBusy(null); }
  }
  function rejectOt(r) {
    setReasonModal({ kind: 'overtime-reject', target: r, reason: r.rejectionReason || '' });
  }
  async function deleteOt(r) {
    const u = userMap[r.userId];
    if (!confirm(`${u ? u.name + ' 직원의 ' : ''}${r.date} 잔업 기록을 삭제하시겠습니까?`)) return;
    setOtBusy(r.id);
    try { await deleteOvertimeRecord(r.id); await loadOvertimes(); }
    catch (err) { alert('삭제 실패: ' + err.message); }
    finally { setOtBusy(null); }
  }

  return (
    <div className="leave-management-page">
      <h2>연차/잔업 신청 목록</h2>

      <div className="tab-nav">
        <button className={`tab-nav-item ${activeTab === 'leave' ? 'active' : ''}`} onClick={() => setActiveTab('leave')}>
          연차 {leaveStats.pending > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{leaveStats.pending}</span>}
        </button>
        <button className={`tab-nav-item ${activeTab === 'overtime' ? 'active' : ''}`} onClick={() => setActiveTab('overtime')}>
          잔업 {otStats.pending > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{otStats.pending}</span>}
        </button>
      </div>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          <option value={0}>전체 월</option>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => <option key={m} value={m}>{m}월</option>)}
        </select>
        {activeTab === 'leave' ? (
          <select value={leaveStatus} onChange={(e) => setLeaveStatus(e.target.value)}>
            {LEAVE_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <>
            <select value={otStatus} onChange={(e) => setOtStatus(e.target.value)}>
              {OVERTIME_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={otSiteId} onChange={(e) => setOtSiteId(e.target.value)}>
              <option value="all">전체 프로젝트</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="etc">기타</option>
            </select>
          </>
        )}
        <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setUserId('all'); }}>
          <option value="all">전체 부서</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="all">전체 직원</option>
          {filteredUserOptions.map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
        </select>
      </div>

      {activeTab === 'leave' ? (
        <LeaveTab
          stats={leaveStats}
          loading={leaveLoading}
          filtered={filteredLeaves}
          userMap={userMap}
          deptMap={deptMap}
          editingId={editingLeaveId}
          editForm={editLeaveForm}
          setEditForm={setEditLeaveForm}
          startEdit={startEditLeave}
          cancelEdit={cancelEditLeave}
          handleTypeChange={handleLeaveTypeChange}
          handleCancel={handleCancelLeave}
          handleDelete={handleDeleteLeave}
          saveEdit={saveLeave}
          busy={leaveBusy}
          holidaySet={holidaySet}
        />
      ) : (
        <OvertimeTab
          stats={otStats}
          loading={otLoading}
          filtered={filteredOvertimes}
          userMap={userMap}
          deptMap={deptMap}
          siteMap={siteMap}
          sites={sites}
          editingId={editingOtId}
          editForm={editOtForm}
          setEditForm={setEditOtForm}
          startEdit={startEditOt}
          cancelEdit={cancelEditOt}
          save={saveOt}
          approve={approveOt}
          reject={rejectOt}
          remove={deleteOt}
          busy={otBusy}
        />
      )}

      {/* 취소/거절 사유 입력 모달 — 다른 모달들과 디자인 통일 */}
      {reasonModal && (() => {
        const isLeave = reasonModal.kind === 'leave-cancel';
        const u = userMap[reasonModal.target.userId];
        const dateStr = isLeave
          ? reasonModal.target.startDate
          : reasonModal.target.date;
        return (
          <Modal isOpen={!!reasonModal} onClose={() => setReasonModal(null)} title={isLeave ? '연차 신청 취소' : '잔업 신청 거절'}>
            <div className="form-group">
              <label className="text-muted text-sm" style={{ display: 'block', marginBottom: 6 }}>
                {u?.name || '직원'} · {dateStr}
              </label>
            </div>
            <div className="form-group">
              <label>{isLeave ? '취소' : '거절'} 사유</label>
              <textarea
                rows={3}
                autoFocus
                placeholder="사유를 입력해주세요 (당사자도 확인 가능)"
                value={reasonModal.reason}
                onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
              />
              <p className="field-hint" style={{ marginTop: 4 }}>
                입력한 사유는 당사자의 연차/잔업 내역에 함께 표시됩니다.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-danger" onClick={confirmReason}>
                {isLeave ? '취소 처리' : '거절 처리'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setReasonModal(null)}>닫기</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

// ===== 연차 탭 =====
function LeaveTab({ stats, loading, filtered, userMap, deptMap, editingId, editForm, setEditForm, startEdit, cancelEdit, handleTypeChange, handleCancel, handleDelete, saveEdit, busy, holidaySet }) {
  return (
    <>
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
            const statusStyle = LEAVE_STATUS_STYLES[l.status] || {};
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
                          <input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} />
                        </div>
                        {!isSingleDayType(editForm.type) && (
                          <div className="form-group" style={{ marginBottom: 0 }}>
                            <label style={{ fontSize: 12 }}>종료일</label>
                            <input type="date" value={editForm.endDate} min={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} />
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
                        <input type="text" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} placeholder="사유 (선택)" />
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
                        {l.status === 'cancelled' && l.cancelReason && (
                          <span style={{ fontSize: 11, color: 'var(--danger)', textAlign: 'right', maxWidth: 220, lineHeight: 1.4 }}>
                            취소 사유: {l.cancelReason}
                          </span>
                        )}
                        <div className="btn-group">
                          {canEdit && (
                            <>
                              <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>수정</button>
                              <button className="btn btn-sm btn-danger-outline" disabled={busy} onClick={() => handleCancel(l)}>취소</button>
                            </>
                          )}
                          {handleDelete && (
                            <button className="btn btn-sm btn-danger-outline" disabled={busy} onClick={() => handleDelete(l)} title="기록 영구 삭제">삭제</button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ===== 잔업 탭 =====
function OvertimeTab({ stats, loading, filtered, userMap, deptMap, siteMap, sites, editingId, editForm, setEditForm, startEdit, cancelEdit, save, approve, reject, remove, busy }) {
  return (
    <>
      <div className="total-summary-bar">
        <div className="total-summary-item">
          <span className="label">전체 신청</span>
          <strong>{stats.total}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인 대기</span>
          <strong style={{ color: '#92400e' }}>{stats.pending}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인됨</span>
          <strong className="stat-revenue">{stats.approved}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인 합계 시간</span>
          <strong className="stat-revenue">{formatMinutes(stats.minutes)}</strong>
        </div>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="card-body empty-state">조건에 맞는 잔업 신청이 없습니다.</div></div>
      ) : (
        <div className="record-list">
          {filtered.map((r) => {
            const isEditing = editingId === r.id;
            const u = userMap[r.userId];
            const statusStyle = OVERTIME_STATUS_STYLES[r.status] || {};
            const userName = u ? u.name : (r.userName || '(알 수 없음)');
            const deptName = u && u.departmentId ? deptMap[u.departmentId] || '' : '';
            const isPending = r.status === 'pending';
            const rowBusy = busy === r.id;

            return (
              <div key={r.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{userName}</span>
                        {u?.position && <span className={`badge badge-position-${u.position}`}>{u.position}</span>}
                        {deptName && <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }}>· {deptName}</span>}
                      </div>
                      <div className="form-row" style={{ gap: 8 }}>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                          <label style={{ fontSize: 12 }}>날짜</label>
                          <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })} />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>시간</label>
                          <input type="number" min={0} max={12} value={editForm.hours} onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })} placeholder="시간" />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>분</label>
                          <input type="number" min={0} max={59} value={editForm.minutesPart} onChange={(e) => setEditForm({ ...editForm, minutesPart: e.target.value })} placeholder="분" />
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>프로젝트</label>
                        <select value={editForm.siteId} onChange={(e) => setEditForm({ ...editForm, siteId: e.target.value })}>
                          <option value="">프로젝트 선택</option>
                          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          <option value="etc">기타</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>사유</label>
                        <input type="text" value={editForm.reason} onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })} placeholder="사유 (선택)" />
                      </div>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-primary" disabled={rowBusy} onClick={() => save(r)}>저장</button>
                        <button className="btn btn-sm btn-outline" disabled={rowBusy} onClick={cancelEdit}>닫기</button>
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
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{r.date}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{formatMinutes(r.minutes || 0)}</span>
                          <span>{siteMap[r.siteId] || '미지정'}</span>
                          {r.reason && <span style={{ color: 'var(--text-muted)' }}>{r.reason}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                        <span style={{
                          color: statusStyle.color,
                          background: statusStyle.bg || 'transparent',
                          fontWeight: 700,
                          fontSize: 12,
                          padding: statusStyle.bg ? '2px 8px' : 0,
                          borderRadius: 4,
                          whiteSpace: 'nowrap',
                        }}>
                          {statusStyle.label}
                        </span>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <span style={{ fontSize: 11, color: 'var(--danger)', textAlign: 'right', maxWidth: 220, lineHeight: 1.4 }}>
                            거절 사유: {r.rejectionReason}
                          </span>
                        )}
                        <div className="btn-group">
                          {isPending && (
                            <>
                              <button className="btn btn-sm btn-primary" disabled={rowBusy} onClick={() => approve(r)}>승인</button>
                              <button className="btn btn-sm btn-danger-outline" disabled={rowBusy} onClick={() => reject(r)}>거절</button>
                            </>
                          )}
                          <button className="btn btn-sm btn-outline" disabled={rowBusy} onClick={() => startEdit(r)}>수정</button>
                          <button className="btn btn-sm btn-danger-outline" disabled={rowBusy} onClick={() => remove(r)}>삭제</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
