import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getMyOvertimeRecords, deleteOvertimeRecord, updateOvertimeRecord } from '../../services/attendanceService';
import { getAllSites } from '../../services/siteService';
import { getMonthStart, getMonthEnd, formatMinutes, getDayName } from '../../utils/dateUtils';
import AttendanceTabs from '../../components/common/AttendanceTabs';

export default function AttendanceHistoryPage() {
  const { userProfile } = useAuth();
  const [records, setRecords] = useState([]);
  const [sites, setSites] = useState([]);
  const [siteMap, setSiteMap] = useState({});
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editSiteId, setEditSiteId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAllSites().then((s) => {
      const m = { etc: '기타' };
      s.forEach((site) => { m[site.id] = site.name; });
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
      setRecords(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('이 잔업 기록을 삭제하시겠습니까?')) return;
    try {
      await deleteOvertimeRecord(id);
      await loadRecords();
    } catch (err) {
      alert('삭제 실패: ' + err.message);
    }
  }

  function startEdit(r) {
    setEditingId(r.id);
    setEditSiteId(r.siteId || 'etc');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditSiteId('');
  }

  async function saveEdit(r) {
    if (editSiteId === (r.siteId || 'etc')) {
      cancelEdit();
      return;
    }
    setBusy(true);
    try {
      await updateOvertimeRecord(r.id, { siteId: editSiteId });
      setEditingId(null);
      await loadRecords();
    } catch (err) {
      alert('수정 실패: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  const totalMinutes = records.reduce((sum, r) => sum + (r.minutes || 0), 0);

  return (
    <div className="history-page">
      <AttendanceTabs />
      <h2>잔업 이력</h2>

      <div className="filters">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {[2024, 2025, 2026, 2027].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
      </div>

      {totalMinutes > 0 && (
        <div className="summary-bar">
          <span>총 잔업 <strong>{formatMinutes(totalMinutes)}</strong></span>
          <span>등록 건수 <strong>{records.length}건</strong></span>
        </div>
      )}

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : records.length === 0 ? (
        <p className="text-muted">해당 월의 기록이 없습니다.</p>
      ) : (
        <div className="record-list">
          {records.map((r) => {
            const isEditing = editingId === r.id;
            return (
              <div key={r.id} className="card" style={{ marginBottom: 8 }}>
                <div className="card-body" style={{ padding: '12px 16px' }}>
                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                          {r.date} ({getDayName(r.date)})
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--text-light)', marginLeft: 'auto' }}>
                          {formatMinutes(r.minutes)}
                        </span>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: 12, marginBottom: 4 }}>프로젝트</label>
                        <select
                          value={editSiteId}
                          onChange={(e) => setEditSiteId(e.target.value)}
                          autoFocus
                        >
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="btn-group">
                        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => saveEdit(r)}>저장</button>
                        <button className="btn btn-sm btn-outline" disabled={busy} onClick={cancelEdit}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>
                          {r.date}
                          <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)', marginLeft: 6 }}>
                            ({getDayName(r.date)})
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{formatMinutes(r.minutes)}</span>
                          <span>{siteMap[r.siteId] || '기타'}</span>
                          {r.reason && <span style={{ color: 'var(--text-muted)' }}>{r.reason}</span>}
                        </div>
                      </div>
                      <div className="btn-group" style={{ flexShrink: 0 }}>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => startEdit(r)}
                        >
                          수정
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                          onClick={() => handleDelete(r.id)}
                        >
                          삭제
                        </button>
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
