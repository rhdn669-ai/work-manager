import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { addOvertimeRecord } from '../../services/attendanceService';
import { getAllSites } from '../../services/siteService';
import { getToday } from '../../utils/dateUtils';
import AttendanceTabs from '../../components/common/AttendanceTabs';
import Select from '../../components/common/Select';

export default function AttendancePage() {
  const { userProfile, isAdmin } = useAuth();
  const [date, setDate] = useState(getToday());
  const [hours, setHours] = useState('');
  const [minutesInput, setMinutesInput] = useState('');
  const [reason, setReason] = useState('');
  const [siteId, setSiteId] = useState('');
  const [sites, setSites] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const dateInputRef = useRef(null);
  function openPicker(ref) {
    const el = ref.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        /* fallback */
      }
    }
    el.focus();
    el.click();
  }

  useEffect(() => {
    (async () => {
      try {
        const list = await getAllSites();
        // 마감된 프로젝트는 잔업 등록 선택지에서 제외
        setSites(list.filter((s) => s.status !== 'completed'));
      } catch (err) {
        console.error(err);
      }
    })();
  }, [userProfile]);

  async function handleSubmit(e) {
    e.preventDefault();
    const totalMinutes = parseInt(hours || 0) * 60 + parseInt(minutesInput || 0);
    if (totalMinutes <= 0) {
      setMessage('잔업 시간을 입력해주세요.');
      return;
    }
    if (!siteId) {
      setMessage('프로젝트를 선택해주세요.');
      return;
    }
    const todayStr = getToday();
    if (date > todayStr) {
      setMessage('미래 날짜의 잔업은 등록할 수 없습니다.');
      return;
    }

    const isPast = date < todayStr;
    setSubmitting(true);
    setMessage('');
    try {
      await addOvertimeRecord({
        userId: userProfile.uid,
        userName: userProfile.name,
        departmentId: userProfile.departmentId,
        date,
        minutes: totalMinutes,
        reason,
        siteId: siteId || '',
      });
      setHours('');
      setMinutesInput('');
      setReason('');
      setSiteId('');
      setDate(getToday());
      setMessage(isPast ? '지난 날짜 잔업이 등록되었습니다. 관리자 승인 후 확정됩니다.' : '잔업이 등록되었습니다!');
    } catch (err) {
      setMessage('등록 실패: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="attendance-page">
      <AttendanceTabs />
      <h2>잔업 등록</h2>

      <form onSubmit={handleSubmit} className="card">
        <div className="card-body">
          {message && <div className="alert alert-info">{message}</div>}
          <div className="form-group date-picker-cell"
            role="button"
            tabIndex={0}
            onClick={() => openPicker(dateInputRef)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPicker(dateInputRef);
              }
            }}
          >
            <label>날짜</label>
            <input
              ref={dateInputRef}
              type="date"
              value={date}
              max={getToday()}
              onChange={(e) => setDate(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              required
              style={{ maxWidth: '100%', minHeight: 36 }}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>시간</label>
              <input
                type="number"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="시간"
                min="0"
                max="12"
              />
            </div>
            <div className="form-group">
              <label>분</label>
              <input
                type="number"
                value={minutesInput}
                onChange={(e) => setMinutesInput(e.target.value)}
                placeholder="분"
                min="0"
                max="59"
              />
            </div>
          </div>
          <div className="form-group">
            <label>
              프로젝트 <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <Select
              value={siteId}
              onChange={(v) => setSiteId(v)}
              options={sites.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="프로젝트 선택"
              ariaLabel="프로젝트 선택"
            />
          </div>
          <div className="form-group">
            <label>사유</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="잔업 사유 (선택)"
            />
          </div>
          {date < getToday() && <div className="alert alert-warning">지난 날짜는 관리자 승인이 필요합니다.</div>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ minHeight: 40 }}>
            {submitting ? '등록 중...' : '잔업 등록'}
          </button>
        </div>
      </form>
    </div>
  );
}
