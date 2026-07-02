import { useEffect, useMemo, useState } from 'react';
import { getUsers } from '../../services/userService';
import {
  getMileagesByMonth,
  saveMileage,
} from '../../services/vehicleMileageService';
import { trashGeneric } from '../../services/trashService';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/DialogProvider';

// 관리자 운행일지 — 차량 운행자 지정자의 월별 누적 키로수 / 운행 km 모니터링
// /admin/vehicle-log

function fmt(n) {
  if (n == null || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString();
}
function fmtMoney(n) {
  if (n == null || isNaN(Number(n)) || Number(n) === 0) return '-';
  return Number(n).toLocaleString() + '원';
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
  } catch {
    return '-';
  }
}

function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return vw;
}

export default function VehicleLogPage() {
  const { toast } = useDialog();
  const { userProfile } = useAuth();
  const now = new Date();
  const vw = useViewportWidth();
  const isXSmall = vw <= 360;
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
  const [trashOpen, setTrashOpen] = useState(false);

  async function reloadRecords() {
    const prevY = month === 1 ? year - 1 : year;
    const prevM = month === 1 ? 12 : month - 1;
    const [recs, prevRecs] = await Promise.all([getMileagesByMonth(year, month), getMileagesByMonth(prevY, prevM)]);
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
      // recordId(Firestore 문서 id)가 있는 경우만 trashGeneric 사용
      // deterministic docId(`uid_YYYY-MM`)도 Firestore 문서 id이므로 recordId로 처리
      const targetId = deleteTarget.recordId
        || `${deleteTarget.uid}_${String(year)}-${String(month).padStart(2, '0')}`;
      await trashGeneric(
        'vehicleMileages',
        targetId,
        {
          title: `${deleteTarget.name} ${year}년 ${month}월`,
          summary: `누적 ${deleteTarget.odometer ?? '-'} km · 운행 ${deleteTarget.drivenKm ?? '-'} km`,
        },
        userProfile?.name || '',
      );
      // 즉시 로컬에서 제거 — 사용자에게 빠른 피드백
      setRecords((prev) => prev.filter((r) => r.uid !== deleteTarget.uid));
      // 백그라운드에서 서버 상태로 동기화 (다른 기기 변경 반영용)
      reloadRecords().catch(() => {
        /* 다음 새로고침 때 재동기화 */
      });
      setDeleteTarget(null);
    } catch (err) {
      toast('삭제 중 오류가 발생했습니다', 'error');
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const prevY = month === 1 ? year - 1 : year;
    const prevM = month === 1 ? 12 : month - 1;
    Promise.all([getUsers(), getMileagesByMonth(year, month), getMileagesByMonth(prevY, prevM)])
      .then(([u, recs, prevRecs]) => {
        if (cancelled) return;
        setUsers(u);
        setRecords(recs);
        setPrevRecords(prevRecs);
      })
      .catch((err) => {
        console.error('운행일지 로드 실패:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const drivers = useMemo(() => users.filter((u) => u.usesVehicle), [users]);
  const recordMap = useMemo(() => {
    const m = {};
    records.forEach((r) => {
      m[r.uid] = r;
    });
    return m;
  }, [records]);
  const prevRecordMap = useMemo(() => {
    const m = {};
    prevRecords.forEach((r) => {
      m[r.uid] = r;
    });
    return m;
  }, [prevRecords]);

  const rows = useMemo(() => {
    const list = drivers.map((u) => {
      const rec = recordMap[u.uid];
      const prevRec = prevRecordMap[u.uid];
      const drivenKm = rec?.drivenKm ?? null;
      const prevDrivenKm = prevRec?.drivenKm ?? null;
      const deltaVsPrev = drivenKm != null && prevDrivenKm != null ? drivenKm - prevDrivenKm : null;
      return {
        uid: u.uid,
        recordId: rec?.id || null, // Firestore 문서 id — 삭제·수정 시 실제 ID 사용
        name: u.name,
        plate: u.vehiclePlate || rec?.plate || '',
        monthlyCost: Number(u.vehicleMonthlyCost) || 0,
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
    return rows.filter((r) => (r.name || '').toLowerCase().includes(kw) || (r.plate || '').toLowerCase().includes(kw));
  }, [rows, search]);

  const missingCount = rows.filter((r) => !r.hasInput).length;
  const totalDrivenKm = rows.reduce((sum, r) => sum + (Number(r.drivenKm) || 0), 0);
  const totalMonthlyCost = rows.reduce((sum, r) => sum + (Number(r.monthlyCost) || 0), 0);

  const yearOptions = [];
  const curY = now.getFullYear();
  for (let y = curY - 3; y <= curY + 1; y += 1) yearOptions.push(y);

  return (
    <div className="vehicle-log-page">
      <div className="page-header">
        <h2>운행일지</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />휴지통
          </button>
        </div>
      </div>

      <div className="vehicle-log-toolbar vehicle-log-toolbar-responsive">
        <div className="vehicle-log-filters">
          <Select
            value={year}
            onChange={(v) => setYear(Number(v))}
            options={yearOptions.map((y) => ({ value: y, label: `${y}년` }))}
            ariaLabel="연도 선택"
          />
          <Select
            value={month}
            onChange={(v) => setMonth(Number(v))}
            options={Array.from({ length: 12 }, (_, i) => i + 1).map((m) => ({ value: m, label: `${m}월` }))}
            ariaLabel="월 선택"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름·차량번호 검색"
            className="vehicle-log-search vehicle-log-search-responsive"
          />
        </div>
        <div className="vehicle-log-summary" style={{ display: 'flex', flexWrap: 'wrap', gap: isXSmall ? 4 : 'var(--space-2, 8px)' }}>
          <span className="vehicle-log-summary-item" style={{ padding: isXSmall ? '4px 8px' : 'var(--space-1, 4px) var(--space-3, 11px)', flex: '1 1 auto', fontSize: isXSmall ? 11 : undefined, minHeight: 32 }}>
            지정 운행자 <strong>{drivers.length}</strong>명
          </span>
          <span className={`vehicle-log-summary-item ${missingCount > 0 ? 'is-warn' : 'is-ok'}`} style={{ padding: isXSmall ? '4px 8px' : 'var(--space-1, 4px) var(--space-3, 11px)', flex: '1 1 auto', fontSize: isXSmall ? 11 : undefined, minHeight: 32 }}>
            미입력 <strong>{missingCount}</strong>명
          </span>
          <span className="vehicle-log-summary-item vehicle-log-summary-secondary" style={{ padding: isXSmall ? '4px 8px' : 'var(--space-1, 4px) var(--space-3, 11px)', flex: '1 1 auto', fontSize: isXSmall ? 11 : undefined, minHeight: 32 }}>
            합계 운행 <strong>{fmt(totalDrivenKm)}</strong> km
          </span>
          {totalMonthlyCost > 0 && (
            <span className="vehicle-log-summary-item vehicle-log-summary-secondary" style={{ padding: isXSmall ? '4px 8px' : 'var(--space-1, 4px) var(--space-3, 11px)', flex: '1 1 auto', fontSize: isXSmall ? 11 : undefined, minHeight: 32 }}>
              합계 월 금액 <strong>{fmt(totalMonthlyCost)}</strong> 원
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <Skeleton.Rows count={6} />
      ) : drivers.length === 0 ? (
        <div className="card vehicle-log-empty">
          <p>차량 운행자로 지정된 직원이 없습니다.</p>
          <p className="text-muted text-sm">직원 관리에서 사용자 편집 → "차량 운행자 지정"을 켜주세요.</p>
        </div>
      ) : (
        <>
          <div className="vehicle-log-table-wrap table-scroll-x">
            <table className="table vehicle-log-table">
              <thead>
                <tr>
                  <th style={{ padding: '7px 6px', height: 36 }}>운행자</th>
                  <th style={{ padding: '7px 6px', height: 36 }}>차량번호</th>
                  <th className="num-col" style={{ textAlign: 'right', padding: '7px 6px', height: 36 }}>월 금액</th>
                  <th className="num-col" title="이전월 누적" style={{ textAlign: 'right', padding: '7px 6px', height: 36 }}>이전월 누적</th>
                  <th className="num-col" style={{ textAlign: 'right', padding: '7px 6px', height: 36 }}>이번월 누적</th>
                  <th className="num-col" style={{ textAlign: 'right', padding: '7px 6px', height: 36 }}>운행 km</th>
                  <th className="num-col" title="전월 대비" style={{ textAlign: 'right', padding: '7px 6px', height: 36 }}>전월 대비</th>
                  <th title="입력일" style={{ padding: '7px 6px', height: 36 }}>입력일</th>
                  <th className="col-action" style={{ width: 160, padding: '7px 6px', height: 36 }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const dColor =
                    r.deltaVsPrev == null
                      ? 'var(--text-muted)'
                      : r.deltaVsPrev > 0
                        ? 'var(--danger)'
                        : r.deltaVsPrev < 0
                          ? 'var(--success)'
                          : 'var(--text-muted)';
                  return (
                    <tr key={r.uid} className={r.hasInput ? '' : 'is-missing'} style={{ height: 36 }}>
                      <td title={r.name} style={{ whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word', padding: '6px 6px', height: 36 }}>
                        <strong>{r.name}</strong>
                      </td>
                      <td title={r.plate || ''} style={{ whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word', padding: '6px 6px', height: 36 }}>{r.plate || <span className="text-muted">-</span>}</td>
                      <td className="num-col" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 6px', height: 36 }}>
                        {r.monthlyCost > 0 ? fmtMoney(r.monthlyCost) : <span className="text-muted">-</span>}
                      </td>
                      <td className="num-col" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 6px', height: 36 }}>{fmt(r.prevOdometer)}</td>
                      <td className="num-col" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 6px', height: 36 }}>
                        {r.hasInput ? (
                          <strong>{fmt(r.odometer)}</strong>
                        ) : (
                          <span className="vehicle-log-missing-tag">미입력</span>
                        )}
                      </td>
                      <td className="num-col" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 6px', height: 36 }}>{r.hasInput ? fmt(r.drivenKm) : '-'}</td>
                      <td className="num-col" style={{ textAlign: 'right', color: dColor, fontVariantNumeric: 'tabular-nums', padding: '6px 6px', height: 36 }}>
                        {fmtDelta(r.deltaVsPrev)}
                      </td>
                      <td style={{ padding: '6px 6px', height: 36 }}>{fmtDate(r.recordedAt)}</td>
                      <td className="col-action">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(r)}>
                            {r.hasInput ? '수정' : '입력'}
                          </button>
                          {r.hasInput && (
                            <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleteTarget(r)}>
                              <Icon name="trash" className="btn-ic" />삭제
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
                  <div className="vlc-name" title={`${r.name}${r.plate ? ` · ${r.plate}` : ''}`}>
                    <strong>{r.name}</strong>
                    {r.plate && (
                      <span className="vlc-plate" title={r.plate}>
                        {r.plate}
                      </span>
                    )}
                  </div>
                  {r.hasInput ? (
                    <span className="vlc-badge vlc-badge-ok">입력완료</span>
                  ) : (
                    <span className="vlc-badge vlc-badge-missing">미입력</span>
                  )}
                </div>
                <div className="vlc-grid">
                  {r.monthlyCost > 0 && (
                    <div className="vlc-cell vlc-cell-cost">
                      <span className="vlc-label">월 금액</span>
                      <span className="vlc-value vlc-cost">{fmtMoney(r.monthlyCost)}</span>
                    </div>
                  )}
                  <div className="vlc-cell">
                    <span className="vlc-label">이전월</span>
                    <span className="vlc-value">{fmt(r.prevOdometer)} km</span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">이번월</span>
                    <span className="vlc-value vlc-strong">{r.hasInput ? `${fmt(r.odometer)} km` : '-'}</span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">운행</span>
                    <span className="vlc-value vlc-driven">{r.hasInput ? `${fmt(r.drivenKm)} km` : '-'}</span>
                  </div>
                  <div className="vlc-cell">
                    <span className="vlc-label">전월 대비</span>
                    <span
                      className="vlc-value"
                      style={{
                        color:
                          r.deltaVsPrev == null
                            ? 'var(--text-muted)'
                            : r.deltaVsPrev > 0
                              ? 'var(--danger)'
                              : r.deltaVsPrev < 0
                                ? 'var(--success)'
                                : 'var(--text-muted)',
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
                      <Icon name="trash" className="btn-ic" />삭제
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
        {editTarget &&
          (() => {
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
                  <div
                    style={{
                      background: 'var(--bg-subtle)',
                      borderRadius: 6,
                      padding: '10px 12px',
                      fontSize: 13,
                      color: 'var(--text)',
                      marginBottom: 12,
                    }}
                  >
                    운행 거리: <strong>{fmt(driven)}</strong> km
                  </div>
                )}
                {editError && (
                  <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{editError}</div>
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

      {/* 휴지통 모달 */}
      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['vehicleMileages']}
        title="운행기록 휴지통"
        onChange={reloadRecords}
      />

      {/* 삭제 확인 모달 */}
      <Modal isOpen={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} title="운행 기록 삭제">
        {deleteTarget && (
          <div>
            <p>
              <strong>{deleteTarget.name}</strong>님의{' '}
              <strong>
                {year}년 {month}월
              </strong>{' '}
              운행 기록을 삭제합니다.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              누적 {fmt(deleteTarget.odometer)} km · 운행 {fmt(deleteTarget.drivenKm)} km
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              삭제 후 휴지통에서 복원할 수 있습니다. 복원하지 않으면 다음 달 "이전월 누적"에도 영향을 줄 수 있어요.
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
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? '삭제 중…' : '삭제'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
