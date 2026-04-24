import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers, updateUser, createUser, deleteUser } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { initLeaveBalance, getLeaveBalance, setLeaveRemaining } from '../../services/leaveService';
import { POSITIONS } from '../../utils/constants';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';

export default function UserManagementPage() {
  const { impersonate, userProfile } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({
    name: '', code: '', password: '', role: 'employee', position: '', departmentId: '', joinDate: '', fixedCost: '', hourlyRate: '',
    leaveRemaining: '', canViewSalary: false,
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [u, d] = await Promise.all([getUsers(), getDepartments()]);
      setUsers(u);
      setDepartments(d);

      const balMap = {};
      await Promise.all(u.map(async (usr) => {
        const bal = await getLeaveBalance(usr.uid).catch(() => null);
        if (bal) balMap[usr.uid] = bal;
      }));
      setBalances(balMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncAll() {
    if (!confirm('전체 사용자의 입사일을 연차 데이터에 동기화하시겠습니까?\n(사용 일수는 유지됩니다)')) return;
    try {
      for (const u of users) {
        if (u.joinDate) await initLeaveBalance(u.uid, u.joinDate);
      }
      await loadData();
      alert('동기화 완료');
    } catch (err) {
      alert('동기화 오류: ' + err.message);
    }
  }

  function openCreate() {
    setEditUser(null);
    setForm({ name: '', code: '', password: '', role: 'employee', position: '', departmentId: '', joinDate: '', fixedCost: '', hourlyRate: '', leaveRemaining: '', canViewSalary: false });
    setShowModal(true);
  }

  function openEdit(user) {
    const bal = balances[user.uid];
    setEditUser(user);
    setForm({
      name: user.name, code: user.code || '', password: '',
      role: user.role, position: user.position || '', departmentId: user.departmentId || '', joinDate: user.joinDate || '',
      fixedCost: user.fixedCost || '', hourlyRate: user.hourlyRate || '',
      leaveRemaining: bal ? String(bal.remainingDays) : '',
      canViewSalary: !!user.canViewSalary,
    });
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      let targetUid;
      if (editUser) {
        targetUid = editUser.uid;
        const updateData = {
          name: form.name, code: form.code, role: form.role,
          position: form.position, departmentId: form.departmentId, joinDate: form.joinDate,
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
          canViewSalary: !!form.canViewSalary,
        };
        if (form.password !== '') updateData.password = form.password;
        await updateUser(editUser.uid, updateData);
        if (form.joinDate) await initLeaveBalance(editUser.uid, form.joinDate);
      } else {
        const userId = 'user_' + Date.now();
        targetUid = userId;
        await createUser(userId, {
          uid: userId, name: form.name, code: form.code, role: form.role,
          position: form.position, departmentId: form.departmentId, joinDate: form.joinDate,
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
          canViewSalary: !!form.canViewSalary,
          ...(form.password !== '' && { password: form.password }),
        });
        if (form.joinDate) await initLeaveBalance(userId, form.joinDate);
      }

      // 연차 잔여 조정: 편집 중 현재 잔여와 다르면 업데이트
      if (form.leaveRemaining !== '' && !isNaN(Number(form.leaveRemaining))) {
        const currentBal = editUser ? balances[editUser.uid] : null;
        const newRemaining = Number(form.leaveRemaining);
        if (!currentBal || currentBal.remainingDays !== newRemaining) {
          await setLeaveRemaining(targetUid, newRemaining);
        }
      }

      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleDelete(user) {
    if (!confirm(`"${user.name}" 직원을 삭제하시겠습니까?`)) return;
    try {
      await deleteUser(user.uid);
      setShowModal(false);
      await loadData();
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  async function handleResetPassword() {
    if (!editUser) return;
    if (!confirm(`"${editUser.name}"의 비밀번호를 초기화하시겠습니까?\n본인이 다음 로그인 시 새 비밀번호를 직접 설정합니다.`)) return;
    try {
      await updateUser(editUser.uid, { password: '' });
      setForm((f) => ({ ...f, password: '' }));
      setEditUser((u) => u ? { ...u, password: '' } : u);
      await loadData();
      alert(`${editUser.name} 비밀번호 초기화 완료. 다음 로그인 시 비밀번호 설정 화면으로 이동합니다.`);
    } catch (err) {
      alert('초기화 실패: ' + err.message);
    }
  }

  async function handleImpersonate(u) {
    if (u.uid === userProfile?.uid) { alert('이미 본인 계정으로 로그인 중입니다.'); return; }
    if (!confirm(`${u.name}(${u.code}) 계정으로 전환하시겠습니까?\n상단 배너의 "관리자로 돌아가기"로 복귀할 수 있습니다.`)) return;
    try {
      await impersonate(u);
      navigate('/');
    } catch (err) {
      alert('전환 오류: ' + err.message);
    }
  }

  const deptMap = {};
  departments.forEach((d) => { deptMap[d.id] = d.name; });

  const EXECUTIVE_POSITIONS = ['대표', '부사장'];
  function getSalaryPermissionReason(u) {
    if (u.role === 'admin') return '관리자';
    if (EXECUTIVE_POSITIONS.includes(u.position)) return u.position;
    if (u.canViewSalary) return '권한 부여';
    return null;
  }
  const salaryViewers = users
    .map((u) => ({ user: u, reason: getSalaryPermissionReason(u) }))
    .filter((x) => x.reason);

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="user-management-page">
      <div className="page-header">
        <h2>직원 관리</h2>
        <div className="btn-group" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={openCreate}>직원 추가</button>
          <button className="btn btn-outline" onClick={handleSyncAll}>연차 동기화</button>
        </div>
      </div>
      <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
        ※ 누적 연차는 입사일 기준 자동 계산됩니다. "연차 수정"은 현재 잔여만 입력하면 이후 발생분은 자동 반영됩니다.
      </p>

      <div className="card" style={{ padding: 14, marginBottom: 16, background: 'var(--pastel-amber-bg, #fff8e7)', border: '1px solid var(--pastel-amber-border, #f2d48a)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>금액 열람 권한자 ({salaryViewers.length}명)</strong>
          <span className="text-muted text-sm">관리자·대표·부사장은 자동 포함. 그 외 직원은 아래에서 권한 부여 가능.</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {salaryViewers.length === 0 ? (
            <span className="text-muted text-sm">권한자가 없습니다.</span>
          ) : (
            salaryViewers.map(({ user, reason }) => (
              <span
                key={user.uid}
                className="badge"
                onClick={() => openEdit(user)}
                style={{
                  cursor: 'pointer',
                  background: reason === '권한 부여' ? '#e0f2fe' : '#fef3c7',
                  color: '#374151',
                  border: '1px solid rgba(0,0,0,0.08)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 13,
                }}
              >
                {user.name} <span style={{ opacity: 0.6, marginLeft: 4 }}>({reason})</span>
              </span>
            ))
          )}
        </div>
      </div>

      <table className="table user-management-table table-clickable">
        <thead>
          <tr>
            <th>이름</th>
            <th>코드</th>
            <th>비밀번호</th>
            <th>직급</th>
            <th>부서</th>
            <th>고정비용</th>
            <th>시급</th>
            <th>입사일</th>
            <th>연차 (누적/사용/잔여)</th>
            <th style={{ width: 44 }} aria-label="로그인 전환"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const bal = balances[u.uid];
            const isSelf = u.uid === userProfile?.uid;
            return (
              <tr key={u.uid} onClick={() => openEdit(u)} style={{ cursor: 'pointer' }}>
                <td>{u.name}</td>
                <td><code>{u.code}</code></td>
                <td>
                  {u.password
                    ? <code style={{ fontSize: 13 }}>{u.password}</code>
                    : <span style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>✗ 미설정</span>}
                </td>
                <td>
                  <span className={`badge badge-position${u.position ? `-${u.position}` : ''}`}>
                    {u.position || '-'}
                  </span>
                </td>
                <td>{deptMap[u.departmentId] || '-'}</td>
                <td>{u.fixedCost ? Number(u.fixedCost).toLocaleString() + '원' : '-'}</td>
                <td>{u.hourlyRate ? Number(u.hourlyRate).toLocaleString() + '원' : '-'}</td>
                <td>{u.joinDate || '-'}</td>
                <td>
                  {bal ? (
                    <span className="leave-balance-cell">
                      <span className="leave-total">{bal.totalDays}</span>
                      <span className="leave-sep">/</span>
                      <span className="leave-used">{bal.usedDays}</span>
                      <span className="leave-sep">/</span>
                      <strong className="leave-remaining" style={bal.remainingDays < 0 ? { color: 'var(--danger, #dc2626)' } : undefined}>{bal.remainingDays}</strong>
                    </span>
                  ) : '-'}
                </td>
                <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: '6px 8px' }}>
                  <button
                    type="button"
                    className="impersonate-btn"
                    onClick={(e) => { e.stopPropagation(); handleImpersonate(u); }}
                    disabled={isSelf}
                    title={isSelf ? '본인 계정' : `${u.name}(${u.code}) 계정으로 로그인`}
                    aria-label={`${u.name} 계정으로 전환`}
                  >
                    →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editUser ? '사용자 수정' : '직원 추가'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>이름</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>로그인 코드</label>
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="예: 1234" required />
          </div>
          <div className="form-group">
            <label>
              비밀번호 {editUser && <span className="text-muted text-sm" style={{ fontWeight: 400 }}>(비워두면 기존 유지)</span>}
              {editUser && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger-outline"
                  onClick={handleResetPassword}
                  style={{ float: 'right', fontSize: 11, padding: '3px 8px' }}
                  title="비밀번호를 지워 다음 로그인 시 본인이 직접 재설정하게 함"
                >
                  초기화
                </button>
              )}
            </label>
            {editUser && editUser.password && (
              <div style={{ marginBottom: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                현재: <code style={{ background: 'var(--bg-subtle, #f1f5f9)', padding: '2px 6px', borderRadius: 4 }}>{editUser.password}</code>
              </div>
            )}
            {editUser && !editUser.password && (
              <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--danger, #dc2626)', fontWeight: 600 }}>
                ✓ 초기화됨 — 다음 로그인 시 본인이 비밀번호 설정
              </div>
            )}
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editUser ? '변경 시에만 입력' : '비밀번호 입력'} autoComplete="new-password" />
          </div>
          <div className="form-group">
            <label>직급</label>
            <select value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">없음</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>부서</label>
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
              <option value="">선택</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>고정비용 (월급, 원)</label>
            <MoneyInput value={form.fixedCost} onChange={(e) => setForm({ ...form, fixedCost: e.target.value })} placeholder="예: 3,000,000" />
          </div>
          <div className="form-group">
            <label>시급 (잔업 단가, 원)</label>
            <MoneyInput value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} placeholder="예: 15,000" />
          </div>
          {form.role !== 'admin' && (
            <div className="form-group">
              <label>입사일</label>
              <input type="date" value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} required />
            </div>
          )}
          {(() => {
            const autoGranted = form.role === 'admin' || EXECUTIVE_POSITIONS.includes(form.position);
            const on = autoGranted || !!form.canViewSalary;
            return (
              <div className="form-group">
                <div className="toggle-row">
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">금액 열람 권한</span>
                    <small className="text-muted">
                      {autoGranted
                        ? '관리자/대표/부사장은 자동으로 부여됩니다.'
                        : '프로젝트 단가·고정비용 등 금액 정보 열람 여부'}
                    </small>
                  </div>
                  <label className={`toggle-switch${autoGranted ? ' is-locked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={autoGranted}
                      onChange={(e) => setForm({ ...form, canViewSalary: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
            );
          })()}
          {editUser && balances[editUser.uid] && (
            <div className="form-group">
              <label>
                잔여 연차 조정 (일)
                <span className="text-muted text-sm" style={{ marginLeft: 8, fontWeight: 400 }}>
                  누적 {balances[editUser.uid].totalDays}일 · 사용 {balances[editUser.uid].usedDays}일
                </span>
              </label>
              <input type="number" step="0.25" value={form.leaveRemaining} onChange={(e) => setForm({ ...form, leaveRemaining: e.target.value })} placeholder="현재 잔여 일수 (음수 입력 가능)" />
              <small className="text-muted">
                현재 잔여 일수를 입력하면 반영됩니다. 초과 사용 시 음수(-) 입력 가능. 이후 발생분은 자동 계산됩니다.
              </small>
            </div>
          )}
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            {editUser ? (
              <button type="button" className="btn btn-danger" onClick={() => handleDelete(editUser)}>삭제</button>
            ) : <span />}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>취소</button>
              <button type="submit" className="btn btn-primary">{editUser ? '수정' : '추가'}</button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
