import { useState, useEffect, useMemo, Fragment } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  getBomBySite, addBomItem, updateBomItem, deleteBomItem,
  getBomProjectById,
} from '../../services/bomService';
import { getPurchaseItems } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';

function codePrefix(code) {
  const m = (code || '').match(/^IOPN-(\d{5})/);
  return m ? `IOPN-${m[1]}` : (code || '__no-code__');
}

export default function BomDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { confirm, alert } = useDialog();

  const [project, setProject] = useState(null);
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const [search, setSearch] = useState('');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Set());

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [p, im] = await Promise.all([
          getBomProjectById(projectId),
          getPurchaseItems(),
        ]);
        if (!p) {
          alert('해당 프로젝트를 찾을 수 없습니다.');
          navigate('/admin/purchase/bom');
          return;
        }
        const items = await getBomBySite(projectId);
        setProject(p);
        setItemMaster(im);
        setBomItems(items);
      } catch (err) {
        console.error(err);
        alert('불러오기 오류: ' + err.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const masterMap = useMemo(() => {
    const m = {};
    itemMaster.forEach((it) => { m[it.id] = it; });
    return m;
  }, [itemMaster]);

  const displayItems = useMemo(() => bomItems.map((b) => {
    const m = b.itemId ? masterMap[b.itemId] : null;
    return {
      ...b,
      code: m?.code || b.code || '',
      name: m?.name || b.name || '',
      spec: m?.spec || b.spec || '',
      unit: m?.unit || b.unit || '',
      maker: m?.maker || '',
      category: m?.category || '',
    };
  }), [bomItems, masterMap]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return displayItems;
    return displayItems.filter((it) =>
      [it.code, it.name, it.spec, it.maker, it.category, it.note]
        .some((v) => (v || '').toLowerCase().includes(kw)),
    );
  }, [displayItems, search]);

  const groups = useMemo(() => {
    const map = new Map();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    for (const it of filtered) {
      const key = codePrefix(it.code);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => collator.compare(a.code || '', b.code || ''));
    }
    return [...map.entries()].sort(([a], [b]) => collator.compare(a, b));
  }, [filtered]);

  const total = useMemo(
    () => displayItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0),
    [displayItems],
  );

  function repItemForGroup(groupItems) {
    return groupItems.find((it) => /^IOPN-\d{5}$/.test(it.code || '')) || groupItems[0];
  }

  function toggleGroup(key) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpandedGroups(new Set(groups.map(([k]) => k)));
  }
  function collapseAll() {
    setExpandedGroups(new Set());
  }

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
    if (!await confirm(`"${item?.name || '이 항목'}"을(를) BOM에서 삭제하시겠습니까?`)) return;
    try {
      await deleteBomItem(id);
      setBomItems((prev) => prev.filter((b) => b.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  async function removeGroup(prefix, groupItems) {
    if (!await confirm(`"${prefix}" 대분류의 BOM 항목 ${groupItems.length}개를 모두 삭제하시겠습니까?`)) return;
    const ids = groupItems.map((it) => it.id);
    try {
      await Promise.all(ids.map((idd) => deleteBomItem(idd)));
      setBomItems((prev) => prev.filter((b) => !ids.includes(b.id)));
    } catch (err) {
      alert('대분류 삭제 중 오류: ' + err.message);
    }
  }

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
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return list.sort((a, b) => collator.compare(a.code || '', b.code || ''));
  }, [itemMaster, bomItems, pickerSearch]);

  async function addPickedToBom() {
    if (picked.size === 0) { setPickerOpen(false); return; }
    let nextOrder = bomItems.length === 0
      ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    const newGroupKeys = new Set();
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
        const ref = await addBomItem(projectId, data);
        added.push({ ...data, id: ref.id, siteId: projectId, code: m.code });
        newGroupKeys.add(codePrefix(m.code));
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPicked(new Set());
    setPickerOpen(false);
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      for (const k of newGroupKeys) next.add(k);
      return next;
    });
  }

  if (loading || !project) return <div className="loading">로딩 중...</div>;

  return (
    <div className="bom-page">
      <div className="page-header">
        <div className="purchase-detail-header-left">
          <Link to="/admin/purchase/bom" className="purchase-back-link">← 프로젝트 목록</Link>
          <h2>{project.name}</h2>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-outline" onClick={collapseAll}>전체 접기</button>
          <button type="button" className="btn btn-outline" onClick={expandAll}>전체 펼치기</button>
          <button type="button" className="btn btn-primary" onClick={openPicker}>+ 품목 불러오기</button>
        </div>
      </div>

      <div className="bom-toolbar">
        <input
          type="text"
          className="bom-search-input"
          placeholder="코드 · 품명 · 규격 · 메이커 · 분류 · 메모 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="bom-summary">
          <span>항목 <strong>{bomItems.length}</strong>건</span>
          <span>예상 합계 <strong>{total.toLocaleString()}원</strong></span>
        </div>
      </div>

      {groups.length === 0 ? (
        <p className="purchase-empty">
          {bomItems.length === 0
            ? '품목이 없습니다 — 우측 상단 "+ 품목 불러오기"로 추가하세요.'
            : '검색 조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group-list">
          {groups.map(([prefix, groupItems]) => {
            const isExpanded = expandedGroups.has(prefix);
            const repItem = repItemForGroup(groupItems);
            const subItems = repItem ? groupItems.filter((it) => it.id !== repItem.id) : groupItems;
            const headerCode = repItem?.code || prefix;
            const headerName = repItem?.name || '(품명 없음)';
            const groupTotal = groupItems.reduce(
              (s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0),
              0,
            );
            const displayed = repItem && subItems.length > 0 ? [repItem, ...subItems] : groupItems;
            return (
              <div key={prefix} className={`item-group ${isExpanded ? 'is-expanded' : ''}`}>
                <div
                  className="item-group-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(prefix)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleGroup(prefix);
                    }
                  }}
                >
                  <span className="item-group-code-input bom-group-code">{headerCode}</span>
                  <span className="item-group-name-input bom-group-name">{headerName}</span>
                  <span className="item-group-count">{groupItems.length}개</span>
                  <span className="bom-group-total">{groupTotal.toLocaleString()}원</span>
                  <span className="item-group-arrow" aria-hidden="true">∨</span>
                  <button
                    type="button"
                    className="item-group-delete-btn"
                    onClick={(e) => { e.stopPropagation(); removeGroup(prefix, groupItems); }}
                    aria-label="대분류 삭제"
                    title="이 대분류의 BOM 항목 모두 삭제"
                  >✕</button>
                </div>
                {isExpanded && (
                  <div className="item-group-detail">
                    <table className="table inline-edit-table cards-sm">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 100 }}>코드</th>
                          <th style={{ minWidth: 160 }}>품명</th>
                          <th>메이커</th>
                          <th>규격</th>
                          <th>분류</th>
                          <th>단위</th>
                          <th className="num-col">수량</th>
                          <th className="num-col">단가</th>
                          <th className="num-col">합계</th>
                          <th>메모</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayed.map((it) => {
                          const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                          return (
                            <Fragment key={it.id}>
                              <tr>
                                <td data-label="코드"><code className="bom-code">{it.code || '-'}</code></td>
                                <td data-label="품명"><strong>{it.name}</strong></td>
                                <td data-label="메이커">{it.maker || '-'}</td>
                                <td data-label="규격">{it.spec || '-'}</td>
                                <td data-label="분류">{it.category || '-'}</td>
                                <td data-label="단위">{it.unit || '-'}</td>
                                <td data-label="수량">
                                  <input
                                    className="num-input"
                                    type="number" min="0"
                                    value={it.qty || ''}
                                    onChange={(e) => updateField(it.id, { qty: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="단가">
                                  <input
                                    className="num-input"
                                    type="number" min="0"
                                    value={it.unitPrice || ''}
                                    onChange={(e) => updateField(it.id, { unitPrice: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="합계" className="bom-cell-amount num-col">{amount.toLocaleString()}</td>
                                <td data-label="메모">
                                  <input
                                    type="text"
                                    value={it.note || ''}
                                    placeholder="-"
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
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

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
            <p className="purchase-empty">
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
