import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyLeaves, editLeaveWithBalance, cancelLeave } from '../../services/leaveService';
import { getEvents } from '../../services/eventService';
import { LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import { getBusinessDaysExcludingHolidays, buildHolidaySet, getToday } from '../../utils/dateUtils';
import LeaveTabs from '../../components/common/LeaveTabs';

const STATUS_STYLES = {
  confirmed: { color: 'var(--success)', label: '승인됨' },
  pending:   { color: 'var(--text-muted)', label: '대기중' },
  cancelled: { color: 'var(--text-muted)', label: '취소됨' },
  rejected:  { color: 'var(--danger)', label: '반려됨' },
};

function calcDays(type, startDate, endDate, holidaySet) {
  if (!type || !startDate) return 0;
  if (type === 'half_am' || type === 'half_pm') return 0.5;
  if (QUARTER_LEAVE_TYPES.includes(type)) return 0.25;
  if (!endDate) return 0;
  return getBusinessDaysExcludingHolidays(startDate, endDate, holidaySet);
}

function isSingleDayType(type) {
  return type === 'half_am' || type === 'half_pm' || QUARTER_LEAVE_TYPES.includes(type);
}

export default function LeaveHistoryPage() {
  const { userProfile } = useAuth();
  const [leaves, setLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [holidayEvents, setHolidayEvents] = useState([]);

  useEffect(() => {
    getEvents().then((evs) => setHolidayEvents(evs.filter((e) => e.type === 'holiday'))).catch(() => {});
  }, []);
  const holidaySet = useMemo(() => buildHolidaySet(holidayEvents), [holidayEvents]);

  const today = getToday();

  useEffect(() => {
    if (userProfile) loadLeaves();
  }, [userProfile, year]);

  async function loadLeaves() {
    setLoading(true);
    try {
      const data = await getMyLeaves(userProfile.uid, year);
      setLeaves(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
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
    if (!confirm('이 연차를 취소하시겠습니까?')) return;
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
      await editLeaveWithBalance(l.id, userProfile.uid, {
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
    <div className="leave-history-page">
      <LeaveTabs />
      <h2>연차 사용 이력</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : leaves.length === 0 ? (
        <p className="text-muted">해당 연도의 기록이 없습니다.</p>
      ) : (
        <div className="record-list">
          {leaves.map((l) => {
            const isEditing = editingId === l.id;
            // 시작일이 오늘이거나 미래면 수정/취소 가능 (지난 연차는 잠금)
            const isToday = l.startDate >= today;
            const statusStyle = STATUS_STYLES[l.status] || {};
            const period = l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`;
            const previewDays = calcDays(editForm.type, editForm.startDate,
              isSingleDayType(editForm.type) ? editForm.startDate : editForm.endDate, holidaySet);

            return (
              <div key={l.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>휴가 종류</label>
                        <select
                          value={editForm.type}
                          onChange={(e) => handleTypeChange(e.target.value)}
                        >
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
                        <button className="btn btn-sm btn-outline" disabled={busy} onClick={cancelEdit}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>
                          {period}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{l.days}일</span>
                          <span>{LEAVE_TYPE_LABELS[l.type] || l.type}</span>
                          {l.reason && <span style={{ color: 'var(--text-muted)' }}>{l.reason}</span>}
                          <span style={{ color: statusStyle.color, fontWeight: 500 }}>{statusStyle.label}</span>
                          {l.status === 'cancelled' && l.cancelReason && (
                            <span style={{ color: 'var(--danger)', fontWeight: 500 }}>· 취소 사유: {l.cancelReason}</span>
                          )}
                        </div>
                      </div>
                      {isToday && l.status !== 'cancelled' && (
                        <div className="btn-group" style={{ flexShrink: 0 }}>
                          <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => startEdit(l)}>수정</button>
                          <button
                            className="btn btn-sm btn-danger-outline"
                            disabled={busy}
                            onClick={() => handleCancel(l)}
                          >취소</button>
                        </div>
                      )}
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
