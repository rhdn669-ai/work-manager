import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSite, getClosingItems, addClosingItem, updateClosingItem, deleteClosingItem,
  getFinanceItems, addFinanceItem, updateFinanceItem, deleteFinanceItem,
  copyPreviousMonth,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { getApprovedLeavesByMonth } from '../../services/leaveService';

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

const AUTO_SAVE_DELAY_MS = 800;

export default function SiteClosingPage() {
  const { siteId, year, month } = useParams();
  const y = Number(year);
  const m = Number(month);
  const { isAdmin, isExecutive, userProfile } = useAuth();
  const canViewSalary = isAdmin || isExecutive;
  const navigate = useNavigate();

  const [site, setSite] = useState(null);
  const [userMap, setUserMap] = useState({});
  const [items, setItems] = useState([]);
  const [editBuf, setEditBuf] = useState({});
  const [loading, setLoading] = useState(true);
  const [finances, setFinances] = useState([]);
  const [financeBuf, setFinanceBuf] = useState({});
  const [leaveDays, setLeaveDays] = useState({}); // { userId: Set of day numbers }
  const [showEmployeeSelect, setShowEmployeeSelect] = useState(false);
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
      const [s, its, fins, users, approvedLeaves] = await Promise.all([
        getSite(siteId),
        getClosingItems(siteId, y, m),
        getFinanceItems(siteId, y, m),
        getUsers(),
        getApprovedLeavesByMonth(y, m),
      ]);
      setSite(s);
      setFinances(fins);
      const uMap = Object.fromEntries(users.map((u) => [u.uid, u]));
      setUserMap(uMap);

      // 연차 날짜 매핑: userId → Set of day numbers
      const ldMap = {};
      for (const leave of approvedLeaves) {
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        const cur = new Date(start);
        while (cur <= end) {
          if (cur.getFullYear() === y && cur.getMonth() + 1 === m) {
            const uid = leave.userId;
            if (!ldMap[uid]) ldMap[uid] = new Set();
            ldMap[uid].add(cur.getDate());
          }
          cur.setDate(cur.getDate() + 1);
        }
      }
      // 이름 → userId 매핑 (공수표 detail이 이름이므로)
      const nameToUid = {};
      users.forEach((u) => { nameToUid[u.name] = u.uid; });
      const ldByName = {};
      for (const [uid, days] of Object.entries(ldMap)) {
        const user = uMap[uid];
        if (user) ldByName[user.name] = days;
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
    if (!confirm('전월 공수표 · 매출/지출 항목을 이번 달로 복사합니다.\n(수량/금액은 초기화됩니다)\n\n계속하시겠습니까?')) return;
    setCopying(true);
    try {
      const result = await copyPreviousMonth(siteId, y, m);
      alert(`복사 완료: 공수표 ${result.items}건, 매출/지출 ${result.finances}건`);
      await loadAll();
    } catch (err) {
      alert(err.message || '복사 실패');
    } finally {
      setCopying(false);
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
    const alreadyExists = items.some((it) => it.itemType === 'employee' && it.detail === user.name);
    if (alreadyExists) { alert(`${user.name}은(는) 이미 추가되어 있습니다.`); return; }
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    const monthlySalary = Number(user.fixedCost) || 0;
    const workingDays = getWorkingDaysInMonth(y, m);
    const dailyRate = workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;
    // 영업일 전체 자동 채우기 (연차일 제외)
    const userLeaveDays = leaveDays[user.name] || new Set();
    const dq = {};
    const totalDays = daysInMonth(y, m);
    for (let d = 1; d <= totalDays; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow !== 0 && dow !== 6 && !userLeaveDays.has(d)) dq[d] = 1;
    }
    const quantity = Object.values(dq).reduce((s, v) => s + v, 0);
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '직원',
      detail: user.name,
      category: `월급 ${monthlySalary.toLocaleString()} ÷ ${workingDays}일`,
      itemType: 'employee',
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

  async function handleDeleteFinance(id) {
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
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
  const isOvertimeFinance = (f) => { const d = ((financeBuf[f.id]?.description ?? f.description) || '').trim(); return d === '잔업' || d.startsWith('잔업 -') || d.startsWith('잔업-'); };
  const totalRevenue = revenueItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);
  const totalExpense = expenseItems.filter((f) => canViewSalary || !isOvertimeFinance(f)).reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);

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
          {canEdit && items.length === 0 && (
            <button className="btn btn-outline" onClick={handleCopyPrevMonth} disabled={copying}>
              {copying ? '복사 중...' : '전월 복사'}
            </button>
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
                  <input className="finance-amount" type="number" value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
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
        {expenseItems.length === 0 ? (
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
                      <input className="expense-input-amount" type="number" value={buf.amount || 0} onChange={(e) => updateFinanceField(f.id, 'amount', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit || readOnly} />
                      <span className="expense-won">원</span>
                    </>
                  )}
                  {!readOnly && (
                    <input className="expense-input-note" value={buf.note || ''} placeholder="비고" onChange={(e) => updateFinanceField(f.id, 'note', e.target.value)} onBlur={() => flushFinance(f.id)} disabled={!canEdit} />
                  )}
                  {canEdit && !readOnly && (
                    <button type="button" className="closing-delete" onClick={() => handleDeleteFinance(f.id)} aria-label="삭제">✕</button>
                  )}
                  {readOnly && <span className="expense-readonly-badge" title="잔업 내역은 팀원 잔업 등록에서 자동 반영됩니다">🔒</span>}
                </div>
              );
            })}
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
      {showEmployeeSelect && canEdit && (
        <div className="select-dropdown-list" style={{ marginBottom: 12 }}>
          {Object.values(userMap).filter((u) => u.fixedCost).length === 0 ? (
            <p className="empty-state" style={{ padding: '12px', margin: 0 }}>고정비용이 등록된 직원이 없습니다. 직원 관리에서 설정하세요.</p>
          ) : (
            Object.values(userMap).filter((u) => u.fixedCost).map((u) => (
              <label key={u.uid} className="select-list-item" onClick={() => handleAddEmployee(u)} style={{ cursor: 'pointer' }}>
                <span className="select-list-name">{u.name}</span>
                <span className="select-list-sub">{u.position || ''}{canViewSalary ? ` · 월 ${Number(u.fixedCost).toLocaleString()}원` : ''}</span>
              </label>
            ))
          )}
        </div>
      )}

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
                            const isOnLeave = cardType === 'employee' && leaveDays[buf.detail]?.has(d);
                            const isEmployee = cardType === 'employee';
                            const isPresent = Number(v) === 1;
                            return (
                              <div className={`day-cal-cell ${hasValue ? 'has-value' : ''} ${isSunday ? 'sunday' : ''} ${isSaturday ? 'saturday' : ''} ${isOnLeave ? 'on-leave' : ''}`} key={di}>
                                <label>{d}</label>
                                {isOnLeave ? (
                                  <div className="leave-badge">연차</div>
                                ) : isEmployee ? (
                                  <button
                                    type="button"
                                    className={`attendance-badge ${isPresent ? 'active' : ''}`}
                                    onClick={() => {
                                      if (!canEdit) return;
                                      updateDay(it.id, d, isPresent ? '' : 1);
                                      flushRow(it.id);
                                    }}
                                    disabled={!canEdit}
                                  >
                                    {isPresent ? '출근' : ''}
                                  </button>
                                ) : (
                                  <input
                                    type="number"
                                    step="0.25"
                                    value={v ?? ''}
                                    onChange={(e) => updateDay(it.id, d, e.target.value)}
                                    onBlur={() => flushRow(it.id)}
                                    disabled={!canEdit}
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
                        <input
                          className="closing-price"
                          type="number"
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
