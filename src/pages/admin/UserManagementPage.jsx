import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUsers, updateUser, createUser, seedSiteCreatorsIfNeeded } from '../../services/userService';
import { getDepartments } from '../../services/departmentService';
import { initLeaveBalance, getLeaveBalance, setLeaveRemaining } from '../../services/leaveService';
import { isRealStaff } from '../../utils/workspace';
import { trashGeneric } from '../../services/trashService';
import { setUserResigned } from '../../services/userService';
import { POSITIONS } from '../../utils/constants';
import { useAuth } from '../../contexts/useAuth';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import MoneyInput from '../../components/common/MoneyInput';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import { useDialog } from '../../components/common/useDialog';

function useViewportWidth() {
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1024));
  useEffect(() => {
    const handler = () => setVw(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return vw;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function UserManagementPage() {
  const { confirm, alert, toast } = useDialog();
  const { impersonate, userProfile } = useAuth();
  const navigate = useNavigate();
  const vw = useViewportWidth();
  const isSmall = vw <= 600;
  const isXSmall = vw <= 360;
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [view, setView] = useState('active'); // 'active' | 'resigned'
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({
    name: '',
    code: '',
    password: '',
    role: 'employee',
    position: '',
    departmentId: '',
    joinDate: '',
    fixedCost: '',
    hourlyRate: '',
    phone: '',
    leaveRemaining: '',
    canViewSalary: false,
    canCreateSite: false,
    canViewArchive: false,
    productionAccess: false,
    purchaseAccess: false,
    productionDefectOnly: false,
    usesVehicle: false,
    vehiclePlate: '',
    vehicleMonthlyCost: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [loadedUsers, d] = await Promise.all([getUsers(), getDepartments()]);
      let u = loadedUsers;
      // 일회성 — 명단 직원에게 프로젝트 추가 권한 부여 (한 번만 실행)
      const seedNames = ['이종현', '손성욱', '이주현', '하성민', '박정현'];
      const granted = await seedSiteCreatorsIfNeeded(seedNames, u).catch(() => []);
      if (granted.length > 0) u = await getUsers();
      setUsers(u);
      setDepartments(d);

      const balMap = {};
      await Promise.all(
        u.map(async (usr) => {
          const bal = await getLeaveBalance(usr.uid).catch(() => null);
          if (bal) balMap[usr.uid] = bal;
        }),
      );
      setBalances(balMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setEditUser(null);
    setForm({
      name: '',
      code: '',
      password: '',
      role: 'employee',
      position: '',
      departmentId: '',
      joinDate: '',
      fixedCost: '',
      hourlyRate: '',
      phone: '',
      leaveRemaining: '',
      canViewSalary: false,
      canCreateSite: false,
      canViewArchive: false,
      productionAccess: false,
      purchaseAccess: false,
      productionDefectOnly: false,
      usesVehicle: false,
      vehiclePlate: '',
      vehicleMonthlyCost: '',
    });
    setShowModal(true);
  }

  function openEdit(user) {
    const bal = balances[user.uid];
    setEditUser(user);
    setForm({
      name: user.name,
      code: user.code || '',
      password: '',
      role: user.role,
      position: user.position || '',
      departmentId: user.departmentId || '',
      joinDate: user.joinDate || '',
      fixedCost: user.fixedCost || '',
      hourlyRate: user.hourlyRate || '',
      phone: user.phone || '',
      leaveRemaining: bal ? String(bal.remainingDays) : '',
      canViewSalary: !!user.canViewSalary,
      canCreateSite: !!user.canCreateSite,
      canViewArchive: !!user.canViewArchive,
      productionAccess: !!user.productionAccess,
      purchaseAccess: !!user.purchaseAccess,
      productionDefectOnly: !!user.productionDefectOnly,
      usesVehicle: !!user.usesVehicle,
      vehiclePlate: user.vehiclePlate || '',
      vehicleMonthlyCost: user.vehicleMonthlyCost ? Number(user.vehicleMonthlyCost).toLocaleString() : '',
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
          name: form.name,
          code: form.code,
          role: form.role,
          position: form.position,
          departmentId: form.departmentId,
          joinDate: form.joinDate,
          phone: (form.phone || '').trim(),
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
          canViewSalary: !!form.canViewSalary,
          canCreateSite: !!form.canCreateSite,
          canViewArchive: !!form.canViewArchive,
          productionAccess: !!form.productionAccess,
          purchaseAccess: !!form.purchaseAccess,
          productionDefectOnly: !!form.productionDefectOnly,
          usesVehicle: !!form.usesVehicle,
          vehiclePlate: form.usesVehicle ? (form.vehiclePlate || '').trim() : '',
          vehicleMonthlyCost: form.usesVehicle ? Number(String(form.vehicleMonthlyCost).replace(/[^\d]/g, '')) || 0 : 0,
        };
        if (form.password !== '') updateData.password = form.password;
        await updateUser(editUser.uid, updateData);
        // 현장 공용 아이디는 연차가 없다 — 입사일도 안 받는다
        if (form.joinDate && !form.productionDefectOnly) await initLeaveBalance(editUser.uid, form.joinDate);
      } else {
        const userId = 'user_' + Date.now();
        targetUid = userId;
        await createUser(userId, {
          uid: userId,
          name: form.name,
          code: form.code,
          role: form.role,
          position: form.position,
          departmentId: form.departmentId,
          joinDate: form.joinDate,
          phone: (form.phone || '').trim(),
          fixedCost: Number(form.fixedCost) || 0,
          hourlyRate: Number(form.hourlyRate) || 0,
          canViewSalary: !!form.canViewSalary,
          canCreateSite: !!form.canCreateSite,
          canViewArchive: !!form.canViewArchive,
          productionAccess: !!form.productionAccess,
          purchaseAccess: !!form.purchaseAccess,
          productionDefectOnly: !!form.productionDefectOnly,
          usesVehicle: !!form.usesVehicle,
          vehiclePlate: form.usesVehicle ? (form.vehiclePlate || '').trim() : '',
          vehicleMonthlyCost: form.usesVehicle ? Number(String(form.vehicleMonthlyCost).replace(/[^\d]/g, '')) || 0 : 0,
          ...(form.password !== '' && { password: form.password }),
        });
        if (form.joinDate && !form.productionDefectOnly) await initLeaveBalance(userId, form.joinDate);
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
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // 퇴사 처리 — 지우지 않는다. 근태·연차·잔업 기록이 uid 로 매여 있어
  // 직원을 지우면 과거 기록에서 이름이 사라진다.
  async function handleResign(user) {
    const ok = await confirm({
      title: '퇴사 처리',
      message:
        `"${user.name}"을(를) 퇴사 처리합니다. ` +
        '지금까지의 근태·연차·잔업 기록은 그대로 남고, ' +
        '앞으로 담당자·팀원을 고르는 자리에는 나타나지 않습니다.',
    });
    if (!ok) return;
    try {
      await setUserResigned(user.uid, true, userProfile?.name || '');
      toast(`${user.name} 퇴사 처리했습니다`, 'success');
      setShowModal(false);
      await loadData();
    } catch {
      toast('퇴사 처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleRejoin(user) {
    const ok = await confirm({ title: '복직 처리', message: `"${user.name}"을(를) 재직 상태로 되돌립니다.` });
    if (!ok) return;
    try {
      await setUserResigned(user.uid, false);
      toast(`${user.name} 복직 처리했습니다`, 'success');
      setShowModal(false);
      await loadData();
    } catch {
      toast('복직 처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(user) {
    if (
      !(await confirm(
        `"${user.name}" 직원을 삭제하시겠습니까?\n퇴사한 직원이라면 삭제 대신 「퇴사 처리」를 쓰세요 — 기록이 그대로 남습니다.`,
      ))
    )
      return;
    try {
      await trashGeneric(
        'users',
        user.uid,
        {
          title: user.name,
          summary: [user.position, user.code].filter(Boolean).join(' · '),
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      setShowModal(false);
      await loadData();
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleResetPassword() {
    if (!editUser) return;
    if (
      !(await confirm(
        `"${editUser.name}"의 비밀번호를 초기화하시겠습니까?\n본인이 다음 로그인 시 새 비밀번호를 직접 설정합니다.`,
      ))
    )
      return;
    try {
      await updateUser(editUser.uid, { password: '' });
      setForm((f) => ({ ...f, password: '' }));
      setEditUser((u) => (u ? { ...u, password: '' } : u));
      await loadData();
      toast(`${editUser.name} 비밀번호 초기화 완료. 다음 로그인 시 비밀번호 설정 화면으로 이동합니다.`);
    } catch {
      toast('초기화 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleImpersonate(u) {
    if (u.uid === userProfile?.uid) {
      alert('이미 본인 계정으로 로그인 중입니다.');
      return;
    }
    if (
      !(await confirm(
        `${u.name}(${u.code}) 계정으로 전환하시겠습니까?\n상단 배너의 "관리자로 돌아가기"로 복귀할 수 있습니다.`,
      ))
    )
      return;
    try {
      await impersonate(u);
      navigate('/');
    } catch {
      toast('전환 중 오류가 발생했습니다', 'error');
    }
  }

  const deptMap = {};
  departments.forEach((d) => {
    deptMap[d.id] = d.name;
  });

  const EXECUTIVE_POSITIONS = ['대표', '부사장'];
  function getSalaryPermissionReason(u) {
    if (u.role === 'admin') return '관리자';
    if (EXECUTIVE_POSITIONS.includes(u.position)) return u.position;
    if (u.canViewSalary) return '권한 부여';
    return null;
  }
  // 재직·퇴사를 나눠 본다. 퇴사자는 지운 것이 아니라 접어둔 것이다.
  const activeUsers = users.filter((u) => u.isActive !== false);
  // 공용 아이디는 계정이지 사람이 아니다 — 목록에는 두되 인원 수에서는 뺀다
  const activeStaffCount = activeUsers.filter(isRealStaff).length;
  const resignedUsers = users.filter((u) => u.isActive === false);
  const shownUsers = view === 'resigned' ? resignedUsers : activeUsers;

  const salaryViewers = users.map((u) => ({ user: u, reason: getSalaryPermissionReason(u) })).filter((x) => x.reason);

  function getCreateSiteReason(u) {
    if (u.role === 'admin') return '관리자';
    if (u.canCreateSite) return '권한 부여';
    return null;
  }
  const siteCreators = users.map((u) => ({ user: u, reason: getCreateSiteReason(u) })).filter((x) => x.reason);

  function getArchiveViewReason(u) {
    if (u.role === 'admin') return '관리자';
    if (EXECUTIVE_POSITIONS.includes(u.position)) return u.position;
    if (u.canViewArchive) return '권한 부여';
    return null;
  }
  const archiveViewers = users.map((u) => ({ user: u, reason: getArchiveViewReason(u) })).filter((x) => x.reason);

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="user-management-page">
      <div className="page-header">
        <h2>직원 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            직원 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['users']}
        title="직원 휴지통"
        onChange={loadData}
      />
      <p className="text-muted text-sm" style={{ marginBottom: 12 }}>
        ※ 누적 연차는 입사일 기준 자동 계산됩니다. "연차 수정"은 현재 잔여만 입력하면 이후 발생분은 자동 반영됩니다.
      </p>

      <div
        className="card permission-cards"
        style={{
          padding: isXSmall ? '6px 8px' : 'var(--space-3, 11px)',
          marginBottom: isXSmall ? 8 : 'var(--space-2, 8px)',
          background: 'var(--accent-soft, #feefe7)',
          border: '1px solid var(--accent-tint, #f6d3c4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-2, 8px)',
            flexWrap: 'wrap',
            gap: 'var(--space-2, 8px)',
            lineHeight: 1.3,
          }}
        >
          <strong style={{ fontSize: 14 }}>금액 열람 권한자 ({salaryViewers.length}명)</strong>
          <span className="text-muted" style={{ fontSize: 12 }}>
            관리자·대표·부사장은 자동 포함. 그 외 직원은 아래에서 권한 부여 가능.
          </span>
        </div>
        <div
          className="permission-badge-row"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${isXSmall ? '90px' : '110px'}, 1fr))`,
            gap: isXSmall ? 4 : 'var(--space-2, 8px)',
          }}
        >
          {salaryViewers.length === 0 ? (
            <span className="text-muted text-sm">권한자가 없습니다.</span>
          ) : (
            salaryViewers.map(({ user, reason }) => (
              <span
                key={user.uid}
                className="badge permission-badge"
                onClick={() => openEdit(user)}
                title={`${user.name} (${reason})`}
                style={{
                  cursor: 'pointer',
                  background: reason === '권한 부여' ? 'var(--primary-soft, #e6ecf5)' : 'var(--accent-soft, #fde8df)',
                  color: 'var(--text, #1f2937)',
                  border: '1px solid rgba(0,32,80,0.12)',
                  padding: isXSmall ? '0px 3px' : '1px 5px',
                  borderRadius: 999,
                  fontSize: isXSmall ? 10 : 11,
                  height: isXSmall ? 18 : 20,
                  lineHeight: isXSmall ? '18px' : '20px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.name} <span style={{ opacity: 0.6, marginLeft: 3 }}>({reason})</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div
        className="card permission-cards"
        style={{
          padding: isXSmall ? '6px 8px' : 'var(--space-3, 11px)',
          marginBottom: isXSmall ? 8 : 'var(--space-2, 8px)',
          background: 'var(--primary-soft, #e6ecf5)',
          border: '1px solid var(--primary-tint, #c2cee0)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-2, 8px)',
            flexWrap: 'wrap',
            gap: 'var(--space-2, 8px)',
            lineHeight: 1.3,
          }}
        >
          <strong style={{ fontSize: 14 }}>프로젝트 추가 권한자 ({siteCreators.length}명)</strong>
          <span className="text-muted" style={{ fontSize: 12 }}>
            관리자는 자동 포함. 그 외 직원은 아래 직원 행을 눌러 권한 부여.
          </span>
        </div>
        <div
          className="permission-badge-row"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${isXSmall ? '90px' : '110px'}, 1fr))`,
            gap: isXSmall ? 4 : 'var(--space-2, 8px)',
          }}
        >
          {siteCreators.length === 0 ? (
            <span className="text-muted text-sm">권한자가 없습니다.</span>
          ) : (
            siteCreators.map(({ user, reason }) => (
              <span
                key={user.uid}
                className="badge permission-badge"
                onClick={() => openEdit(user)}
                title={`${user.name} (${reason})`}
                style={{
                  cursor: 'pointer',
                  background: reason === '권한 부여' ? 'var(--primary-soft, #e6ecf5)' : 'var(--primary-tint, #d7e0ee)',
                  color: 'var(--text, #1f2937)',
                  border: '1px solid rgba(0,32,80,0.12)',
                  padding: isXSmall ? '0px 3px' : '1px 5px',
                  borderRadius: 999,
                  fontSize: isXSmall ? 10 : 11,
                  height: isXSmall ? 18 : 20,
                  lineHeight: isXSmall ? '18px' : '20px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.name} <span style={{ opacity: 0.6, marginLeft: 3 }}>({reason})</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div
        className="card permission-cards"
        style={{
          padding: isXSmall ? '6px 8px' : 'var(--space-3, 11px)',
          marginBottom: isXSmall ? 8 : 'var(--space-2, 8px)',
          background: 'var(--bg-secondary, #eef1f5)',
          border: '1px solid var(--border, #d5dbe4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 'var(--space-2, 8px)',
            flexWrap: 'wrap',
            gap: 'var(--space-2, 8px)',
            lineHeight: 1.3,
          }}
        >
          <strong style={{ fontSize: 14 }}>자료실 열람 권한자 ({archiveViewers.length}명)</strong>
          <span className="text-muted" style={{ fontSize: 12 }}>
            관리자·대표·부사장은 자동 포함. 그 외 직원은 아래 직원 행을 눌러 권한 부여.
          </span>
        </div>
        <div
          className="permission-badge-row"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${isXSmall ? '90px' : '110px'}, 1fr))`,
            gap: isXSmall ? 4 : 'var(--space-2, 8px)',
          }}
        >
          {archiveViewers.length === 0 ? (
            <span className="text-muted text-sm">권한자가 없습니다.</span>
          ) : (
            archiveViewers.map(({ user, reason }) => (
              <span
                key={user.uid}
                className="badge permission-badge"
                onClick={() => openEdit(user)}
                title={`${user.name} (${reason})`}
                style={{
                  cursor: 'pointer',
                  background: reason === '권한 부여' ? 'var(--primary-soft, #e6ecf5)' : 'var(--bg-card, #ffffff)',
                  color: 'var(--text, #1f2937)',
                  border: '1px solid rgba(0,32,80,0.12)',
                  padding: isXSmall ? '0px 3px' : '1px 5px',
                  borderRadius: 999,
                  fontSize: isXSmall ? 10 : 11,
                  height: isXSmall ? 18 : 20,
                  lineHeight: isXSmall ? '18px' : '20px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.name} <span style={{ opacity: 0.6, marginLeft: 3 }}>({reason})</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="purchase-filters no-print" style={{ marginBottom: 12 }}>
        {[
          { k: 'active', label: '재직', n: activeStaffCount },
          { k: 'resigned', label: '퇴사', n: resignedUsers.length },
        ].map((o) => (
          <button
            key={o.k}
            type="button"
            className={`btn btn-sm ${view === o.k ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setView(o.k)}
          >
            {o.label} {o.n}
          </button>
        ))}
      </div>

      <div className="table-scroll-x">
        <table className="table user-management-table table-clickable cards-sm">
          <thead>
            <tr>
              <th scope="col">이름</th>
              <th scope="col">코드</th>
              <th scope="col" style={isSmall ? { display: 'none' } : undefined}>
                직급
              </th>
              <th scope="col" style={isSmall ? { display: 'none' } : undefined}>
                연락처
              </th>
              <th scope="col">부서</th>
              <th scope="col">고정비용</th>
              <th scope="col" style={isSmall ? { display: 'none' } : undefined}>
                시급
              </th>
              <th scope="col" style={isSmall ? { display: 'none' } : undefined}>
                {view === 'resigned' ? '퇴사일' : '입사일'}
              </th>
              <th scope="col">연차 (누적/사용/잔여)</th>
              <th scope="col" style={{ width: 44 }} aria-label="로그인 전환"></th>
            </tr>
          </thead>
          <tbody>
            {shownUsers.map((u) => {
              const bal = balances[u.uid];
              const isSelf = u.uid === userProfile?.uid;
              return (
                <tr key={u.uid} onClick={() => openEdit(u)} style={{ cursor: 'pointer', height: 36 }}>
                  <td
                    data-label="이름"
                    title={u.name}
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word', minHeight: 36 }}
                  >
                    {u.name}
                    {/* 공용 아이디는 사람이 아니라 계정 — 목록에서 한눈에 갈리게 */}
                    {!isRealStaff(u) && <span className="user-shared-tag">공용</span>}
                    {u.isActive === false && (
                      <span className="purchase-badge purchase-badge-closed" style={{ marginLeft: 6 }}>
                        퇴사
                      </span>
                    )}
                  </td>
                  <td data-label="코드" title={u.code || ''} style={{ minHeight: 36 }}>
                    <code>{u.code}</code>
                  </td>
                  <td
                    data-label="직급"
                    title={u.position || ''}
                    style={isSmall ? { display: 'none' } : { minHeight: 36 }}
                  >
                    <span className={`badge badge-position${u.position ? `-${u.position}` : ''}`}>
                      {u.position || '-'}
                    </span>
                  </td>
                  <td
                    data-label="연락처"
                    title={u.phone || ''}
                    style={{
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      minHeight: 36,
                      ...(isSmall ? { display: 'none' } : {}),
                    }}
                  >
                    {u.phone || '-'}
                  </td>
                  <td data-label="부서" title={deptMap[u.departmentId] || ''} style={{ minHeight: 36 }}>
                    {deptMap[u.departmentId] || '-'}
                  </td>
                  <td data-label="고정비용" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, minHeight: 36 }}>
                    {u.fixedCost ? Number(u.fixedCost).toLocaleString() + '원' : '-'}
                  </td>
                  <td
                    data-label="시급"
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 12,
                      minHeight: 36,
                      ...(isSmall ? { display: 'none' } : {}),
                    }}
                  >
                    {u.hourlyRate ? Number(u.hourlyRate).toLocaleString() + '원' : '-'}
                  </td>
                  <td
                    data-label={view === 'resigned' ? '퇴사일' : '입사일'}
                    style={{ fontSize: 12, minHeight: 36, ...(isSmall ? { display: 'none' } : {}) }}
                  >
                    {view === 'resigned' ? fmtDate(u.resignedAt) : u.joinDate || '-'}
                  </td>
                  <td data-label="연차 (누적/사용/잔여)">
                    {bal ? (
                      <span
                        className="leave-balance-cell"
                        title={`누적 ${bal.totalDays} / 사용 ${bal.usedDays} / 잔여 ${bal.remainingDays}`}
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: 12,
                          whiteSpace: 'normal',
                          overflowWrap: 'break-word',
                          display: 'inline-flex',
                          flexWrap: 'wrap',
                          gap: 2,
                        }}
                      >
                        <span className="leave-total leave-balance-detail">{bal.totalDays}</span>
                        <span className="leave-sep leave-balance-detail">/</span>
                        <span className="leave-used leave-balance-detail">{bal.usedDays}</span>
                        <span className="leave-sep leave-balance-detail">/</span>
                        <strong
                          className="leave-remaining"
                          style={bal.remainingDays < 0 ? { color: 'var(--danger, #dc2626)' } : undefined}
                        >
                          {bal.remainingDays}
                        </strong>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: '6px 8px' }}>
                    <button
                      type="button"
                      className="impersonate-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleImpersonate(u);
                      }}
                      disabled={isSelf}
                      title={isSelf ? '본인 계정' : `${u.name}(${u.code}) 계정으로 로그인`}
                      aria-label={`${u.name} 계정으로 전환`}
                    >
                      <Icon name="chevronRight" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editUser ? '사용자 수정' : '직원 추가'}>
        <form onSubmit={handleSubmit}>
          {/* 현장 공용 아이디 — 이름·코드·비밀번호만 받는다.
              입사일·급여·연차 같은 인사 정보는 쓸 일이 없어 켜면 아래 칸이 접힌다 (2026-08-22 대표님) */}
          <div className="form-group">
            <div className="toggle-row">
              <div className="toggle-row-text">
                <span className="toggle-row-title">불량 조치 전용 (현장 공용)</span>
                <small className="text-muted">
                  여러 사람이 함께 쓰는 현장 아이디입니다. 로그인하면 생산현황으로 바로 들어가 불량 확인·조치만 합니다.
                  인사 정보는 받지 않습니다.
                </small>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={!!form.productionDefectOnly}
                  onChange={(e) => setForm({ ...form, productionDefectOnly: e.target.checked })}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>이름</label>
            <input
              aria-label="이름"
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>로그인 코드</label>
            <input
              aria-label="로그인 코드"
              type="text"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="예: 1234"
              required
            />
          </div>
          <div className="form-group">
            <label>
              비밀번호{' '}
              {editUser && (
                <span className="text-muted text-sm" style={{ fontWeight: 400 }}>
                  (비워두면 기존 유지)
                </span>
              )}
              {editUser && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={handleResetPassword}
                  style={{ float: 'right', fontSize: 'var(--font-xs)', padding: 'var(--space-1) var(--space-2)' }}
                  title="비밀번호를 지워 다음 로그인 시 본인이 직접 재설정하게 함"
                >
                  초기화
                </button>
              )}
            </label>
            {editUser && !editUser.password && (
              <div
                style={{
                  marginBottom: 6,
                  fontSize: 12,
                  color: 'var(--danger, #dc2626)',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Icon name="check" size={13} /> 초기화됨 — 다음 로그인 시 본인이 비밀번호 설정
              </div>
            )}
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editUser ? '변경 시에만 입력' : '비밀번호 입력'}
              autoComplete="new-password"
            />
          </div>
          {/* 현장 공용 아이디는 여기까지 필요 없다 — 이름·코드·비밀번호만 받는다 */}
          {!form.productionDefectOnly && (
            <>
              <div className="form-group">
                <label>직급</label>
                <Select
                  value={form.position}
                  onChange={(v) => setForm({ ...form, position: v })}
                  options={POSITIONS.map((p) => ({ value: p, label: p }))}
                  ariaLabel="직급 선택"
                  placeholder="없음"
                />
              </div>
              <div className="form-group">
                <label>부서</label>
                <Select
                  value={form.departmentId}
                  onChange={(v) => setForm({ ...form, departmentId: v })}
                  options={departments.map((d) => ({ value: d.id, label: d.name }))}
                  ariaLabel="부서 선택"
                  placeholder="선택"
                />
              </div>
              <div className="form-group">
                <label>연락처</label>
                <input
                  aria-label="연락처"
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="예: 010-1234-5678"
                  inputMode="tel"
                />
              </div>
              <div className="form-group">
                <label>고정비용 (월급, 원)</label>
                <MoneyInput
                  value={form.fixedCost}
                  onChange={(e) => setForm({ ...form, fixedCost: e.target.value })}
                  placeholder="예: 3,000,000"
                />
              </div>
              <div className="form-group">
                <label>시급 (잔업 단가, 원)</label>
                <MoneyInput
                  value={form.hourlyRate}
                  onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                  placeholder="예: 15,000"
                />
              </div>
              {form.role !== 'admin' && (
                <div className="form-group">
                  <label>입사일</label>
                  <input
                    aria-label="입사일"
                    type="date"
                    value={form.joinDate}
                    onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
                    required
                  />
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
              {(() => {
                const autoGranted = form.role === 'admin';
                const on = autoGranted || !!form.canCreateSite;
                return (
                  <div className="form-group">
                    <div className="toggle-row">
                      <div className="toggle-row-text">
                        <span className="toggle-row-title">프로젝트 추가 권한</span>
                        <small className="text-muted">
                          {autoGranted
                            ? '관리자는 자동으로 부여됩니다.'
                            : '프로젝트 목록에서 신규 프로젝트를 등록할 수 있습니다.'}
                        </small>
                      </div>
                      <label className={`toggle-switch${autoGranted ? ' is-locked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={autoGranted}
                          onChange={(e) => setForm({ ...form, canCreateSite: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const autoGranted = form.role === 'admin' || ['대표', '부사장'].includes(form.position);
                const on = autoGranted || !!form.canViewArchive;
                return (
                  <div className="form-group">
                    <div className="toggle-row">
                      <div className="toggle-row-text">
                        <span className="toggle-row-title">자료실 열람 권한</span>
                        <small className="text-muted">
                          {autoGranted
                            ? '관리자·대표/부사장은 자동으로 부여됩니다.'
                            : '일반 직원은 기본 미공개입니다. 켜면 자료실 메뉴가 보입니다.'}
                        </small>
                      </div>
                      <label className={`toggle-switch${autoGranted ? ' is-locked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={autoGranted}
                          onChange={(e) => setForm({ ...form, canViewArchive: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const autoGranted = form.role === 'admin';
                const on = autoGranted || !!form.productionAccess;
                return (
                  <div className="form-group">
                    <div className="toggle-row">
                      <div className="toggle-row-text">
                        <span className="toggle-row-title">생산·품질 권한</span>
                        <small className="text-muted">
                          {autoGranted
                            ? '관리자는 자동으로 부여됩니다. 지우고 되살리는 것은 관리자만 할 수 있습니다.'
                            : '켜면 생산현황 검수·판넬 등록과 품질 대장 작성까지 할 수 있습니다. 삭제·휴지통은 관리자만.'}
                        </small>
                      </div>
                      <label className={`toggle-switch${autoGranted ? ' is-locked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={autoGranted}
                          onChange={(e) => setForm({ ...form, productionAccess: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const autoGranted = form.role === 'admin';
                const on = autoGranted || !!form.purchaseAccess;
                return (
                  <div className="form-group">
                    <div className="toggle-row">
                      <div className="toggle-row-text">
                        <span className="toggle-row-title">구매 권한</span>
                        <small className="text-muted">
                          {autoGranted
                            ? '관리자는 자동으로 부여됩니다.'
                            : '켜면 구매 탭(발주·BOM·품목·재고·구매처·견적)을 쓸 수 있습니다. 결제와 메일 발송은 관리자만.'}
                        </small>
                      </div>
                      <label className={`toggle-switch${autoGranted ? ' is-locked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={autoGranted}
                          onChange={(e) => setForm({ ...form, purchaseAccess: e.target.checked })}
                        />
                        <span className="toggle-slider" />
                      </label>
                    </div>
                  </div>
                );
              })()}
              <div className="form-group">
                <div className="toggle-row">
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">차량 운행자 지정</span>
                    <small className="text-muted">
                      지정 시 매월 누적 키로수를 입력하지 않으면 로그인할 때마다 안내 모달이 표시됩니다.
                    </small>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={!!form.usesVehicle}
                      onChange={(e) => setForm({ ...form, usesVehicle: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </div>
              {form.usesVehicle && (
                <>
                  <div className="form-group">
                    <label>
                      차량번호{' '}
                      <span className="text-muted text-sm" style={{ fontWeight: 400 }}>
                        (선택)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={form.vehiclePlate}
                      onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })}
                      placeholder="예: 12가 3456"
                      maxLength={20}
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      차량 월 금액{' '}
                      <span className="text-muted text-sm" style={{ fontWeight: 400 }}>
                        (원, 선택)
                      </span>
                    </label>
                    <MoneyInput
                      value={form.vehicleMonthlyCost}
                      onChange={(e) => setForm({ ...form, vehicleMonthlyCost: e.target.value })}
                      placeholder="예: 500,000"
                    />
                    <small className="text-muted">
                      리스료·보조금 등 매월 동일하게 들어가는 금액. 운행일지에 함께 표시됩니다.
                    </small>
                  </div>
                </>
              )}
              {editUser && balances[editUser.uid] && (
                <div className="form-group">
                  <label>
                    잔여 연차 조정 (일)
                    <span className="text-muted text-sm" style={{ marginLeft: 8, fontWeight: 400 }}>
                      누적 {balances[editUser.uid].totalDays}일 · 사용 {balances[editUser.uid].usedDays}일
                    </span>
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    value={form.leaveRemaining}
                    onChange={(e) => setForm({ ...form, leaveRemaining: e.target.value })}
                    placeholder="현재 잔여 일수 (음수 입력 가능)"
                  />
                  <small className="text-muted">
                    현재 잔여 일수를 입력하면 반영됩니다. 초과 사용 시 음수(-) 입력 가능. 이후 발생분은 자동 계산됩니다.
                  </small>
                </div>
              )}
            </>
          )}
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            {editUser ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {editUser.isActive === false ? (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => handleRejoin(editUser)}>
                    복직 처리
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => handleResign(editUser)}>
                    퇴사 처리
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(editUser)}>
                  <Icon name="trash" className="btn-ic" />
                  삭제
                </button>
              </div>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                {editUser ? '수정' : '추가'}
              </button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
