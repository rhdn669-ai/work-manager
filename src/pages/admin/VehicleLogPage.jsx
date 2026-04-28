import { useEffect, useMemo, useState } from 'react';
import { getUsers } from '../../services/userService';
import { getMileagesByMonth } from '../../services/vehicleMileageService';

// 관리자 운행일지 — 차량 운행자 지정자의 월별 누적 키로수 / 운행 km 모니터링
// /admin/vehicle-log

function fmt(n) {
  if (n == null || isNaN(Number(n))) return '-';
  return Number(n).toLocaleString();
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getUsers(), getMileagesByMonth(year, month)])
      .then(([u, recs]) => {
        if (cancelled) return;
        setUsers(u);
        setRecords(recs);
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

  const rows = useMemo(() => {
    const list = drivers.map((u) => {
      const rec = recordMap[u.uid];
      return {
        uid: u.uid,
        name: u.name,
        plate: u.vehiclePlate || rec?.plate || '',
        odometer: rec?.odometer ?? null,
        prevOdometer: rec?.prevOdometer ?? null,
        drivenKm: rec?.drivenKm ?? null,
        recordedAt: rec?.recordedAt || null,
        hasInput: !!rec,
      };
    });
    list.sort((a, b) => {
      if (a.hasInput !== b.hasInput) return a.hasInput ? 1 : -1; // 미입력자 위
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
    return list;
  }, [drivers, recordMap]);

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
                  <th>입력일</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => (
                  <tr key={r.uid} className={r.hasInput ? '' : 'is-missing'}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.plate || <span className="text-muted">-</span>}</td>
                    <td className="num-col">{fmt(r.prevOdometer)}</td>
                    <td className="num-col">{r.hasInput ? <strong>{fmt(r.odometer)}</strong> : <span className="vehicle-log-missing-tag">미입력</span>}</td>
                    <td className="num-col">{r.hasInput ? fmt(r.drivenKm) : '-'}</td>
                    <td>{fmtDate(r.recordedAt)}</td>
                  </tr>
                ))}
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
                    <span className="vlc-label">입력일</span>
                    <span className="vlc-value">{fmtDate(r.recordedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
