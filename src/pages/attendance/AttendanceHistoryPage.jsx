import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth';
import {
  getMyOvertimeRecords,
  deleteOvertimeRecord,
  updateOvertimeRecord,
  OVERTIME_MULTIPLIER,
} from '../../services/attendanceService';
import { getAllSites } from '../../services/siteService';
import {
  getMonthStart,
  getMonthEnd,
  formatMinutes,
  getDayName,
  getToday,
  formatDisplayDate,
} from '../../utils/dateUtils';
import AttendanceTabs from '../../components/common/AttendanceTabs';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';

export default function AttendanceHistoryPage() {
  const { userProfile } = useAuth();
  const { confirm, alert, toast } = useDialog();
  const [records, setRecords] = useState([]);
  const [sites, setSites] = useState([]);
  const [siteMap, setSiteMap] = useState({});
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [busy, setBusy] = useState(false);

  const today = getToday();

  useEffect(() => {
    getAllSites().then((s) => {
      const m = { etc: '기타' };
      s.forEach((site) => {
        m[site.id] = site.name;
      });
      setSiteMap(m);
      setSites([...s, { id: 'etc', name: '기타' }]);
    });
  }, []);

  useEffect(() => {
    if (userProfile) loadRecords();
  }, [userProfile, year, month]);

  async function loadRecords() {
    setLoading(true);
    try {
      const start = getMonthStart(year, month);
      const end = getMonthEnd(year, month);
      const data = await getMyOvertimeRecords(userProfile.uid, start, end);
      // 거절된 항목도 표시 — 당사자가 거절 사유 확인 가능하도록
      setRecords(data.filter((r) => r.status === 'approved' || r.status === 'pending' || r.status === 'rejected'));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!(await confirm('이 잔업 기록을 삭제하시겠습니까?'))) return;
    try {
      await deleteOvertimeRecord(id, userProfile?.name || '');
      await loadRecords();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function startEdit(r) {
    setEditingId(r.id);
    setEditForm({
      hours: String(Math.floor((r.minutes || 0) / 60)),
      mins: String((r.minutes || 0) % 60),
      siteId: r.siteId || 'etc',
      reason: r.reason || '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({});
  }

  async function saveEdit(r) {
    const totalMinutes = parseInt(editForm.hours || 0) * 60 + parseInt(editForm.mins || 0);
    if (totalMinutes <= 0) {
      alert('잔업 시간을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await updateOvertimeRecord(r.id, {
        minutes: totalMinutes,
        siteId: editForm.siteId,
        reason: editForm.reason,
      });
      setEditingId(null);
      await loadRecords();
    } catch {
      toast('수정 중 오류가 발생했습니다', 'error');
    } finally {
      setBusy(false);
    }
  }

  const approvedRecords = records.filter((r) => r.status === 'approved');
  const totalMinutes = approvedRecords.reduce((sum, r) => sum + (r.minutes || 0), 0);
  const hourlyRate = Number(userProfile?.hourlyRate) || 0;
  const totalAmount = Math.round((totalMinutes / 60) * hourlyRate * OVERTIME_MULTIPLIER);

  return (
    <div className="history-page">
      <AttendanceTabs />
      <h2>잔업 이력</h2>

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

      {records.length > 0 && (
        <div className="overtime-summary-card">
          <div className="overtime-summary-head">
            <span className="overtime-summary-title">
              {year}년 {month}월 잔업 집계
            </span>
            <span className="overtime-summary-meta">
              승인 {approvedRecords.length}건
              {records.length > approvedRecords.length && ` · 대기 ${records.length - approvedRecords.length}건`}
            </span>
          </div>
          <div className="overtime-summary-row" style={{ flexWrap: 'wrap' }}>
            <div className="overtime-summary-cell" style={{ flex: '1 1 120px', minWidth: 0 }}>
              <span className="overtime-summary-label">승인 잔업</span>
              <strong className="overtime-summary-value">{formatMinutes(totalMinutes)}</strong>
            </div>
            {hourlyRate > 0 && (
              <div className="overtime-summary-cell" style={{ flex: '1 1 120px', minWidth: 0 }}>
                <span className="overtime-summary-label">예상 금액</span>
                <strong className="overtime-summary-value overtime-summary-amount">
                  {totalAmount.toLocaleString()}원
                </strong>
              </div>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <Skeleton.Rows count={6} />
      ) : records.length === 0 ? (
        <p className="text-muted">해당 월의 기록이 없습니다.</p>
      ) : (
        <div className="record-list">
          {records.map((r) => {
            const isEditing = editingId === r.id;
            const isToday = r.date === today;
            return (
              <div key={r.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: 'clamp(8px, 2vw, 12px) clamp(10px, 3vw, 16px)' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {formatDisplayDate(r.date)} ({getDayName(r.date)})
                      </div>
                      <div className="form-row" style={{ gap: 8 }}>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>
                          <label style={{ fontSize: 12 }}>시간</label>
                          <input
                            aria-label="시간"
                            type="number"
                            min={0}
                            max={12}
                            value={editForm.hours}
                            onChange={(e) => setEditForm({ ...editForm, hours: e.target.value })}
                            placeholder="시간"
                            style={{ width: '100%' }}
                          />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>
                          <label style={{ fontSize: 12 }}>분</label>
                          <input
                            aria-label="분"
                            type="number"
                            min={0}
                            max={59}
                            value={editForm.mins}
                            onChange={(e) => setEditForm({ ...editForm, mins: e.target.value })}
                            placeholder="분"
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12 }}>프로젝트</label>
                        <Select
                          value={editForm.siteId}
                          onChange={(v) => setEditForm({ ...editForm, siteId: v })}
                          options={sites.map((s) => ({ value: s.id, label: s.name }))}
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
                          placeholder="잔업 사유 (선택)"
                        />
                      </div>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(r)}>
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
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span style={{ whiteSpace: 'nowrap' }}>{formatDisplayDate(r.date)}</span>
                          <span
                            style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}
                          >
                            ({getDayName(r.date)})
                          </span>
                          {r.status === 'pending' && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: 'var(--accent)',
                                background: 'transparent',
                                border: '1px solid var(--accent)',
                                borderRadius: 4,
                                padding: '1px 6px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              승인 대기
                            </span>
                          )}
                          {r.status === 'rejected' && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                color: 'var(--danger)',
                                background: 'var(--danger-tint)',
                                border: '1px solid var(--danger)',
                                borderRadius: 4,
                                padding: '1px 6px',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              거절됨
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--text-light)',
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <span style={{ fontWeight: 600, color: 'var(--primary)', flexShrink: 0 }}>
                            {formatMinutes(r.minutes)}
                          </span>
                          <span
                            style={{
                              minWidth: 0,
                              maxWidth: '70px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flexShrink: 1,
                            }}
                            title={siteMap[r.siteId] || '기타'}
                          >
                            {siteMap[r.siteId] || '기타'}
                          </span>
                          {r.reason && (
                            <span
                              style={{
                                color: 'var(--text-muted)',
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                flexShrink: 2,
                              }}
                              title={r.reason}
                            >
                              {r.reason}
                            </span>
                          )}
                        </div>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <div
                            style={{
                              fontSize: 12,
                              color: 'var(--danger)',
                              marginTop: 3,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={r.rejectionReason}
                          >
                            거절 사유: {r.rejectionReason}
                          </div>
                        )}
                      </div>
                      {(r.status === 'pending' || isToday) && (
                        <div
                          className="btn-group"
                          style={{ flexShrink: 0, alignItems: 'center', flexDirection: 'row' }}
                        >
                          <button
                            className="btn btn-sm btn-outline"
                            style={{ flex: 1, whiteSpace: 'nowrap' }}
                            onClick={() => startEdit(r)}
                          >
                            수정
                          </button>
                          <button
                            className="btn btn-sm btn-danger"
                            style={{ flex: 1, whiteSpace: 'nowrap' }}
                            onClick={() => handleDelete(r.id)}
                          >
                            <Icon name="trash" className="btn-ic" />
                            삭제
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
