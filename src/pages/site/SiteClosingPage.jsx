import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSite, getClosingItems, addClosingItem, updateClosingItem, deleteClosingItem,
  getFinanceItems, addFinanceItem, updateFinanceItem, deleteFinanceItem,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';

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
  const { isAdmin, userProfile } = useAuth();
  const navigate = useNavigate();

  const [site, setSite] = useState(null);
  const [userMap, setUserMap] = useState({});
  const [items, setItems] = useState([]);
  const [editBuf, setEditBuf] = useState({});
  const [loading, setLoading] = useState(true);
  const [finances, setFinances] = useState([]);
  const [financeBuf, setFinanceBuf] = useState({});
  const [showEmployeeSelect, setShowEmployeeSelect] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const timersRef = useRef({});

  const canEdit = site && (isAdmin || (site.managerIds || []).includes(userProfile?.uid));
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
      const [s, its, fins, users] = await Promise.all([
        getSite(siteId),
        getClosingItems(siteId, y, m),
        getFinanceItems(siteId, y, m),
        getUsers(),
      ]);
      setSite(s);
      setItems(its);
      setFinances(fins);
      setUserMap(Object.fromEntries(users.map((u) => [u.uid, u])));
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
    const nextOrder = items.length ? Math.max(...items.map((i) => i.order || 0)) + 1 : 1;
    const nextNo = items.length ? Math.max(...items.map((i) => i.no || 0)) + 1 : 1;
    // 월급 ÷ 해당 월 영업일수 = 일당
    const monthlySalary = Number(user.fixedCost) || 0;
    const workingDays = getWorkingDaysInMonth(y, m);
    const dailyRate = workingDays > 0 ? Math.round(monthlySalary / workingDays) : 0;
    await addClosingItem(siteId, y, m, {
      no: nextNo,
      vendor: '직원',
      detail: user.name,
      category: `월급 ${monthlySalary.toLocaleString()} ÷ ${workingDays}일`,
      unitPrice: dailyRate,
      dailyQuantities: {},
      quantity: 0, amount: 0,
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

  const totalAmount = Object.values(editBuf).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const itemCount = items.length;

  const revenueItems = finances.filter((f) => f.type === 'revenue');
  const expenseItems = finances.filter((f) => f.type === 'expense');
  const totalRevenue = revenueItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);
  const totalExpense = expenseItems.reduce((s, f) => s + (Number(financeBuf[f.id]?.amount) || 0), 0);

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
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록</button>
        </div>
      </div>

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
          <strong>{totalAmount.toLocaleString()}원</strong>
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
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '식대')}>식대</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '교통비')}>교통비</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleAddFinance('expense', '자재비')}>자재비</button>
            </div>
          )}
        </div>
        {expenseItems.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '8px 0' }}>등록된 지출 항목이 없습니다.</p>
        ) : (
          <div className="finance-list">
            {expenseItems.map((f) => {
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
                <span className="select-list-sub">{u.position || ''} · 월 {Number(u.fixedCost).toLocaleString()}원</span>
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
          {items.map((it) => {
            const buf = editBuf[it.id] || it;
            return (
              <div className="closing-card" key={it.id}>
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

                <input
                  className="closing-category"
                  value={buf.category || ''}
                  placeholder="비고"
                  onChange={(e) => updateField(it.id, 'category', e.target.value)}
                  onBlur={() => flushRow(it.id)}
                  disabled={!canEdit}
                />

                <div className="day-grid">
                  {days.map((d) => {
                    const v = buf.dailyQuantities?.[d];
                    const hasValue = v !== undefined && v !== null && v !== '';
                    return (
                      <div className={`day-cell ${hasValue ? 'has-value' : ''}`} key={d}>
                        <label>{d}</label>
                        <input
                          type="number"
                          step="0.25"
                          value={v ?? ''}
                          onChange={(e) => updateDay(it.id, d, e.target.value)}
                          onBlur={() => flushRow(it.id)}
                          disabled={!canEdit}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="closing-card-foot">
                  <div className="foot-field">
                    <span className="label">수량</span>
                    <strong>{Number(buf.quantity || 0)}일</strong>
                  </div>
                  <div className="foot-field">
                    <span className="label">단가</span>
                    <input
                      className="closing-price"
                      type="number"
                      value={buf.unitPrice || 0}
                      onChange={(e) => updateField(it.id, 'unitPrice', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="foot-field closing-amount">
                    <span className="label">금액</span>
                    <strong>{Number(buf.amount || 0).toLocaleString()}원</strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
