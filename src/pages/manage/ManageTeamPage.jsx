import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers, updateUser } from '../../services/userService';
import { getDepartments, getDepartmentsByLeader, addDepartment, updateDepartment, deleteDepartment } from '../../services/departmentService';
import { getMyOvertimeRecords, getAllOvertimeRecords } from '../../services/attendanceService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getAllSites } from '../../services/siteService';
import { getMonthStart, getMonthEnd, formatMinutes } from '../../utils/dateUtils';
import Modal from '../../components/common/Modal';

export default function ManageTeamPage() {
  const { userProfile, isAdmin, canApproveLeave } = useAuth();
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [overtimeMap, setOvertimeMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTeam, setEditTeam] = useState(null);
  const [form, setForm] = useState({ name: '', managerId: '', subManagerId: '', memberIds: [] });
  const [memberListOpen, setMemberListOpen] = useState(false);
  // 일반 직원 뷰용 팀 캘린더 (본인 제외)
  const nowRef = new Date();
  const [calYear, setCalYear] = useState(nowRef.getFullYear());
  const [calMonth, setCalMonth] = useState(nowRef.getMonth() + 1);
  const [teamLeaves, setTeamLeaves] = useState([]); // { userId, startDate, endDate, type }[]
  const [teamOvertime, setTeamOvertime] = useState([]); // { userId, date, minutes, siteId }[]
  const [siteMap, setSiteMap] = useState({}); // id → name
  const [selectedCalDay, setSelectedCalDay] = useState(null); // 'YYYY-MM-DD'

  useEffect(() => { if (userProfile) loadData(); }, [userProfile]);

  async function loadData() {
    setLoading(true);
    try {
      const [allTeams, allUsers] = await Promise.all([
        isAdmin ? getDepartments() : (canApproveLeave ? getDepartmentsByLeader(userProfile.uid) : getDepartments()),
        getUsers(),
      ]);
      // 일반 직원은 자기 소속 팀만 필터
      const visibleTeams = (!isAdmin && !canApproveLeave && userProfile.departmentId)
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
            otMap[u.uid] = records
              .filter((r) => r.status === 'approved')
              .reduce((sum, r) => sum + (r.minutes || 0), 0);
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
        const teammateIds = new Set(
          users
            .filter((u) => u.departmentId === userProfile.departmentId && u.uid !== userProfile.uid)
            .map((u) => u.uid)
        );
        setTeamLeaves(leaves.filter((l) => teammateIds.has(l.userId)));
        setTeamOvertime(
          allOvertime
            .filter((r) => r.status === 'approved' && teammateIds.has(r.userId))
            .map((r) => ({ userId: r.userId, date: r.date, minutes: r.minutes || 0, siteId: r.siteId || '' }))
        );
        setSiteMap(Object.fromEntries(allSites.map((s) => [s.id, s.name])));
      } catch (err) { /* 네트워크 실패 시 빈 캘린더 */ console.error(err); }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, canApproveLeave, userProfile?.departmentId, userProfile?.uid, users, calYear, calMonth]);

  // 날짜별 이벤트 맵 생성 — { 'YYYY-MM-DD': [{userId, kind, label, type}] }
  const calendarEventsByDate = useMemo(() => {
    const map = {};
    const push = (date, ev) => { (map[date] = map[date] || []).push(ev); };
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
        siteName: r.siteId ? (siteMap[r.siteId] || '') : '',
      });
    });
    return map;
  }, [teamLeaves, teamOvertime, calYear, calMonth, userMap, siteMap]);

  function shiftCalMonth(delta) {
    let y = calYear;
    let m = calMonth + delta;
    if (m < 1) { m = 12; y -= 1; }
    else if (m > 12) { m = 1; y += 1; }
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
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) { while (week.length < 7) week.push(null); weeks.push(week); }
    return weeks;
  }

  function openCreate() {
    setEditTeam(null);
    setForm({ name: '', managerId: '', subManagerId: '', memberIds: [] });
    setShowModal(true);
  }

  function openEdit(team) {
    setEditTeam(team);
    const memberIds = users
      .filter((u) => u.departmentId === team.id)
      .map((u) => u.uid);
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
    } catch (err) {
      alert('저장 오류: ' + err.message);
    }
  }

  async function handleDelete(team) {
    if (!confirm(`"${team.name}" 팀을 삭제하시겠습니까?\n소속 팀원의 부서가 초기화됩니다.`)) return;
    try {
      const members = users.filter((u) => u.departmentId === team.id);
      for (const u of members) {
        await updateUser(u.uid, { departmentId: '', isTeamLeader: false, isSubTeamLeader: false });
      }
      await deleteDepartment(team.id);
      await loadData();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  function toggleMember(uid) {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid)
        ? f.memberIds.filter((x) => x !== uid)
        : [...f.memberIds, uid],
    }));
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  // === 일반 직원 뷰: 소속 팀 + 팀원 이름/직급만 ===
  if (!isAdmin && !canApproveLeave) {
    const myTeam = teams[0];
    const rankOf = (uid) => (myTeam?.managerId === uid ? 0 : myTeam?.subManagerId === uid ? 1 : 2);
    const members = myTeam ? users.filter((u) => u.departmentId === myTeam.id).sort((a, b) => rankOf(a.uid) - rankOf(b.uid)) : [];
    const leader = myTeam ? userMap[myTeam.managerId] : null;
    const subLeader = myTeam && myTeam.subManagerId ? userMap[myTeam.subManagerId] : null;
    return (
      <div className="manage-team-page">
        <div className="page-header">
          <h2>우리 팀{myTeam && ` — ${myTeam.name}`}</h2>
        </div>
        {!myTeam ? (
          <div className="card"><div className="card-body empty-state">소속된 팀이 없습니다. 관리자에게 문의해주세요.</div></div>
        ) : (
          <>
            {(leader || subLeader) && (
              <div className="meta-bar" style={{ marginBottom: 12 }}>
                {leader && <span>팀장: <strong>{leader.name}</strong> {leader.position && `(${leader.position})`}</span>}
                {subLeader && <span style={{ marginLeft: leader ? 12 : 0 }}>부팀장: <strong>{subLeader.name}</strong> {subLeader.position && `(${subLeader.position})`}</span>}
              </div>
            )}
            <table className="table">
              <thead>
                <tr><th>이름</th><th>직급</th></tr>
              </thead>
              <tbody>
                {members.map((u) => (
                  <tr key={u.uid}>
                    <td>
                      <strong>{u.name}</strong>
                      {u.uid === myTeam.managerId && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>팀장</span>}
                      {u.uid === myTeam.subManagerId && <span className="badge badge-role-manager" style={{ marginLeft: 6 }}>부팀장</span>}
                      {u.uid === userProfile.uid && <span className="badge badge-position" style={{ marginLeft: 6 }}>나</span>}
                    </td>
                    <td>{u.position || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 팀원 일정 캘린더 — 본인 잔업/연차는 제외 */}
            <div className="team-calendar-section">
              <div className="team-calendar-head">
                <div className="team-calendar-title">
                  <strong>팀원 일정</strong>
                  <span className="team-calendar-hint">· 본인 잔업/연차 제외</span>
                </div>
                <div className="team-calendar-nav">
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftCalMonth(-1)} aria-label="이전 달">‹</button>
                  <span className="team-calendar-ym">{calYear}년 {calMonth}월</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => shiftCalMonth(1)} aria-label="다음 달">›</button>
                </div>
              </div>

              <div className="team-calendar">
                <div className="team-calendar-dow-row">
                  {['일','월','화','수','목','금','토'].map((dn, i) => (
                    <div key={dn} className={`team-calendar-dow ${i === 0 ? 'sunday' : i === 6 ? 'saturday' : ''}`}>{dn}</div>
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
                          onClick={() => setSelectedCalDay(selectedCalDay === dateStr ? null : dateStr)}
                          disabled={events.length === 0}
                        >
                          <span className="team-cal-day">{d}</span>
                          <div className="team-cal-events team-cal-events-dots">
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

              {selectedCalDay && (() => {
                const evs = calendarEventsByDate[selectedCalDay] || [];
                const [y, m, d] = selectedCalDay.split('-');
                return (
                  <div className="team-calendar-day-detail">
                    <div className="team-calendar-day-detail-head">
                      <strong>{Number(m)}월 {Number(d)}일</strong>
                      <span className="team-calendar-hint">· {evs.length}건</span>
                      <button type="button" className="team-calendar-close" onClick={() => setSelectedCalDay(null)} aria-label="닫기">✕</button>
                    </div>
                    <ul className="team-calendar-day-list">
                      {evs.map((e, i) => (
                        <li key={i}>
                          <span className={`team-cal-ev-dot team-cal-ev-${e.kind}${e.kind === 'leave' ? ` team-cal-ev-leave-${e.type || 'annual'}` : ''}`} />
                          <strong>{e.label}</strong>
                          <span className="team-calendar-ev-detail">
                            {e.kind === 'leave' ? leaveTypeLabel(e.type) : `잔업 ${formatMinutes(e.minutes)}`}
                          </span>
                          {e.kind === 'overtime' && e.siteName && (
                            <span className="team-calendar-ev-site">{e.siteName}</span>
                          )}
                        </li>
                      ))}
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
          <div className="card"><div className="card-body empty-state">소속 팀원이 없습니다.</div></div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>이름</th><th>직급</th><th>이번 달 잔업</th></tr>
            </thead>
            <tbody>
              {members.map((u) => {
                const minutes = overtimeMap[u.uid] || 0;
                return (
                  <tr key={u.uid}>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.position || '-'}</td>
                    <td>{minutes > 0 ? <strong style={{ color: 'var(--primary)' }}>{formatMinutes(minutes)}</strong> : '-'}</td>
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
          <button className="btn btn-primary" onClick={openCreate}>팀 추가</button>
        </div>
      </div>
      <p className="field-hint">
        팀을 구성하고 팀장을 지정하면, 팀원이 연차 신청 시 해당 팀장에게 승인 대기가 표시됩니다.
      </p>

      {teams.length === 0 ? (
        <div className="card"><div className="card-body empty-state">등록된 팀이 없습니다.</div></div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>팀 이름</th><th>팀장</th><th>부팀장</th><th>팀원</th><th>작업</th></tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const leader = userMap[t.managerId];
              const subLeader = userMap[t.subManagerId];
              const members = getTeamMembers(t.id);
              return (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{leader?.name || '-'}</td>
                  <td>{subLeader?.name || '-'}</td>
                  <td>{members.length}명</td>
                  <td>
                    <button className="btn btn-sm btn-outline" onClick={() => openEdit(t)}>수정</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t)}>삭제</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editTeam ? '팀 수정' : '팀 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>팀 이름 *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="예: 전장 1팀" />
          </div>
          <div className="form-group">
            <label>팀장 선택 *</label>
            <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} required>
              <option value="">선택</option>
              {users.filter((u) => {
                if (u.role === 'admin') return false;
                if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                return true;
              }).map((u) => (
                <option key={u.uid} value={u.uid}>{u.name} ({u.code}){u.position && ` · ${u.position}`}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>부팀장 선택 (선택사항)</label>
            <select value={form.subManagerId} onChange={(e) => setForm({ ...form, subManagerId: e.target.value })}>
              <option value="">선택 안 함</option>
              {users.filter((u) => {
                if (u.role === 'admin') return false;
                if (u.uid === form.managerId) return false;
                if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                return true;
              }).map((u) => (
                <option key={u.uid} value={u.uid}>{u.name} ({u.code}){u.position && ` · ${u.position}`}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>팀원 선택</label>
            <button
              type="button"
              className="select-dropdown-toggle"
              onClick={() => setMemberListOpen(!memberListOpen)}
            >
              <span>{form.memberIds.length > 0 ? `${form.memberIds.length}명 선택됨` : '팀원을 선택하세요'}</span>
              <span className="select-dropdown-arrow">{memberListOpen ? '▲' : '▼'}</span>
            </button>
            {memberListOpen && (
              <div className="select-dropdown-list">
                {users.filter((u) => {
                  if (u.role === 'admin') return false;
                  if (u.uid === form.managerId) return false;
                  if (u.uid === form.subManagerId) return false;
                  if (u.departmentId && u.departmentId !== (editTeam?.id || '')) return false;
                  return true;
                }).map((u) => {
                  const checked = form.memberIds.includes(u.uid);
                  return (
                    <label key={u.uid} className={`select-list-item ${checked ? 'is-checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleMember(u.uid)} />
                      <span className="select-list-name">{u.name}</span>
                      <span className="select-list-sub">{u.code}{u.position && ` · ${u.position}`}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">{editTeam ? '수정' : '추가'}</button>
            <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
