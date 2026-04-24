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
import { getFreelancers, getVendors, getRateForDate } from '../../services/outsourceService';
import { QUARTER_LEAVE_TYPES } from '../../utils/constants';
import MoneyInput from '../../components/common/MoneyInput';
import Modal from '../../components/common/Modal';

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
  const [showOvertimeDetail, setShowOvertimeDetail] = useState(false);
  // 업체(공수/프로젝트) 추가 모달 — 업체 → 프로젝트 2단계 선택
  const [vendorPickerMode, setVendorPickerMode] = useState(null); // 'vendor' | 'vendor_case' | null
  const [vendorPickerStep, setVendorPickerStep] = useState('vendor'); // 'vendor' | 'project'
  const [pickedVendor, setPickedVendor] = useState(null);
  const [closingTab, setClosingTab] = useState('all'); // 'all' | 'employee' | 'freelancer' | 'daily' | 'vendor'

  function resetVendorPicker() {
    setVendorPickerMode(null);
    setVendorPickerStep('vendor');
    setPickedVendor(null);
  }
  const [freelancers, setFreelancers] = useState([]);
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [fs, vs] = await Promise.all([getFreelancers(), getVendors()]);
        setFreelancers(fs);
        setVendors(vs);
      } catch (err) { console.error(err); }
    })();
  }, []);

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
      itemType: 'freelancer',
      dailyQuantities: {},
      quantity: 0, amount: 0,
      order: nextOrder,
    });
    await loadAll();
  }

  async function handleAddDailyWorker() {
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '',
      detail: '',
      category: '',
      itemType: 'daily',
      unitPrice: 0, // 시급
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
      order: nextOrder,
    });
    await loadAll();
  }

  function openVendorPicker(mode) {
    setVendorPickerMode(mode);
    setVendorPickerStep('vendor');
    setPickedVendor(null);
  }

  async function addVendorRow({ itemType, vendorName, projectName = '', unitPrice = 0 }) {
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: vendorName || '',
      detail: projectName || '',
      category: '',
      itemType,
      unitPrice: Number(unitPrice) || 0,
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
      order: nextOrder,
    });
    await loadAll();
  }

  async function handlePickVendor(v) {
    setPickedVendor(v);
    if (vendorPickerMode === 'vendor') {
      setVendorPickerStep('member');
    } else {
      setVendorPickerStep('project');
    }
  }

  async function handlePickMember(f) {
    const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const rate = getRateForDate(f, targetDate) || Number(pickedVendor?.dailyRate) || 0;
    await addVendorRow({
      itemType: 'vendor',
      vendorName: pickedVendor?.name || '',
      projectName: f?.name || '',
      unitPrice: rate,
    });
    resetVendorPicker();
  }

  async function handlePickMemberBlank() {
    await addVendorRow({
      itemType: 'vendor',
      vendorName: pickedVendor?.name || '',
      projectName: '',
      unitPrice: Number(pickedVendor?.dailyRate) || 0,
    });
    resetVendorPicker();
  }

  async function handlePickProject(p) {
    await addVendorRow({
      itemType: 'vendor_case',
      vendorName: pickedVendor?.name || '',
      projectName: p?.name || '',
      unitPrice: Number(p?.unitPrice) || Number(pickedVendor?.caseRate) || 0,
    });
    resetVendorPicker();
  }

  async function handlePickProjectBlank() {
    // 프로젝트 없는 업체 — 업체만 지정하고 행 생성
    await addVendorRow({
      itemType: 'vendor_case',
      vendorName: pickedVendor?.name || '',
      projectName: '',
      unitPrice: Number(pickedVendor?.caseRate) || 0,
    });
    resetVendorPicker();
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
    // 출근일자는 비운 상태로 생성 — 사용자가 날짜별로 직접 기록
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '직원',
      detail: user.name,
      category: `월급 ${monthlySalary.toLocaleString()} ÷ ${workingDays}일`,
      itemType: resolvedType,
      unitPrice: dailyRate,
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
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
      if (field === 'unitPrice' || field === 'quantity') {
        const q = Number(cur.quantity || 0);
        cur.quantity = q;
        cur.amount = Number(cur.unitPrice || 0) * q;
      }
      // 외주관리 연동: 프리랜서/일용직 행에서 이름을 등록된 프리랜서로 바꾸면 업체·단가 자동 채움
      // 단가는 해당 월(1일 기준)에 유효한 rateHistory 값 사용 (없으면 기본 dailyRate)
      if (field === 'detail' && (cur.itemType === 'freelancer' || cur.itemType === 'daily' || !cur.itemType) && value) {
        const match = freelancers.find((f) => f.name === value);
        if (match) {
          if (match.vendor) cur.vendor = match.vendor;
          const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
          const rate = getRateForDate(match, targetDate);
          if (rate > 0) {
            cur.unitPrice = rate;
            cur.amount = cur.unitPrice * Number(cur.quantity || 0);
          }
        }
      }
      // 외주관리 연동: 업체(공수/건당) 행에서 업체명 선택 시 단가 자동 채움
      if (field === 'vendor' && (cur.itemType === 'vendor' || cur.itemType === 'vendor_case') && value) {
        const match = vendors.find((v) => v.name === value);
        if (match) {
          const rate = cur.itemType === 'vendor_case' ? match.caseRate : match.dailyRate;
          if (rate > 0) {
            cur.unitPrice = Number(rate) || 0;
            cur.amount = cur.unitPrice * Number(cur.quantity || 0);
          }
        }
      }
      // 업체(건당): 프로젝트명(detail) 선택 시 해당 업체 프로젝트 단가로 override
      if (field === 'detail' && cur.itemType === 'vendor_case' && value) {
        const vendorMatch = vendors.find((v) => v.name === cur.vendor);
        const projects = vendorMatch?.projects || [];
        const proj = projects.find((p) => p.name === value);
        if (proj && Number(proj.unitPrice) > 0) {
          cur.unitPrice = Number(proj.unitPrice) || 0;
          cur.amount = cur.unitPrice * Number(cur.quantity || 0);
        }
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
        let num = Number(value);
        if (!isNaN(num)) {
          // 직원 공수는 일 단위 최대 1 (하루 이상 근무 불가)
          if (cur.itemType === 'employee') num = Math.max(0, Math.min(1, num));
          dq[day] = num;
        }
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
  const hideRevenue = !!site?.hideRevenue;
  const effectiveRevenue = hideRevenue ? 0 : totalRevenue;
  const netTotal = effectiveRevenue - totalExpense - freelancerTotal - (canViewSalary ? employeeTotal : 0);

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
        {!hideRevenue && (
          <div className="closing-summary-item">
            <span className="label">매출</span>
            <strong style={{ color: 'var(--success, #16a34a)' }}>{totalRevenue.toLocaleString()}원</strong>
          </div>
        )}
        <div className="closing-summary-item">
          <span className="label">지출</span>
          <strong style={{ color: 'var(--danger, #dc2626)' }}>{totalExpense.toLocaleString()}원</strong>
        </div>
        {canViewSalary && (
          <div className="closing-summary-item closing-summary-total">
            <span className="label">공수 합계</span>
            <strong>{freelancerTotal.toLocaleString()}원</strong>
          </div>
        )}
        {canViewSalary && (
          <div className="closing-summary-item closing-summary-total">
            <span className="label">직원 합계</span>
            <strong>{employeeTotal.toLocaleString()}원</strong>
          </div>
        )}
        {!hideRevenue && (
          <div className="closing-summary-item closing-summary-net">
            <span className="label">합계</span>
            <strong style={{ color: netTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {netTotal >= 0 ? '+' : ''}{netTotal.toLocaleString()}원
            </strong>
          </div>
        )}
      </div>
      {canEdit && <div className="closing-save-status">{saveStatus}</div>}

      {/* 매출 섹션 (hideRevenue 프로젝트는 숨김) */}
      {!hideRevenue && (
        <div className="finance-section">
          <div className="finance-section-header">
            <h3 className="finance-title finance-revenue">매출</h3>
            {canEdit && <button className="btn btn-sm btn-pastel-green" onClick={() => handleAddFinance('revenue')}>+ 추가</button>}
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
      )}

      {/* 지출 섹션 */}
      <div className="finance-section">
        <div className="finance-section-header">
          <h3 className="finance-title finance-expense">지출</h3>
          {canEdit && (
            <div className="finance-actions">
              <button className="btn btn-sm btn-pastel-rose" onClick={() => handleAddFinance('expense')}>+ 추가</button>
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
            {/* 비잔업 지출 항목은 개별 렌더 */}
            {expenseItems.filter((f) => !isOvertimeFinance(f)).map((f) => {
              const buf = financeBuf[f.id] || f;
              const desc = (buf.description || '').trim();
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material' };
              const chipKey = chipMap[desc];
              return (
                <div className={`expense-card ${chipKey ? `expense-card-${chipKey}` : ''}`} key={f.id}>
                  <span className={`expense-tag ${chipKey ? `expense-chip-${chipKey}` : 'expense-chip-default'}`}>
                    {desc || '지출'}
                  </span>
                  {!chipKey && (
                    <input className="expense-input-desc" value={buf.description || ''} placeholder="항목명" onChange={(e) => updateFinanceField(f.id, 'description', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  )}
                  <MoneyInput className="expense-input-amount" value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  <span className="expense-won">원</span>
                  <input className="expense-input-note" value={buf.note || ''} placeholder="비고" onChange={(e) => updateFinanceField(f.id, 'note', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  {canEdit && (
                    <button type="button" className="closing-delete" onClick={() => handleDeleteFinance(f.id, false)} aria-label="삭제">✕</button>
                  )}
                </div>
              );
            })}
            {/* 잔업 항목은 한 줄로 합산 + 상세 모달 */}
            {canViewSalary && (() => {
              const ownOvertimeItems = expenseItems.filter((f) => isOvertimeFinance(f));
              if (ownOvertimeItems.length === 0) return null;
              const sum = ownOvertimeItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount ?? f.amount) || 0), 0);
              return (
                <div className="expense-card expense-card-overtime expense-card-readonly" key="local-overtime-summary">
                  <span className="expense-tag expense-chip-overtime">잔업</span>
                  <span className="expense-input-desc expense-readonly-text">잔업 합계 ({ownOvertimeItems.length}건)</span>
                  <MoneyInput className="expense-input-amount" value={sum} onChange={() => {}} disabled />
                  <span className="expense-won">원</span>
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowOvertimeDetail(true)}>상세 보기</button>
                </div>
              );
            })()}
            {/* 합산 대상 프로젝트의 비잔업 지출 (카테고리별 합산, 읽기 전용) */}
            {(() => {
              const nonOvertimeItems = mirroredFinances.filter((f) => !isOvertimeDesc(f.description));
              if (nonOvertimeItems.length === 0) return null;
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material' };
              // description 단위로 그룹핑
              const groups = new Map();
              for (const f of nonOvertimeItems) {
                const desc = (f.description || '').trim() || '지출';
                if (!groups.has(desc)) groups.set(desc, { items: [], sum: 0, sources: new Set() });
                const g = groups.get(desc);
                g.items.push(f);
                g.sum += Number(f.amount) || 0;
                if (f._sourceName) g.sources.add(f._sourceName);
              }
              return [...groups.entries()].map(([desc, g]) => {
                const chipKey = chipMap[desc];
                const sourceNames = [...g.sources].join(', ');
                return (
                  <div className={`expense-card expense-card-readonly ${chipKey ? `expense-card-${chipKey}` : ''}`} key={`mirror-group-${desc}`}>
                    <span className={`expense-tag ${chipKey ? `expense-chip-${chipKey}` : 'expense-chip-default'}`}>{desc}</span>
                    <span className="expense-input-desc expense-readonly-text">합산 프로젝트 {desc} 합계 ({g.items.length}건)</span>
                    <MoneyInput className="expense-input-amount" value={g.sum} onChange={() => {}} disabled />
                    <span className="expense-won">원</span>
                    <span className="expense-readonly-badge" title={`${sourceNames} 프로젝트의 ${desc}`}>↗ {sourceNames}</span>
                  </div>
                );
              });
            })()}
            {/* 합산 대상 프로젝트의 잔업 내역 합산 (읽기 전용, 급여 열람 권한자만) */}
            {canViewSalary && (() => {
              const overtimeItems = mirroredFinances.filter((f) => isOvertimeDesc(f.description));
              if (overtimeItems.length === 0) return null;
              const sum = overtimeItems.reduce((s, f) => s + (Number(f.amount) || 0), 0);
              const sourceNames = [...new Set(overtimeItems.map((f) => f._sourceName))].join(', ');
              return (
                <div className="expense-card expense-card-readonly expense-card-overtime" key="mirror-overtime-total">
                  <span className="expense-tag expense-chip-overtime">잔업</span>
                  <span className="expense-input-desc expense-readonly-text">합산 프로젝트 잔업 합계 ({overtimeItems.length}건)</span>
                  <MoneyInput className="expense-input-amount" value={sum} onChange={() => {}} disabled />
                  <span className="expense-won">원</span>
                  <span className="expense-readonly-badge" title={`${sourceNames} 프로젝트의 잔업`}>↗ {sourceNames}</span>
                </div>
              );
            })()}
            {/* 합산 대상 프로젝트의 인건비 (읽기 전용, 급여 열람 권한자만) */}
            {canViewSalary && mirroredLaborSum > 0 && (() => {
              const laborSourceNames = [...new Set((mirroredFinances || []).map((f) => f._sourceName).filter(Boolean))].join(', ') || '합산 합계';
              return (
                <div className="expense-card expense-card-readonly" key="mirror-labor-total">
                  <span className="expense-tag expense-chip-default">인건비</span>
                  <span className="expense-input-desc expense-readonly-text">합산 프로젝트 인건비 합계</span>
                  <MoneyInput className="expense-input-amount" value={mirroredLaborSum} onChange={() => {}} disabled />
                  <span className="expense-won">원</span>
                  <span className="expense-readonly-badge" title={`${laborSourceNames} 프로젝트의 인건비`}>↗ {laborSourceNames}</span>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* 공수표 섹션 */}
      <div className="finance-section-header" style={{ marginTop: 16 }}>
        <h3 className="finance-title">공수표</h3>
        {canEdit && (
          <div className="finance-actions">
            <button className="btn btn-sm btn-pastel-sky" onClick={handleAddRow}>+ 프리랜서</button>
            <button className="btn btn-sm btn-pastel-peach" onClick={handleAddDailyWorker}>+ 일용직</button>
            <button className="btn btn-sm btn-pastel-teal" onClick={() => openVendorPicker('vendor')}>+ 업체(공수)</button>
            <button className="btn btn-sm btn-pastel-amber" onClick={() => openVendorPicker('vendor_case')}>+ 업체(프로젝트)</button>
            <button className="btn btn-sm btn-pastel-lavender" onClick={() => setShowEmployeeSelect(!showEmployeeSelect)}>+ 직원</button>
          </div>
        )}
      </div>
      {/* 공수표 탭 필터 */}
      {items.length > 0 && (() => {
        const cnt = (types) => items.filter((i) => types.includes(i.itemType || 'freelancer')).length;
        const tabs = [
          { key: 'all', label: '전체', count: items.length },
          { key: 'employee', label: '직원', count: cnt(['employee']) },
          { key: 'freelancer', label: '프리랜서', count: cnt(['freelancer']) },
          { key: 'daily', label: '일용직', count: cnt(['daily']) },
          { key: 'vendor', label: '업체', count: cnt(['vendor', 'vendor_case']) },
        ];
        return (
          <div className="tab-nav closing-tab-nav">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tab-nav-item ${closingTab === t.key ? 'active' : ''}`}
                onClick={() => setClosingTab(t.key)}
              >
                {t.label}
                {t.count > 0 && <span style={{ opacity: 0.55, marginLeft: 3, fontSize: '0.85em' }}>{t.count}</span>}
              </button>
            ))}
          </div>
        );
      })()}
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

      {/* 외주관리 연동 datalist */}
      <datalist id="closing-freelancer-list">
        {freelancers.map((f) => (
          <option key={f.id} value={f.name}>
            {f.vendor ? `${f.vendor}` : ''}{canViewSalary && f.dailyRate ? `${f.vendor ? ' · ' : ''}${Number(f.dailyRate).toLocaleString()}원` : ''}
          </option>
        ))}
      </datalist>
      <datalist id="closing-vendor-list">
        {vendors.map((v) => (
          <option key={v.id} value={v.name}>{v.representative || ''}</option>
        ))}
      </datalist>
      <datalist id="closing-vendor-project-list">
        {vendors.flatMap((v) => (v.projects || []).map((p) => (
          <option key={`${v.id}-${p.name}`} value={p.name}>
            {v.name}{canViewSalary && p.unitPrice > 0 ? ` · 건당 ${Number(p.unitPrice).toLocaleString()}원` : ''}
          </option>
        )))}
      </datalist>

      {(() => {
        const rank = (t) => {
          if (t === 'employee') return 0;
          if (t === 'daily') return 1;
          if (t === 'vendor') return 2;
          if (t === 'vendor_case') return 3;
          return 4;
        };
        const sorted = [...items].sort((a, b) => {
          const aR = rank(a.itemType);
          const bR = rank(b.itemType);
          return aR !== bR ? aR - bR : (a.order || 0) - (b.order || 0);
        });
        const filtered = sorted.filter((it) => {
          if (closingTab === 'all') return true;
          const t = it.itemType || 'freelancer';
          if (closingTab === 'vendor') return t === 'vendor' || t === 'vendor_case';
          return t === closingTab;
        });

        if (items.length === 0) return (
          <div className="card">
            <div className="card-body empty-state">
              항목이 없습니다.{canEdit && ' 우측 상단 "+ 항목 추가" 버튼으로 시작하세요.'}
            </div>
          </div>
        );
        if (filtered.length === 0) return (
          <div className="card">
            <div className="card-body empty-state">이 유형의 항목이 없습니다.</div>
          </div>
        );

        return (
        <div className="closing-cards">
          {filtered.map((it) => {
            const buf = editBuf[it.id] || it;
            const cardType = it.itemType || buf.itemType || 'freelancer';
            const isDaily = cardType === 'daily';
            const isVendorCase = cardType === 'vendor_case';
            const unitLabel = isDaily ? '시간' : isVendorCase ? '건' : '일';
            const priceLabel = isDaily ? '시급' : isVendorCase ? '건당' : '단가';
            return (
              <div className={`closing-card closing-card-${cardType}`} key={it.id}>
                <div className="closing-card-head">
                  <span className="closing-no">#{buf.no || '-'}</span>
                  <input
                    className="closing-vendor"
                    value={buf.vendor || ''}
                    placeholder="업체명"
                    list={cardType !== 'employee' ? 'closing-vendor-list' : undefined}
                    onChange={(e) => updateField(it.id, 'vendor', e.target.value)}
                    onBlur={() => flushRow(it.id)}
                    disabled={!canEdit}
                  />
                  <input
                    className="closing-name"
                    value={buf.detail || ''}
                    placeholder={cardType === 'vendor_case' ? '프로젝트명' : '이름'}
                    list={
                      cardType === 'vendor_case' ? 'closing-vendor-project-list' :
                      cardType !== 'employee' ? 'closing-freelancer-list' : undefined
                    }
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
                                    step={isDaily ? '0.5' : isVendorCase ? '1' : '0.25'}
                                    min="0"
                                    max={isDaily ? '24' : isVendorCase ? '99' : '1'}
                                    value={v ?? ''}
                                    onChange={(e) => updateDay(it.id, d, e.target.value)}
                                    onBlur={() => flushRow(it.id)}
                                    disabled={!canEdit}
                                    title={isOnLeave ? `${leaveBadgeLabel(leaveType)} (근무 ${workFraction})` : (isDaily ? '시간 입력' : isVendorCase ? '납품 건수' : '')}
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
                    <strong>{Number(buf.quantity || 0)}{unitLabel}</strong>
                  </div>
                  {canViewSalary && (
                    <>
                      <div className="foot-field">
                        <span className="label">{priceLabel}</span>
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
        );
      })()}

      {/* 잔업 상세 모달 */}
      {showOvertimeDetail && (() => {
        const ownOvertimeItems = expenseItems
          .filter((f) => isOvertimeFinance(f))
          .sort((a, b) => (a.description || '').localeCompare(b.description || ''));
        const sum = ownOvertimeItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount ?? f.amount) || 0), 0);
        return (
          <Modal isOpen={showOvertimeDetail} onClose={() => setShowOvertimeDetail(false)} title={`잔업 내역 (${ownOvertimeItems.length}건 · ${sum.toLocaleString()}원)`}>
            {ownOvertimeItems.length === 0 ? (
              <p className="empty-state">등록된 잔업이 없습니다.</p>
            ) : (
              <div className="overtime-detail-list">
                {ownOvertimeItems.map((f) => {
                  const desc = (f.description || '').replace(/^잔업\s*-\s*/, '');
                  return (
                    <div className="overtime-detail-row" key={f.id}>
                      <div className="overtime-detail-info">
                        <strong>{desc}</strong>
                        <span className="overtime-detail-amount">{Number(f.amount || 0).toLocaleString()}원</span>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger-outline"
                          onClick={async () => {
                            if (!confirm('이 잔업 항목을 삭제하시겠습니까?\n(원본 잔업 기록은 남아있을 수 있으니, 필요 시 잔업 관리에서도 정리하세요.)')) return;
                            await handleDeleteFinance(f.id, true);
                          }}
                        >삭제</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Modal>
        );
      })()}

      {/* 업체(공수/프로젝트) 추가 — 2단계 선택 모달 */}
      {vendorPickerMode && (() => {
        const modalTitle =
          vendorPickerStep === 'vendor'
            ? (vendorPickerMode === 'vendor' ? '업체 선택 (공수)' : '업체 선택 (프로젝트)')
            : vendorPickerStep === 'member'
              ? `직원 선택 — ${pickedVendor?.name || ''}`
              : `프로젝트 선택 — ${pickedVendor?.name || ''}`;
        const vendorMembers = pickedVendor
          ? freelancers.filter((f) => (f.vendor || '').trim() === pickedVendor.name.trim())
          : [];
        const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
        return (
          <Modal isOpen={!!vendorPickerMode} onClose={resetVendorPicker} title={modalTitle}>
            {vendorPickerStep === 'vendor' && (
              vendors.length === 0 ? (
                <p className="empty-state">등록된 업체가 없습니다. 먼저 외주관리에 업체를 등록해주세요.</p>
              ) : (
                <ul className="vendor-picker-list">
                  {vendors.map((v) => (
                    <li key={v.id}>
                      <button type="button" onClick={() => handlePickVendor(v)}>
                        <strong>{v.name}</strong>
                        <span>
                          {canViewSalary && vendorPickerMode === 'vendor' && v.dailyRate > 0 && `공수 ${Number(v.dailyRate).toLocaleString()}원`}
                          {canViewSalary && vendorPickerMode === 'vendor_case' && v.caseRate > 0 && `건당 ${Number(v.caseRate).toLocaleString()}원`}
                          {v.representative && `${canViewSalary && (v.dailyRate > 0 || v.caseRate > 0) ? ' · ' : ''}${v.representative}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {vendorPickerStep === 'member' && (
              vendorMembers.length === 0 ? (
                <>
                  <p className="empty-state">이 업체에 등록된 소속 직원이 없습니다.</p>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-outline" onClick={() => setVendorPickerStep('vendor')}>이전</button>
                    <button type="button" className="btn btn-primary" onClick={handlePickMemberBlank}>직원 없이 추가</button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="vendor-picker-list">
                    {vendorMembers.map((f) => {
                      const rate = getRateForDate(f, targetDate);
                      return (
                        <li key={f.id}>
                          <button type="button" onClick={() => handlePickMember(f)}>
                            <strong>{f.name}</strong>
                            <span>{canViewSalary ? (rate > 0 ? `공수 ${rate.toLocaleString()}원` : '단가 미입력') : ''}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-outline" onClick={() => setVendorPickerStep('vendor')}>이전</button>
                    <button type="button" className="btn btn-outline" onClick={handlePickMemberBlank}>직원 없이 추가</button>
                  </div>
                </>
              )
            )}

            {vendorPickerStep === 'project' && (
              (pickedVendor?.projects || []).length === 0 ? (
                <>
                  <p className="empty-state">이 업체에 등록된 프로젝트가 없습니다.</p>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-outline" onClick={() => setVendorPickerStep('vendor')}>이전</button>
                    <button type="button" className="btn btn-primary" onClick={handlePickProjectBlank}>프로젝트 없이 추가</button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="vendor-picker-list">
                    {pickedVendor.projects.map((p) => (
                      <li key={p.name}>
                        <button type="button" onClick={() => handlePickProject(p)}>
                          <strong>{p.name}</strong>
                          <span>{canViewSalary ? (p.unitPrice > 0 ? `건당 ${Number(p.unitPrice).toLocaleString()}원` : '단가 미입력') : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="modal-actions">
                    <button type="button" className="btn btn-outline" onClick={() => setVendorPickerStep('vendor')}>이전</button>
                    <button type="button" className="btn btn-outline" onClick={handlePickProjectBlank}>프로젝트 없이 추가</button>
                  </div>
                </>
              )
            )}
          </Modal>
        );
      })()}
    </div>
  );
}
