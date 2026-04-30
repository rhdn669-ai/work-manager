import { useEffect, useMemo, useState } from 'react';
import { getUsers } from '../../services/userService';
import { getMileagesByMonth, saveMileage, deleteMileage, deleteMileageById } from '../../services/vehicleMileageService';
import Modal from '../../components/common/Modal';

// 관리자 운행일지 — 차량 운행자 지정자의 월별 누적 키로수 / 운행 km 모니터링
// /admin/vehicle-log

function fmt(n) {
  if (n == null || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString();
}
// 전월 대비 운행 km 차이 — +/- 부호 + 천단위 콤마, null이면 '-'
function fmtDelta(d) {
  if (d == null || isNaN(Number(d))) return '-';
  const n = Number(d);
  if (n === 0) return '±0';
  return (n > 0 ? '+' : '') + n.toLocaleString();
}
function fmtDate(ts) {
  if (!ts) return '-';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
    if (isNaN(d.getTime())) return '-';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return '-'; }
}

export default function VehicleLogPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [prevRecords, setPrevRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  // 수정/삭제 모달 상태
  const [editTarget, setEditTarget] = useState(null); // row 객체
  const [editForm, setEditForm] = useState({ odometer: '', prevOdometer: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function reloadRecords() {
    const prevY = month === 1 ? year - 1 : year;
    const prevM = month === 1 ? 12 : month - 1;
    const [recs, prevRecs] = await Promise.all([
      getMileagesByMonth(year, month),
      getMileagesByMonth(prevY, prevM),
    ]);
    setRecords(recs);
    setPrevRecords(prevRecs);
  }

  function openEdit(r) {
    setEditTarget(r);
    setEditForm({
      odometer: r.odometer ? Number(r.odometer).toLocaleString() : '',
      prevOdometer: r.prevOdometer ? Number(r.prevOdometer).toLocaleString() : '',
    });
    setEditError('');
  }

  async function handleSaveEdit() {
    if (!editTarget) return;
    const odo = Number(String(editForm.odometer).replace(/[^\d]/g, '')) || 0;
    const prev = Number(String(editForm.prevOdometer).replace(/[^\d]/g, '')) || 0;
    if (odo <= 0) {
      setEditError('이번월 누적 키로수를 입력해주세요.');
      return;
    }
    if (prev > 0 && odo < prev) {
      setEditError('이번월 누적은 이전월 이상이어야 합니다.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      await saveMileage(editTarget.uid, year, month, {
        userName: editTarget.name,
        plate: editTarget.plate,
        odometer: odo,
        prevOdometer: prev,
      });
      await reloadRecords();
      setEditTarget(null);
    } catch (err) {
      setEditError(err.message || '저장 실패');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // 두 경로 시도 — recordId가 있으면 그 id로 직접 삭제(legacy/auto-id 안전), 없으면 deterministic docId
      if (deleteTarget.recordId) {
        await deleteMileageById(deleteTarget.recordId);
      } else {
        await deleteMileage(deleteTarget.uid, year, month);
      }
      // 즉시 로컬에서 제거 — 사용자에게 빠른 피드백
      setRecords((prev) => prev.filter((r) => r.uid !== deleteTarget.uid));
      // 백그라운드에서 서버 상태로 동기화 (다른 기기 변경 반영용)
      reloadRecords().catch(() => { /* 다음 새로고침 때 재동기화 */ });
      setDeleteTarget(null);
    } catch (err) {
      alert('삭제 실패: ' + (err.message || '알 수 없는 오류'));
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const prevY = month === 1 ? year - 1 : year;
    const prevM = month === 1 ? 12 : month - 1;
    Promise.all([
      getUsers(),
      getMileagesByMonth(year, month),
      getMileagesByMonth(prevY, prevM),
    ])
      .then(([u, recs, prevRecs]) => {
        if (cancelled) return;
        setUsers(u);
        setRecords(recs);
        setPrevRecords(prevRecs);
      })
      .catch((err) => {
        console.error('운행일지 로드 실패:', err);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  const drivers = useMemo(() => users.filter((u) => u.usesVehicle), [users]);
  const recordMap = useMemo(() => {
    const m = {};
    records.forEach((r) => { m[r.uid] = r; });
    return m;
  }, [records]);
  const prevRecordMap = useMemo(() => {
    const m = {};
    prevRecords.forEach((r) => { m[r.uid] = r; });
    return m;
  }, [prevRecords]);

  const rows = useMemo(() => {
    const list = drivers.map((u) => {
      const rec = recordMap[u.uid];
      const prevRec = prevRecordMap[u.uid];
      const drivenKm = rec?.drivenKm ?? null;
      const prevDrivenKm = prevRec?.drivenKm ?? null;
      const deltaVsPrev = (drivenKm != null && prevDrivenKm != null)
        ? drivenKm - prevDrivenKm
        : null;
      return {
        uid: u.uid,
        recordId: rec?.id || null, // Firestore 문서 id — 삭제·수정 시 실제 ID 사용
        name: u.name,
        plate: u.vehiclePlate || rec?.plate || '',
        odometer: rec?.odometer ?? null,
        prevOdometer: rec?.prevOdometer ?? null,
        drivenKm,
        prevDrivenKm,
        deltaVsPrev,
        recordedAt: rec?.recordedAt || null,
        hasInput: !!rec,
      };
    });
    list.sort((a, b) => {
      if (a.hasInput !== b.hasInput) return a.hasInput ? 1 : -1; // 미입력자 위
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
    return list;
  }, [drivers, recordMap, prevRecordMap]);

  const filteredRows = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(kw)
      || (r.plate || '').toLowerCase().includes(kw),
    );
  }, [rows, search]);

  const missingCount = rows.filter((r) => !r.hasInput).length;
  const totalDrivenKm = rows.reduce((sum, r) => sum + (Number(r.drivenKm) || 0), 0);

  const yearOptions = [];
  const curY = now.getFullYear();
  for (let y = curY - 3; y <= curY + 1; y += 1) yearOptions.push(y);

  return (
    <div className="vehicle-log-page">
      <div className="page-header">
        <h2>운행일지</h2>
      </div>

      <div className="vehicle-log-toolbar">
        <div className="vehicle-log-filters">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·차량번호 검색"
            className="vehicle-log-search"
          />
        </div>
        <div className="vehicle-log-summary">
          <span className="vehicle-log-summary-item">
            지정 운행자 <strong>{drivers.length}</strong>명
          </span>
          <span className={`vehicle-log-summary-item ${missingCount > 0 ? 'is-warn' : 'is-ok'}`}>
            미입력 <strong>{missingCount}</strong>명
          </span>
          <span className="vehicle-log-summary-item">
            합계 운행 <strong>{fmt(totalDrivenKm)}</strong> km
          </span>
        </div>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : drivers.length === 0 ? (
        <div className="card vehicle-log-empty">
          <p>차량 운행자로 지정된 직원이 없습니다.</p>
          <p className="text-muted text-sm">직원 관리에서 사용자 편집 → "차량 운행자 지정"을 켜주세요.</p>
        </div>
      ) : (
        <>
          <div className="vehicle-log-table-wrap">
            <table className="table vehicle-log-table">
              <thead>
                <tr>
                  <th>운행자</th>
                  <th>차량번호</th>
                  <th className="num-col">이전월 누적</th>
                  <th className="num-col">이번월 누적</th>
                  <th className="num-col">운행 km</th>
                  <th className="num-col">전월 대비</th>
                  <th>입력일</th>
                  <th style={{ width: 160 }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const dColor = r.deltaVsPrev == null
                    ? '#999'
                    : r.deltaVsPrev > 0
                      ? '#c0392b'
                      : r.deltaVsPrev < 0
                        ? '#2e7d32'
                        : '#666';
                  return (
                    <tr key={r.uid} className={r.hasInput ? '' : 'is-missing'}>
                      <td><strong>{r.name}</strong></td>
                      <td>{r.plate || <span className="text-muted">-</span>}</td>
                      <td className="num-col">{fmt(r.prevOdometer)}</td>
                      <td className="num-col">{r.hasInput ? <strong>{fmt(r.odometer)}</strong> : <span className="vehicle-log-missing-tag">미입력</span>}</td>
                      <td className="num-col">{r.hasInput ? fmt(r.drivenKm) : '-'}</td>
                      <td className="num-col" style={{ color: dColor, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDelta(r.deltaVsPrev)}
                      </td>
                      <td>{fmtDate(r.recordedAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => openEdit(r)}
                          >
                            {r.hasInput ? '수정' : '입력'}
                          </button>
                          {r.hasInput && (
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => setDeleteTarget(r)}
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 모바일 카드 뷰 */}
          <div className="vehicle-log-cards">
            {filteredRows.map((r) => (
              <div key={r.uid} className={`vehicle-log-card ${r.hasInput ? '' : 'is-missing'}`}>
                <div className="vlc-head">
                  <div className="vlc-name">
                    <strong>{r.name}</strong>
                    {r.plate && <span className="vlc-plate">{r.plate}</span>}
                  </div>
                  {r.hasInput
                    ? <span className="vlc-badge vlc-badge-ok">입력완료</span>
                    : <span className="vlc-badge vlc-badge-missing">미입력</span>}
                </div>
                <div className="vlc-grid">
                  <div className="vlc-cell">
                    <span className="vlc-label">이전월</span>
                    <span className="vlc-value">{fmt(r.prevOdometer)} km</span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">이번월</span>
                    <span className="vlc-value vlc-strong">
                      {r.hasInput ? `${fmt(r.odometer)} km` : '-'}
                    </span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">운행</span>
                    <span className="vlc-value vlc-driven">
                      {r.hasInput ? `${fmt(r.drivenKm)} km` : '-'}
                    </span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">전월 대비</span>
                    <span
                      className="vlc-value"
                      style={{
                        color: r.deltaVsPrev == null
                          ? '#999'
                          : r.deltaVsPrev > 0
                            ? '#c0392b'
                            : r.deltaVsPrev < 0
                              ? '#2e7d32'
                              : '#666',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {r.deltaVsPrev == null ? '-' : `${fmtDelta(r.deltaVsPrev)} km`}
                    </span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">입력일</span>
                    <span className="vlc-value">{fmtDate(r.recordedAt)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ flex: 1, minWidth: 80 }}
                    onClick={() => openEdit(r)}
                  >
                    {r.hasInput ? '수정' : '입력'}
                  </button>
                  {r.hasInput && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      style={{ flex: 1, minWidth: 80 }}
                      onClick={() => setDeleteTarget(r)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 수정/입력 모달 */}
      <Modal
        isOpen={!!editTarget}
        onClose={() => !editSaving && setEditTarget(null)}
        title={editTarget ? `${editTarget.name} — ${year}년 ${month}월 운행 키로수` : ''}
      >
        {editTarget && (() => {
          const odoNum = Number(String(editForm.odometer).replace(/[^\d]/g, '')) || 0;
          const prevNum = Number(String(editForm.prevOdometer).replace(/[^\d]/g, '')) || 0;
          const driven = odoNum >= prevNum ? odoNum - prevNum : 0;
          return (
            <div>
              <div className="form-group">
                <label>이전월 누적 (km)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editForm.prevOdometer}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '');
                    setEditForm((f) => ({ ...f, prevOdometer: raw ? Number(raw).toLocaleString() : '' }));
                    setEditError('');
                  }}
                  placeholder="예: 44,750"
                  disabled={editSaving}
                />
              </div>
              <div className="form-group">
                <label>이번월 누적 (km)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editForm.odometer}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '');
                    setEditForm((f) => ({ ...f, odometer: raw ? Number(raw).toLocaleString() : '' }));
                    setEditError('');
                  }}
                  placeholder="예: 45,200"
                  disabled={editSaving}
                  autoFocus
                />
              </div>
              {odoNum > 0 && (
                <div style={{
                  background: '#f3f6fa', borderRadius: 6, padding: '10px 12px',
                  fontSize: 13, color: '#444', marginBottom: 12,
                }}>
                  운행 거리: <strong>{fmt(driven)}</strong> km
                </div>
              )}
              {editError && (
                <div style={{ color: '#c00', fontSize: 13, marginBottom: 12 }}>{editError}</div>
              )}
              <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditTarget(null)}
                  disabled={editSaving}
                >
                  취소
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSaveEdit}
                  disabled={editSaving || !odoNum}
                >
                  {editSaving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 삭제 확인 모달 */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => !deleting && setDeleteTarget(null)}
        title="운행 기록 삭제"
      >
        {deleteTarget && (
          <div>
            <p>
              <strong>{deleteTarget.name}</strong>님의 <strong>{year}년 {month}월</strong> 운행 기록을 삭제합니다.
            </p>
            <p style={{ color: '#666', fontSize: 13 }}>
              누적 {fmt(deleteTarget.odometer)} km · 운행 {fmt(deleteTarget.drivenKm)} km
            </p>
            <p style={{ color: '#c00', fontSize: 13 }}>
              되돌릴 수 없습니다. 사용자가 다시 입력하지 않으면 다음 달 "이전월 누적"에도 영향을 줄 수 있어요.
            </p>
            <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
