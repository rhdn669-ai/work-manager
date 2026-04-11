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

  // 두 줄로 쪼개기 (1~16 / 17~31)
  const half = Math.ceil(dayCount / 2); // 31→16, 30→15, 28→14
  const row1 = days.slice(0, half);
  const row2 = days.slice(half);
  const row2Padded = [...row2, ...Array(Math.max(0, half - row2.length)).fill(null)];

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

  let saveStatus;
  if (saveError) {
    saveStatus = <span className="save-status save-status-error">⚠ 저장 실패: {saveError}</span>;
  } else if (savingCount > 0) {
    saveStatus = <span className="save-status save-status-saving">● 저장 중...</span>;
  } else if (lastSavedAt) {
    const t = lastSavedAt;
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    saveStatus = <span className="save-status save-status-saved">✓ {hh}:{mm}:{ss} 저장됨</span>;
  } else {
    saveStatus = <span className="save-status save-status-idle">자동 저장 대기</span>;
  }

  return (
    <div className="site-closing-page">
      <div className="page-header">
        <h2>{site.name} — {y}년 {m}월 마감</h2>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={() => navigate('/sites')}>목록</button>
          {canEdit && (
            <button className="btn btn-outline" onClick={handleAddRow}>행 추가</button>
          )}
        </div>
      </div>

      <div className="meta-bar">
        <div>팀 <strong>{site.team || '-'}</strong></div>
        <div>담당 <strong>{managerNames()}</strong></div>
        <div>월 합계 <strong className="meta-primary">{totalAmount.toLocaleString()}원</strong></div>
        {canEdit && saveStatus}
      </div>

      <div className="table-wrap">
        <table className="table closing-table" style={{ minWidth: 'max-content' }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ minWidth: 22 }}>NO</th>
              <th rowSpan={2} style={{ minWidth: 52 }}>업체명</th>
              <th rowSpan={2} style={{ minWidth: 46 }}>이름</th>
              {row1.map((d) => (
                <th key={`r1h${d}`} style={{ minWidth: 22 }}>{d}</th>
              ))}
              <th rowSpan={2} style={{ minWidth: 32 }}>수량</th>
              <th rowSpan={2} style={{ minWidth: 54 }}>단가</th>
              <th rowSpan={2} style={{ minWidth: 62 }}>금액</th>
              <th rowSpan={2} style={{ minWidth: 52 }}>비고</th>
              {canEdit && <th rowSpan={2} style={{ minWidth: 24 }}>삭제</th>}
            </tr>
            <tr>
              {row2Padded.map((d, i) => (
                <th key={`r2h${i}`}>{d ?? ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const buf = editBuf[it.id] || it;
              return [
                <tr key={it.id + '_a'}>
                  <td rowSpan={2}>
                    <input
                      type="number"
                      value={buf.no ?? ''}
                      onChange={(e) => updateField(it.id, 'no', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td rowSpan={2}>
                    <input
                      value={buf.vendor || ''}
                      onChange={(e) => updateField(it.id, 'vendor', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td rowSpan={2}>
                    <input
                      value={buf.detail || ''}
                      onChange={(e) => updateField(it.id, 'detail', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  {row1.map((d) => (
                    <td key={`r1${it.id}${d}`}>
                      <input
                        type="number"
                        step="0.25"
                        value={buf.dailyQuantities?.[d] ?? ''}
                        onChange={(e) => updateDay(it.id, d, e.target.value)}
                        onBlur={() => flushRow(it.id)}
                        disabled={!canEdit}
                      />
                    </td>
                  ))}
                  <td rowSpan={2} style={{ textAlign: 'right', paddingRight: 6 }}>
                    <strong>{Number(buf.quantity || 0)}</strong>
                  </td>
                  <td rowSpan={2}>
                    <input
                      type="number"
                      value={buf.unitPrice || 0}
                      onChange={(e) => updateField(it.id, 'unitPrice', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  <td rowSpan={2} style={{ textAlign: 'right', paddingRight: 6 }}>
                    {Number(buf.amount || 0).toLocaleString()}
                  </td>
                  <td rowSpan={2}>
                    <input
                      value={buf.category || ''}
                      onChange={(e) => updateField(it.id, 'category', e.target.value)}
                      onBlur={() => flushRow(it.id)}
                      disabled={!canEdit}
                    />
                  </td>
                  {canEdit && (
                    <td rowSpan={2}>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDeleteRow(it.id)}>✕</button>
                    </td>
                  )}
                </tr>,
                <tr key={it.id + '_b'}>
                  {row2Padded.map((d, i) => (
                    <td key={`r2${it.id}${i}`}>
                      {d !== null ? (
                        <input
                          type="number"
                          step="0.25"
                          value={buf.dailyQuantities?.[d] ?? ''}
                          onChange={(e) => updateDay(it.id, d, e.target.value)}
                          onBlur={() => flushRow(it.id)}
                          disabled={!canEdit}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>,
              ];
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7 + row1.length + (canEdit ? 1 : 0)}>
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
                <td colSpan={5 + row1.length}><strong>월 합계</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{totalAmount.toLocaleString()}원</strong></td>
                <td colSpan={1 + (canEdit ? 1 : 0)}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
