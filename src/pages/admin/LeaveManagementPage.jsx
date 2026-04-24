import { useState, useEffect, useMemo } from 'react';
import { getAllLeavesByYear } from '../../services/leaveService';
import { getUsers } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { LEAVE_TYPE_LABELS } from '../../utils/constants';

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

export default function LeaveManagementPage() {
  const [leaves, setLeaves] = useState([]);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(0);
  const [status, setStatus] = useState('all');
  const [deptId, setDeptId] = useState('all');
  const [userId, setUserId] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getUsers(), getDepartments()])
      .then(([u, d]) => { setUsers(u); setDepartments(d); })
      .catch((err) => console.error(err));
  }, []);

  useEffect(() => { loadLeaves(); }, [year]);

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
            const u = userMap[l.userId];
            const statusStyle = STATUS_STYLES[l.status] || {};
            const period = l.startDate === l.endDate ? l.startDate : `${l.startDate} ~ ${l.endDate}`;
            const userName = u ? u.name : '(알 수 없음)';
            const deptName = u && u.departmentId ? deptMap[u.departmentId] || '' : '';
            return (
              <div key={l.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '12px 16px' }}>
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
                    <span style={{ color: statusStyle.color, fontWeight: 600, fontSize: 13, flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {statusStyle.label}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
