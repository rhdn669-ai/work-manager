import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSite, getClosingItems, addClosingItem, updateClosingItem, deleteClosingItem,
  getFinanceItems, addFinanceItem, updateFinanceItem, deleteFinanceItem,
  initRosterFromPreviousMonth, updateSite, getAssignedEmployeeIds,
  getAllSites,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { QUARTER_LEAVE_TYPES } from '../../utils/constants';
import MoneyInput from '../../components/common/MoneyInput';

function daysInMonth(yr, mo) {
  return new Date(yr, mo, 0).getDate();
}

function getWorkingDaysInMonth(yr, mo) {
  const total = daysInMonth(yr, mo);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const day = new Date(yr, mo - 1, d).getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// 연차 유형별 실제 근무 비율 (공수 계산용)
function leaveWorkFraction(type) {
  if (!type) return 1;
  if (type === 'half_am' || type === 'half_pm') return 0.5;
  if (QUARTER_LEAVE_TYPES.includes(type)) return 0.75;
  return 0; // annual, sick 등 전일 휴가
}

function leaveBadgeLabel(type) {
  if (type === 'half_am') return '오전반차';
  if (type === 'half_pm') return '오후반차';
  if (QUARTER_LEAVE_TYPES.includes(type)) return '반반차';
  if (type === 'sick') return '병가';
  return '연차';
}

const AUTO_SAVE_DELAY_MS = 800;

export default function SiteClosingPage() {
  const { siteId, year, month } = useParams();
  const y = Number(year);
  const m = Number(month);
  const { isAdmin, isExecutive, canViewSalary, userProfile } = useAuth();
  const navigate = useNavigate();

  const [site, setSite] = useState(null);
  const [userMap, setUserMap] = useState({});
  const [items, setItems] = useState([]);
  const [editBuf, setEditBuf] = useState({});
  const [loading, setLoading] = useState(true);
  const [finances, setFinances] = useState([]);
  const [financeBuf, setFinanceBuf] = useState({});
  const [mirroredFinances, setMirroredFinances] = useState([]); // 합산 대상 프로젝트의 지출 (읽기 전용)
  const [mirroredLabor, setMirroredLabor] = useState(0); // 합산 대상 프로젝트의 공수비 총액
  const [leaveDays, setLeaveDays] = useState({}); // { userId: Set of day numbers }
  const [showEmployeeSelect, setShowEmployeeSelect] = useState(false);
  const [assignedNames, setAssignedNames] = useState(new Set());
  const [addingAll, setAddingAll] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const timersRef = useRef({});

  function canEditSite(s) {
    return s && (isAdmin || (s.managerIds || []).includes(userProfile?.uid));
  }
  const isCompleted = site?.status === 'completed';
  const canEdit = canEditSite(site) && !isCompleted;
  const [copying, setCopying] = useState(false);
  const [clearing, setClearing] = useState(false);
  const dayCount = daysInMonth(y, m);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  useEffect(() => { loadAll(); }, [siteId, y, m]);

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
      timersRef.current = {};
    };
  }, []);

  async function loadAll() {
    setLoading(true);
    try {
      const [s, its, fins, users, approvedLeaves, assigned] = await Promise.all([
        getSite(siteId),
        getClosingItems(siteId, y, m),
        getFinanceItems(siteId, y, m),
        getUsers(),
        getApprovedLeavesByMonth(y, m),
        getAssignedEmployeeIds(y, m),
      ]);
      setSite(s);
      setAssignedNames(assigned);
      setFinances(fins);

      // 합산 대상 프로젝트들의 지출/공수를 읽기 전용으로 가져오기
      const mirrorIds = s?.mirrorFromSiteIds || [];
      if (mirrorIds.length > 0) {
        const allSitesList = await getAllSites();
        const siteNameMap = Object.fromEntries(allSitesList.map((x) => [x.id, x.name]));
        const results = await Promise.all(mirrorIds.map(async (srcId) => {
          const [srcFins, srcItems] = await Promise.all([
            getFinanceItems(srcId, y, m),
            getClosingItems(srcId, y, m),
          ]);
          const srcName = siteNameMap[srcId] || '(삭제된 프로젝트)';
          const expenseFins = srcFins
            .filter((f) => f.type === 'expense')
            .map((f) => ({ ...f, _mirrored: true, _sourceName: srcName, _sourceSiteId: srcId }));
          const labor = srcItems.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
          return { expenseFins, labor };
        }));
        setMirroredFinances(results.flatMap((r) => r.expenseFins));
        setMirroredLabor(results.reduce((sum, r) => sum + r.labor, 0));
      } else {
        setMirroredFinances([]);
        setMirroredLabor(0);
      }
      const uMap = Object.fromEntries(users.map((u) => [u.uid, u]));
      setUserMap(uMap);

      // 연차 날짜 매핑: userId → { [day]: leaveType }
      // 같은 날 복수 신청이 있으면 더 긴 휴가 타입(연차 > 반차 > 반반차)을 유지
      const ldMap = {};
      const typeRank = (t) => {
        if (!t || t === 'annual' || t === 'sick') return 3;
        if (t === 'half_am' || t === 'half_pm') return 2;
        if (QUARTER_LEAVE_TYPES.includes(t)) return 1;
        return 0;
      };
      for (const leave of approvedLeaves) {
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        const cur = new Date(start);
        while (cur <= end) {
          if (cur.getFullYear() === y && cur.getMonth() + 1 === m) {
            const uid = leave.userId;
            const day = cur.getDate();
            if (!ldMap[uid]) ldMap[uid] = {};
            const prev = ldMap[uid][day];
            if (!prev || typeRank(leave.type) > typeRank(prev)) {
              ldMap[uid][day] = leave.type || 'annual';
            }
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      // 이름 → 날짜별 타입 매핑 (공수표 detail이 이름이므로)
      const ldByName = {};
      for (const [uid, map] of Object.entries(ldMap)) {
        const user = uMap[uid];
        if (user) ldByName[user.name] = map;
      }
      setLeaveDays(ldByName);

      setItems(its);
      const buf = {};
      its.forEach((it) => { buf[it.id] = { ...it, dailyQuantities: { ...(it.dailyQuantities || {}) } }; });
      setEditBuf(buf);
      const fbuf = {};
      fins.forEach((f) => { fbuf[f.id] = { ...f }; });
      setFinanceBuf(fbuf);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyPrevMonth() {
    if (!confirm('전월 직원/프리랜서 명단을 복사합니다.\n(수량·금액은 0으로 초기화, 매출/지출은 복사되지 않습니다)\n\n계속하시겠습니까?')) return;
    setCopying(true);
    try {
      const count = await initRosterFromPreviousMonth(siteId, y, m);
      alert(`복사 완료: 명단 ${count}건`);
      await loadAll();
    } catch (err) {
      alert(err.message || '복사 실패');
    } finally {
      setCopying(false);
    }
  }

  async function handleClearItems() {
    if (!confirm(`공수표 항목 ${items.length}건을 모두 삭제합니다.\n이 작업은 되돌릴 수 없습니다.\n\n계속하시겠습니까?`)) return;
    setClearing(true);
    try {
      for (const item of items) {
        if (timersRef.current[item.id]) {
          clearTimeout(timersRef.current[item.id]);
          delete timersRef.current[item.id];
        }
        await deleteClosingItem(item.id);
      }
      await loadAll();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    } finally {
      setClearing(false);
    }
  }

  async function handleCloseProject() {
    if (!confirm(`"${site.name}" 프로젝트를 마감 처리하시겠습니까?\n\n마감 후 수정이 불가하며, 프로젝트 목록에서 재활성할 수 있습니다.`)) return;
    try {
      await updateSite(siteId, { status: 'completed' });
      await loadAll();
    } catch (err) {
      alert('마감 처리 오류: ' + err.message);
    }
  }

  function managerNames() {
    const ids = site?.managerIds || [];
    const names = ids.map((uid) => userMap[uid]?.name).filter(Boolean);
    return names.length ? names.join(', ') : '-';
  }

  async function persistRow(itemId, data) {
    setSavingCount((c) => c + 1);
    try {
      await updateClosingItem(itemId, {
        no: Number(data.no) || 0,
        vendor: data.vendor || '',
        detail: data.detail || '',
        category: data.category || '',
        itemType: data.itemType || 'freelancer',
        unitPrice: Number(data.unitPrice) || 0,
        dailyQuantities: data.dailyQuantities || {},
        quantity: Number(data.quantity) || 0,
        amount: Number(data.amount) || 0,
      });
      setLastSavedAt(new Date());
      setSaveError(null);
    } catch (err) {
      console.error('자동 저장 실패', err);
      setSaveError(err.message || '저장 실패');
    } finally {
      setSavingCount((c) => Math.max(0, c - 1));
    }
  }

  function scheduleSave(itemId, data) {
    if (timersRef.current[itemId]) clearTimeout(timersRef.current[itemId]);
    timersRef.current[itemId] = setTimeout(() => {
      persistRow(itemId, data);
      delete timersRef.current[itemId];
    }, AUTO_SAVE_DELAY_MS);
  }

  async function handleAddRow() {
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    const vendorSuggestion = site?.defaultVendors?.[items.length] || '';
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: vendorSuggestion,
      detail: '', category: '', unitPrice: 0,
      dailyQuantities: {},
      quantity: 0, amount: 0,
      order: nextOrder,
    });
    await loadAll();
  }

  async function handleAddEmployee(user) {
    const resolvedType = 'employee';
    const alreadyExists = items.some((it) => it.itemType === resolvedType && it.detail === user.name);
    if (alreadyExists) { alert(`${user.name}은(는) 이미 추가되어 있습니다.`); return; }
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    const monthlySalary = Number(user.fixedCost) || 0;
    const workingDays = getWorkingDaysInMonth(y, m);
    const dailyRate = workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;
    const userLeaveDays = leaveDays[user.name] || {};
    const dq = {};
    // 단발성 프로젝트는 출근일자를 비워두고 사용자가 직접 입력
    const isOnceProject = site?.projectType === 'once';
    if (!isOnceProject) {
      const totalDays = daysInMonth(y, m);
      for (let d = 1; d <= totalDays; d++) {
        const dow = new Date(y, m - 1, d).getDay();
        if (dow === 0 || dow === 6) continue;
        const frac = leaveWorkFraction(userLeaveDays[d]);
        if (frac > 0) dq[d] = frac;
      }
    }
    const quantity = Object.values(dq).reduce((s, v) => s + v, 0);
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '직원',
      detail: user.name,
      category: `월급 ${monthlySalary.toLocaleString()} ÷ ${workingDays}일`,
      itemType: resolvedType,
      unitPrice: dailyRate,
      dailyQuantities: dq,
      quantity,
      amount: dailyRate * quantity,
      order: nextOrder,
    });
    setShowEmployeeSelect(false);
    await loadAll();
  }

  async function handleDeleteRow(itemId) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    if (timersRef.current[itemId]) {
      clearTimeout(timersRef.current[itemId]);
      delete timersRef.current[itemId];
    }
    try {
      await deleteClosingItem(itemId);
      await loadAll();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  function updateField(itemId, field, value) {
    setEditBuf((b) => {
      const cur = { ...b[itemId], [field]: value };
      if (field === 'unitPrice') {
        cur.amount = Number(cur.unitPrice || 0) * Number(cur.quantity || 0);
      }
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
  }

  function updateDay(itemId, day, value) {
    setEditBuf((b) => {
      const cur = { ...b[itemId] };
      const dq = { ...(cur.dailyQuantities || {}) };
      if (value === '' || value === null) {
        delete dq[day];
      } else {
        const num = Number(value);
        if (!isNaN(num)) dq[day] = num;
      }
      cur.dailyQuantities = dq;
      const sum = Object.values(dq).reduce((a, v) => a + (Number(v) || 0), 0);
      cur.quantity = sum;
      cur.amount = Number(cur.unitPrice || 0) * sum;
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
  }

  function flushRow(itemId) {
    if (!timersRef.current[itemId]) return;
    clearTimeout(timersRef.current[itemId]);
    delete timersRef.current[itemId];
    const data = editBuf[itemId];
    if (data) persistRow(itemId, data);
  }

  // --- 지출/매출 ---
  async function handleAddFinance(type, description = '') {
    const list = finances.filter((f) => f.type === type);
    const nextOrder = list.length ? Math.max(...list.map((f) => f.order || 0)) + 1 : 1;
    await addFinanceItem(siteId, y, m, { type, description, amount: 0, note: '', order: nextOrder });
    await loadAll();
  }

  function updateFinanceField(id, field, value) {
    setFinanceBuf((b) => {
      const cur = { ...b[id], [field]: field === 'amount' ? Number(value) || 0 : value };
      if (timersRef.current['fin_' + id]) clearTimeout(timersRef.current['fin_' + id]);
      timersRef.current['fin_' + id] = setTimeout(async () => {
        setSavingCount((c) => c + 1);
        try {
          await updateFinanceItem(id, { description: cur.description, amount: cur.amount, note: cur.note });
          setLastSavedAt(new Date());
          setSaveError(null);
        } catch (err) {
          setSaveError(err.message || '저장 실패');
        } finally {
          setSavingCount((c) => Math.max(0, c - 1));
        }
        delete timersRef.current['fin_' + id];
      }, AUTO_SAVE_DELAY_MS);
      return { ...b, [id]: cur };
    });
  }

  function flushFinance(id) {
    const key = 'fin_' + id;
    if (!timersRef.current[key]) return;
    clearTimeout(timersRef.current[key]);
    delete timersRef.current[key];
    const cur = financeBuf[id];
    if (cur) {
      setSavingCount((c) => c + 1);
      updateFinanceItem(id, { description: cur.description, amount: cur.amount, note: cur.note })
        .then(() => { setLastSavedAt(new Date()); setSaveError(null); })
        .catch((err) => setSaveError(err.message))
        .finally(() => setSavingCount((c) => Math.max(0, c - 1)));
    }
  }

  async function handleDeleteFinance(id, isOvertime = false) {
    const msg = isOvertime
      ? '잔업 지출 항목을 삭제합니다.\n(원본 잔업 기록은 남아있을 수 있으니, 필요 시 잔업 관리에서도 정리하세요.)\n\n계속하시겠습니까?'
      : '이 항목을 삭제하시겠습니까?';
    if (!confirm(msg)) return;
    const key = 'fin_' + id;
    if (timersRef.current[key]) { clearTimeout(timersRef.current[key]); delete timersRef.current[key]; }
    try {
      await deleteFinanceItem(id);
      await loadAll();
    } catch (err) {
      alert('삭제 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;
  if (!site) return <div>프로젝트을 찾을 수 없습니다.</div>;
  if (!isAdmin && !(site.managerIds || []).includes(userProfile?.uid)) {
    return (
      <div className="card">
        <div className="card-body">
          <p>이 프로젝트에 접근 권한이 없습니다.</p>
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록으로</button>
        </div>
      </div>
    );
  }

  const employeeTotal = Object.values(editBuf).reduce((s, it) => s + (it.itemType === 'employee' ? (Number(it.amount) || 0) : 0), 0);
  const freelancerTotal = Object.values(editBuf).reduce((s, it) => s + (it.itemType !== 'employee' ? (Number(it.amount) || 0) : 0), 0);
  const itemCount = items.length;

  const revenueItems = finances.filter((f) => f.type === 'revenue');
  const expenseItems = finances.filter((f) => f.type === 'expense');
  const isOvertimeDesc = (desc) => { const d = (desc || '').trim(); return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-'); };
  const isOvertimeFinance = (f) => isOvertimeDesc(financeBuf[f.id]?.description ?? f.description);
  const totalRevenue = revenueItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);
  const ownExpense = expenseItems.filter((f) => canViewSalary || !isOvertimeFinance(f)).reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);
  const mirroredExpenseSum = mirroredFinances.filter((f) => canViewSalary || !isOvertimeDesc(f.description)).reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const mirroredLaborSum = canViewSalary ? mirroredLabor : 0;
  const totalExpense = ownExpense + mirroredExpenseSum + mirroredLaborSum;
  const netTotal = totalRevenue - totalExpense - freelancerTotal - (canViewSalary ? employeeTotal : 0);

  let saveStatus;
  if (saveError) {
    saveStatus = <span className="save-status save-status-error">⚠ 저장 실패</span>;
  } else if (savingCount > 0) {
    saveStatus = <span className="save-status save-status-saving">● 저장 중</span>;
  } else if (lastSavedAt) {
    const t = lastSavedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    saveStatus = <span className="save-status save-status-saved">✓ {hh}:{mm} 저장됨</span>;
  } else {
    saveStatus = <span className="save-status save-status-idle">자동 저장 대기</span>;
  }

  return (
    <div className="site-closing-page">
      <div className="page-header">
        <h2>{site.name} <span className="closing-period">{y}년 {m}월</span></h2>
        <div className="page-actions">
          {canEdit && items.length > 0 && (
            <button className="btn btn-outline btn-sm" onClick={handleClearItems} disabled={clearing}>
              {clearing ? '삭제 중...' : '공수표 초기화'}
            </button>
          )}
          {canEdit && items.length === 0 && (
            <button className="btn btn-outline" onClick={handleCopyPrevMonth} disabled={copying}>
              {copying ? '복사 중...' : '전월 복사'}
            </button>
          )}
          {canEditSite(site) && !isCompleted && (
            <button className="btn btn-danger btn-sm" onClick={handleCloseProject}>프로젝트 마감</button>
          )}
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록</button>
        </div>
      </div>

      {isCompleted && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          완료된 프로젝트입니다. 수정이 불가합니다.
        </div>
      )}

      <div className="closing-summary">
        <div className="closing-summary-item">
          <span className="label">팀</span>
          <strong>{site.team || '-'}</strong>
        </div>
        <div className="closing-summary-item">
          <span className="label">담당</span>
          <strong>{managerNames()}</strong>
        </div>
        <div className="closing-summary-item">
          <span className="label">항목</span>
          <strong>{itemCount}건</strong>
        </div>
        <div className="closing-summary-item">
          <span className="label">매출</span>
          <strong style={{ color: 'var(--success, #16a34a)' }}>{totalRevenue.toLocaleString()}원</strong>
        </div>
        <div className="closing-summary-item">
          <span className="label">지출</span>
          <strong style={{ color: 'var(--danger, #dc2626)' }}>{totalExpense.toLocaleString()}원</strong>
        </div>
        <div className="closing-summary-item closing-summary-total">
          <span className="label">공수 합계</span>
          <strong>{freelancerTotal.toLocaleString()}원</strong>
        </div>
        {canViewSalary && (
          <div className="closing-summary-item closing-summary-total">
            <span className="label">직원 합계</span>
            <strong>{employeeTotal.toLocaleString()}원</strong>
          </div>
        )}
        <div className="closing-summary-item closing-summary-net" style={{
          borderLeft: '2px solid var(--border-strong)',
          paddingLeft: 16,
          marginLeft: 4,
        }}>
          <span className="label">합계</span>
          <strong style={{ color: netTotal >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 15 }}>
            {netTotal >= 0 ? '+' : ''}{netTotal.toLocaleString()}원
          </strong>
        </div>
        {canEdit && saveStatus}
      </div>

      {/* 매출 섹션 */}
      <div className="finance-section">
        <div className="finance-section-header">
          <h3 className="finance-title finance-revenue">매출</h3>
          {canEdit && <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('revenue')}>+ 추가</button>}
        </div>
        {revenueItems.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '8px 0' }}>등록된 매출 항목이 없습니다.</p>
        ) : (
          <div className="finance-list">
            {revenueItems.map((f) => {
              const buf = financeBuf[f.id] || f;
              return (
                <div className="finance-row" key={f.id}>
                  <input className="finance-desc" value={buf.description || ''} placeholder="항목명" onChange={(e) => updateFinanceField(f.id, 'description', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  <MoneyInput className="finance-amount" value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  <span className="finance-won">원</span>
                  <input className="finance-note" value={buf.note || ''} placeholder="비고" onChange={(e) => updateFinanceField(f.id, 'note', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  {canEdit && <button className="closing-delete" onClick={() => handleDeleteFinance(f.id)} aria-label="삭제">✕</button>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 지출 섹션 */}
      <div className="finance-section">
        <div className="finance-section-header">
          <h3 className="finance-title finance-expense">지출</h3>
          {canEdit && (
            <div className="finance-actions">
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense')}>+ 추가</button>
              <button className="expense-chip expense-chip-meal" onClick={() => handleAddFinance('expense', '식대')}>식대</button>
              <button className="expense-chip expense-chip-transport" onClick={() => handleAddFinance('expense', '교통비')}>교통비</button>
              <button className="expense-chip expense-chip-material" onClick={() => handleAddFinance('expense', '자재비')}>자재비</button>
            </div>
          )}
        </div>
        {expenseItems.length === 0 && mirroredFinances.length === 0 && mirroredLaborSum === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '8px 0' }}>등록된 지출 항목이 없습니다.</p>
        ) : (
          <div className="finance-list">
            {expenseItems.map((f) => {
              const buf = financeBuf[f.id] || f;
              const desc = (buf.description || '').trim();
              const isOvertime = desc === '잔업' || desc.startsWith('잔업 -') || desc.startsWith('잔업-');
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material' };
              const chipKey = isOvertime ? 'overtime' : chipMap[desc];
              const readOnly = isOvertime;
              return (
                <div className={`expense-card ${chipKey ? `expense-card-${chipKey}` : ''} ${readOnly ? 'expense-card-readonly' : ''}`} key={f.id}>
                  <span className={`expense-tag ${chipKey ? `expense-chip-${chipKey}` : 'expense-chip-default'}`}>
                    {isOvertime ? '잔업' : (desc || '지출')}
                  </span>
                  {readOnly ? (
                    <span className="expense-input-desc expense-readonly-text" title={desc}>{desc.replace(/^잔업\s*-\s*/, '')}</span>
                  ) : !chipKey ? (
                    <input className="expense-input-desc" value={buf.description || ''} placeholder="항목명" onChange={(e) => updateFinanceField(f.id, 'description', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  ) : null}
                  {(!isOvertime || canViewSalary) && (
                    <>
                      <MoneyInput className="expense-input-amount" value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit || readOnly} />
                      <span className="expense-won">원</span>
                    </>
                  )}
                  {!readOnly && (
                    <input className="expense-input-note" value={buf.note || ''} placeholder="비고" onChange={(e) => updateFinanceField(f.id, 'note', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  )}
                  {canEdit && (
                    <button type="button" className="closing-delete" onClick={() => handleDeleteFinance(f.id, isOvertime)} aria-label="삭제" title={isOvertime ? '잔업 지출 삭제 (고아 데이터 정리용)' : '삭제'}>✕</button>
                  )}
                </div>
              );
            })}
            {/* 합산 대상 프로젝트의 지출 (읽기 전용) */}
            {mirroredFinances.filter((f) => canViewSalary || !isOvertimeDesc(f.description)).map((f) => {
              const desc = (f.description || '').trim();
              const isOvertime = isOvertimeDesc(desc);
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material' };
              const chipKey = isOvertime ? 'overtime' : chipMap[desc];
              return (
                <div className={`expense-card expense-card-readonly ${chipKey ? `expense-card-${chipKey}` : ''}`} key={`mirror-${f.id}`}>
                  <span className={`expense-tag ${chipKey ? `expense-chip-${chipKey}` : 'expense-chip-default'}`}>
                    {isOvertime ? '잔업' : (desc || '지출')}
                  </span>
                  <span className="expense-input-desc expense-readonly-text" title={desc}>
                    {isOvertime ? desc.replace(/^잔업\s*-\s*/, '') : desc}
                  </span>
                  <MoneyInput className="expense-input-amount" value={f.amount || 0} onChange={() => {}} disabled />
                  <span className="expense-won">원</span>
                  <span className="expense-readonly-badge" title={`${f._sourceName} 프로젝트의 지출`}>↗ {f._sourceName}</span>
                </div>
              );
            })}
            {/* 합산 대상 프로젝트의 공수비 (읽기 전용, 급여 열람 권한자만) */}
            {canViewSalary && mirroredLaborSum > 0 && (
              <div className="expense-card expense-card-readonly" key="mirror-labor-total">
                <span className="expense-tag expense-chip-default">공수</span>
                <span className="expense-input-desc expense-readonly-text">합산 프로젝트 공수비 합계</span>
                <MoneyInput className="expense-input-amount" value={mirroredLaborSum} onChange={() => {}} disabled />
                <span className="expense-won">원</span>
                <span className="expense-readonly-badge">↗ 합산 합계</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 공수표 섹션 */}
      <div className="finance-section-header" style={{ marginTop: 16 }}>
        <h3 className="finance-title">공수표</h3>
        {canEdit && (
          <div className="finance-actions">
            <button className="btn btn-sm btn-primary" onClick={handleAddRow}>+ 프리랜서</button>
            <button className="btn btn-sm btn-outline" onClick={() => setShowEmployeeSelect(!showEmployeeSelect)}>+ 직원</button>
          </div>
        )}
      </div>
      {showEmployeeSelect && canEdit && (() => {
        const currentNames = new Set(items.filter((it) => it.itemType === 'employee').map((it) => it.detail));
        const allWithCost = Object.values(userMap).filter((u) => u.fixedCost);
        const unassigned = allWithCost.filter((u) => !assignedNames.has(u.name) && !currentNames.has(u.name));
        const assignedElsewhere = allWithCost.filter((u) => assignedNames.has(u.name) && !currentNames.has(u.name));
        const alreadyHere = allWithCost.filter((u) => currentNames.has(u.name));

        async function handleAddAllUnassigned() {
          if (unassigned.length === 0) return;
          if (!confirm(`미배정 인원 ${unassigned.length}명을 일괄 추가하시겠습니까?`)) return;
          setAddingAll(true);
          try {
            for (const u of unassigned) { await handleAddEmployee(u); }
            setShowEmployeeSelect(false);
          } finally { setAddingAll(false); }
        }

        return (
          <div className="select-dropdown-list" style={{ marginBottom: 12 }}>
            {allWithCost.length === 0 ? (
              <p className="empty-state" style={{ padding: '12px', margin: 0 }}>고정비용이 등록된 직원이 없습니다. 직원 관리에서 설정하세요.</p>
            ) : (
              <>
                {unassigned.length > 0 && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fef3c7', borderBottom: '1px solid #fde68a' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>미배정 인원 ({unassigned.length}명)</span>
                      <button className="btn btn-sm btn-primary" onClick={handleAddAllUnassigned} disabled={addingAll} style={{ fontSize: 11, padding: '4px 10px' }}>
                        {addingAll ? '추가 중...' : '일괄 추가'}
                      </button>
                    </div>
                    {unassigned.map((u) => (
                      <label key={u.uid} className="select-list-item" onClick={() => handleAddEmployee(u)} style={{ cursor: 'pointer' }}>
                        <span className="select-list-name">{u.name}</span>
                        <span className="select-list-sub">{u.position || ''}{canViewSalary ? ` · 월 ${Number(u.fixedCost).toLocaleString()}원` : ''}</span>
                      </label>
                    ))}
                  </>
                )}
                {assignedElsewhere.length > 0 && (
                  <>
                    <div style={{ padding: '8px 12px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>다른 프로젝트 배정 ({assignedElsewhere.length}명)</span>
                    </div>
                    {assignedElsewhere.map((u) => (
                      <label key={u.uid} className="select-list-item" onClick={() => handleAddEmployee(u)} style={{ cursor: 'pointer', opacity: 0.6 }}>
                        <span className="select-list-name">{u.name}</span>
                        <span className="select-list-sub">{u.position || ''}{canViewSalary ? ` · 월 ${Number(u.fixedCost).toLocaleString()}원` : ''}</span>
                      </label>
                    ))}
                  </>
                )}
                {alreadyHere.length > 0 && (
                  <>
                    <div style={{ padding: '8px 12px', background: '#dcfce7', borderBottom: '1px solid #bbf7d0' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>이미 등록됨 ({alreadyHere.length}명)</span>
                    </div>
                    {alreadyHere.map((u) => (
                      <label key={u.uid} className="select-list-item" style={{ opacity: 0.4, cursor: 'default' }}>
                        <span className="select-list-name">{u.name}</span>
                        <span className="select-list-sub">{u.position || ''}</span>
                      </label>
                    ))}
                  </>
                )}
                {unassigned.length === 0 && assignedElsewhere.length === 0 && alreadyHere.length > 0 && (
                  <p style={{ padding: '12px', margin: 0, fontSize: 13, color: '#64748b', textAlign: 'center' }}>모든 직원이 이미 등록되었습니다.</p>
                )}
              </>
            )}
          </div>
        );
      })()}

      {items.length === 0 ? (
        <div className="card">
          <div className="card-body empty-state">
            항목이 없습니다.{canEdit && ' 우측 상단 "+ 항목 추가" 버튼으로 시작하세요.'}
          </div>
        </div>
      ) : (
        <div className="closing-cards">
          {[...items].sort((a, b) => {
            const aType = a.itemType === 'employee' ? 0 : 1;
            const bType = b.itemType === 'employee' ? 0 : 1;
            return aType !== bType ? aType - bType : (a.order || 0) - (b.order || 0);
          }).map((it) => {
            const buf = editBuf[it.id] || it;
            const cardType = it.itemType || buf.itemType || 'freelancer';
            return (
              <div className={`closing-card closing-card-${cardType}`} key={it.id}>
                <div className="closing-card-head">
                  <span className="closing-no">#{buf.no || '-'}</span>
                  <input
                    className="closing-vendor"
                    value={buf.vendor || ''}
                    placeholder="업체명"
                    onChange={(e) => updateField(it.id, 'vendor', e.target.value)}
                    onBlur={() => flushRow(it.id)}
                    disabled={!canEdit}
                  />
                  <input
                    className="closing-name"
                    value={buf.detail || ''}
                    placeholder="이름"
                    onChange={(e) => updateField(it.id, 'detail', e.target.value)}
                    onBlur={() => flushRow(it.id)}
                    disabled={!canEdit}
                  />
                  {canEdit && (
                    <button
                      type="button"
                      className="closing-delete"
                      onClick={() => handleDeleteRow(it.id)}
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {(() => {
                  // 캘린더 형식 생성
                  const firstDow = new Date(y, m - 1, 1).getDay(); // 0=일
                  const totalDays = daysInMonth(y, m);
                  const weeks = [];
                  let week = new Array(firstDow).fill(null);
                  for (let d = 1; d <= totalDays; d++) {
                    week.push(d);
                    if (week.length === 7) { weeks.push(week); week = []; }
                  }
                  if (week.length > 0) {
                    while (week.length < 7) week.push(null);
                    weeks.push(week);
                  }
                  return (
                    <div className="day-calendar">
                      <div className="day-calendar-header">
                        {['일','월','화','수','목','금','토'].map((dn, i) => (
                          <div key={dn} className={`day-calendar-dow ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{dn}</div>
                        ))}
                      </div>
                      {weeks.map((wk, wi) => (
                        <div className="day-calendar-row" key={wi}>
                          {wk.map((d, di) => {
                            if (d === null) return <div className="day-cal-cell day-cal-empty" key={di} />;
                            const v = buf.dailyQuantities?.[d];
                            const hasValue = v !== undefined && v !== null && v !== '';
                            const isSunday = di === 0;
                            const isSaturday = di === 6;
                            const isEmployee = cardType === 'employee';
                            const leaveType = isEmployee ? leaveDays[buf.detail]?.[d] : undefined;
                            const isOnLeave = !!leaveType;
                            const workFraction = leaveWorkFraction(leaveType);
                            const isFullLeave = isOnLeave && workFraction === 0;
                            const leaveCls = isOnLeave ? `leave-${leaveType}` : '';
                            return (
                              <div className={`day-cal-cell ${hasValue ? 'has-value' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${isOnLeave ? 'on-leave' : ''} ${leaveCls}`} key={di}>
                                <label>{d}</label>
                                {isOnLeave && (
                                  <div className={`leave-badge leave-badge-${leaveType}`}>{leaveBadgeLabel(leaveType)}</div>
                                )}
                                {isFullLeave ? null : (
                                  <input
                                    type="number"
                                    step="0.25"
                                    min="0"
                                    max="1"
                                    value={v ?? ''}
                                    onChange={(e) => updateDay(it.id, d, e.target.value)}
                                    onBlur={() => flushRow(it.id)}
                                    disabled={!canEdit}
                                    title={isOnLeave ? `${leaveBadgeLabel(leaveType)} (근무 ${workFraction})` : ''}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                <div className="closing-card-foot">
                  <div className="foot-field">
                    <span className="label">수량</span>
                    <strong>{Number(buf.quantity || 0)}일</strong>
                  </div>
                  {(canViewSalary || cardType !== 'employee') && (
                    <>
                      <div className="foot-field">
                        <span className="label">단가</span>
                        <MoneyInput
                          className="closing-price"
                          value={buf.unitPrice || 0}
                          onChange={(e) => updateField(it.id, 'unitPrice', e.target.value)}
                          onBlur={() => flushRow(it.id)}
                          disabled={!canEdit || cardType === 'employee'}
                        />
                      </div>
                      <div className="foot-field closing-amount">
                        <span className="label">금액</span>
                        <strong>{Number(buf.amount || 0).toLocaleString()}원</strong>
                      </div>
                    </>
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
