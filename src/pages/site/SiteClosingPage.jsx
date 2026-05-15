import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSite, getClosingItems, addClosingItem, updateClosingItem, deleteClosingItem,
  getFinanceItems, addFinanceItem, updateFinanceItem, deleteFinanceItem,
  initRosterFromPreviousMonth, updateSite, getAssignedEmployeeIds,
  getAllSites, getEmployeeClosingItemsByMonth,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';
import { getAllOvertimeRecords } from '../../services/attendanceService';
import { getEvents } from '../../services/eventService';
import { getKoreanHolidayDates } from '../../utils/koreanHolidays';
import { getFreelancers, getVendors, getRateForDate, addFreelancer } from '../../services/outsourceService';
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

// 양산형 프로젝트 자동 채움 범위: 과거 월=전체 평일, 현재 월=오늘까지, 미래 월=0
function autofillUpToDay(year, month) {
  const today = new Date();
  const ty = today.getFullYear();
  const tm = today.getMonth() + 1;
  if (year < ty || (year === ty && month < tm)) return daysInMonth(year, month);
  if (year === ty && month === tm) return today.getDate();
  return 0;
}

// 프로젝트 시작월 이전은 자동 채우지 않음 (신규 프로젝트 직원 추가 시 과거 일자가 1로 채워지는 버그 방지)
function autofillUpToDayForSite(site, year, month) {
  const sy = Number(site?.startYear) || 0;
  const sm = Number(site?.startMonth) || 0;
  if (sy && sm) {
    if (year < sy || (year === sy && month < sm)) return 0;
  }
  return autofillUpToDay(year, month);
}

