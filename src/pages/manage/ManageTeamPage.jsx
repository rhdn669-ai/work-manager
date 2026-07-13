import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { getUsers, updateUser } from '../../services/userService';
import {
  getDepartments,
  getDepartmentsByLeader,
  addDepartment,
  updateDepartment,
} from '../../services/departmentService';
import { trashGeneric } from '../../services/trashService';
import { getMyOvertimeRecords, getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getAllSites } from '../../services/siteService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';

export default function ManageTeamPage() {
  const { userProfile, isAdmin, canApproveLeave } = useAuth();
  const { confirm, alert, toast } = useDialog();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [overtimeMap, setOvertimeMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [editTeam, setEditTeam] = useState(null);
  const [form, setForm] = useState({ name: '', managerId: '', subManagerId: '', memberIds: [] });
  const [memberListOpen, setMemberListOpen] = useState(false);
  // 일반 직원 뷰용 팀 캘린더 (본인 포함)
  const nowRef = new Date();
  const [calYear, setCalYear] = useState(nowRef.getFullYear());
  const [calMonth, setCalMonth] = useState(nowRef.getMonth() + 1);
  const [teamLeaves, setTeamLeaves] = useState([]); // { userId, startDate, endDate, type }[]
  const [teamOvertime, setTeamOvertime] = useState([]); // { userId, date, minutes, siteId }[]
  const [siteMap, setSiteMap] = useState({}); // id → name
  const [selectedCalDay, setSelectedCalDay] = useState(null); // 'YYYY-MM-DD'

  useEffect(() => {
    if (userProfile) loadData();
  }, [userProfile]);

  async function loadData() {
    setLoading(true);
    try {
      const [allTeams, allUsers] = await Promise.all([
        isAdmin ? getDepartments() : canApproveLeave ? getDepartmentsByLeader(userProfile.uid) : getDepartments(),
        getUsers(),
      ]);
      // 일반 직원은 자기 소속 팀만 필터
      const visibleTeams =
        !isAdmin && !canApproveLeave && userProfile.departmentId
          ? allTeams.filter((t) => t.id === userProfile.departmentId)
          : allTeams;
      setTeams(visibleTeams);
      setUsers(allUsers);

      // 팀원 잔업 조회 (팀장 뷰)
      if (!isAdmin && canApproveLeave) {
        const now = new Date();
        const start = getMonthStart(now.getFullYear(), now.getMonth() + 1);
        const end = getMonthEnd(now.getFullYear(), now.getMonth() + 1);
        const otMap = {};
        const myTeam = allTeams[0];
        if (myTeam) {
          const members = allUsers.filter((u) => u.departmentId === myTeam.id && u.uid !== userProfile.uid);
          for (const u of members) {
            const records = await getMyOvertimeRecords(u.uid, start, end);
            otMap[u.uid] = records.filter((r) => r.status === 'approved').reduce((sum, r) => sum + (r.minutes || 0), 0);
          }
        }
        setOvertimeMap(otMap);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const userMap = Object.fromEntries(users.map((u) => [u.uid, u]));

  function getTeamMembers(teamId) {
    return users.filter((u) => u.departmentId === teamId);
  }

  // 팀 캘린더 데이터 로드 — 일반 직원 뷰일 때만 실행
  useEffect(() => {
    const isRegularEmployee = !isAdmin && !canApproveLeave;
    if (!isRegularEmployee || !userProfile?.departmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const start = getMonthStart(calYear, calMonth);
        const end = getMonthEnd(calYear, calMonth);
        const [leaves, allOvertime, allSites] = await Promise.all([
          getApprovedLeavesByMonth(calYear, calMonth),
          getAllOvertimeRecords(start, end),
          getAllSites(),
        ]);
        if (cancelled) return;
        const teammateIds = new Set(users.filter((u) => u.departmentId === userProfile.departmentId).map((u) => u.uid));
        setTeamLeaves(leaves.filter((l) => teammateIds.has(l.userId)));
        setTeamOvertime(
          allOvertime
            .filter((r) => r.status === 'approved' && teammateIds.has(r.userId))
            .map((r) => ({ userId: r.userId, date: r.date, minutes: r.minutes || 0, siteId: r.siteId || '' })),
        );
        setSiteMap(Object.fromEntries(allSites.map((s) => [s.id, s.name])));
      } catch (err) {
        /* 네트워크 실패 시 빈 캘린더 */ console.error(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, canApproveLeave, userProfile?.departmentId, userProfile?.uid, users, calYear, calMonth]);

  // 날짜별 이벤트 맵 생성 — { 'YYYY-MM-DD': [{userId, kind, label, type}] }
  const calendarEventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => {
      (map[date] = map[date] || []).push(ev);
    };
    // 연차는 startDate~endDate 범위 → 일별 전개 (해당 월만)
    teamLeaves.forEach((l) => {
      const from = new Date(l.startDate);
      const to = new Date(l.endDate);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() !== calYear || d.getMonth() + 1 !== calMonth) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const u = userMap[l.userId];
        push(dateStr, { userId: l.userId, kind: 'leave', type: l.type, label: u?.name || '?' });
      }
    });
    teamOvertime.forEach((r) => {
      const u = userMap[r.userId];
      push(r.date, {
        userId: r.userId,
        kind: 'overtime',
        minutes: r.minutes,
        label: u?.name || '?',
        siteId: r.siteId || '',
        siteName: r.siteId ? siteMap[r.siteId] || '' : '',
      });
    });
    return map;
  }, [teamLeaves, teamOvertime, calYear, calMonth, userMap, siteMap]);

  function shiftCalMonth(delta) {
    let y = calYear;
    let m = calMonth + delta;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setCalYear(y);
    setCalMonth(m);
    setSelectedCalDay(null);
  }

  function leaveTypeLabel(t) {
    if (t === 'half_am') return '오전반차';
    if (t === 'half_pm') return '오후반차';
    if (t === 'sick') return '병가';
    if (t === 'quarter_1' || t === 'quarter_2' || t === 'quarter_3' || t === 'quarter_4') return '반반차';
    return '연차';
  }

  function buildCalendarWeeks(y, m) {
    const firstDow = new Date(y, m - 1, 1).getDay();
    const totalDays = new Date(y, m, 0).getDate();
    const weeks = [];
    let week = new Array(firstDow).fill(null);
    for (let d = 1; d <= totalDays; d++) {
      week.push(d);
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null);
      weeks.push(week);
    }
    return weeks;
  }

  function openCreate() {
    setEditTeam(null);
    setForm({ name: '', managerId: '', subManagerId: '', memberIds: [] });
    setShowModal(true);
  }

  function openEdit(team) {
    setEditTeam(team);
    const memberIds = users.filter((u) => u.departmentId === team.id).map((u) => u.uid);
    setForm({
      name: team.name,
      managerId: team.managerId || '',
      subManagerId: team.subManagerId || '',
      memberIds,
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.subManagerId && form.subManagerId === form.managerId) {
      alert('팀장과 부팀장은 같은 사람이 될 수 없습니다.');
      return;
    }
    try {
      let teamId;
      const deptData = {
        name: form.name,
        managerId: form.managerId,
        subManagerId: form.subManagerId || '',
      };
      if (editTeam) {
        teamId = editTeam.id;
        await updateDepartment(teamId, deptData);
      } else {
        const ref = await addDepartment(deptData);
        teamId = ref.id;
      }

      // 팀원 소속 업데이트
      const prevMembers = users.filter((u) => u.departmentId === teamId).map((u) => u.uid);
      const newMembers = form.memberIds;

      // 제거된 사용자: departmentId 비우기
      for (const uid of prevMembers) {
        if (!newMembers.includes(uid)) {
          await updateUser(uid, { departmentId: '', isTeamLeader: false, isSubTeamLeader: false });
        }
      }

      // 추가/유지된 사용자: departmentId 설정
      for (const uid of newMembers) {
        const isLeader = uid === form.managerId;
        const isSubLeader = uid === form.subManagerId;
        await updateUser(uid, {
          departmentId: teamId,
          isTeamLeader: isLeader,
          isSubTeamLeader: isSubLeader,
        });
      }

      // 팀장이 memberIds에 없으면 별도 업데이트
      if (form.managerId && !newMembers.includes(form.managerId)) {
        await updateUser(form.managerId, {
          departmentId: teamId,
          isTeamLeader: true,
          isSubTeamLeader: false,
        });
      }
      // 부팀장이 memberIds에 없으면 별도 업데이트
      if (form.subManagerId && !newMembers.includes(form.subManagerId)) {
        await updateUser(form.subManagerId, {
          departmentId: teamId,
          isTeamLeader: false,
          isSubTeamLeader: true,
        });
      }

      setShowModal(false);
      await loadData();
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(team) {
    if (
      !(await confirm(
        `"${team.name}" 팀을 삭제하시겠습니까?\n소속 팀원의 부서가 초기화됩니다.\n(휴지통에서 복원할 수 있습니다)`,
      ))
    )
      return;
    try {
      const members = users.filter((u) => u.departmentId === team.id);
      for (const u of members) {
        await updateUser(u.uid, { departmentId: '', isTeamLeader: false, isSubTeamLeader: false });
      }
      await trashGeneric('departments', team.id, { title: team.name }, userProfile?.name || '');
      await loadData();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  function toggleMember(uid) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid) ? f.memberIds.filter((x) => x !== uid) : [...f.memberIds, uid],
    }));
  }

  if (loading) return <Skeleton.Rows count={6} />;

  // === 일반 직원 뷰: 소속 팀 + 팀원 이름/직급만 ===
  if (!isAdmin && !canApproveLeave) {
    const myTeam = teams[0];
    const rankOf = (uid) => (myTeam?.managerId === uid ? 0 : myTeam?.subManagerId === uid ? 1 : 2);
    const members = myTeam
      ? users.filter((u) => u.departmentId === myTeam.id).sort((a, b) => rankOf(a.uid) - rankOf(b.uid))
      : [];
    const leader = myTeam ? userMap[myTeam.managerId] : null;
    const subLeader = myTeam && myTeam.subManagerId ? userMap[myTeam.subManagerId] : null;
    return (
      <div className="manage-team-page">
        <div className="page-header">
          <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>
        </div>
        {!myTeam ? (
          <div className="card">
            <div className="card-body empty-state">소속된 팀이 없습니다. 관리자에게 문의해주세요.</div>
          </div>
        ) : (
          <>
            {(leader || subLeader) && (
              <div
                className="meta-bar"
                style={{ marginBottom: 8, padding: '6px 8px', display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}
              >
                {leader && (
                  <span style={{ whiteSpace: 'nowrap', minWidth: 0 }}>
                    팀장:{' '}
                    <strong className="u-ellipsis-1" title={leader.name}>
                      {leader.name}
                    </strong>{' '}
                    {leader.position && `(${leader.position})`}
                  </span>
                )}
                {subLeader && (
                  <span style={{ whiteSpace: 'nowrap', minWidth: 0 }}>
                    부팀장:{' '}
                    <strong className="u-ellipsis-1" title={subLeader.name}>
                      {subLeader.name}
                    </strong>{' '}
                    {subLeader.position && `(${subLeader.position})`}
                  </span>
                )}
              </div>
            )}
            <table className="table cards-sm">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>직급</th>
                </tr>
              </thead>
              <tbody>
                {members.map((u) => (
                  <tr key={u.uid}>
                    <td data-label="이름" title={u.name}>
                      <div
                        style={{
                          display: 'inline-flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: '2px 4px',
                          minWidth: 0,
                        }}
                      >
                        <strong className="u-ellipsis-1" title={u.name} style={{ minHeight: 22 }}>
                          {u.name}
                        </strong>
                        {u.uid === myTeam.managerId && (
                          <span
                            className="badge badge-role-manager"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              minWidth: 0,
                              minHeight: 22,
                              height: 22,
                            }}
                          >
                            팀장
                          </span>
                        )}
                        {u.uid === myTeam.subManagerId && (
                          <span
                            className="badge badge-role-manager"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              minWidth: 0,
                              minHeight: 22,
                              height: 22,
                            }}
                          >
                            부팀장
                          </span>
                        )}
                        {u.uid === userProfile.uid && (
                          <span
                            className="badge badge-position"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              minWidth: 0,
                              minHeight: 22,
                              height: 22,
                            }}
                          >
                            나
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="직급" title={u.position || ''}>
                      {u.position || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 팀원 일정 캘린더 — 본인 포함 */}
            <div className="team-calendar-section">
              <div className="team-calendar-head">
                <div className="team-calendar-title">
                  <strong>팀원 일정</strong>
                </div>
                <div className="team-calendar-nav">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-icon"
                    onClick={() => shiftCalMonth(-1)}
                    aria-label="이전 달"
                    title="이전 달"
                  >
                    <Icon name="chevronRight" className="btn-ic" style={{ transform: 'rotate(180deg)' }} />
                  </button>
                  <span className="team-calendar-ym">
                    {calYear}년 {calMonth}월
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline btn-icon"
                    onClick={() => shiftCalMonth(1)}
                    aria-label="다음 달"
                    title="다음 달"
                  >
                    <Icon name="chevronRight" className="btn-ic" />
                  </button>
                </div>
              </div>

              <div className="team-calendar team-calendar-compact-xs">
                <div className="team-calendar-dow-row">
                  {['일', '월', '화', '수', '목', '금', '토'].map((dn, i) => (
                    <div key={dn} className={`team-calendar-dow ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`}>
                      {dn}
                    </div>
                  ))}
                </div>
                {buildCalendarWeeks(calYear, calMonth).map((wk, wi) => (
                  <div className="team-calendar-row" key={wi}>
                    {wk.map((d, di) => {
                      if (d === null) return <div className="team-cal-cell team-cal-empty" key={di} />;
                      const dateStr = `${calYear}-${String(calMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                      const events = calendarEventsByDate[dateStr] || [];
                      const isToday =
                        calYear === nowRef.getFullYear() &&
                        calMonth === nowRef.getMonth() + 1 &&
                        d === nowRef.getDate();
                      const isSunday = di === 0;
                      const isSaturday = di === 6;
                      const visible = events.slice(0, 3);
                      const extra = events.length - visible.length;
                      return (
                        <button
                          type="button"
                          key={di}
                          className={`team-cal-cell ${events.length > 0 ? 'has-events' : ''} ${isToday ? 'is-today' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${selectedCalDay === dateStr ? 'is-selected' : ''}`}
                          style={{
                            minHeight: 'clamp(42px, 8vw, 56px)',
                            display: 'flex',
                            flexDirection: 'column',
                            contain: 'layout',
                          }}
                          onClick={() => setSelectedCalDay(selectedCalDay === dateStr ? null : dateStr)}
                          disabled={events.length === 0}
                        >
                          <span className="team-cal-day">{d}</span>
                          <div className="team-cal-events team-cal-events-dots" style={{ marginTop: 'auto' }}>
                            {visible.map((e, i) => (
                              <span
                                key={i}
                                className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`}
                                title={`${e.label} · ${e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}`}
                              />
                            ))}
                            {extra > 0 && <span className="team-cal-ev-more">+{extra}</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {selectedCalDay &&
                (() => {
                  const evs = calendarEventsByDate[selectedCalDay] || [];
                  const [, m, d] = selectedCalDay.split('-');
                  return (
                    <div className="team-calendar-day-detail">
                      <div
                        className="team-calendar-day-detail-head"
                        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      >
                        <strong>
                          {Number(m)}월 {Number(d)}일
                        </strong>
                        <span className="team-calendar-hint">· {evs.length}건</span>
                        <button
                          type="button"
                          className="team-calendar-close"
                          onClick={() => setSelectedCalDay(null)}
                          aria-label="닫기"
                        >
                          <Icon name="close" />
                        </button>
                      </div>
                      <ul className="team-calendar-day-list">
                        {evs.map((e, i) => {
                          const linkable = e.kind === 'overtime' && !!e.siteId;
                          const inner = (
                            <>
                              <span
                                className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`}
                              />
                              <strong
                                className="u-ellipsis-1"
                                title={e.label}
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  minWidth: 0,
                                  flex: '1 1 auto',
                                }}
                              >
                                {e.label}
                              </strong>
                              <span className="team-calendar-ev-detail">
                                {e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}
                              </span>
                              {e.kind === 'overtime' && e.siteName && (
                                <span className="team-calendar-ev-site u-ellipsis-1" title={e.siteName}>
                                  {e.siteName}
                                </span>
                              )}
                            </>
                          );
                          return linkable ? (
                            <li key={i} className="has-link" style={{ minHeight: 44 }}>
                              <Link
                                to={`/sites/${e.siteId}/${calYear}/${calMonth}`}
                                className="team-calendar-day-link"
                                title={`${e.siteName} 마감 페이지로 이동`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  minHeight: 44,
                                  padding: '10px 12px',
                                }}
                              >
                                {inner}
                              </Link>
                            </li>
                          ) : (
                            <li
                              key={i}
                              style={{
                                minHeight: 44,
                                padding: '10px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              {inner}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })()}
            </div>
          </>
        )}
      </div>
    );
  }

  // === 팀장 뷰: 팀 구성 현황 (이름 + 직급 + 이번 달 잔업) ===
  if (!isAdmin) {
    const myTeam = teams[0];
    const members = myTeam ? users.filter((u) => u.departmentId === myTeam.id && u.uid !== userProfile.uid) : [];
    const now = new Date();
    return (
      <div className="manage-team-page">
        <div className="page-header">
          <h2>팀 구성 현황{myTeam && ` — ${myTeam.name}`}</h2>
        </div>
        <p className="field-hint">
          {now.getFullYear()}년 {now.getMonth() + 1}월 기준 잔업 현황
        </p>
        {members.length === 0 ? (
          <div className="card">
            <div className="card-body empty-state">소속 팀원이 없습니다.</div>
          </div>
        ) : (
          <table className="table cards-sm">
            <thead>
              <tr>
                <th>이름</th>
                <th>직급</th>
                <th>이번 달 잔업</th>
              </tr>
            </thead>
            <tbody>
              {members.map((u) => {
                const minutes = overtimeMap[u.uid] || 0;
                return (
                  <tr key={u.uid}>
                    <td data-label="이름" title={u.name}>
                      <strong>{u.name}</strong>
                    </td>
                    <td data-label="직급" title={u.position || ''}>
                      {u.position || '-'}
                    </td>
                    <td data-label="이번 달 잔업">
                      {minutes > 0 ? (
                        <strong style={{ color: 'var(--primary)' }}>{formatMinutes(minutes)}</strong>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  // === 관리자 뷰: 팀 설정 ===
  return (
    <div className="manage-team-page">
      <div className="page-header">
        <h2>팀 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />팀 추가
          </button>
        </div>
      </div>
      <p className="field-hint">
        팀을 구성하고 팀장을 지정하면, 팀원이 연차 신청 시 해당 팀장에게 승인 대기가 표시됩니다.
      </p>

      {teams.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">등록된 팀이 없습니다.</div>
        </div>
      ) : (
        <table className="table cards-sm">
          <thead>
            <tr>
              <th>팀 이름</th>
              <th>팀장</th>
              <th>부팀장</th>
              <th>팀원</th>
              <th className="col-action">작업</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const leader = userMap[t.managerId];
              const subLeader = userMap[t.subManagerId];
              const members = getTeamMembers(t.id);
              return (
                <tr key={t.id}>
                  <td data-label="팀 이름" title={t.name || ''}>
                    <strong>{t.name}</strong>
                  </td>
                  <td data-label="팀장" title={leader?.name || ''}>
                    {leader?.name || '-'}
                  </td>
                  <td data-label="부팀장" title={subLeader?.name || ''}>
                    {subLeader?.name || '-'}
                  </td>
                  <td data-label="팀원">{members.length}명</td>
                  <td className="col-action">
                    <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => openEdit(t)}>
                        수정
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(t)}>
                        <Icon name="trash" className="btn-ic" />
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['departments']}
        title="팀 휴지통"
        onChange={loadData}
      />

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTeam ? '팀 수정' : '팀 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>팀 이름 *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="예: 전장 1팀"
            />
          </div>
          <div className="form-group">
            <label>팀장 선택 *</label>
            <Select
              value={form.managerId}
              onChange={(v) => setForm({ ...form, managerId: v })}
              ariaLabel="팀장 선택"
              placeholder="선택"
              options={users
                .filter((u) => {
                  if (u.role === 'admin') return false;
                  if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                  return true;
                })
                .map((u) => ({ value: u.uid, label: `${u.name} (${u.code})${u.position ? ` · ${u.position}` : ''}` }))}
            />
          </div>
          <div className="form-group">
            <label>부팀장 선택 (선택사항)</label>
            <Select
              value={form.subManagerId}
              onChange={(v) => setForm({ ...form, subManagerId: v })}
              ariaLabel="부팀장 선택"
              placeholder="선택 안 함"
              options={users
                .filter((u) => {
                  if (u.role === 'admin') return false;
                  if (u.uid === form.managerId) return false;
                  if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                  return true;
                })
                .map((u) => ({ value: u.uid, label: `${u.name} (${u.code})${u.position ? ` · ${u.position}` : ''}` }))}
            />
          </div>
          <div className="form-group">
            <label>팀원 선택</label>
            <button type="button" className="select-dropdown-toggle" onClick={() => setMemberListOpen(!memberListOpen)}>
              <span>{form.memberIds.length > 0 ? `${form.memberIds.length}명 선택됨` : '팀원을 선택하세요'}</span>
              <Icon
                name="chevronDown"
                className={`select-dropdown-arrow${memberListOpen ? ' open' : ''}`}
                aria-label={memberListOpen ? '닫기' : '열기'}
              />
            </button>
            {memberListOpen && (
              <div className="select-dropdown-list" style={{ maxHeight: '30vh', overflowY: 'auto' }}>
                {users
                  .filter((u) => {
                    if (u.role === 'admin') return false;
                    if (u.uid === form.managerId) return false;
                    if (u.uid === form.subManagerId) return false;
                    if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                    return true;
                  })
                  .map((u) => {
                    const checked = form.memberIds.includes(u.uid);
                    return (
                      <label
                        key={u.uid}
                        className={`select-list-item ${checked ? 'is-checked' : ''}`}
                        style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleMember(u.uid)} />
                        <span className="select-list-name">{u.name}</span>
                        <span className="select-list-sub">
                          {u.code}
                          {u.position && ` · ${u.position}`}
                        </span>
                      </label>
                    );
                  })}
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowModal(false)}
              style={{ minHeight: 36 }}
            >
              취소
            </button>
            <button type="submit" className="btn btn-primary" style={{ minHeight: 36 }}>
              {editTeam ? '수정' : '추가'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
