import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyLeaves, editLeaveWithBalance, cancelLeave } from '../../services/leaveService';
import { getEvents } from '../../services/eventService';
import { LEAVE_TYPE_LABELS, QUARTER_LEAVE_TYPES } from '../../utils/constants';
import { getBusinessDaysExcludingHolidays, buildHolidaySet, getToday } from '../../utils/dateUtils';
import LeaveTabs from '../../components/common/LeaveTabs';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/DialogProvider';

const STATUS_STYLES = {
  confirmed: { color: 'var(--success)', label: '승인됨' },
  pending: { color: 'var(--text-muted)', label: '대기중' },
  cancelled: { color: 'var(--text-muted)', label: '취소됨' },
  rejected: { color: 'var(--danger)', label: '반려됨' },
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
  const { confirm, alert, toast } = useDialog();
  const [leaves, setLeaves] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [holidayEvents, setHolidayEvents] = useState([]);

  useEffect(() => {
    getEvents()
      .then((evs) => setHolidayEvents(evs.filter((e) => e.type === 'holiday')))
      .catch(() => {});
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
    if (!(await confirm('이 연차를 취소하시겠습니까?'))) return;
    setBusy(true);
    try {
      await cancelLeave(l.id);
      await loadLeaves();
    } catch (err) {
      toast('취소 중 오류가 발생했습니다', 'error');
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
      await editLeaveWithBalance(
        l.id,
        userProfile.uid,
        {
          type: editForm.type,
          startDate: editForm.startDate,
          endDate,
          days: newDays,
          reason: editForm.reason,
        },
        l.days,
      );
      setEditingId(null);
      await loadLeaves();
    } catch (err) {
      toast('수정 중 오류가 발생했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="leave-history-page">
      <LeaveTabs />
      <h2>연차 사용 이력</h2>

      <div className="filters">
        <Select
          value={year}
          onChange={(v) => setYear(Number(v))}
          options={[2024, 2025, 2026, 2027].map((y) => ({ value: y, label: `${y}년` }))}
          ariaLabel="연도 선택"
        />
      </div>

      {loading ? (
        <Skeleton.Rows count={6} />
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
            const previewDays = calcDays(
              editForm.type,
              editForm.startDate,
              isSingleDayType(editForm.type) ? editForm.startDate : editForm.endDate,
              holidaySet,
            );

            return (
              <div key={l.id} className="card" style={{ marginBottom: 4 }}>
                <div className="card-body" style={{ padding: '9px 11px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>휴가 종류</label>
                        <Select
                          value={editForm.type}
                          onChange={(v) => handleTypeChange(v)}
                          options={Object.entries(LEAVE_TYPE_LABELS).map(([key, label]) => ({ value: key, label }))}
                          ariaLabel="휴가 종류 선택"
                        />
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
                              (기존 {l.days}일 → {previewDays > l.days ? '+' : ''}
                              {(previewDays - l.days).toFixed(2).replace(/\.?0+$/, '')}일)
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
                      <div className="btn-group" style={{ alignItems: 'stretch' }}>
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(l)}>
                          저장
                        </button>
                        <button className="btn btn-sm btn-outline" disabled={busy} onClick={cancelEdit}>
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 14,
                            marginBottom: 3,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={period}
                        >
                          {period}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-light)',
                            display: 'flex',
                            gap: 4,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <span style={{ fontWeight: 600, color: 'var(--primary)', flexShrink: 0 }}>{l.days}일</span>
                          <span style={{ flexShrink: 0 }} title={LEAVE_TYPE_LABELS[l.type] || l.type}>
                            {LEAVE_TYPE_LABELS[l.type] || l.type}
                          </span>
                          {l.reason && (
                            <span
                              style={{
                                color: 'var(--text-muted)',
                                minWidth: 0,
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={l.reason}
                            >
                              {l.reason}
                            </span>
                          )}
                          <span style={{ color: statusStyle.color, fontWeight: 500 }}>{statusStyle.label}</span>
                          {l.status === 'cancelled' && l.cancelReason && (
                            <span
                              style={{
                                color: 'var(--danger)',
                                fontWeight: 500,
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                wordBreak: 'break-word',
                                minWidth: 0,
                              }}
                              title={l.cancelReason}
                            >
                              · 취소 사유: {l.cancelReason}
                            </span>
                          )}
                        </div>
                      </div>
                      {isToday && l.status !== 'cancelled' && (
                        <div
                          className="btn-group"
                          style={{ flexShrink: 0, alignItems: 'center', flexDirection: 'row' }}
                        >
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ whiteSpace: 'nowrap', minWidth: 50, padding: '0 14px' }}
                            disabled={busy}
                            onClick={() => startEdit(l)}
                          >
                            수정
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            style={{ whiteSpace: 'nowrap', minWidth: 50, padding: '0 14px' }}
                            disabled={busy}
                            onClick={() => handleCancel(l)}
                          >
                            <Icon name="trash" className="btn-ic" />
                            취소
                          </button>
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