// 직원 dailyQuantities에서 평일 빈 칸을 1로 채움 (수동값/연차일/공휴일/주말 보존)
// fromDay: 채우기 시작일 (기본 1). 직원 신규 추가 시 추가 당일부터 채우려고 사용
function autofillEmployeeDq({ oldDq, year, month, holidaySet, leaveMap, upToDay, fromDay = 1 }) {
  if (upToDay <= 0) return { newDq: oldDq || {}, changed: false };
  const newDq = { ...(oldDq || {}) };
  let changed = false;
  for (let d = fromDay; d <= upToDay; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (holidaySet.has(iso)) continue;
    if (leaveMap && leaveMap[d]) continue;
    const cur = newDq[d];
    if (cur === undefined || cur === null || cur === '') {
      newDq[d] = 1;
      changed = true;
    }
  }
  return { newDq, changed };
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
  // 다른 프로젝트 같은 월의 직원 일별 공수 합 — 1일 합 1 초과 검증용
  const [otherSitesEmployeeDaily, setOtherSitesEmployeeDaily] = useState({});
  // 휴무일(주말 + 회사 공휴일 + 한국 공휴일) 집합 — 'YYYY-MM-DD'
  const [holidaySet, setHolidaySet] = useState(new Set());
  // 이 사이트 같은 월의 직원 잔업일 집합 — { 이름: Set<day> } (휴무일에 잔업 신청 → 출근으로 표시)
  const [siteOvertimeDays, setSiteOvertimeDays] = useState({});
  // 1일 초과 경고 모달 데이터
  const [overflowAlert, setOverflowAlert] = useState(null);
  const [addingAll, setAddingAll] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [dirtyFinances, setDirtyFinances] = useState(new Set());
  const [showOvertimeDetail, setShowOvertimeDetail] = useState(false);
  // 업체(공수/프로젝트) 추가 모달 — 업체 → 프로젝트 2단계 선택
  const [vendorPickerMode, setVendorPickerMode] = useState(null); // 'vendor' | 'vendor_case' | null
  const [vendorPickerStep, setVendorPickerStep] = useState('vendor'); // 'vendor' | 'project'
  const [pickedVendor, setPickedVendor] = useState(null);
  const [closingTab, setClosingTab] = useState('all'); // 'all' | 'employee' | 'freelancer' | 'daily' | 'vendor'
  // 프리랜서/일용직 추가 모달
  const [freelancerPickerMode, setFreelancerPickerMode] = useState(null); // 'freelancer' | 'daily' | null
  // 프리랜서/일용직 직접 입력 모달
  const [directInputModal, setDirectInputModal] = useState(null); // { type, name, vendor, dailyRate } | null
  // CS 셀 입력 모달 — site.isCS일 때 셀 탭하면 공수+현장명 함께 입력
  const [csCellModal, setCsCellModal] = useState(null); // { itemId, day, qty, siteName } | null

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

  async function loadAll(opts = {}) {
    // silent 모드: 로딩 스피너 안 띄우고 백그라운드 동기화 → 현재 스크롤 위치 유지
    const silent = opts.silent === true;
    if (!silent) setLoading(true);
    try {
      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
      const totalDaysInMonth = new Date(y, m, 0).getDate();
      const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(totalDaysInMonth).padStart(2, '0')}`;
      const [s, its, fins, users, approvedLeaves, assigned, allEmpItemsThisMonth, eventList, allOvertime] = await Promise.all([
        getSite(siteId),
        getClosingItems(siteId, y, m),
        getFinanceItems(siteId, y, m),
        getUsers(),
        getApprovedLeavesByMonth(y, m),
        getAssignedEmployeeIds(y, m),
        getEmployeeClosingItemsByMonth(y, m),
        getEvents().catch(() => []),
        getAllOvertimeRecords(monthStart, monthEnd).catch(() => []),
      ]);

      // 휴무일 집합 — 한국 공휴일 + Firestore 등록 휴일 (해당 월만)
      const hSet = new Set();
      try {
        const koreanHolidays = getKoreanHolidayDates(y) || [];
        koreanHolidays.forEach((iso) => { if (iso.startsWith(`${y}-${String(m).padStart(2, '0')}`)) hSet.add(iso); });
      } catch { /* 무시 */ }
      eventList.filter((e) => e.type === 'holiday').forEach((e) => {
        const start = new Date(e.startDate);
        const end = new Date(e.endDate || e.startDate);
        const cur = new Date(start);
        while (cur <= end) {
          if (cur.getFullYear() === y && cur.getMonth() + 1 === m) {
            const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
            hSet.add(iso);
          }
          cur.setDate(cur.getDate() + 1);
        }
      });
      setHolidaySet(hSet);

      // 이 사이트의 승인된 잔업 — 직원 이름별 잔업일 집합 (휴무일 출근 표시용)
      const otMap = {};
      const userIdToName = Object.fromEntries(users.map((u) => [u.uid, u.name]));
      allOvertime
        .filter((r) => r.status === 'approved' && r.siteId === siteId)
        .forEach((r) => {
          const name = userIdToName[r.userId] || r.userName;
          if (!name) return;
          const day = new Date(r.date).getDate();
          if (!otMap[name]) otMap[name] = new Set();
          otMap[name].add(day);
        });
      setSiteOvertimeDays(otMap);
      // 다른 프로젝트(현재 사이트 제외) 같은 월의 직원 일별 공수 분포
      // { 이름: { day: { total, sources: [{siteName, qty}] } } }
      const allSitesNameMap = Object.fromEntries((await getAllSites()).map((x) => [x.id, x.name]));
      const currentClosingId = `${siteId}_${y}_${String(m).padStart(2, '0')}`;
      const otherDaily = {};
      allEmpItemsThisMonth.forEach((it) => {
        // closingId 포맷: `{siteId}_{year}_{MM}` — siteId 필드가 누락된 legacy 항목의 출처 복원용
        const effectiveSiteId = it.siteId || (it.closingId ? String(it.closingId).split('_')[0] : '');
        if (!effectiveSiteId) return; // 출처 식별 불가 → 합계 제외
        if (effectiveSiteId === siteId) return; // 현재 사이트 본인 항목 제외
        if (it.closingId === currentClosingId) return; // 안전망
        const name = it.detail || '';
        if (!name) return;
        const siteName = allSitesNameMap[effectiveSiteId] || '(삭제된 프로젝트)';
        if (!otherDaily[name]) otherDaily[name] = {};
        const dq = it.dailyQuantities || {};
        for (const [day, qty] of Object.entries(dq)) {
          const q = Number(qty) || 0;
          if (q <= 0) continue;
          if (!otherDaily[name][day]) otherDaily[name][day] = { total: 0, sources: [] };
          otherDaily[name][day].total += q;
          otherDaily[name][day].sources.push({ siteName, qty: q });
        }
      });
      setOtherSitesEmployeeDaily(otherDaily);
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

      // 양산형 프로젝트: 직원 평일 빈 칸을 오늘까지 1로 자동 채움 (단발성은 제외)
      let finalItems = its;
      if (s?.projectType === 'recurring') {
        const upToDay = autofillUpToDayForSite(s, y, m);
        if (upToDay > 0) {
          const updates = [];
          finalItems = its.map((it) => {
            if (it.itemType !== 'employee') return it;
            const leaveMap = ldByName[it.detail] || {};
            const { newDq, changed } = autofillEmployeeDq({
              oldDq: it.dailyQuantities,
              year: y,
              month: m,
              holidaySet: hSet,
              leaveMap,
              upToDay,
            });
            if (!changed) return it;
            const quantity = Object.values(newDq).reduce((sum, v) => sum + Number(v || 0), 0);
            const unitPrice = Number(it.unitPrice) || 0;
            const amount = Math.round(unitPrice * quantity);
            updates.push(updateClosingItem(it.id, { dailyQuantities: newDq, quantity, amount }));
            return { ...it, dailyQuantities: newDq, quantity, amount };
          });
          if (updates.length > 0) await Promise.all(updates);
        }
      }

      // vendor_case: 캘린더(dailyQuantities) → 납기일 행(closings) 자동 마이그레이션
      // closings가 비어있고 dailyQuantities에 값이 있는 항목만 1회 변환 후 firestore 저장
      const migrationUpdates = [];
      finalItems = finalItems.map((it) => {
        if (it.itemType !== 'vendor_case') return it;
        const closings = Array.isArray(it.closings) ? it.closings : [];
        const dq = it.dailyQuantities || {};
        const hasDq = Object.values(dq).some((v) => Number(v) > 0);
        if (closings.length > 0 || !hasDq) return it;
        const migrated = Object.entries(dq)
          .map(([day, n]) => ({ day: Number(day), count: Number(n) || 0 }))
          .filter((r) => r.count > 0)
          .sort((a, b) => a.day - b.day)
          .map((r, i) => ({
            id: `c-${Date.now()}-${i}`,
            date: `${y}-${String(m).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
            count: r.count,
            units: '',
          }));
        const quantity = migrated.reduce((s, r) => s + (r.count || 0), 0);
        const amount = (Number(it.unitPrice) || 0) * quantity;
        migrationUpdates.push(updateClosingItem(it.id, { closings: migrated, dailyQuantities: {}, quantity, amount }));
        return { ...it, closings: migrated, dailyQuantities: {}, quantity, amount };
      });
      if (migrationUpdates.length > 0) {
        try { await Promise.all(migrationUpdates); } catch (e) { console.error('vendor_case 마이그레이션 일부 실패', e); }
      }

      setItems(finalItems);
      const buf = {};
      finalItems.forEach((it) => {
        buf[it.id] = {
          ...it,
          dailyQuantities: { ...(it.dailyQuantities || {}) },
          closings: Array.isArray(it.closings) ? it.closings.map((c) => ({ ...c })) : [],
        };
      });
      setEditBuf(buf);
      const fbuf = {};
      fins.forEach((f) => { fbuf[f.id] = { ...f }; });
      setFinanceBuf(fbuf);

    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function handleCopyPrevMonth() {
    if (!confirm('전월 직원/프리랜서 명단을 복사합니다.\n(수량·금액은 0으로 초기화, 매출/지출은 복사되지 않습니다)\n\n계속하시겠습니까?')) return;
    setCopying(true);
    try {
      const count = await initRosterFromPreviousMonth(siteId, y, m);
      alert(`복사 완료: 명단 ${count}건`);
      await loadAll({ silent: true });
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
      await loadAll({ silent: true });
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
      await loadAll({ silent: true });
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
        dailySites: data.dailySites || {},
        closings: Array.isArray(data.closings) ? data.closings : [],
        quantity: Number(data.quantity) || 0,
        amount: Number(data.amount) || 0,
      });
      setLastSavedAt(new Date());
      setSaveError(null);
      // 프리랜서/일용직 직접입력 → 외주관리에 미등록 이름이면 자동 등록
      maybeAutoRegisterFreelancer(data);
    } catch (err) {
      console.error('자동 저장 실패', err);
      setSaveError(err.message || '저장 실패');
    } finally {
      setSavingCount((c) => Math.max(0, c - 1));
    }
  }

  // 프리랜서/일용직 직접입력 자동 외주관리 등록
  async function maybeAutoRegisterFreelancer(data) {
    if (!data) return;
    const type = data.itemType;
    if (type !== 'freelancer' && type !== 'daily') return;
    const name = (data.detail || '').trim();
    if (!name) return;
    // 이미 등록되어 있으면 skip (이름 + workerType 동일)
    const wt = type === 'daily' ? 'daily' : 'freelancer';
    const exists = freelancers.some((f) => {
      const fwt = f.workerType || 'freelancer';
      return (f.name || '').trim() === name && fwt === wt;
    });
    if (exists) return;
    try {
      await addFreelancer({
        name,
        vendor: (data.vendor || '').trim(),
        dailyRate: Number(data.unitPrice) || 0,
        contact: '',
        note: '',
        workerType: wt,
        autoCreated: true,
        createdBy: userProfile?.uid || '',
      });
      // 로컬 freelancers state 갱신 — 같은 이름이 중복 호출돼도 한 번만 등록되도록
      setFreelancers((prev) => [
        ...prev,
        {
          id: `auto-${Date.now()}`,
          name,
          vendor: (data.vendor || '').trim(),
          dailyRate: Number(data.unitPrice) || 0,
          workerType: wt,
          autoCreated: true,
        },
      ]);
    } catch (err) {
      console.error('외주관리 자동 등록 실패:', err);
    }
  }

  function scheduleSave(itemId, data) {
    if (timersRef.current[itemId]) clearTimeout(timersRef.current[itemId]);
    timersRef.current[itemId] = setTimeout(() => {
      persistRow(itemId, data);
      delete timersRef.current[itemId];
    }, AUTO_SAVE_DELAY_MS);
  }

  function openFreelancerPicker(mode) {
    setFreelancerPickerMode(mode);
  }

  // 프리랜서/일용직 직접 입력 모달 열기 (picker 모달 닫고 입력 폼 표시)
  function openDirectInput(itemType) {
    setFreelancerPickerMode(null);
    const vendorSuggestion = itemType === 'freelancer' ? (site?.defaultVendors?.[items.length] || '') : '';
    setDirectInputModal({ type: itemType, name: '', vendor: vendorSuggestion, dailyRate: 0 });
  }

  // 직접 입력 모달 제출 — 행 생성 + 외주관리 자동 등록
  async function submitDirectInput() {
    const m_ = directInputModal;
    if (!m_) return;
    const name = (m_.name || '').trim();
    if (!name) { alert('이름을 입력해주세요.'); return; }
    const dup = items.some((it) => it.itemType === m_.type && (it.detail || '').trim() === name);
    if (dup) { alert(`${name}은(는) 이미 추가되어 있습니다.`); return; }
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    const vendor = (m_.vendor || '').trim();
    const dailyRate = Number(m_.dailyRate) || 0;
    try {
      await addClosingItem(siteId, y, m, {
        no: nextNo,
        vendor,
        detail: name,
        category: '',
        itemType: m_.type,
        unitPrice: dailyRate,
        dailyQuantities: {},
        quantity: 0,
        amount: 0,
        order: nextOrder,
      });
      // 외주관리 자동 등록 (이름 미등록인 경우)
      await maybeAutoRegisterFreelancer({
        itemType: m_.type,
        detail: name,
        vendor,
        unitPrice: dailyRate,
      });
      setDirectInputModal(null);
      await loadAll({ silent: true });
    } catch (err) {
      alert('추가 실패: ' + (err.message || '알 수 없는 오류'));
    }
  }

  // 프리랜서 선택 시 — 이름/업체/단가 자동 입력
  async function handlePickFreelancer(f, itemType) {
    const alreadyExists = items.some((it) => (it.itemType === itemType) && it.detail === f.name);
    if (alreadyExists) { alert(`${f.name}은(는) 이미 추가되어 있습니다.`); return; }
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const rate = getRateForDate(f, targetDate);
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: f.vendor || '',
      detail: f.name || '',
      category: '',
      itemType,
      unitPrice: Number(rate) || 0,
      dailyQuantities: {},
      quantity: 0,
      amount: 0,
      order: nextOrder,
      vendorLocked: !!(f.vendor || '').trim(),
      detailLocked: true,
    });
    setFreelancerPickerMode(null);
    await loadAll({ silent: true });
  }

  function openVendorPicker(mode) {
    setVendorPickerMode(mode);
    setVendorPickerStep('vendor');
    setPickedVendor(null);
  }

  async function addVendorRow({ itemType, vendorName, projectName = '', unitPrice = 0, vendorLocked = false, detailLocked = false }) {
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
      closings: [],
      quantity: 0,
      amount: 0,
      order: nextOrder,
      vendorLocked,
      detailLocked,
    });
    await loadAll({ silent: true });
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
    const dup = items.some((it) => it.itemType === 'vendor' && (it.vendor || '') === (pickedVendor?.name || '') && (it.detail || '') === (f?.name || ''));
    if (dup) { alert(`${pickedVendor?.name} · ${f?.name}는 이미 추가되어 있습니다.`); return; }
    const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const rate = getRateForDate(f, targetDate) || Number(pickedVendor?.dailyRate) || 0;
    await addVendorRow({
      itemType: 'vendor',
      vendorName: pickedVendor?.name || '',
      projectName: f?.name || '',
      unitPrice: rate,
      vendorLocked: true,
      detailLocked: true,
    });
    resetVendorPicker();
  }

  async function handlePickMemberBlank() {
    await addVendorRow({
      itemType: 'vendor',
      vendorName: pickedVendor?.name || '',
      projectName: '',
      unitPrice: Number(pickedVendor?.dailyRate) || 0,
      vendorLocked: true,
      detailLocked: false,
    });
    resetVendorPicker();
  }

  async function handlePickProject(p) {
    const dup = items.some((it) => it.itemType === 'vendor_case' && (it.vendor || '') === (pickedVendor?.name || '') && (it.detail || '') === (p?.name || ''));
    if (dup) { alert(`${pickedVendor?.name} · ${p?.name}는 이미 추가되어 있습니다.`); return; }
    await addVendorRow({
      itemType: 'vendor_case',
      vendorName: pickedVendor?.name || '',
      projectName: p?.name || '',
      unitPrice: Number(p?.unitPrice) || Number(pickedVendor?.caseRate) || 0,
      vendorLocked: true,
      detailLocked: true,
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
      vendorLocked: true,
      detailLocked: false,
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
    // 양산형: 평일 빈 칸을 오늘까지 1로 자동 채움 / 단발성: 빈 상태로 생성
    let initDq = {};
    let initQuantity = 0;
    let initAmount = 0;
    if (site?.projectType === 'recurring') {
      const upToDay = autofillUpToDayForSite(site, y, m);
      if (upToDay > 0) {
        // 직원 추가일부터 채움 — 현재 월이면 오늘 날짜부터, 과거 월이면 채우지 않음(추가일이 범위 밖)
        const today = new Date();
        const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === m;
        const fromDay = isCurrentMonth ? today.getDate() : upToDay + 1;
        const leaveMap = leaveDays[user.name] || {};
        const { newDq } = autofillEmployeeDq({
          oldDq: {},
          year: y,
          month: m,
          holidaySet,
          leaveMap,
          upToDay,
          fromDay,
        });
        initDq = newDq;
        initQuantity = Object.values(newDq).reduce((sum, v) => sum + Number(v || 0), 0);
        initAmount = Math.round(dailyRate * initQuantity);
      }
    }
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '직원',
      detail: user.name,
      category: `월급 ${monthlySalary.toLocaleString()} ÷ ${workingDays}일`,
      itemType: resolvedType,
      unitPrice: dailyRate,
      dailyQuantities: initDq,
      quantity: initQuantity,
      amount: initAmount,
      order: nextOrder,
      vendorLocked: true,
      detailLocked: true,
    });
    setShowEmployeeSelect(false);
    await loadAll({ silent: true });
  }

  async function handleDeleteRow(itemId) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    if (timersRef.current[itemId]) {
      clearTimeout(timersRef.current[itemId]);
      delete timersRef.current[itemId];
    }
    try {
      await deleteClosingItem(itemId);
      // 낙관적 업데이트 — 전체 reload 대신 로컬 상태에서만 제거해 스크롤 위치 유지
      setItems((prev) => prev.filter((x) => x.id !== itemId));
      setEditBuf((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
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
          if (cur.itemType === 'employee') {
            // 휴가 종류에 따라 일 최대 입력값 제한 (반차 0.5 / 반반차 0.75)
            const leaveType = leaveDays[cur.detail]?.[day];
            let dayMax = 1;
            if (leaveType === 'half_am' || leaveType === 'half_pm') dayMax = 0.5;
            else if (QUARTER_LEAVE_TYPES.includes(leaveType)) dayMax = 0.75;
            num = Math.max(0, Math.min(dayMax, num));
            const info = otherSitesEmployeeDaily[cur.detail || '']?.[day];
            const otherTotal = info?.total || 0;
            const allowed = Math.max(0, Math.min(dayMax - otherTotal, dayMax));
            if (num > allowed) {
              setOverflowAlert({
                name: cur.detail || '직원',
                day,
                otherTotal,
                allowed,
                attempted: num,
                sources: info?.sources || [],
              });
              num = allowed;
            }
          }
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

  // CS 셀 모달 열기 — 기존 값(공수/현장명) 채워서 표시
  function openCsCellModal(itemId, day) {
    const buf = editBuf[itemId];
    if (!buf) return;
    setCsCellModal({
      itemId,
      day,
      qty: buf.dailyQuantities?.[day] ?? '',
      siteName: buf.dailySites?.[day] || '',
    });
  }

  // CS 셀 모달 저장 — dailyQuantities와 dailySites 동시 업데이트
  function saveCsCellModal() {
    if (!csCellModal) return;
    const { itemId, day, qty, siteName } = csCellModal;
    setEditBuf((b) => {
      const cur = { ...b[itemId] };
      const dq = { ...(cur.dailyQuantities || {}) };
      const ds = { ...(cur.dailySites || {}) };
      const trimmedSite = (siteName || '').trim();
      const rawQty = qty;
      let num = Number(rawQty);
      if (rawQty === '' || rawQty === null || isNaN(num) || num <= 0) {
        delete dq[day];
        delete ds[day];
      } else {
        // CS는 보통 직원/프리랜서/일용직 → 1일 최대 1로 클램프 (직원일 때 다른 사이트 합산 검증)
        const isEmployee = cur.itemType === 'employee';
        const leaveType = isEmployee ? leaveDays[cur.detail]?.[day] : null;
        let dayMax = 1;
        if (leaveType === 'half_am' || leaveType === 'half_pm') dayMax = 0.5;
        else if (QUARTER_LEAVE_TYPES.includes(leaveType)) dayMax = 0.75;
        num = Math.max(0, Math.min(dayMax, num));
        if (isEmployee) {
          const info = otherSitesEmployeeDaily[cur.detail || '']?.[day];
          const otherTotal = info?.total || 0;
          const allowed = Math.max(0, Math.min(dayMax - otherTotal, dayMax));
          if (num > allowed) {
            setOverflowAlert({
              name: cur.detail || '직원',
              day,
              otherTotal,
              allowed,
              attempted: num,
              sources: info?.sources || [],
            });
            num = allowed;
          }
        }
        if (num <= 0) {
          delete dq[day];
          delete ds[day];
        } else {
          dq[day] = num;
          if (trimmedSite) ds[day] = trimmedSite;
          else delete ds[day];
        }
      }
      cur.dailyQuantities = dq;
      cur.dailySites = ds;
      const sum = Object.values(dq).reduce((a, v) => a + (Number(v) || 0), 0);
      cur.quantity = sum;
      cur.amount = Number(cur.unitPrice || 0) * sum;
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
    setCsCellModal(null);
  }

  // --- 업체(프로젝트) 납기일 행 추가/삭제/수정 ---
  function addRowClosing(itemId) {
    setEditBuf((b) => {
      const cur = { ...b[itemId] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      const today = new Date();
      const tYear = today.getFullYear();
      const tMonth = today.getMonth() + 1;
      let yyyy = tYear, mm = tMonth, dd = today.getDate();
      if (tYear !== y || tMonth !== m) { yyyy = y; mm = m; dd = 1; }
      const dateStr = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      closings.push({ id: `c-${Date.now()}`, date: dateStr, count: 0, units: '' });
      cur.closings = closings;
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = (Number(cur.unitPrice) || 0) * totalQty;
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
  }
  function removeRowClosing(itemId, idx) {
    setEditBuf((b) => {
      const cur = { ...b[itemId] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      closings.splice(idx, 1);
      cur.closings = closings;
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = (Number(cur.unitPrice) || 0) * totalQty;
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
  }
  function updateRowClosing(itemId, idx, field, value) {
    setEditBuf((b) => {
      const cur = { ...b[itemId] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      const row = { ...(closings[idx] || {}) };
      row[field] = value;
      // units 텍스트에서 콤마/공백/슬래시로 분리 → 자동 댓수 카운트
      if (field === 'units') {
        const tokens = (value || '').split(/[,\s/]+/).filter((x) => x.trim());
        row.count = tokens.length;
      }
      closings[idx] = row;
      cur.closings = closings;
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = (Number(cur.unitPrice) || 0) * totalQty;
      scheduleSave(itemId, cur);
      return { ...b, [itemId]: cur };
    });
  }

  // --- 지출/매출 ---
  async function handleAddFinance(type, description = '') {
    const list = finances.filter((f) => f.type === type);
    const nextOrder = list.length ? Math.max(...list.map((f) => f.order || 0)) + 1 : 1;
    // 지출은 발생일 기본값을 설정 — 오늘이 현재 마감월 안이면 오늘, 아니면 마감월 1일
    let date = '';
    if (type === 'expense') {
      const today = new Date();
      if (today.getFullYear() === y && (today.getMonth() + 1) === m) {
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        date = `${today.getFullYear()}-${mm}-${dd}`;
      } else {
        date = `${y}-${String(m).padStart(2, '0')}-01`;
      }
    }
    await addFinanceItem(siteId, y, m, { type, description, amount: 0, note: '', order: nextOrder, date });
    await loadAll({ silent: true });
  }

  function updateFinanceField(id, field, value) {
    setDirtyFinances((s) => new Set([...s, id]));
    setFinanceBuf((b) => {
      const cur = { ...b[id], [field]: field === 'amount' ? Number(value) || 0 : value };
      scheduleFinanceSave(id, cur);
      return { ...b, [id]: cur };
    });
  }
  // 매출 단가 갱신 → 매출액 = 단가 × 총 댓수 자동 재계산
  function updateFinanceUnitPrice(id, value) {
    setFinanceBuf((b) => {
      const cur = { ...b[id] };
      cur.unitPrice = Number(String(value).replace(/[,\s]/g, '')) || 0;
      const closings = Array.isArray(cur.closings) ? cur.closings : [];
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = cur.unitPrice * totalQty;
      scheduleFinanceSave(id, cur);
      return { ...b, [id]: cur };
    });
  }
  // 매출 마감행 추가/삭제/수정
  function addClosingRow(id) {
    setFinanceBuf((b) => {
      const cur = { ...b[id] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      closings.push({ id: `c-${Date.now()}`, date: `${yyyy}-${mm}-${dd}`, count: 0, units: '' });
      cur.closings = closings;
      scheduleFinanceSave(id, cur);
      return { ...b, [id]: cur };
    });
  }
  function removeClosingRow(id, idx) {
    setFinanceBuf((b) => {
      const cur = { ...b[id] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      closings.splice(idx, 1);
      cur.closings = closings;
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = (Number(cur.unitPrice) || 0) * totalQty;
      scheduleFinanceSave(id, cur);
      return { ...b, [id]: cur };
    });
  }
  function updateClosingRow(id, idx, field, value) {
    setFinanceBuf((b) => {
      const cur = { ...b[id] };
      const closings = Array.isArray(cur.closings) ? [...cur.closings] : [];
      const row = { ...(closings[idx] || {}) };
      row[field] = value;
      // units 필드에서 자동으로 count 도출 (콤마/공백 구분)
      if (field === 'units') {
        const tokens = (value || '').split(/[,\s/]+/).filter((x) => x.trim());
        row.count = tokens.length;
      }
      closings[idx] = row;
      cur.closings = closings;
      const totalQty = closings.reduce((s, c) => s + (Number(c.count) || 0), 0);
      cur.quantity = totalQty;
      cur.amount = (Number(cur.unitPrice) || 0) * totalQty;
      scheduleFinanceSave(id, cur);
      return { ...b, [id]: cur };
    });
  }
  function scheduleFinanceSave(id, cur) {
    if (timersRef.current['fin_' + id]) clearTimeout(timersRef.current['fin_' + id]);
    timersRef.current['fin_' + id] = setTimeout(async () => {
      setSavingCount((c) => c + 1);
      try {
        await updateFinanceItem(id, {
          description: cur.description,
          amount: cur.amount,
          note: cur.note,
          date: cur.date || '',
          unitPrice: cur.unitPrice || 0,
          quantity: cur.quantity || 0,
          closings: cur.closings || [],
          checked: cur.checked || false,
        });
        setLastSavedAt(new Date());
        setSaveError(null);
        setDirtyFinances((s) => { const n = new Set(s); n.delete(id); return n; });
      } catch (err) {
        setSaveError(err.message || '저장 실패');
      } finally {
        setSavingCount((c) => Math.max(0, c - 1));
      }
      delete timersRef.current['fin_' + id];
    }, AUTO_SAVE_DELAY_MS);
  }

  function toggleFinanceChecked(id) {
    setFinanceBuf((b) => {
      const checked = !b[id]?.checked;
      updateFinanceItem(id, { checked });
      return { ...b, [id]: { ...b[id], checked } };
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
      updateFinanceItem(id, { description: cur.description, amount: cur.amount, note: cur.note, date: cur.date || '' })
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
      await loadAll({ silent: true });
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
          <button className="btn btn-outline" onClick={() => navigate(`/sites?y=${y}&m=${m}`)}>목록으로</button>
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
    saveStatus = null;
  }

  return (
    <div className="site-closing-page">
      <div className="page-header">
        <h2>{site.name} <span className="closing-period">{y}년 {m}월</span></h2>
        <div className="page-actions">
          {canEdit && saveStatus}
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
          <button className="btn btn-outline" onClick={() => navigate(`/sites?y=${y}&m=${m}`)}>목록</button>
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
        {canViewSalary && !hideRevenue && (
          <div className="closing-summary-item">
            <span className="label">매출</span>
            <strong style={{ color: 'var(--success, #16a34a)' }}>{totalRevenue.toLocaleString()}원</strong>
          </div>
        )}
        {canViewSalary && (
          <div className="closing-summary-item">
            <span className="label">지출</span>
            <strong style={{ color: 'var(--danger, #dc2626)' }}>{totalExpense.toLocaleString()}원</strong>
          </div>
        )}
        {canViewSalary && (
          <div className="closing-summary-item closing-summary-total">
            <span className="label">외주 합계</span>
            <strong>{freelancerTotal.toLocaleString()}원</strong>
          </div>
        )}
        {canViewSalary && (
          <div className="closing-summary-item closing-summary-total">
            <span className="label">직원 합계</span>
            <strong>{employeeTotal.toLocaleString()}원</strong>
          </div>
        )}
        {canViewSalary && !hideRevenue && (
          <div className="closing-summary-item closing-summary-net">
            <span className="label">합계</span>
            <strong style={{ color: netTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {netTotal >= 0 ? '+' : ''}{netTotal.toLocaleString()}원
            </strong>
          </div>
        )}
      </div>

      {/* 매출 섹션 (hideRevenue 프로젝트는 숨김) */}
      {!hideRevenue && (
        <div className="finance-section">
          <div className="finance-section-header">
            <h3 className="finance-title finance-revenue">매출</h3>
            {canEdit && (
              <div className="finance-actions">
                <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('revenue')}>+ 추가</button>
              </div>
            )}
          </div>
          {revenueItems.length === 0 ? (
            <p className="text-muted text-sm" style={{ padding: '8px 0' }}>등록된 매출 항목이 없습니다.</p>
          ) : (
            <div className="revenue-list">
              {revenueItems.map((f) => {
                const buf = financeBuf[f.id] || f;
                const closings = Array.isArray(buf.closings) ? buf.closings : [];
                // 호기 문자열을 콤마/공백으로 split → 비어있지 않은 항목 수 = 댓수
                const countUnits = (units) => (units || '').split(/[,\s/]+/).filter((x) => x.trim()).length;
                const totalQty = closings.reduce((s, c) => s + countUnits(c.units), 0);
                const totalAmount = (Number(buf.unitPrice) || 0) * totalQty;
                return (
                  <div className="revenue-card" key={f.id}>
                    <div className="revenue-card-head">
                      <input
                        className="revenue-desc"
                        value={buf.description || ''}
                        placeholder="항목명 (예: A설비)"
                        onChange={(e) => updateFinanceField(f.id, 'description', e.target.value)}
                        onBlur={() => flushFinance(f.id)}
                        disabled={!canEdit}
                      />
                      <div className="revenue-unitprice">
                        <span className="label">1대당</span>
                        <MoneyInput
                          className="revenue-unitprice-input"
                          value={buf.unitPrice || 0}
                          onChange={(e) => updateFinanceUnitPrice(f.id, e.target.value)}
                          onBlur={() => flushFinance(f.id)}
                          disabled={!canEdit}
                        />
                        <span className="label">원</span>
                      </div>
                      {canEdit && (
                        <button className="closing-delete" onClick={() => handleDeleteFinance(f.id)} aria-label="삭제">✕</button>
                      )}
                    </div>

                    <div className="revenue-rows">
                      <div className="revenue-row revenue-row-head">
                        <span>마감일자</span>
                        <span>호기</span>
                        <span></span>
                      </div>
                      {closings.length === 0 && (
                        <div className="revenue-row-empty">마감 일자를 추가해주세요.</div>
                      )}
                      {closings.map((c, idx) => (
                        <div className="revenue-row" key={c.id || idx}>
                          <input
                            type="date"
                            value={c.date || ''}
                            onChange={(e) => updateClosingRow(f.id, idx, 'date', e.target.value)}
                            onBlur={() => flushFinance(f.id)}
                            disabled={!canEdit}
                          />
                          <input
                            type="text"
                            value={c.units || ''}
                            onChange={(e) => updateClosingRow(f.id, idx, 'units', e.target.value)}
                            onBlur={() => flushFinance(f.id)}
                            disabled={!canEdit}
                            placeholder="예: 1호기, 2호기 (콤마로 구분 → 자동 카운트)"
                          />
                          {canEdit && (
                            <button type="button" className="closing-delete" onClick={() => removeClosingRow(f.id, idx)} aria-label="행 삭제">✕</button>
                          )}
                        </div>
                      ))}
                      {canEdit && (
                        <button type="button" className="btn btn-sm btn-outline revenue-add-row" onClick={() => addClosingRow(f.id)}>
                          + 마감 추가
                        </button>
                      )}
                    </div>

                    <div className="revenue-card-foot">
                      <div className="foot-field">
                        <span className="label">총 댓수</span>
                        <strong>{totalQty}대</strong>
                      </div>
                      <div className="foot-field">
                        <span className="label">매출</span>
                        <strong style={{ color: 'var(--success)' }}>{totalAmount.toLocaleString()}원</strong>
                      </div>
                    </div>
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
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense')}>+ 추가</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '식대')}>+ 식대</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '교통비')}>+ 교통비</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '자재비')}>+ 자재비</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '운송비')}>+ 운송비</button>
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
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material', '운송비': 'shipping' };
              const chipKey = chipMap[desc];
              return (
                <div className={`expense-card ${chipKey ? `expense-card-${chipKey}` : ''}`} key={f.id}>
                  <span className={`expense-tag ${chipKey ? `expense-chip-${chipKey}` : 'expense-chip-default'}`}>
                    {desc || '지출'}
                  </span>
                  <input
                    type="date"
                    className="expense-input-date"
                    value={buf.date || ''}
                    onChange={(e) => updateFinanceField(f.id, 'date', e.target.value)}
                    onBlur={() => flushFinance(f.id)}
                    disabled={!canEdit}
                    aria-label="발생일"
                  />
                  <input className="expense-input-desc" value={buf.description || ''} placeholder="항목명" onChange={(e) => updateFinanceField(f.id, 'description', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit || !!chipKey} />
                  <input className="expense-input-note" value={buf.note || ''} placeholder="비고" onChange={(e) => updateFinanceField(f.id, 'note', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  <MoneyInput className={`expense-input-amount ${!dirtyFinances.has(f.id) && lastSavedAt && (buf.amount || 0) > 0 ? 'is-saved' : ''}`} value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  <span className="expense-won">원</span>
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
              const chipMap = { '식대': 'meal', '교통비': 'transport', '자재비': 'material', '운송비': 'shipping' };
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
                  <div className={`expense-card expense-card-readonly expense-card-mirror ${chipKey ? `expense-card-${chipKey}` : ''}`} key={`mirror-group-${desc}`}>
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
                <div className="expense-card expense-card-readonly expense-card-mirror expense-card-overtime" key="mirror-overtime-total">
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
                <div className="expense-card expense-card-readonly expense-card-mirror" key="mirror-labor-total">
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
            <button className="btn btn-sm btn-outline closing-add-btn" onClick={() => setShowEmployeeSelect(true)}>+ 직원</button>
            <button className="btn btn-sm btn-outline closing-add-btn" onClick={() => openFreelancerPicker('freelancer')}>+ 프리랜서</button>
            <button className="btn btn-sm btn-outline closing-add-btn" onClick={() => openFreelancerPicker('daily')}>+ 일용직</button>
            <button className="btn btn-sm btn-outline closing-add-btn" onClick={() => openVendorPicker('vendor')}>+ 업체(공수)</button>
            <button className="btn btn-sm btn-outline closing-add-btn" onClick={() => openVendorPicker('vendor_case')}>+ 업체(프로젝트)</button>
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
          { key: 'vendor', label: '업체(공수)', count: cnt(['vendor']) },
          { key: 'vendor_case', label: '업체(프로젝트)', count: cnt(['vendor_case']) },
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
            const unitLabel = isDaily ? '시간' : isVendorCase ? '대' : '일';
            const priceLabel = isDaily ? '시급' : isVendorCase ? '1대당' : '단가';
            // 모달 전용 생성 유형은 과거 데이터도 파생 잠금.
            // - employee: 항상 모달 → 업체/이름 둘 다 잠금
            // - vendor / vendor_case: 업체는 항상 모달 → 업체 잠금. 이름은 값 있을 때만(모달 선택) 잠금.
            // - freelancer / daily: 직접 입력 경로 있음 → 플래그만 사용
            const isEmployee = cardType === 'employee';
            const isVendorType = cardType === 'vendor' || cardType === 'vendor_case';
            const vendorLocked = !!buf.vendorLocked || isEmployee || (isVendorType && !!(buf.vendor || '').trim());
            const detailLocked = !!buf.detailLocked || isEmployee || (isVendorType && !!(buf.detail || '').trim());
            return (
              <div className={`closing-card closing-card-${cardType}`} key={it.id}>
                <div className="closing-card-head">
                  <span className="closing-no">#{buf.no || '-'}</span>
                  <input
                    className="closing-vendor"
                    value={buf.vendor || ''}
                    placeholder="업체명"
                    list={!vendorLocked && cardType !== 'employee' ? 'closing-vendor-list' : undefined}
                    onChange={(e) => updateField(it.id, 'vendor', e.target.value)}
                    onBlur={() => flushRow(it.id)}
                    disabled={!canEdit}
                    readOnly={vendorLocked}
                    title={vendorLocked ? '모달에서 선택된 값은 수정 불가 (삭제 후 재추가)' : undefined}
                  />
                  <input
                    className="closing-name"
                    value={buf.detail || ''}
                    placeholder={cardType === 'vendor_case' ? '프로젝트명' : '이름'}
                    list={
                      detailLocked ? undefined :
                      cardType === 'vendor_case' ? 'closing-vendor-project-list' :
                      cardType !== 'employee' ? 'closing-freelancer-list' : undefined
                    }
                    onChange={(e) => updateField(it.id, 'detail', e.target.value)}
                    onBlur={() => flushRow(it.id)}
                    disabled={!canEdit}
                    readOnly={detailLocked}
                    title={detailLocked ? '모달에서 선택된 값은 수정 불가 (삭제 후 재추가)' : undefined}
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

                {isVendorCase ? (
                  (() => {
                    const closings = Array.isArray(buf.closings) ? buf.closings : [];
                    return (
                      <div className="vendor-case-rows">
                        <div className="vendor-case-row vendor-case-row-head">
                          <span>납기일</span>
                          <span>호기</span>
                          <span className="vendor-case-count-head">댓수</span>
                          <span></span>
                        </div>
                        {closings.length === 0 && (
                          <div className="vendor-case-row-empty">납기일 행을 추가해주세요.</div>
                        )}
                        {closings.map((c, idx) => (
                          <div className="vendor-case-row" key={c.id || idx}>
                            <input
                              type="date"
                              value={c.date || ''}
                              onChange={(e) => updateRowClosing(it.id, idx, 'date', e.target.value)}
                              onBlur={() => flushRow(it.id)}
                              disabled={!canEdit}
                            />
                            <input
                              type="text"
                              value={c.units || ''}
                              onChange={(e) => updateRowClosing(it.id, idx, 'units', e.target.value)}
                              onBlur={() => flushRow(it.id)}
                              disabled={!canEdit}
                              placeholder="예: 1호기, 2호기 (콤마 구분 → 자동 카운트)"
                            />
                            <span className="vendor-case-count">{Number(c.count) || 0}대</span>
                            {canEdit && (
                              <button type="button" className="closing-delete" onClick={() => removeRowClosing(it.id, idx)} aria-label="행 삭제">✕</button>
                            )}
                          </div>
                        ))}
                        {canEdit && (
                          <button type="button" className="btn btn-sm btn-outline vendor-case-add-row" onClick={() => addRowClosing(it.id)}>
                            + 납기 추가
                          </button>
                        )}
                      </div>
                    );
                  })()
                ) : (() => {
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
                            const dayIso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                            const isHoliday = holidaySet.has(dayIso);
                            // 직원 공수표: 토/일/공휴일 = 입력 차단 (잔업 별도 등록 영역)
                            const isEmpRest = isEmployee && (isSaturday || isSunday || isHoliday);
                            // 휴무일에 잔업 신청 있으면 자동으로 "출근" 표시
                            const hasSiteOvertime = isEmployee && siteOvertimeDays[buf.detail]?.has(d);
                            const showAttendance = isEmpRest && hasSiteOvertime;
                            const leaveType = isEmployee ? leaveDays[buf.detail]?.[d] : undefined;
                            const isOnLeave = !!leaveType;
                            const workFraction = leaveWorkFraction(leaveType);
                            const isFullLeave = isOnLeave && workFraction === 0;
                            const leaveCls = isOnLeave ? `leave-${leaveType}` : '';
                            // CS 프로젝트: 셀 탭 → 모달로 공수+현장명 입력
                            const isCSMode = !!site?.isCS && !isVendorCase;
                            const csSiteName = isCSMode ? (buf.dailySites?.[d] || '') : '';
                            return (
                              <div className={`day-cal-cell ${hasValue ? 'has-value' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${isHoliday ? 'is-holiday' : ''} ${isOnLeave ? 'on-leave' : ''} ${leaveCls} ${isEmpRest ? 'is-emp-rest' : ''} ${isCSMode ? 'is-cs-cell' : ''}`} key={di}>
                                <label>{d}</label>
                                {isEmpRest ? (
                                  showAttendance ? (
                                    <div className="emp-rest-attendance" title="잔업 신청에 따라 자동 출근 표시">출근</div>
                                  ) : (
                                    <div className="emp-rest-blocked" title="휴무일은 잔업 신청 시 자동 출근 표시됩니다" />
                                  )
                                ) : isFullLeave ? (
                                  <div
                                    className={`leave-badge-input leave-badge-${leaveType}`}
                                    title={`${leaveBadgeLabel(leaveType)} (근무 ${workFraction})`}
                                  >
                                    {leaveBadgeLabel(leaveType)}
                                  </div>
                                ) : isCSMode ? (
                                  <button
                                    type="button"
                                    className={`cs-cell-btn ${hasValue ? 'has-value' : ''}`}
                                    onClick={() => canEdit && openCsCellModal(it.id, d)}
                                    disabled={!canEdit}
                                    title={canEdit ? '탭하여 공수·현장 입력' : (csSiteName ? `${csSiteName} · ${v}공수` : '')}
                                  >
                                    <span className="cs-cell-qty">{hasValue ? v : '+'}</span>
                                    {csSiteName && <span className="cs-cell-site">{csSiteName}</span>}
                                  </button>
                                ) : (
                                  <div className="day-cal-input-wrap">
                                    <input
                                      type="number"
                                      step={isDaily ? '0.5' : isVendorCase ? '1' : '0.25'}
                                      min="0"
                                      max={isDaily ? '24' : isVendorCase ? '99' : (
                                        // 직원 휴가일 최대값: 반차 0.5 / 반반차 0.75 / 그 외 1
                                        (leaveType === 'half_am' || leaveType === 'half_pm') ? '0.5'
                                          : QUARTER_LEAVE_TYPES.includes(leaveType) ? '0.75'
                                          : '1'
                                      )}
                                      value={v ?? ''}
                                      onChange={(e) => updateDay(it.id, d, e.target.value)}
                                      onBlur={() => flushRow(it.id)}
                                      disabled={!canEdit}
                                      title={isOnLeave ? `${leaveBadgeLabel(leaveType)} (근무 ${workFraction})` : (isDaily ? '시간 입력' : isVendorCase ? '납품 건수' : '')}
                                    />
                                    {isOnLeave && (
                                      <span className={`leave-badge-tag leave-badge-${leaveType}`}>
                                        {leaveBadgeLabel(leaveType)}
                                      </span>
                                    )}
                                  </div>
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

      {/* CS 셀 입력 모달 — 공수 + 현장명 */}
      {csCellModal && (() => {
        const buf = editBuf[csCellModal.itemId];
        const personName = buf?.detail || '담당자';
        const dayIso = `${y}-${String(m).padStart(2, '0')}-${String(csCellModal.day).padStart(2, '0')}`;
        // 이번 달 이미 방문한 현장 목록 — 자동완성 후보
        const visitedSites = Array.from(new Set(
          items.flatMap((it) => Object.values(it.dailySites || {}))
        )).filter((s) => s && s.trim()).sort();
        return (
          <Modal isOpen={!!csCellModal} onClose={() => setCsCellModal(null)} title={`${m}/${csCellModal.day} 공수 입력 — ${personName}`}>
            <div className="cs-cell-modal-body">
              <div className="form-group">
                <label>현장명</label>
                <input
                  type="text"
                  value={csCellModal.siteName}
                  onChange={(e) => setCsCellModal({ ...csCellModal, siteName: e.target.value })}
                  placeholder="예: 삼성 SDS 본사"
                  list="cs-cell-visited-sites"
                  autoFocus
                />
                <datalist id="cs-cell-visited-sites">
                  {visitedSites.map((s) => <option key={s} value={s} />)}
                </datalist>
                <p className="field-hint" style={{ marginTop: 4 }}>
                  이번 달 방문 이력이 있는 현장명은 자동으로 추천됩니다.
                </p>
              </div>
              <div className="form-group">
                <label>공수 ({dayIso})</label>
                <div className="cs-cell-modal-qty-row">
                  {[0.25, 0.5, 0.75, 1].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`btn btn-sm ${Number(csCellModal.qty) === preset ? 'btn-primary' : 'btn-outline'}`}
                      onClick={() => setCsCellModal({ ...csCellModal, qty: preset })}
                    >
                      {preset}
                    </button>
                  ))}
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="1"
                    value={csCellModal.qty}
                    onChange={(e) => setCsCellModal({ ...csCellModal, qty: e.target.value })}
                    placeholder="직접 입력"
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={saveCsCellModal}>저장</button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setCsCellModal({ ...csCellModal, qty: '', siteName: '' })}
                  title="이 날 입력 비우기"
                >
                  비우기
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setCsCellModal(null)}>취소</button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* 1일 공수 1 초과 경고 모달 */}
      {overflowAlert && (() => {
        const ratio = Math.min(100, Math.round(overflowAlert.otherTotal * 100));
        return (
        <Modal isOpen={!!overflowAlert} onClose={() => setOverflowAlert(null)} title="1일 공수가 한도(1)를 넘습니다">
          <div className="overflow-alert-body">
            <div className="overflow-alert-headline">
              <span className="overflow-alert-who">{overflowAlert.name}</span>
              <span className="overflow-alert-when">{m}/{overflowAlert.day}</span>
            </div>

            <div className="overflow-alert-meter">
              <div className="overflow-alert-meter-bar"><span style={{ width: `${ratio}%` }} /></div>
              <div className="overflow-alert-meter-label">
                다른 프로젝트 합계 <strong>{overflowAlert.otherTotal}</strong> · 남은 가능량 <strong className="text-danger">{overflowAlert.allowed}</strong>
              </div>
            </div>

            {overflowAlert.sources.length > 0 && (
              <ul className="overflow-alert-list">
                {overflowAlert.sources.map((s, i) => (
                  <li key={i}>
                    <span>{s.siteName}</span>
                    <strong>{s.qty}</strong>
                  </li>
                ))}
              </ul>
            )}

            <div className="overflow-alert-note">
              💡 잔업은 신청한 프로젝트에 자동으로 집계되니, 1일 공수는 다른 프로젝트와 나눠서 입력하면 됩니다.
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => setOverflowAlert(null)}>확인</button>
            </div>
          </div>
        </Modal>
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
                      const already = items.some((it) => it.itemType === 'vendor' && (it.vendor || '') === (pickedVendor?.name || '') && (it.detail || '') === f.name);
                      return (
                        <li key={f.id} style={already ? { opacity: 0.4 } : undefined}>
                          <button type="button" onClick={() => handlePickMember(f)} disabled={already} style={already ? { cursor: 'default' } : undefined}>
                            <strong>{f.name}</strong>
                            <span>{already ? '이미 등록됨' : (canViewSalary ? (rate > 0 ? `공수 ${rate.toLocaleString()}원` : '단가 미입력') : '')}</span>
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
                    {pickedVendor.projects.map((p) => {
                      const already = items.some((it) => it.itemType === 'vendor_case' && (it.vendor || '') === (pickedVendor?.name || '') && (it.detail || '') === p.name);
                      return (
                        <li key={p.name} style={already ? { opacity: 0.4 } : undefined}>
                          <button type="button" onClick={() => handlePickProject(p)} disabled={already} style={already ? { cursor: 'default' } : undefined}>
                            <strong>{p.name}</strong>
                            <span>{already ? '이미 등록됨' : (canViewSalary ? (p.unitPrice > 0 ? `건당 ${Number(p.unitPrice).toLocaleString()}원` : '단가 미입력') : '')}</span>
                          </button>
                        </li>
                      );
                    })}
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

      {/* 프리랜서/일용직 선택 모달 */}
      {freelancerPickerMode && (() => {
        const isDaily = freelancerPickerMode === 'daily';
        const title = isDaily ? '일용직 선택' : '프리랜서 선택';
        // 업체 소속이 아닌 개인 인력 + workerType 매칭 (undefined는 freelancer로 간주)
        const pool = freelancers.filter((f) => {
          if ((f.vendor || '').trim()) return false;
          const wt = f.workerType || 'freelancer';
          return isDaily ? wt === 'daily' : wt === 'freelancer';
        });
        const currentDetails = new Set(
          items
            .filter((it) => it.itemType === freelancerPickerMode)
            .map((it) => (it.detail || '').trim())
        );
        const available = pool.filter((f) => !currentDetails.has((f.name || '').trim()));
        const already = pool.filter((f) => currentDetails.has((f.name || '').trim()));
        const targetDate = `${y}-${String(m).padStart(2, '0')}-01`;
        return (
          <Modal isOpen={!!freelancerPickerMode} onClose={() => setFreelancerPickerMode(null)} title={title}>
            {pool.length === 0 ? (
              <>
                <p className="empty-state">외주관리에 등록된 {isDaily ? '일용직' : '프리랜서'}이 없습니다.</p>
                <div className="modal-actions">
                  <button type="button" className="btn btn-primary" onClick={() => openDirectInput(freelancerPickerMode)}>직접 입력으로 추가</button>
                </div>
              </>
            ) : (
              <>
                <ul className="vendor-picker-list">
                  {available.map((f) => {
                    const rate = getRateForDate(f, targetDate);
                    return (
                      <li key={f.id}>
                        <button type="button" onClick={() => handlePickFreelancer(f, freelancerPickerMode)}>
                          <strong>{f.name}</strong>
                          <span>{canViewSalary ? (rate > 0 ? `${isDaily ? '시급' : '공수'} ${rate.toLocaleString()}원` : '단가 미입력') : ''}</span>
                        </button>
                      </li>
                    );
                  })}
                  {already.length > 0 && available.length === 0 && (
                    <li style={{ listStyle: 'none', padding: '12px', color: '#64748b', fontSize: 13, textAlign: 'center' }}>
                      모든 {isDaily ? '일용직' : '프리랜서'}이 이미 등록되었습니다.
                    </li>
                  )}
                  {already.map((f) => (
                    <li key={f.id} style={{ opacity: 0.4 }}>
                      <button type="button" disabled style={{ cursor: 'default' }}>
                        <strong>{f.name}</strong>
                        <span>이미 등록됨</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="modal-actions">
                  <button type="button" className="btn btn-outline" onClick={() => openDirectInput(freelancerPickerMode)}>직접 입력으로 추가</button>
                </div>
              </>
            )}
          </Modal>
        );
      })()}

      {/* 프리랜서/일용직 직접 입력 모달 */}
      {directInputModal && (() => {
        const isDaily = directInputModal.type === 'daily';
        const title = `${isDaily ? '일용직' : '프리랜서'} 직접 입력`;
        return (
          <Modal isOpen={!!directInputModal} onClose={() => setDirectInputModal(null)} title={title}>
            <div className="direct-input-form">
              <label className="direct-input-row">
                <span className="direct-input-label">이름 <em>*</em></span>
                <input
                  type="text"
                  className="direct-input-text"
                  value={directInputModal.name}
                  onChange={(e) => setDirectInputModal({ ...directInputModal, name: e.target.value })}
                  placeholder={`${isDaily ? '일용직' : '프리랜서'} 이름`}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') submitDirectInput(); }}
                />
              </label>
              <label className="direct-input-row">
                <span className="direct-input-label">소속 업체</span>
                <input
                  type="text"
                  className="direct-input-text"
                  value={directInputModal.vendor}
                  onChange={(e) => setDirectInputModal({ ...directInputModal, vendor: e.target.value })}
                  placeholder="없으면 비워두세요"
                  onKeyDown={(e) => { if (e.key === 'Enter') submitDirectInput(); }}
                />
              </label>
              {canViewSalary && (
                <label className="direct-input-row">
                  <span className="direct-input-label">{isDaily ? '시급/일급' : '공수 단가'}</span>
                  <MoneyInput
                    className="direct-input-text"
                    value={directInputModal.dailyRate}
                    onChange={(e) => setDirectInputModal({ ...directInputModal, dailyRate: Number(e.target.value) || 0 })}
                  />
                </label>
              )}
              <p className="direct-input-hint">외주관리에 미등록된 이름이면 자동 등록됩니다.</p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setDirectInputModal(null)}>취소</button>
              <button type="button" className="btn btn-primary" onClick={submitDirectInput}>추가</button>
            </div>
          </Modal>
        );
      })()}

      {/* 직원 선택 모달 */}
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
          <Modal isOpen={showEmployeeSelect} onClose={() => setShowEmployeeSelect(false)} title="직원 선택">
            {allWithCost.length === 0 ? (
              <p className="empty-state">고정비용이 등록된 직원이 없습니다. 직원 관리에서 설정하세요.</p>
            ) : (
              <div className="employee-picker">
                {unassigned.length > 0 && (
                  <>
                    <div className="employee-picker-group-head employee-picker-group-head--unassigned">
                      <span>미배정 인원 ({unassigned.length}명)</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={handleAddAllUnassigned}
                        disabled={addingAll}
                      >
                        {addingAll ? '추가 중...' : '일괄 추가'}
                      </button>
                    </div>
                    <ul className="vendor-picker-list">
                      {unassigned.map((u) => (
                        <li key={u.uid}>
                          <button type="button" onClick={() => handleAddEmployee(u)}>
                            <strong>{u.name}</strong>
                            <span>{u.position || ''}{canViewSalary ? ` · 월 ${Number(u.fixedCost).toLocaleString()}원` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {assignedElsewhere.length > 0 && (
                  <>
                    <div className="employee-picker-group-head employee-picker-group-head--assigned">
                      <span>다른 프로젝트 배정 ({assignedElsewhere.length}명)</span>
                    </div>
                    <ul className="vendor-picker-list">
                      {assignedElsewhere.map((u) => (
                        <li key={u.uid} style={{ opacity: 0.6 }}>
                          <button type="button" onClick={() => handleAddEmployee(u)}>
                            <strong>{u.name}</strong>
                            <span>{u.position || ''}{canViewSalary ? ` · 월 ${Number(u.fixedCost).toLocaleString()}원` : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {alreadyHere.length > 0 && (
                  <>
                    <div className="employee-picker-group-head employee-picker-group-head--done">
                      <span>이미 등록됨 ({alreadyHere.length}명)</span>
                    </div>
                    <ul className="vendor-picker-list">
                      {alreadyHere.map((u) => (
                        <li key={u.uid} style={{ opacity: 0.4 }}>
                          <button type="button" disabled style={{ cursor: 'default' }}>
                            <strong>{u.name}</strong>
                            <span>{u.position || ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {unassigned.length === 0 && assignedElsewhere.length === 0 && alreadyHere.length > 0 && (
                  <p className="empty-state">모든 직원이 이미 등록되었습니다.</p>
                )}
              </div>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}
