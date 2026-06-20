import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers } from '../../services/userService';
import { getAllSites, getClosingItems } from '../../services/siteService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getAllOvertimeRecords, OVERTIME_MULTIPLIER } from '../../services/attendanceService';
import { getMonthStart, getMonthEnd, formatMinutes, buildHolidaySet } from '../../utils/dateUtils';
import { QUARTER_LEAVE_TYPES } from '../../utils/constants';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';

function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return vw;
}

function daysInMonth(y, m) {
  return new Date(y, m, 0).getDate();
}
function workingDaysInMonth(y, m) {
  const total = daysInMonth(y, m);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function formatQty(q) {
  const n = Number(q) || 0;
  if (n % 1 === 0) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function leaveLabel(type) {
  if (!type) return '';
  if (type === 'half_am') return '오전반차';
  if (type === 'half_pm') return '오후반차';
  if (QUARTER_LEAVE_TYPES.includes(type)) return '반반차';
  if (type === 'sick') return '병가';
  return '연차';
}

export default function UnassignedReportPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const vw = useViewportWidth();
  const isMobile = vw < 768;
  const isXSmall = vw <= 360;
  const [hoverDay, setHoverDay] = useState(null);
  const [detailCell, setDetailCell] = useState(null); // { name, day, dateStr, projects, leaveType, overtimeMin, otSiteNames }
  const [users, setUsers] = useState([]);
  const [sites, setSites] = useState([]);
  const [allItems, setAllItems] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [overtimes, setOvertimes] = useState([]);
  const [loading, setLoading] = useState(true);
  // 한국 공휴일 Set (배치현황에 회색 표시용)
  const holidaySet = useMemo(() => buildHolidaySet([]), []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [u, s] = await Promise.all([getUsers(), getAllSites()]);
        // 활성 직원은 모두 포함 (대표·부사장·관리자 role도 — 본인 연차/배정도 보여줘야 함)
        // 'iopn' 계정은 시스템/회사 계정이므로 직원 배치현황에서 제외
        setUsers(u.filter((x) => x.isActive !== false && (x.name || '').trim().toLowerCase() !== 'iopn'));
        setSites(s);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (sites.length === 0) return;
    (async () => {
      setLoading(true);
      try {
        const start = getMonthStart(year, month);
        const end = getMonthEnd(year, month);
        const [perSite, lvs, ots] = await Promise.all([
          Promise.all(
            sites.map(async (s) => {
              const items = await getClosingItems(s.id, year, month);
              return items
                .filter((it) => it.itemType === 'employee')
                .map((it) => ({
                  siteId: s.id,
                  siteName: s.name,
                  detail: it.detail,
                  dailyQuantities: it.dailyQuantities || {},
                }));
            }),
          ),
          getApprovedLeavesByMonth(year, month),
          getAllOvertimeRecords(start, end),
        ]);
        setAllItems(perSite.flat());
        setLeaves(lvs);
        setOvertimes(ots.filter((o) => o.status === 'approved'));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [sites, year, month]);

  const { rows, topUnassigned, topOvertime, totalUnassignedAmount, totalUnassignedDays } = useMemo(() => {
    const totalDays = daysInMonth(year, month);
    // assigned[userName][day] = { siteName: qty누적합, ... }
    const assigned = {};
    for (const it of allItems) {
      if (!it.detail) continue;
      if (!assigned[it.detail]) assigned[it.detail] = {};
      for (const [dStr, q] of Object.entries(it.dailyQuantities || {})) {
        const d = Number(dStr);
        const qty = Number(q) || 0;
        if (qty <= 0) continue;
        if (!assigned[it.detail][d]) assigned[it.detail][d] = {};
        assigned[it.detail][d][it.siteName] = (assigned[it.detail][d][it.siteName] || 0) + qty;
      }
    }

    const userIdToName = Object.fromEntries(users.map((u) => [u.uid, u.name]));
    const nameToLeaveDay = {};
    for (const l of leaves) {
      const name = userIdToName[l.userId];
      if (!name) continue;
      const s = new Date(l.startDate);
      const e = new Date(l.endDate);
      const cur = new Date(s);
      while (cur <= e) {
        if (cur.getFullYear() === year && cur.getMonth() + 1 === month) {
          const d = cur.getDate();
          if (!nameToLeaveDay[name]) nameToLeaveDay[name] = {};
          if (!nameToLeaveDay[name][d]) nameToLeaveDay[name][d] = l.type || 'annual';
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    // 잔업: userName → day → { minutes, siteNames: Set<string> }
    const siteIdToName = Object.fromEntries(sites.map((s) => [s.id, s.name]));
    const nameToOvertime = {};
    for (const o of overtimes) {
      const name = o.userName || userIdToName[o.userId];
      if (!name) continue;
      const d = new Date(o.date);
      if (d.getFullYear() !== year || d.getMonth() + 1 !== month) continue;
      const day = d.getDate();
      if (!nameToOvertime[name]) nameToOvertime[name] = {};
      if (!nameToOvertime[name][day]) nameToOvertime[name][day] = { minutes: 0, siteNames: new Set() };
      nameToOvertime[name][day].minutes += o.minutes || 0;
      if (o.siteId) {
        const sn = o.siteId === 'etc' ? '기타' : siteIdToName[o.siteId];
        if (sn) nameToOvertime[name][day].siteNames.add(sn);
      }
    }

    const leaveTypeToClass = (t) => {
      if (!t) return null;
      if (t === 'half_am' || t === 'half_pm') return 'leave-half';
      if (QUARTER_LEAVE_TYPES.includes(t)) return 'leave-quarter';
      if (t === 'sick') return 'leave-sick';
      return 'leave-annual';
    };

    const out = users.map((u) => {
      const days = [];
      let unassignedCount = 0;
      let overlapCount = 0;
      let leaveCount = 0; // 차감일수 (반차 0.5, 반반차 0.25)
      for (let d = 1; d <= totalDays; d++) {
        const dow = new Date(year, month - 1, d).getDay();
        const isWeekend = dow === 0 || dow === 6;
        const dateIso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const isHoliday = holidaySet.has(dateIso);
        const leaveType = nameToLeaveDay[u.name]?.[d];
        const projectsMap = assigned[u.name]?.[d] || {};
        const projects = Object.entries(projectsMap)
          .map(([name, qty]) => ({ name, qty }))
          .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
        const otInfo = nameToOvertime[u.name]?.[d];
        const overtimeMin = otInfo?.minutes || 0;
        const otSiteNames = otInfo ? [...otInfo.siteNames] : [];
        // 공휴일 → 회색(holiday), 그 외 휴가/배정/주말/미배정 순으로 결정
        let type;
        if (isHoliday) type = 'holiday';
        else if (isWeekend) type = 'weekend';
        else if (leaveType) type = leaveTypeToClass(leaveType);
        else if (projects.length > 1) type = 'overlap';
        else if (projects.length === 1) type = 'assigned';
        else type = 'unassigned';
        days.push({ d, type, projects, leaveType, overtimeMin, otSiteNames });
        if (type === 'unassigned') unassignedCount++;
        if (type === 'overlap') overlapCount++;
        if (leaveType) {
          if (leaveType === 'half_am' || leaveType === 'half_pm') leaveCount += 0.5;
          else if (QUARTER_LEAVE_TYPES.includes(leaveType)) leaveCount += 0.25;
          else leaveCount += 1;
        }
      }
      return { uid: u.uid, name: u.name, position: u.position || '', days, unassignedCount, overlapCount, leaveCount };
    });

    // 직원별 일당으로 미배정 금액 계산 (월급 / 근무일수)
    const workingDays = workingDaysInMonth(year, month);
    const userByName = Object.fromEntries(users.map((u) => [u.name, u]));
    let totalUnassignedAmount = 0;
    let totalUnassignedDays = 0;
    for (const r of out) {
      const u = userByName[r.name];
      const monthlySalary = Number(u?.fixedCost) || 0;
      const dailyRate = workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;
      r.unassignedAmount = r.unassignedCount * dailyRate;
      totalUnassignedAmount += r.unassignedAmount;
      totalUnassignedDays += r.unassignedCount;
    }

    const topU = [...out]
      .filter((r) => r.unassignedCount > 0)
      .sort((a, b) => b.unassignedCount - a.unassignedCount)
      .slice(0, 5);

    // 잔업 Top: 직원별 총 시간·금액 집계
    const topOT = users
      .map((u) => {
        const dayMap = nameToOvertime[u.name] || {};
        const totalMinutes = Object.values(dayMap).reduce((s, v) => s + (v.minutes || 0), 0);
        if (totalMinutes === 0) return null;
        const hours = totalMinutes / 60;
        const amount = Math.round((Number(u.hourlyRate) || 0) * OVERTIME_MULTIPLIER * hours);
        return { uid: u.uid, name: u.name, minutes: totalMinutes, amount };
      })
      .filter(Boolean)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    const sorted = out.sort(
      (a, b) =>
        b.unassignedCount + b.overlapCount - (a.unassignedCount + a.overlapCount) || a.name.localeCompare(b.name),
    );
    return { rows: sorted, topUnassigned: topU, topOvertime: topOT, totalUnassignedAmount, totalUnassignedDays };
  }, [users, allItems, leaves, overtimes, year, month, holidaySet]);

  const totalDays = daysInMonth(year, month);
  const dayHeaders = Array.from({ length: totalDays }, (_, i) => i + 1);

  if (!isAdmin)
    return (
      <div className="card">
        <div className="card-body empty-state">접근 권한이 없습니다.</div>
      </div>
    );

  return (
    <div className="unassigned-report-page">
      <div className="page-header">
        <h2>직원 배치현황</h2>
      </div>

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
          options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => ({ value: m, label: `${m}월` }))}
          ariaLabel="월 선택"
        />
      </div>

      <div className="ua-summary-card" style={{ marginBottom: 14 }}>
        <div className="ua-summary-title">
          <span className="ua-dot ua-dot-unassigned" />
          미배정 금액 집계 · {year}년 {month}월
        </div>
        {totalUnassignedDays === 0 ? (
          <p className="ua-summary-empty">미배정 일수 없음</p>
        ) : (
          <div
            className="ua-summary-total"
            style={{
              marginTop: 0,
              borderTop: 'none',
              paddingTop: 0,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>전체 합계</span>
            <span
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
              }}
            >
              <em style={{ fontStyle: 'normal', textAlign: 'right' }}>{totalUnassignedDays}일</em>
              <em style={{ fontStyle: 'normal', textAlign: 'right' }}>{totalUnassignedAmount.toLocaleString()}원</em>
            </span>
          </div>
        )}
      </div>

      <div className="ua-legend" style={isXSmall ? { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, fontSize: 10 } : undefined}>
        <span>
          <span className="ua-legend-swatch assigned" />
          배정
        </span>
        <span>
          <span className="ua-legend-swatch overlap" />
          중복배정
        </span>
        <span>
          <span className="ua-legend-swatch leave-annual" />
          연차
        </span>
        <span>
          <span className="ua-legend-swatch leave-half" />
          반차
        </span>
        <span>
          <span className="ua-legend-swatch leave-quarter" />
          반반차
        </span>
        <span>
          <span className="ua-legend-swatch leave-sick" />
          병가
        </span>
        <span>
          <span className="ua-legend-swatch weekend" />
          주말
        </span>
        <span>
          <span className="ua-legend-swatch holiday" />
          공휴일
        </span>
        <span>
          <span className="ua-legend-swatch unassigned" />
          미배정
        </span>
        <span>
          <span className="ua-legend-dot" />
          잔업
        </span>
      </div>

      {loading ? (
        <div className="loading">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">표시할 직원이 없습니다.</div>
        </div>
      ) : isMobile ? (
        <div className="unassigned-mobile-cards">
          <p className="text-muted text-sm" style={{ marginBottom: 8 }}>
            {year}년 {month}월 — 미배정 직원 {rows.filter((r) => r.unassignedCount > 0).length}명
          </p>
          {rows.filter((r) => r.unassignedCount > 0 || r.overlapCount > 0).slice(0, 10).map((r) => (
            <div key={r.uid} className="card" style={{ padding: '8px 12px', marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, wordBreak: 'break-word', minWidth: 0 }} title={`${r.name}${r.position ? ` · ${r.position}` : ''}`}>
                  {r.name}
                  {r.position && <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>{r.position}</span>}
                </span>
                <span style={{ display: 'flex', gap: 8, flexShrink: 0, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {r.unassignedCount > 0 && <span style={{ color: 'var(--danger)' }}>미배정 <strong>{r.unassignedCount}일</strong></span>}
                  {r.overlapCount > 0 && <span style={{ color: 'var(--warning, #d97706)' }}>중복 <strong>{r.overlapCount}일</strong></span>}
                  {r.leaveCount > 0 && <span>연차 <strong>{r.leaveCount % 1 === 0 ? r.leaveCount : r.leaveCount.toFixed(2).replace(/\.?0+$/, '')}일</strong></span>}
                </span>
              </div>
            </div>
          ))}
          {rows.filter((r) => r.unassignedCount === 0 && r.overlapCount === 0).length > 0 && (
            <p className="text-muted text-sm" style={{ marginTop: 4 }}>
              + 배정 완료 {rows.filter((r) => r.unassignedCount === 0 && r.overlapCount === 0).length}명
            </p>
          )}
          <p className="text-muted text-sm" style={{ marginTop: 8 }}>
            전체 그리드는 태블릿/PC(768px 이상)에서 확인하세요.
          </p>
        </div>
      ) : (
        <div className="unassigned-table-wrap table-scroll-x unassigned-table-container">
          <table className="unassigned-table">
            <thead>
              <tr>
                <th className="sticky-col">직원</th>
                {dayHeaders.map((d) => {
                  const dow = new Date(year, month - 1, d).getDay();
                  const isHoliday = holidaySet.has(
                    `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
                  );
                  const dowCls = dow === 0 || isHoliday ? 'sun' : dow === 6 ? 'sat' : '';
                  return (
                    <th key={d} className={`day-col ${dowCls} ${hoverDay === d ? 'col-hover' : ''}`} style={{ minWidth: 18, maxWidth: 24, fontSize: 10, width: 22 }}>
                      {d}
                    </th>
                  );
                })}
                <th className="sticky-col-right">연차</th>
                <th className="sticky-col-right">미배정</th>
                <th className="sticky-col-right">중복</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid}>
                  <td className="sticky-col name-col" title={`${r.name}${r.position ? ` · ${r.position}` : ''}`} style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    <strong>{r.name}</strong>
                    {r.position && <span className="position-tag position-tag-mobile-hide" title={r.position}>{r.position}</span>}
                  </td>
                  {r.days.map((c) => {
                    const hasOT = c.overtimeMin > 0;
                    const isLeave = c.type.startsWith('leave-');
                    let baseTitle;
                    const projectLabel = (p) => `${p.name} ${formatQty(p.qty)}공수`;
                    if (c.type === 'overlap') baseTitle = `중복배정: ${c.projects.map(projectLabel).join(', ')}`;
                    else if (c.type === 'assigned') baseTitle = c.projects.map(projectLabel).join(', ');
                    else if (isLeave) baseTitle = leaveLabel(c.leaveType);
                    else if (c.type === 'holiday') baseTitle = '공휴일';
                    else if (c.type === 'weekend') baseTitle = '주말';
                    else baseTitle = '미배정';
                    const title = hasOT
                      ? `${baseTitle} · 잔업 ${formatMinutes(c.overtimeMin)}${c.otSiteNames.length > 0 ? ` (${c.otSiteNames.join(', ')})` : ''}`
                      : baseTitle;
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
                    return (
                      <td
                        key={c.d}
                        className={`unassigned-cell ${c.type} ${hasOT ? 'has-overtime' : ''} ${hoverDay === c.d ? 'col-hover' : ''}`}
                        title={`${c.d}일 · ${title}`}
                        onMouseEnter={() => setHoverDay(c.d)}
                        onMouseLeave={() => setHoverDay((prev) => (prev === c.d ? null : prev))}
                        onClick={() =>
                          setDetailCell({
                            name: r.name,
                            position: r.position,
                            day: c.d,
                            dateStr,
                            type: c.type,
                            projects: c.projects,
                            leaveType: c.leaveType,
                            overtimeMin: c.overtimeMin,
                            otSiteNames: c.otSiteNames,
                          })
                        }
                      />
                    );
                  })}
                  <td className="sticky-col-right count-col" style={{ textAlign: 'right' }}>
                    <strong
                      className={r.leaveCount > 0 ? 'leave-count' : ''}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {r.leaveCount % 1 === 0 ? r.leaveCount : r.leaveCount.toFixed(2).replace(/\.?0+$/, '')}
                    </strong>
                  </td>
                  <td className="sticky-col-right count-col" style={{ textAlign: 'right' }}>
                    <strong
                      className={r.unassignedCount > 0 ? 'neg' : ''}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {r.unassignedCount}
                    </strong>
                  </td>
                  <td className="sticky-col-right count-col" style={{ textAlign: 'right' }}>
                    <strong className={r.overlapCount > 0 ? 'warn' : ''} style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.overlapCount}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 셀 클릭 시 배치 상세 모달 */}
      {detailCell &&
        (() => {
          const c = detailCell;
          const isLeave = typeof c.type === 'string' && c.type.startsWith('leave-');
          const statusLabel =
            c.type === 'overlap'
              ? '중복배정'
              : c.type === 'assigned'
                ? '배정'
                : isLeave
                  ? leaveLabel(c.leaveType)
                  : c.type === 'holiday'
                    ? '공휴일'
                    : c.type === 'weekend'
                      ? '주말'
                      : '미배정';
          return (
            <Modal isOpen={!!detailCell} onClose={() => setDetailCell(null)} title={`${c.name}님 · ${c.dateStr}`}>
              <div className="placement-detail-body">
                <div className="placement-detail-summary">
                  <span className={`ua-legend-swatch ${c.type}`} />
                  <strong>{statusLabel}</strong>
                  {c.position && <span className="placement-detail-pos">· {c.position}</span>}
                </div>

                {c.projects.length > 0 &&
                  (() => {
                    const totalQty = c.projects.reduce((s, p) => s + (Number(p.qty) || 0), 0);
                    return (
                      <div className="placement-detail-section">
                        <div className="placement-detail-label">
                          배정 프로젝트
                          <span className="placement-detail-total">합계 {formatQty(totalQty)}공수</span>
                        </div>
                        <ul className="placement-detail-list">
                          {c.projects.map((p, i) => {
                            const site = sites.find((s) => s.name === p.name);
                            const canNavigate = !!site;
                            const qtyEl = <span className="placement-project-qty">{formatQty(p.qty)}공수</span>;
                            return (
                              <li key={i}>
                                {canNavigate ? (
                                  <button
                                    type="button"
                                    className="placement-project-link"
                                    onClick={() => {
                                      setDetailCell(null);
                                      navigate(`/sites/${site.id}/${year}/${month}`);
                                    }}
                                    title={`${p.name} 프로젝트로 이동`}
                                  >
                                    <span className="placement-project-name u-wrap" title={p.name}>
                                      {p.name}
                                    </span>
                                    {qtyEl}
                                    <span className="placement-project-link-arrow" aria-hidden="true">
                                      →
                                    </span>
                                  </button>
                                ) : (
                                  <span className="placement-project-row">
                                    <span className="placement-project-name u-wrap" title={p.name}>
                                      {p.name}
                                    </span>
                                    {qtyEl}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}

                {isLeave && (
                  <div className="placement-detail-section">
                    <div className="placement-detail-label">휴가</div>
                    <p>{leaveLabel(c.leaveType)}</p>
                  </div>
                )}

                {c.overtimeMin > 0 && (
                  <div className="placement-detail-section">
                    <div className="placement-detail-label">잔업 (별도 집계)</div>
                    <p>
                      {formatMinutes(c.overtimeMin)}
                      {c.otSiteNames.length > 0 && ` · ${c.otSiteNames.join(', ')}`}
                    </p>
                    <p className="text-muted text-sm" style={{ marginTop: 2 }}>
                      잔업은 공수표 배정과 무관하게 별도로 집계됩니다.
                    </p>
                  </div>
                )}

                {c.type === 'unassigned' && (
                  <div className="placement-detail-section">
                    <p className="text-muted text-sm">
                      공수표에 배정된 프로젝트가 없는 날입니다.
                      {c.overtimeMin > 0 && ' (잔업 기록은 위에 별도 표시됨)'}
                    </p>
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setDetailCell(null)}>
                    닫기
                  </button>
                </div>
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}
