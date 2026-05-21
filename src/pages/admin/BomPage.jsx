import { useState, useEffect, useMemo } from 'react';
import { getBomBySite, addBomItem, updateBomItem, deleteBomItem } from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

const LS_KEY = 'bom-last-site';

export default function BomPage() {
  const { confirm, alert } = useDialog();
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);

  // 품목 선택 모달
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Set());

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

  useEffect(() => {
    if (!siteId) { setBomItems([]); return; }
    try { localStorage.setItem(LS_KEY, siteId); } catch { /* 무시 */ }
    getBomBySite(siteId).then(setBomItems).catch((err) => console.error(err));
  }, [siteId]);

  const masterMap = useMemo(() => {
    const m = {};
    itemMaster.forEach((it) => { m[it.id] = it; });
    return m;
  }, [itemMaster]);

  // 마스터 정보를 BOM 항목과 합쳐서 표시용 객체 생성 (마스터에 있으면 마스터값 우선)
  const displayItems = useMemo(() => bomItems.map((b) => {
    const m = b.itemId ? masterMap[b.itemId] : null;
    return {
      ...b,
      code: m?.code || b.code || '',
      name: m?.name || b.name || '',
      spec: m?.spec || b.spec || '',
      unit: m?.unit || b.unit || '',
    };
  }), [bomItems, masterMap]);

  const total = useMemo(
    () => displayItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
    [displayItems],
  );

  function updateField(id, patch) {
    setBomItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  async function flushItem(id) {
    const item = bomItems.find((b) => b.id === id);
    if (!item) return;
    try {
      const { id: _, createdAt: __, updatedAt: ___, ...data } = item;
      await updateBomItem(id, data);
    } catch (err) {
      alert('저장 오류: ' + err.message);
    }
  }

  async function removeRow(id) {
    const item = displayItems.find((b) => b.id === id);
    if (!await confirm(`"${item?.name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteBomItem(id);
      setBomItems((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  // ---- 품목 선택 모달 ----
  function openPicker() {
    setPicked(new Set());
    setPickerSearch('');
    setPickerOpen(true);
  }

  function togglePick(itemId) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  const filteredMaster = useMemo(() => {
    const kw = pickerSearch.trim().toLowerCase();
    const inBomIds = new Set(bomItems.map((b) => b.itemId).filter(Boolean));
    let list = itemMaster.filter((m) => !inBomIds.has(m.id));
    if (kw) {
      list = list.filter((m) =>
        [m.code, m.name, m.spec, m.category].some((v) => (v || '').toLowerCase().includes(kw)),
      );
    }
    return list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  }, [itemMaster, bomItems, pickerSearch]);

  async function addPickedToBom() {
    if (picked.size === 0) { setPickerOpen(false); return; }
    let nextOrder = bomItems.length === 0
      ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    for (const itemId of picked) {
      const m = masterMap[itemId];
      if (!m) continue;
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        qty: 0,
        unitPrice: Number(m.standardPrice) || 0,
        note: '',
        order: nextOrder++,
      };
      try {
        const ref = await addBomItem(siteId, data);
        added.push({ ...data, id: ref.id, siteId });
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPicked(new Set());
    setPickerOpen(false);
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
        {siteId && (
          <button type="button" className="btn btn-primary" onClick={openPicker} style={{ marginLeft: 'auto' }}>
            + 품목 불러오기
          </button>
        )}
      </div>

      {!siteId ? (
        <p className="text-muted text-sm" style={{ padding: '20px 0' }}>
          상단에서 프로젝트를 선택하면 해당 프로젝트의 BOM이 표시됩니다.
        </p>
      ) : (
        <table className="table bom-table inline-edit-table cards-sm">
          <thead>
            <tr>
              <th style={{ width: 100 }}>코드</th>
              <th style={{ minWidth: 160 }}>품명</th>
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
            {displayItems.length === 0 && (
              <tr><td colSpan={9} className="text-muted text-sm" style={{ textAlign: 'center', padding: 20 }}>
                품목이 없습니다 — 우측의 "+ 품목 불러오기"로 추가하세요.
              </td></tr>
            )}
            {displayItems.map((it) => {
              const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
              return (
                <tr key={it.id}>
                  <td data-label="코드"><code className="bom-code">{it.code || '-'}</code></td>
                  <td data-label="품명"><strong>{it.name}</strong></td>
                  <td data-label="규격">{it.spec || '-'}</td>
                  <td data-label="단위">{it.unit || '-'}</td>
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
                  <td data-label="합계" className="bom-cell-amount">{amount.toLocaleString()}</td>
                  <td data-label="메모">
                    <input
                      type="text"
                      value={it.note || ''}
                      onChange={(e) => updateField(it.id, { note: e.target.value })}
                      onBlur={() => flushItem(it.id)}
                    />
                  </td>
                  <td>
                    <button type="button" className="closing-delete" onClick={() => removeRow(it.id)} aria-label="삭제">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* 품목 선택 모달 */}
      <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="품목 선택">
        <p className="field-hint">구매 품목 관리에 등록된 품목 중에서 선택해 BOM에 추가합니다. 이미 BOM에 있는 품목은 목록에서 제외됩니다.</p>
        <div className="form-group">
          <input
            type="text"
            placeholder="코드 · 품명 · 규격 · 분류 검색"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="bom-picker-list">
          {filteredMaster.length === 0 ? (
            <p className="text-muted text-sm" style={{ padding: 12, textAlign: 'center' }}>
              {itemMaster.length === 0
                ? '등록된 품목이 없습니다. "구매 품목 관리"에서 먼저 품목을 등록하세요.'
                : (pickerSearch ? '검색 결과가 없습니다.' : '추가 가능한 품목이 없습니다 (모두 BOM에 포함됨).')}
            </p>
          ) : (
            filteredMaster.map((m) => (
              <label key={m.id} className={`bom-picker-row ${picked.has(m.id) ? 'is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={picked.has(m.id)}
                  onChange={() => togglePick(m.id)}
                />
                <span className="bom-picker-code">{m.code || '-'}</span>
                <span className="bom-picker-name">
                  <strong>{m.name}</strong>
                  {m.spec && <span className="bom-picker-spec"> ({m.spec})</span>}
                </span>
                {m.standardPrice > 0 && (
                  <span className="bom-picker-price">{Number(m.standardPrice).toLocaleString()}원</span>
                )}
              </label>
            ))
          )}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={addPickedToBom}
            disabled={picked.size === 0}
          >
            {picked.size}개 추가
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPickerOpen(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
