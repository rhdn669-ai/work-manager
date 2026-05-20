import { useState, useEffect, useMemo } from 'react';
import { getBomBySite, addBomItem, updateBomItem, deleteBomItem } from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { useDialog } from '../../components/common/DialogProvider';

const LS_KEY = 'bom-last-site';

export default function BomPage() {
  const { confirm, alert } = useDialog();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeLine, setActiveLine] = useState(null); // 드롭다운 열린 행 id

  // 초기 로드 — 프로젝트 목록 + 품목 마스터 + 마지막 선택 프로젝트 복원
  useEffect(() => {
    (async () => {
      try {
        const [st, im] = await Promise.all([getAllSites(), getPurchaseItems()]);
        setSites(st);
        setItemMaster(im);
        const saved = (() => { try { return localStorage.getItem(LS_KEY) || ''; } catch { return ''; } })();
        if (saved && st.some((s) => s.id === saved)) setSiteId(saved);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 프로젝트 바뀔 때 BOM 재로드 + localStorage 저장
  useEffect(() => {
    if (!siteId) { setBomItems([]); return; }
    try { localStorage.setItem(LS_KEY, siteId); } catch { /* 무시 */ }
    getBomBySite(siteId).then(setBomItems).catch((err) => console.error(err));
  }, [siteId]);

  const total = useMemo(
    () => bomItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
    [bomItems],
  );

  function updateField(id, patch) {
    setBomItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function updateName(id, name) {
    const m = itemMaster.find((x) => x.name === name);
    if (m) {
      updateField(id, {
        name: m.name, itemId: m.id,
        spec: m.spec || '', unit: m.unit || '',
      });
    } else {
      updateField(id, { name, itemId: '' });
    }
  }

  function pickItem(id, m) {
    setBomItems((prev) => prev.map((b) => {
      if (b.id !== id) return b;
      return {
        ...b,
        name: m.name, itemId: m.id,
        spec: m.spec || b.spec, unit: m.unit || b.unit,
        unitPrice: Number(b.unitPrice) > 0 ? b.unitPrice : (Number(m.standardPrice) || 0),
      };
    }));
    setActiveLine(null);
    // 선택 후 즉시 저장
    setTimeout(() => flushItem(id), 0);
  }

  async function flushItem(id) {
    const item = bomItems.find((b) => b.id === id);
    if (!item) return;
    const isNew = String(id).startsWith('tmp-');
    if (isNew && !(item.name || '').trim()) return; // 빈 행 무시
    try {
      if (isNew) {
        const ref = await addBomItem(siteId, item);
        setBomItems((prev) => prev.map((b) => (b.id === id ? { ...b, id: ref.id } : b)));
      } else {
        const { id: _, createdAt: __, updatedAt: ___, ...data } = item;
        await updateBomItem(id, data);
      }
    } catch (err) {
      alert('저장 오류: ' + err.message);
    }
  }

  function addRow() {
    const nextOrder = (bomItems.length === 0)
      ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    setBomItems((prev) => [...prev, {
      id: `tmp-${Date.now()}`,
      siteId, itemId: '', name: '', spec: '', unit: '',
      qty: 0, unitPrice: 0, note: '',
      order: nextOrder,
    }]);
  }

  async function removeRow(id) {
    const item = bomItems.find((b) => b.id === id);
    if (!await confirm(`"${item?.name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
    if (String(id).startsWith('tmp-')) {
      setBomItems((prev) => prev.filter((b) => b.id !== id));
      return;
    }
    try {
      await deleteBomItem(id);
      setBomItems((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="bom-page">
      <div className="page-header">
        <h2>프로젝트별 BOM</h2>
      </div>

      <div className="bom-toolbar">
        <select className="bom-site-select" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">프로젝트 선택</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {siteId && (
          <div className="bom-summary">
            <span>항목 <strong>{bomItems.length}</strong>건</span>
            <span>예상 합계 <strong>{total.toLocaleString()}원</strong></span>
          </div>
        )}
      </div>

      {!siteId ? (
        <p className="text-muted text-sm" style={{ padding: '20px 0' }}>
          상단에서 프로젝트를 선택하면 해당 프로젝트의 BOM이 표시됩니다.
        </p>
      ) : (
        <>
          <table className="table bom-table cards-sm">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>품명</th>
                <th>규격</th>
                <th>단위</th>
                <th>수량</th>
                <th>단가</th>
                <th>합계</th>
                <th>메모</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bomItems.length === 0 && (
                <tr><td colSpan={8} className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>
                  하단의 "+ 항목 추가"로 자재를 등록하세요.
                </td></tr>
              )}
              {bomItems.map((it) => {
                const kw = (it.name || '').toLowerCase().trim();
                const matches = itemMaster
                  .filter((m) => {
                    if (!kw) return true;
                    return (m.code || '').toLowerCase().includes(kw)
                        || (m.name || '').toLowerCase().includes(kw)
                        || (m.spec || '').toLowerCase().includes(kw);
                  })
                  .slice(0, 50);
                const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                return (
                  <tr key={it.id}>
                    <td data-label="품명" className="bom-cell-name">
                      <div className="bom-name-wrap">
                        <input
                          type="text"
                          value={it.name || ''}
                          placeholder="품명 검색·입력"
                          onChange={(e) => updateName(it.id, e.target.value)}
                          onFocus={() => setActiveLine(it.id)}
                          onBlur={() => {
                            setTimeout(() => setActiveLine((c) => (c === it.id ? null : c)), 150);
                            flushItem(it.id);
                          }}
                          autoComplete="off"
                        />
                        {activeLine === it.id && (
                          <div className="bom-name-dropdown">
                            {matches.length === 0 ? (
                              <div className="purchase-line-option-empty">
                                {kw ? `"${kw}"는 새 품목` : '등록된 품목이 없습니다 — 직접 입력하세요'}
                              </div>
                            ) : (
                              matches.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={`purchase-line-option ${m.id === it.itemId ? 'is-selected' : ''}`}
                                  onMouseDown={(e) => { e.preventDefault(); pickItem(it.id, m); }}
                                >
                                  <span className="opt-name">
                                    {m.code && <span className="opt-code">[{m.code}]</span>}
                                    {m.name}{m.spec ? ` (${m.spec})` : ''}
                                  </span>
                                  {m.standardPrice > 0 && (
                                    <span className="opt-price">{Number(m.standardPrice).toLocaleString()}원</span>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td data-label="규격">
                      <input
                        type="text"
                        value={it.spec || ''}
                        onChange={(e) => updateField(it.id, { spec: e.target.value })}
                        onBlur={() => flushItem(it.id)}
                      />
                    </td>
                    <td data-label="단위">
                      <input
                        type="text"
                        value={it.unit || ''}
                        placeholder="개·m·kg"
                        onChange={(e) => updateField(it.id, { unit: e.target.value })}
                        onBlur={() => flushItem(it.id)}
                      />
                    </td>
                    <td data-label="수량">
                      <input
                        type="number" min="0"
                        value={it.qty || ''}
                        onChange={(e) => updateField(it.id, { qty: e.target.value })}
                        onBlur={() => flushItem(it.id)}
                      />
                    </td>
                    <td data-label="단가">
                      <input
                        type="number" min="0"
                        value={it.unitPrice || ''}
                        onChange={(e) => updateField(it.id, { unitPrice: e.target.value })}
                        onBlur={() => flushItem(it.id)}
                      />
                    </td>
                    <td data-label="합계" className="bom-cell-amount">
                      {amount.toLocaleString()}
                    </td>
                    <td data-label="메모">
                      <input
                        type="text"
                        value={it.note || ''}
                        onChange={(e) => updateField(it.id, { note: e.target.value })}
                        onBlur={() => flushItem(it.id)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="closing-delete"
                        onClick={() => removeRow(it.id)}
                        aria-label="삭제"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button type="button" className="btn btn-outline" onClick={addRow} style={{ marginTop: 10 }}>
            + 항목 추가
          </button>
        </>
      )}
    </div>
  );
}
