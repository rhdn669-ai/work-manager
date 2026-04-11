import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  getSite, getClosingItems, addClosingItem, updateClosingItem, deleteClosingItem,
} from '../../services/siteService';
import { getUsers } from '../../services/userService';

function daysInMonth(yr, mo) {
  return new Date(yr, mo, 0).getDate();
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
      const [s, its, users] = await Promise.all([
        getSite(siteId),
        getClosingItems(siteId, y, m),
        getUsers(),
      ]);
      setSite(s);
      setItems(its);
      setUserMap(Object.fromEntries(users.map((u) => [u.uid, u])));
      const buf = {};
      its.forEach((it) => { buf[it.id] = { ...it, dailyQuantities: { ...(it.dailyQuantities || {}) } }; });
      setEditBuf(buf);
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

  if (loading) return <div className="loading">로딩 중...</div>;
  if (!site) return <div>현장을 찾을 수 없습니다.</div>;
  if (!isAdmin && !(site.managerIds || []).includes(userProfile?.uid)) {
    return (
      <div className="card">
        <div className="card-body">
          <p>이 현장에 접근 권한이 없습니다.</p>
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록으로</button>
        </div>
      </div>
    );
  }

  const totalAmount = Object.values(editBuf).reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const itemCount = items.length;

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
          {canEdit && (
            <button className="btn btn-primary" onClick={handleAddRow}>+ 항목 추가</button>
          )}
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
        <div className="closing-summary-item closing-summary-total">
          <span className="label">월 합계</span>
          <strong>{totalAmount.toLocaleString()}원</strong>
        </div>
        {canEdit && saveStatus}
      </div>

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
