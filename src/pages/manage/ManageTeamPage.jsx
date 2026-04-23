import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getUsers, updateUser } from '../../services/userService';
import { getDepartments, getDepartmentsByLeader, addDepartment, updateDepartment, deleteDepartment } from '../../services/departmentService';
import { getMyOvertimeRecords } from '../../services/attendanceService';
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
              .filter((r) => r.status !== 'rejected')
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
