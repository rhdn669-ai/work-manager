import { useState, useEffect, useMemo } from 'react';
import { getAllLeavesByYear, editLeaveWithBalance, cancelLeave, deleteLeaveById } from '../../services/leaveService';
import {
  getAllOvertimeRecords,
  approveOvertimeRecord,
  rejectOvertimeRecord,
  updateOvertimeRecord,
  deleteOvertimeRecord,
} from '../../services/attendanceService';
import { useAuth } from '../../contexts/useAuth';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { getEvents } from '../../services/eventService';
import { getAllSites } from '../../services/siteService';
import { LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import {
  getBusinessDaysExcludingHolidays,
  buildHolidaySet,
  formatMinutes,
  formatDisplayDate,
} from '../../utils/dateUtils';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import EditModeButton from '../../components/common/EditModeButton';
import { useDialog } from '../../components/common/useDialog';

const LEAVE_STATUS_STYLES = {
  confirmed: { color: 'var(--success)', label: '승인됨' },
  pending: { color: 'var(--text-muted)', label: '대기중' },
  cancelled: { color: 'var(--text-muted)', label: '취소됨' },
  rejected: { color: 'var(--danger)', label: '반려됨' },
};
const LEAVE_STATUS_OPTIONS = [
  { value: 'all', label: '전체 상태' },
  { value: 'confirmed', label: '승인됨' },
  { value: 'pending', label: '대기중' },
  { value: 'rejected', label: '반려됨' },
  { value: 'cancelled', label: '취소됨' },
];

const OVERTIME_STATUS_STYLES = {
  approved: { color: 'var(--success)', label: '승인됨' },
  pending: { color: 'var(--accent)', label: '승인 대기', bg: 'var(--accent-tint)' },
  rejected: { color: 'var(--danger)', label: '거절됨' },
};
const OVERTIME_STATUS_OPTIONS = [
  { value: 'all', label: '전체 상태' },
  { value: 'pending', label: '승인 대기' },
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
  return Number(d)
    .toFixed(2)
    .replace(/\.?0+$/, '');
}

export default function LeaveManagementPage({ embedded = false } = {}) {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
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

  // 잠금 — 풀었을 때만 체크박스 + 「선택 삭제」 (2026-09-04 대표님 「잠금」 통일)
  const [editMode, setEditMode] = useState(false);
  const [pick, setPick] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

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

  useEffect(() => {
    loadLeaves();
    loadOvertimes();
  }, [year]);

  const holidaySet = useMemo(() => buildHolidaySet(holidayEvents), [holidayEvents]);

  async function loadLeaves() {
    setLeaveLoading(true);
    try {
      setLeaves(await getAllLeavesByYear(year));
    } catch (err) {
      console.error(err);
    } finally {
      setLeaveLoading(false);
    }
  }
  async function loadOvertimes() {
    setOtLoading(true);
    try {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      setOvertimes(await getAllOvertimeRecords(start, end));
    } catch (err) {
      console.error(err);
    } finally {
      setOtLoading(false);
    }
  }

  const userMap = useMemo(() => {
    const m = {};
    users.forEach((u) => {
      m[u.uid] = u;
    });
    return m;
  }, [users]);
  const deptMap = useMemo(() => {
    const m = {};
    departments.forEach((d) => {
      m[d.id] = d.name;
    });
    return m;
  }, [departments]);
  const siteMap = useMemo(() => {
    const m = { etc: '기타' };
    sites.forEach((s) => {
      m[s.id] = s.name;
    });
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
  const filteredLeaves = useMemo(
    () =>
      leaves.filter((l) => {
        if (leaveStatus !== 'all' && l.status !== leaveStatus) return false;
        if (userId !== 'all' && l.userId !== userId) return false;
        if (deptId !== 'all') {
          const u = userMap[l.userId];
          if (!u || u.departmentId !== deptId) return false;
        }
        return inMonthRange(l.startDate, l.endDate);
      }),
    [leaves, leaveStatus, userId, deptId, month, year, userMap],
  );

  const leaveStats = useMemo(() => {
    const s = { total: 0, confirmed: 0, pending: 0, rejected: 0, cancelled: 0, days: 0 };
    filteredLeaves.forEach((l) => {
      s.total += 1;
      s[l.status] = (s[l.status] || 0) + 1;
      if (l.status === 'confirmed') s.days += Number(l.days) || 0;
    });
    return s;
  }, [filteredLeaves]);

  // === 잔업 필터/통계 ===
  const filteredOvertimes = useMemo(
    () =>
      overtimes
        .filter((r) => {
          if (otStatus !== 'all' && r.status !== otStatus) return false;
          if (userId !== 'all' && r.userId !== userId) return false;
          if (deptId !== 'all') {
            const u = userMap[r.userId];
            if (!u || u.departmentId !== deptId) return false;
          }
          if (otSiteId !== 'all' && (r.siteId || 'etc') !== otSiteId) return false;
          return inMonthRange(r.date, r.date);
        })
        .sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    [overtimes, otStatus, otSiteId, userId, deptId, month, year, userMap],
  );

  const otStats = useMemo(() => {
    const s = { total: 0, approved: 0, pending: 0, rejected: 0, minutes: 0 };
    filteredOvertimes.forEach((r) => {
      s.total += 1;
      s[r.status] = (s[r.status] || 0) + 1;
      if (r.status === 'approved') s.minutes += Number(r.minutes) || 0;
    });
    return s;
  }, [filteredOvertimes]);

  // === 연차 핸들러 ===
  function startEditLeave(l) {
    setEditingLeaveId(l.id);
    setEditLeaveForm({ type: l.type, startDate: l.startDate, endDate: l.endDate, reason: l.reason || '' });
  }
  function cancelEditLeave() {
    setEditingLeaveId(null);
    setEditLeaveForm({});
  }
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
      try {
        await cancelLeave(target.id, trimmed);
        await loadLeaves();
        setReasonModal(null);
      } catch {
        toast('취소 중 오류가 발생했습니다', 'error');
      } finally {
        setLeaveBusy(false);
      }
    } else if (kind === 'overtime-reject') {
      setOtBusy(target.id);
      try {
        await rejectOvertimeRecord(target.id, trimmed);
        await loadOvertimes();
        setReasonModal(null);
      } catch {
        toast('거절 중 오류가 발생했습니다', 'error');
      } finally {
        setOtBusy(null);
      }
    }
  }
  async function saveLeave(l) {
    const single = isSingleDayType(editLeaveForm.type);
    const endDate = single ? editLeaveForm.startDate : editLeaveForm.endDate;
    const newDays = calcDays(editLeaveForm.type, editLeaveForm.startDate, endDate, holidaySet);
    if (newDays <= 0) {
      alert('올바른 날짜를 선택해주세요.');
      return;
    }
    setLeaveBusy(true);
    try {
      await editLeaveWithBalance(
        l.id,
        l.userId,
        {
          type: editLeaveForm.type,
          startDate: editLeaveForm.startDate,
          endDate,
          days: newDays,
          reason: editLeaveForm.reason,
        },
        l.days,
      );
      setEditingLeaveId(null);
      await loadLeaves();
    } catch {
      toast('수정 중 오류가 발생했습니다', 'error');
    } finally {
      setLeaveBusy(false);
    }
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
  function cancelEditOt() {
    setEditingOtId(null);
    setEditOtForm({});
  }
  async function saveOt(r) {
    const total = parseInt(editOtForm.hours || 0) * 60 + parseInt(editOtForm.minutesPart || 0);
    if (total <= 0) {
      alert('잔업 시간을 입력해주세요.');
      return;
    }
    if (!editOtForm.siteId) {
      alert('프로젝트를 선택해주세요.');
      return;
    }
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
    } catch {
      toast('수정 중 오류가 발생했습니다', 'error');
    } finally {
      setOtBusy(null);
    }
  }
  async function approveOt(r) {
    setOtBusy(r.id);
    try {
      await approveOvertimeRecord(r.id);
      await loadOvertimes();
    } catch {
      toast('승인 중 오류가 발생했습니다', 'error');
    } finally {
      setOtBusy(null);
    }
  }
  function rejectOt(r) {
    setReasonModal({ kind: 'overtime-reject', target: r, reason: r.rejectionReason || '' });
  }

  // === 잠금 · 선택 삭제 (연차/잔업 공통) ===
  function toggleEditMode() {
    setEditMode((v) => {
      if (v) setPick(new Set());
      return !v;
    });
  }
  function switchTab(tab) {
    setActiveTab(tab);
    setPick(new Set());
  }
  function togglePick(id) {
    setPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function deletePicked() {
    if (activeTab === 'leave') {
      const targets = filteredLeaves.filter((l) => pick.has(l.id));
      if (targets.length === 0) return;
      if (!(await confirm(`고른 ${targets.length}건을 휴지통으로 보내시겠습니까?`))) return;
      setBulkDeleting(true);
      try {
        for (const l of targets) {
          await deleteLeaveById(l.id, userProfile?.name || '');
        }
        setPick(new Set());
        await loadLeaves();
      } catch {
        toast('삭제 중 오류가 발생했습니다', 'error');
      } finally {
        setBulkDeleting(false);
      }
    } else {
      const targets = filteredOvertimes.filter((r) => pick.has(r.id));
      if (targets.length === 0) return;
      if (!(await confirm(`고른 ${targets.length}건을 휴지통으로 보내시겠습니까?`))) return;
      setBulkDeleting(true);
      try {
        for (const r of targets) {
          await deleteOvertimeRecord(r.id, userProfile?.name || '');
        }
        setPick(new Set());
        await loadOvertimes();
      } catch {
        toast('삭제 중 오류가 발생했습니다', 'error');
      } finally {
        setBulkDeleting(false);
      }
    }
  }

  return (
    <div className="leave-management-page">
      <div className="tab-nav">
        <button className={`tab-nav-item ${activeTab === 'leave' ? 'active' : ''}`} onClick={() => switchTab('leave')}>
          연차 {leaveStats.pending > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{leaveStats.pending}</span>}
        </button>
        <button
          className={`tab-nav-item ${activeTab === 'overtime' ? 'active' : ''}`}
          onClick={() => switchTab('overtime')}
        >
          잔업 {otStats.pending > 0 && <span style={{ opacity: 0.6, marginLeft: 3 }}>{otStats.pending}</span>}
        </button>
      </div>

      {!embedded ? (
        <div className="page-header">
          <h2>연차/잔업 신청 목록</h2>
          <div className="page-actions">
            <EditModeButton on={editMode} onToggle={toggleEditMode} />
          </div>
        </div>
      ) : (
        <div className="page-actions" style={{ display: 'flex', justifyContent: 'flex-end', margin: '8px 0' }}>
          <EditModeButton on={editMode} onToggle={toggleEditMode} />
        </div>
      )}

      {editMode && pick.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">
            <strong>{pick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" disabled={bulkDeleting} onClick={deletePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setPick(new Set())}>
            선택 해제
          </button>
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
          options={[
            { value: 0, label: '전체 월' },
            ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` })),
          ]}
          ariaLabel="월 선택"
        />
        {activeTab === 'leave' ? (
          <Select
            value={leaveStatus}
            onChange={(v) => setLeaveStatus(v)}
            options={LEAVE_STATUS_OPTIONS}
            ariaLabel="연차 상태 선택"
          />
        ) : (
          <>
            <Select
              value={otStatus}
              onChange={(v) => setOtStatus(v)}
              options={OVERTIME_STATUS_OPTIONS}
              ariaLabel="잔업 상태 선택"
            />
            <Select
              value={otSiteId}
              onChange={(v) => setOtSiteId(v)}
              options={[
                { value: 'all', label: '전체 프로젝트' },
                ...sites.map((s) => ({ value: s.id, label: s.name })),
                { value: 'etc', label: '기타' },
              ]}
              ariaLabel="프로젝트 선택"
            />
          </>
        )}
        <Select
          value={deptId}
          onChange={(v) => {
            setDeptId(v);
            setUserId('all');
          }}
          options={[{ value: 'all', label: '전체 부서' }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
          ariaLabel="부서 선택"
        />
        <Select
          value={userId}
          onChange={(v) => setUserId(v)}
          options={[
            { value: 'all', label: '전체 직원' },
            ...filteredUserOptions.map((u) => ({ value: u.uid, label: u.name })),
          ]}
          ariaLabel="직원 선택"
        />
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
          saveEdit={saveLeave}
          busy={leaveBusy}
          holidaySet={holidaySet}
          editMode={editMode}
          pick={pick}
          togglePick={togglePick}
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
          busy={otBusy}
          editMode={editMode}
          pick={pick}
          togglePick={togglePick}
        />
      )}

      {/* 취소/거절 사유 입력 모달 — 다른 모달들과 디자인 통일 */}
      {reasonModal &&
        (() => {
          const isLeave = reasonModal.kind === 'leave-cancel';
          const u = userMap[reasonModal.target.userId];
          const dateStr = isLeave ? reasonModal.target.startDate : reasonModal.target.date;
          return (
            <Modal
              isOpen={!!reasonModal}
              onClose={() => setReasonModal(null)}
              title={isLeave ? '연차 신청 취소' : '잔업 신청 거절'}
            >
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
                <button type="button" className="btn btn-outline" onClick={() => setReasonModal(null)}>
                  닫기
                </button>
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}

// ===== 연차 탭 =====
function LeaveTab({
  stats,
  loading,
  filtered,
  userMap,
  deptMap,
  editingId,
  editForm,
  setEditForm,
  startEdit,
  cancelEdit,
  handleTypeChange,
  handleCancel,
  saveEdit,
  busy,
  holidaySet,
  editMode,
  pick,
  togglePick,
}) {
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
        <Skeleton.Rows count={6} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">조건에 맞는 연차 신청이 없습니다.</div>
        </div>
      ) : (
        <div className="record-list">
          {filtered.map((l) => {
            const isEditing = editingId === l.id;
            const u = userMap[l.userId];
            const statusStyle = LEAVE_STATUS_STYLES[l.status] || {};
            const period =
              l.startDate === l.endDate
                ? formatDisplayDate(l.startDate)
                : `${formatDisplayDate(l.startDate)} ~ ${formatDisplayDate(l.endDate)}`;
            const userName = u ? u.name : '(알 수 없음)';
            const deptName = u && u.departmentId ? deptMap[u.departmentId] || '' : '';
            const previewDays = calcDays(
              editForm.type,
              editForm.startDate,
              isSingleDayType(editForm.type) ? editForm.startDate : editForm.endDate,
              holidaySet,
            );
            const canEdit = l.status !== 'cancelled';

            return (
              <div key={l.id} className={`card${pick.has(l.id) ? ' is-checked' : ''}`} style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '10px 12px', display: 'flex', gap: 10 }}>
                  {editMode && !isEditing && (
                    <input
                      type="checkbox"
                      className="sel-check"
                      checked={pick.has(l.id)}
                      onChange={() => togglePick(l.id)}
                      aria-label="삭제할 연차 신청 고르기"
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span title={userName} style={{ whiteSpace: 'nowrap' }}>
                            {userName}
                          </span>
                          {u?.position && (
                            <span className={`badge badge-position-${u.position}`} style={{ flexShrink: 0 }}>
                              {u.position}
                            </span>
                          )}
                          {deptName && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
                              · {deptName}
                            </span>
                          )}
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>휴가 종류</label>
                          <Select
                            value={editForm.type}
                            onChange={(v) => handleTypeChange(v)}
                            options={Object.entries(LEAVE_TYPE_LABELS).map(([key, label]) => ({ value: key, label }))}
                            ariaLabel="휴가 종류 선택"
                          />
                        </div>
                        <div className="form-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 100px' }}>
                            <label style={{ fontSize: 12 }}>시작일</label>
                            <input
                              aria-label="시작일"
                              type="date"
                              value={editForm.startDate}
                              onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                            />
                          </div>
                          {!isSingleDayType(editForm.type) && (
                            <div className="form-group" style={{ marginBottom: 0, flex: '1 1 100px' }}>
                              <label style={{ fontSize: 12 }}>종료일</label>
                              <input
                                aria-label="종료일"
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
                                (기존 {l.days}일 → {previewDays > l.days ? '+' : ''}
                                {(previewDays - l.days).toFixed(2).replace(/\.?0+$/, '')}일)
                              </span>
                            )}
                          </div>
                        )}
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>사유</label>
                          <input
                            aria-label="사유"
                            type="text"
                            value={editForm.reason}
                            onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                            placeholder="사유 (선택)"
                          />
                        </div>
                        <div className="btn-group">
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ minHeight: 36, whiteSpace: 'nowrap' }}
                            disabled={busy}
                            onClick={() => saveEdit(l)}
                          >
                            저장
                          </button>
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ minHeight: 36, whiteSpace: 'nowrap' }}
                            disabled={busy}
                            onClick={cancelEdit}
                          >
                            닫기
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              marginBottom: 4,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                              minWidth: 0,
                            }}
                          >
                            <span title={userName} style={{ whiteSpace: 'nowrap' }}>
                              {userName}
                            </span>
                            {u?.position && (
                              <span className={`badge badge-position-${u.position}`} style={{ flexShrink: 0 }}>
                                {u.position}
                              </span>
                            )}
                            {deptName && (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
                                · {deptName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 'var(--space-1)' }}>{period}</div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--text-light)',
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{l.days}일</span>
                            <span>{LEAVE_TYPE_LABELS[l.type] || l.type}</span>
                            {l.reason && (
                              <span
                                style={{
                                  color: 'var(--text-muted)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 200,
                                }}
                                title={l.reason}
                              >
                                {l.reason}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{ color: statusStyle.color, fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}
                          >
                            {statusStyle.label}
                          </span>
                          {l.status === 'cancelled' && l.cancelReason && (
                            <span
                              title={l.cancelReason}
                              style={{
                                fontSize: 12,
                                color: 'var(--danger)',
                                textAlign: 'right',
                                maxWidth: 220,
                                lineHeight: 1.4,
                                wordBreak: 'break-word',
                              }}
                            >
                              취소 사유: {l.cancelReason}
                            </span>
                          )}
                          <div className="btn-group">
                            {canEdit && (
                              <>
                                <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>
                                  수정
                                </button>
                                <button
                                  className="btn btn-sm btn-danger"
                                  disabled={busy}
                                  onClick={() => handleCancel(l)}
                                >
                                  <Icon name="trash" className="btn-ic" />
                                  취소
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
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
function OvertimeTab({
  stats,
  loading,
  filtered,
  userMap,
  deptMap,
  siteMap,
  sites,
  editingId,
  editForm,
  setEditForm,
  startEdit,
  cancelEdit,
  save,
  approve,
  reject,
  busy,
  editMode,
  pick,
  togglePick,
}) {
  return (
    <>
      <div className="total-summary-bar">
        <div className="total-summary-item">
          <span className="label">전체 신청</span>
          <strong>{stats.total}건</strong>
        </div>
        <div className="total-summary-item">
          <span className="label">승인 대기</span>
          <strong style={{ color: 'var(--accent)' }}>{stats.pending}건</strong>
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
        <Skeleton.Rows count={6} />
      ) : filtered.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">조건에 맞는 잔업 신청이 없습니다.</div>
        </div>
      ) : (
        <div className="record-list">
          {filtered.map((r) => {
            const isEditing = editingId === r.id;
            const u = userMap[r.userId];
            const statusStyle = OVERTIME_STATUS_STYLES[r.status] || {};
            const userName = u ? u.name : r.userName || '(알 수 없음)';
            const deptName = u && u.departmentId ? deptMap[u.departmentId] || '' : '';
            const isPending = r.status === 'pending';
            const rowBusy = busy === r.id;

            return (
              <div key={r.id} className={`card${pick.has(r.id) ? ' is-checked' : ''}`} style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '10px 12px', display: 'flex', gap: 10 }}>
                  {editMode && !isEditing && (
                    <input
                      type="checkbox"
                      className="sel-check"
                      checked={pick.has(r.id)}
                      onChange={() => togglePick(r.id)}
                      aria-label="삭제할 잔업 신청 고르기"
                      style={{ marginTop: 3, flexShrink: 0 }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span title={userName} style={{ whiteSpace: 'nowrap' }}>
                            {userName}
                          </span>
                          {u?.position && (
                            <span className={`badge badge-position-${u.position}`} style={{ flexShrink: 0 }}>
                              {u.position}
                            </span>
                          )}
                          {deptName && (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
                              · {deptName}
                            </span>
                          )}
                        </div>
                        <div className="form-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                          <div className="form-group" style={{ marginBottom: 0, flex: '1 1 100px' }}>
                            <label style={{ fontSize: 12 }}>날짜</label>
                            <input
                              aria-label="날짜"
                              type="date"
                              value={editForm.date}
                              onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 60px' }}>
                            <label style={{ fontSize: 12 }}>시간</label>
                            <input
                              aria-label="시간"
                              type="number"
                              min={0}
                              max={12}
                              value={editForm.hours}
                              onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })}
                              placeholder="시간"
                            />
                          </div>
                          <div className="form-group" style={{ marginBottom: 0, flex: '0 0 60px' }}>
                            <label style={{ fontSize: 12 }}>분</label>
                            <input
                              aria-label="분"
                              type="number"
                              min={0}
                              max={59}
                              value={editForm.minutesPart}
                              onChange={(e) => setEditForm({ ...editForm, minutesPart: e.target.value })}
                              placeholder="분"
                            />
                          </div>
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>프로젝트</label>
                          <Select
                            value={editForm.siteId}
                            onChange={(v) => setEditForm({ ...editForm, siteId: v })}
                            options={[
                              ...sites.map((s) => ({ value: s.id, label: s.name })),
                              { value: 'etc', label: '기타' },
                            ]}
                            placeholder="프로젝트 선택"
                            ariaLabel="프로젝트 선택"
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12 }}>사유</label>
                          <input
                            aria-label="사유"
                            type="text"
                            value={editForm.reason}
                            onChange={(e) => setEditForm({ ...editForm, reason: e.target.value })}
                            placeholder="사유 (선택)"
                          />
                        </div>
                        <div className="btn-group">
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ minHeight: 36, whiteSpace: 'nowrap' }}
                            disabled={rowBusy}
                            onClick={() => save(r)}
                          >
                            저장
                          </button>
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ minHeight: 36, whiteSpace: 'nowrap' }}
                            disabled={rowBusy}
                            onClick={cancelEdit}
                          >
                            닫기
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: 14,
                              marginBottom: 4,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              flexWrap: 'wrap',
                              minWidth: 0,
                            }}
                          >
                            <span title={userName} style={{ whiteSpace: 'nowrap' }}>
                              {userName}
                            </span>
                            {u?.position && (
                              <span className={`badge badge-position-${u.position}`} style={{ flexShrink: 0 }}>
                                {u.position}
                              </span>
                            )}
                            {deptName && (
                              <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400 }}>
                                · {deptName}
                              </span>
                            )}
                          </div>
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 'var(--space-1)' }}>
                            {formatDisplayDate(r.date)}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--text-light)',
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                              {formatMinutes(r.minutes || 0)}
                            </span>
                            <span>{siteMap[r.siteId] || '미지정'}</span>
                            {r.reason && (
                              <span
                                style={{
                                  color: 'var(--text-muted)',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: 200,
                                }}
                                title={r.reason}
                              >
                                {r.reason}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-end',
                            gap: 8,
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              color: statusStyle.color,
                              background: statusStyle.bg || 'transparent',
                              fontWeight: 700,
                              fontSize: 12,
                              padding: statusStyle.bg ? '2px 8px' : 0,
                              borderRadius: 4,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {statusStyle.label}
                          </span>
                          {r.status === 'rejected' && r.rejectionReason && (
                            <span
                              title={r.rejectionReason}
                              style={{
                                fontSize: 12,
                                color: 'var(--danger)',
                                textAlign: 'right',
                                maxWidth: 220,
                                lineHeight: 1.4,
                                wordBreak: 'break-word',
                              }}
                            >
                              거절 사유: {r.rejectionReason}
                            </span>
                          )}
                          <div className="btn-group">
                            {isPending && (
                              <>
                                <button
                                  className="btn btn-sm btn-primary"
                                  disabled={rowBusy}
                                  onClick={() => approve(r)}
                                >
                                  승인
                                </button>
                                <button className="btn btn-sm btn-danger" disabled={rowBusy} onClick={() => reject(r)}>
                                  거절
                                </button>
                              </>
                            )}
                            <button className="btn btn-sm btn-outline" disabled={rowBusy} onClick={() => startEdit(r)}>
                              수정
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
