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

  // 행별 디바운스 타이머 보관
  const timersRef = useRef({});

  const canEdit = site && (isAdmin || (site.managerIds || []).includes(userProfile?.uid));
  const dayCount = daysInMonth(y, m);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  useEffect(() => { loadAll(); }, [siteId, y, m]);

  // 언마운트 시 남은 타이머 정리 (+ 대기 중인 변경사항은 즉시 저장)
  useEffect(() => {
    return () => {
      Object.entries(timersRef.current).forEach(([id, t]) => clearTimeout(t));
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
    if (timersRef.current[itemId]) {
      clearTimeout(timersRef.current[itemId]);
    }
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
    // 대기 중인 저장 취소
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

  // 포커스 해제 시 디바운스 기다리지 않고 즉시 저장
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

  // 저장 상태 메시지
  let saveStatus;
  if (saveError) {
    saveStatus = <span style={{ color: '#dc2626' }}>⚠ 저장 실패: {saveError}</span>;
  } else if (savingCount > 0) {
    saveStatus = <span style={{ color: '#2563eb' }}>● 저장 중...</span>;
  } else if (lastSavedAt) {
    const t = lastSavedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    saveStatus = <span style={{ color: '#16a34a' }}>✓ {hh}:{mm}:{ss} 저장됨</span>;
  } else {
    saveStatus = <span style={{ color: '#94a3b8' }}>자동 저장 대기</span>;
  }

  return (
    <div className="site-closing-page">
      <div className="page-header">
        <h2>{site.name} — {y}년 {m}월 마감</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록</button>
          {canEdit && (
            <button className="btn btn-outline" onClick={handleAddRow}>행 추가</button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>팀: <strong>{site.team || '-'}</strong></div>
          <div>담당: <strong>{managerNames()}</strong></div>
          <div>월 합계: <strong style={{ color: '#2563eb' }}>{totalAmount.toLocaleString()}원</strong></div>
          {canEdit && <div style={{ fontSize: 13 }}>{saveStatus}</div>}
        </div>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}>
        <table className="table closing-table" style={{ minWidth: 'max-content', margin: 0 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 36 }}>NO</th>
              <th style={{ minWidth: 92 }}>업체명</th>
              <th style={{ minWidth: 80 }}>이름</th>
              {days.map((d) => (
                <th key={d} style={{ minWidth: 34 }}>{d}</th>
              ))}
              <th style={{ minWidth: 52 }}>수량</th>
              <th style={{ minWidth: 84 }}>단가</th>
              <th style={{ minWidth: 96 }}>금액</th>
              <th style={{ minWidth: 92 }}>비고</th>
              {canEdit && <th style={{ minWidth: 36 }}>삭제</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const buf = editBuf[it.id] || it;
              return (
                <tr key={it.id}>
                  <td>
                    <input
                      style={{ width: 36 }}
                      type="number"
                      value={buf.no ?? ''}
                      onChange={(e) => updateField(it.id, 'no', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 100 }}
                      value={buf.vendor || ''}
                      onChange={(e) => updateField(it.id, 'vendor', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td>
                    <input
                      style={{ width: 100 }}
                      value={buf.detail || ''}
                      onChange={(e) => updateField(it.id, 'detail', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  {days.map((d) => (
                    <td key={d} style={{ padding: 2 }}>
                      <input
                        style={{ width: 36, textAlign: 'center' }}
                        type="number"
                        step="0.25"
                        value={buf.dailyQuantities?.[d] ?? ''}
                        onChange={(e) => updateDay(it.id, d, e.target.value)}
                        onBlur={() => flushRow(it.id)}
                        disabled={!canEdit}
                      />
                    </td>
                  ))}
                  <td style={{ textAlign: 'right' }}><strong>{Number(buf.quantity || 0)}</strong></td>
                  <td>
                    <input
                      style={{ width: 90 }}
                      type="number"
                      value={buf.unitPrice || 0}
                      onChange={(e) => updateField(it.id, 'unitPrice', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td style={{ textAlign: 'right' }}>{Number(buf.amount || 0).toLocaleString()}</td>
                  <td>
                    <input
                      style={{ width: 100 }}
                      value={buf.category || ''}
                      onChange={(e) => updateField(it.id, 'category', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  {canEdit && (
                    <td>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRow(it.id)}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={days.length + 8 + (canEdit ? 1 : 0)}>
                  <div className="text-muted text-center" style={{ padding: 20 }}>
                    항목이 없습니다.{canEdit && ' "행 추가"로 시작하세요.'}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {items.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={days.length + 5}><strong>월 합계</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{totalAmount.toLocaleString()}원</strong></td>
                <td colSpan={canEdit ? 2 : 1}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
