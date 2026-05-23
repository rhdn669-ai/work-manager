import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  getPurchaseItems, addPurchaseItem, updatePurchaseItem, deletePurchaseItem, deletePurchaseItems,
  getSuppliers, nextMainCode, nextSubCode, reorderGroupCodes, inferGroupKeys,
} from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { useDialog } from '../../components/common/DialogProvider';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// 드래그 가능한 행 — useSortable 훅을 적용한 <tr>
function SortableItemRow({ id, isHighlight, onActivate, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    background: isDragging ? 'var(--bg-card)' : undefined,
    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.15)' : undefined,
    zIndex: isDragging ? 2 : undefined,
    position: isDragging ? 'relative' : undefined,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={isHighlight ? 'is-newly-added' : undefined}
      onPointerDown={isHighlight ? onActivate : undefined}
      onFocusCapture={isHighlight ? onActivate : undefined}
    >
      <td className="drag-handle-cell" data-label="">
        <button
          type="button"
          className="drag-handle-btn"
          aria-label="드래그하여 순서 변경"
          title="드래그하여 순서 변경"
          {...attributes}
          {...listeners}
        >≡</button>
      </td>
      {children}
    </tr>
  );
}

// 복합 단위 파싱 — 단위 문자열 안에 [숫자 + 단위문자] 패턴이 있으면 곱셈으로 인식
// 슬래시(/)·공백·괄호·* ·x ·× ·- 는 분리자(통과 문자)로 취급, baseUnit에는 포함되지 않음
// 인식 예: "2/개", "roll/610m", "Roll 610m", "BOX(24개)", "10EA", "Box*24개", "BOX/24개"
function parseCompoundUnit(unitStr) {
  if (!unitStr) return null;
  const s = String(unitStr).trim();
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)[\s/()*x×\-]*([^\d\s/()*x×,\-]+)/);
  if (!m) return null;
  const qty = parseFloat(m[1].replace(/,/g, ''));
  if (!qty || qty <= 1) return null;   // 1 이하는 곱셈 의미 없음 → 단순 단위 취급
  return {
    container: s.slice(0, m.index).trim(),
    qty,
    baseUnit: m[2].trim(),
  };
}

function parseBulkText(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((line) => line.split('\t'))
    .map((cols) => ({
      code: (cols[0] || '').trim(),
      name: (cols[1] || '').trim(),
      maker: (cols[2] || '').trim(),
      spec: (cols[3] || '').trim(),
      unit: (cols[4] || '').trim(),
      category: (cols[5] || '').trim(),
      standardPrice: (cols[6] || '').replace(/[^0-9.]/g, ''),
    }))
    .filter((r) => r.name && r.name !== '품명' && r.code !== '코드');
}

export default function PurchaseItemPage() {
  const { confirm, alert } = useDialog();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  // 헤더 코드 입력 — 편집 중에는 로컬 state로 임시 보관 (items state 즉시 변경 X → 그룹 키 안 흔들림)
  const [editingHeaderCode, setEditingHeaderCode] = useState(null); // { repId, value } | null

  // 복사/동일품명으로 추가된 행 강조 (사용자가 클릭하면 해제) — 스크롤은 따라가지 않음
  const [highlightIds, setHighlightIds] = useState(() => new Set());
  function markHighlight(id) {
    setHighlightIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }
  function clearHighlight(id) {
    setHighlightIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // 엑셀 일괄 추가 모달
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [it, sp] = await Promise.all([getPurchaseItems(), getSuppliers()]);
      setItems(inferGroupKeys(it));
      setSuppliers(sp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const supplierMap = useMemo(() => {
    const m = {};
    suppliers.forEach((s) => { m[s.id] = s.name; });
    return m;
  }, [suppliers]);

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((it) => { if (it.category) set.add(it.category); });
    return [...set].sort();
  }, [items]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const result = items.filter((it) => {
      if (kw && ![it.code, it.name, it.spec, it.maker, it.category].some((v) => (v || '').toLowerCase().includes(kw))) return false;
      if (filterCategory && it.category !== filterCategory) return false;
      if (filterSupplier && it.defaultSupplierId !== filterSupplier) return false;
      return true;
    });
    // 코드 자연 순서 정렬 — IOPN-00001-9 다음에 -10이 오도록 숫자 비교
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    result.sort((a, b) => collator.compare(a.code || '', b.code || ''));
    return result;
  }, [items, search, filterCategory, filterSupplier]);

  // 그룹화 — groupKey 기준 (베어 메인은 own id가 anchor, 소분류는 groupKey가 anchor의 id)
  // 코드 변경에 영향 받지 않음 → 충돌 없음
  const groups = useMemo(() => {
    const map = new Map();
    for (const it of filtered) {
      const key = it.groupKey || it.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return [...map.entries()];
  }, [filtered]);

  function repItemForGroup(groupItems) {
    // 베어 메인 = groupKey가 없는(또는 자신을 가리키는) 항목
    return groupItems.find((it) => !it.groupKey || it.groupKey === it.id) || groupItems[0];
  }
  function repNameForGroup(groupItems) {
    return repItemForGroup(groupItems)?.name || '';
  }

  function toggleGroup(mainCode) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(mainCode)) next.delete(mainCode); else next.add(mainCode);
      return next;
    });
  }

  function expandGroup(mainCode) {
    setExpandedGroups((prev) => {
      if (prev.has(mainCode)) return prev;
      const next = new Set(prev);
      next.add(mainCode);
      return next;
    });
  }

  // ---- 드래그앤드롭 ----
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event, mainCode, groupItems) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = groupItems.findIndex((it) => it.id === active.id);
    const newIndex = groupItems.findIndex((it) => it.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const m = (mainCode || '').match(/^IOPN-(\d{5})/);
    if (!m) return;
    const prefix = `IOPN-${m[1]}`;

    const newOrder = arrayMove(groupItems, oldIndex, newIndex);
    const orderedIds = newOrder.map((it) => it.id);
    const newCodeById = new Map();
    orderedIds.forEach((id, idx) => {
      newCodeById.set(id, idx === 0 ? prefix : `${prefix}-${idx}`);
    });

    // 낙관적 로컬 업데이트
    setItems((prev) => prev.map((it) => {
      const nc = newCodeById.get(it.id);
      return nc && nc !== it.code ? { ...it, code: nc } : it;
    }));

    try {
      await reorderGroupCodes(orderedIds, groupItems, mainCode);
    } catch (err) {
      alert('순서 변경 저장 중 오류: ' + err.message);
      await loadData(); // 롤백
    }
  }

  const parsedBulk = useMemo(() => parseBulkText(bulkText), [bulkText]);

  // ---- 인라인 편집 ----
  function updateField(id, patch) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  async function flushItem(id) {
    const it = items.find((x) => x.id === id);
    if (!it) return;
    const isNew = String(id).startsWith('tmp-');
    if (isNew && !(it.name || '').trim()) return; // 빈 행 무시

    const payload = { ...it };

    try {
      if (isNew) {
        const ref = await addPurchaseItem({ ...payload, priceHistory: [] });
        setItems((prev) => prev.map((x) => {
          if (x.id === id) return { ...x, id: ref.id, code: payload.code };
          if (x.groupKey === id) return { ...x, groupKey: ref.id }; // 베어 메인 tmp id를 가리키던 서브들도 새 id로 갱신
          return x;
        }));
        if (expandedId === id) setExpandedId(ref.id);
        // expandedGroups가 이 tmp id를 anchor로 갖고 있었다면 새 id로 교체
        setExpandedGroups((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          next.add(ref.id);
          return next;
        });
        // highlightIds가 이 tmp id를 갖고 있었다면 새 id로 이관 (사용자가 클릭할 때까지 깜빡임 유지)
        setHighlightIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          next.add(ref.id);
          return next;
        });
      } else {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = payload;
        await updatePurchaseItem(id, data);
      }
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  function addRow() {
    const tmpId = `tmp-${Date.now()}`;
    const newCode = nextMainCode(items);
    setItems((prev) => [{
      id: tmpId,
      code: newCode,
      name: '', spec: '', maker: '', unit: '', category: '',
      standardPrice: 0, unitPrice: 0, defaultSupplierId: '', note: '',
      priceHistory: [],
      // 베어 메인: groupKey 없음 (own id가 anchor)
    }, ...prev]);
    setExpandedId(null);
    setSearch(''); setFilterCategory(''); setFilterSupplier('');
    expandGroup(tmpId); // groupKey = own id (베어의 tmp id, flushItem에서 real id로 교체됨)
  }

  function duplicateItem(item) {
    const code = nextSubCode(items, item.code);
    if (!code) { alert('코드 자동 부여 실패 — 부모 코드를 확인하세요.'); return; }
    const tmpId = `tmp-${Date.now()}`;
    const groupKey = item.groupKey || item.id;
    const newItem = {
      id: tmpId,
      code,
      name: item.name || '',
      spec: item.spec || '',
      maker: item.maker || '',
      unit: item.unit || '',
      category: item.category || '',
      standardPrice: Number(item.standardPrice) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      defaultSupplierId: item.defaultSupplierId || '',
      note: item.note || '',
      priceHistory: [],
      groupKey,
    };
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === item.id);
      if (idx < 0) return [...prev, newItem];
      return [...prev.slice(0, idx + 1), newItem, ...prev.slice(idx + 1)];
    });
    expandGroup(groupKey);
    markHighlight(tmpId);
  }

  function addSameItem(parent) {
    const code = nextSubCode(items, parent.code);
    if (!code) { alert('부모 코드가 잘못되어 동일품명을 추가할 수 없습니다.'); return; }
    const tmpId = `tmp-${Date.now()}`;
    const groupKey = parent.groupKey || parent.id; // 부모가 베어면 own id, 서브면 부모의 groupKey
    const newItem = {
      id: tmpId,
      code,
      name: parent.name || '',
      spec: '',
      maker: parent.maker || '',
      unit: parent.unit || '',
      category: parent.category || '',
      standardPrice: 0,
      unitPrice: 0,
      defaultSupplierId: parent.defaultSupplierId || '',
      note: '',
      priceHistory: [],
      groupKey, // 서브: 부모(베어)의 id를 anchor로
    };
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === parent.id);
      if (idx < 0) return [newItem, ...prev];
      return [...prev.slice(0, idx + 1), newItem, ...prev.slice(idx + 1)];
    });
    expandGroup(groupKey);
    markHighlight(tmpId);
  }

  async function handleDeleteGroup(mainCode, groupItems) {
    if (!groupItems || groupItems.length === 0) return;
    const count = groupItems.length;
    if (!await confirm(`"${mainCode}" 대분류와 하위 항목 ${count}개를 모두 삭제하시겠습니까?\n(되돌릴 수 없습니다)`)) return;
    const ids = groupItems.map((it) => it.id);
    try {
      await deletePurchaseItems(ids);
      setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    } catch (err) {
      alert('대분류 삭제 중 오류: ' + err.message);
    }
  }

  async function handleDelete(it) {
    if (!await confirm(`"${it.name || '이 항목'}"을(를) 삭제하시겠습니까?`)) return;
    if (String(it.id).startsWith('tmp-')) {
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      return;
    }
    try {
      await deletePurchaseItem(it.id);
      setItems((prev) => prev.filter((x) => x.id !== it.id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  // ---- 엑셀 일괄 ----
  function openBulk() {
    setBulkText('');
    setBulkModal(true);
  }

  async function handleBulkSubmit() {
    if (parsedBulk.length === 0) { alert('인식된 품목이 없습니다. 붙여넣은 내용을 확인해주세요.'); return; }
    if (!await confirm(`${parsedBulk.length}개 품목을 일괄 등록하시겠습니까?`)) return;
    setBulkSaving(true);
    try {
      // 빈 코드 행은 IOPN-XXXXX-N 자동 부여 (품명 기준 대분류/소분류, 기존 items + 누적 계산)
      let buf = [...items];
      const withCodes = parsedBulk.map((r) => {
        if (r.code) return r;
        const code = nextItemCode(buf, r.name);
        buf = [...buf, { code, name: r.name }];
        return { ...r, code };
      });
      await Promise.all(withCodes.map((r) => addPurchaseItem({ ...r, priceHistory: [] })));
      setBulkModal(false);
      setBulkText('');
      await loadData();
      alert(`${parsedBulk.length}개 품목이 등록되었습니다.`);
    } catch (err) {
      alert('일괄 등록 중 오류: ' + err.message);
    } finally {
      setBulkSaving(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-item-page">
      <div className="page-header">
        <h2>구매 품목 관리</h2>
        <div className="page-actions">
          <button className="btn btn-outline" onClick={openBulk}>엑셀 일괄 추가</button>
          <button className="btn btn-primary" onClick={addRow}>+ 품목 추가</button>
        </div>
      </div>

      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="코드 · 품명 · 규격 · 메이커 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">분류 전체</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
          <option value="">구매처 전체</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {groups.length === 0 ? (
        <p className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
          {items.length === 0 ? '등록된 품목이 없습니다 — 우측 상단 "+ 품목 추가" 또는 "엑셀 일괄 추가"' : '조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group-list">
          {groups.map(([groupKey, groupItems]) => {
            const isExpanded = expandedGroups.has(groupKey);
            const repItem = repItemForGroup(groupItems);
            const repName = repItem?.name || '';
            const repCode = repItem?.code || '';
            const subItems = repItem
              ? groupItems.filter((it) => it.id !== repItem.id)
              : groupItems;
            return (
              <div key={groupKey} className={`item-group ${isExpanded ? 'is-expanded' : ''}`}>
                <div
                  className="item-group-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onClick={() => toggleGroup(groupKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleGroup(groupKey);
                    }
                  }}
                >
                  <input
                    type="text"
                    className="item-group-code-input"
                    value={editingHeaderCode?.repId === repItem?.id ? editingHeaderCode.value : repCode}
                    placeholder="코드"
                    onFocus={() => repItem && setEditingHeaderCode({ repId: repItem.id, value: repItem.code || '' })}
                    onChange={(e) => setEditingHeaderCode((prev) => (prev ? { ...prev, value: e.target.value } : prev))}
                    onBlur={(e) => {
                      const newCode = e.target.value;
                      setEditingHeaderCode(null);
                      if (repItem && newCode !== repItem.code) {
                        updateField(repItem.id, { code: newCode });
                        flushItem(repItem.id);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    disabled={!repItem}
                  />
                  <input
                    type="text"
                    className="item-group-name-input"
                    value={repName}
                    placeholder="(품명 없음)"
                    onChange={(e) => repItem && updateField(repItem.id, { name: e.target.value })}
                    onBlur={() => repItem && flushItem(repItem.id)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    disabled={!repItem}
                  />
                  <span className="item-group-count" aria-hidden="true">{subItems.length}개</span>
                  <span className="item-group-arrow" aria-hidden="true">∨</span>
                  <button
                    type="button"
                    className="item-group-delete-btn"
                    onClick={(e) => { e.stopPropagation(); handleDeleteGroup(repCode || '(코드 없음)', groupItems); }}
                    aria-label="대분류 삭제"
                    title="대분류와 모든 하위 항목 삭제"
                  >✕</button>
                </div>
                {isExpanded && (
                  <div className="item-group-detail">
                    <div className="item-group-detail-toolbar">
                      <button
                        type="button"
                        className="item-group-add-btn"
                        onClick={(e) => { e.stopPropagation(); addSameItem(subItems[subItems.length - 1] || repItem); }}
                        title="같은 품명으로 다른 규격 추가 (소분류 -N)"
                      >+ 추가</button>
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(e) => handleDragEnd(e, repCode, subItems)}
                    >
                      <SortableContext
                        items={subItems.map((it) => it.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <table className="table inline-edit-table cards-sm sortable-rows">
                          <thead>
                            <tr>
                              <th style={{ width: 32 }} aria-label="순서 변경"></th>
                              <th style={{ minWidth: 100 }}>코드</th>
                              <th style={{ minWidth: 160 }}>품명</th>
                              <th>메이커</th>
                              <th>규격</th>
                              <th>분류</th>
                              <th>moq/단위</th>
                              <th>개별단가</th>
                              <th>단가</th>
                              <th>기본 구매처</th>
                              <th style={{ minWidth: 160 }}>비고</th>
                              <th className="item-group-add-th">
                                <button
                                  type="button"
                                  className="item-group-add-btn"
                                  onClick={(e) => { e.stopPropagation(); addSameItem(subItems[subItems.length - 1] || repItem); }}
                                  title="같은 품명으로 다른 규격 추가 (소분류 -N)"
                                >+ 추가</button>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {subItems.length === 0 && (
                              <tr>
                                <td colSpan={12} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
                                  소분류가 없습니다 — 우측 상단 "+ 추가"로 등록하세요.
                                </td>
                              </tr>
                            )}
                            {subItems.map((it) => {
                              const expanded = expandedId === it.id;
                              return (
                                <Fragment key={it.id}>
                                  <SortableItemRow
                                    id={it.id}
                                    isHighlight={highlightIds.has(it.id)}
                                    onActivate={() => clearHighlight(it.id)}
                                  >
                                <td data-label="코드">
                                  <input
                                    type="text"
                                    value={it.code || ''}
                                    placeholder="코드"
                                    onChange={(e) => updateField(it.id, { code: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                    autoFocus={String(it.id).startsWith('tmp-') && !highlightIds.has(it.id)}
                                  />
                                </td>
                                <td data-label="품명">
                                  <input
                                    type="text"
                                    value={it.name || ''}
                                    placeholder="품명"
                                    onChange={(e) => updateField(it.id, { name: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="메이커">
                                  <input
                                    type="text"
                                    value={it.maker || ''}
                                    onChange={(e) => updateField(it.id, { maker: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="규격">
                                  <input
                                    type="text"
                                    value={it.spec || ''}
                                    onChange={(e) => updateField(it.id, { spec: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="분류">
                                  <input
                                    type="text"
                                    value={it.category || ''}
                                    onChange={(e) => updateField(it.id, { category: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td data-label="moq/단위">
                                  <input
                                    type="text"
                                    value={it.unit || ''}
                                    placeholder="개·m·2/개·roll/610m·박스 24개·10EA"
                                    onChange={(e) => {
                                      const newUnit = e.target.value;
                                      const cu = parseCompoundUnit(newUnit);
                                      const patch = { unit: newUnit };
                                      // 복합 단위로 바뀌면 개별단가 기준 단가 재계산
                                      if (cu && Number(it.unitPrice) > 0) {
                                        patch.standardPrice = Math.round(Number(it.unitPrice) * cu.qty);
                                      }
                                      updateField(it.id, patch);
                                    }}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                {(() => {
                                  const cu = parseCompoundUnit(it.unit);
                                  const qty = cu ? cu.qty : 1;            // 단순 단위는 qty=1로 취급
                                  const unitPrice = Number(it.unitPrice) || 0;
                                  return (
                                    <td data-label="개별단가" className="item-cell-unit-price">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        className="num-input"
                                        value={unitPrice ? Number(unitPrice).toLocaleString() : ''}
                                        onChange={(e) => {
                                          const raw = e.target.value.replace(/[^0-9]/g, '');
                                          const up = raw ? Number(raw) : 0;
                                          updateField(it.id, {
                                            unitPrice: up,
                                            standardPrice: Math.round(up * qty),
                                          });
                                        }}
                                        onBlur={() => flushItem(it.id)}
                                      />
                                    </td>
                                  );
                                })()}
                                {(() => {
                                  const cu = parseCompoundUnit(it.unit);
                                  const qty = cu ? cu.qty : 1;
                                  const unitPrice = Number(it.unitPrice) || 0;
                                  // 개별단가가 있으면 자동 계산값, 없으면 기존 standardPrice 직접 편집 가능
                                  const isAuto = unitPrice > 0;
                                  const total = isAuto
                                    ? Math.round(unitPrice * qty)
                                    : Number(it.standardPrice) || 0;
                                  return (
                                    <td data-label="단가" className="item-cell-price">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        className={`num-input ${isAuto ? 'is-readonly' : ''}`}
                                        value={total ? Number(total).toLocaleString() : ''}
                                        readOnly={isAuto}
                                        onChange={(e) => {
                                          if (isAuto) return;
                                          const raw = e.target.value.replace(/[^0-9]/g, '');
                                          updateField(it.id, { standardPrice: raw ? Number(raw) : 0 });
                                        }}
                                        onBlur={() => flushItem(it.id)}
                                      />
                                      {it.priceHistory?.length > 0 && (
                                        <span className="price-since">{it.priceHistory[it.priceHistory.length - 1].date}~</span>
                                      )}
                                    </td>
                                  );
                                })()}
                                <td data-label="기본 구매처">
                                  <select
                                    value={it.defaultSupplierId || ''}
                                    onChange={(e) => {
                                      updateField(it.id, { defaultSupplierId: e.target.value });
                                      setTimeout(() => flushItem(it.id), 0);
                                    }}
                                  >
                                    <option value="">선택</option>
                                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                                  </select>
                                </td>
                                <td data-label="비고">
                                  <input
                                    type="text"
                                    value={it.note || ''}
                                    placeholder="-"
                                    onChange={(e) => updateField(it.id, { note: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                </td>
                                <td className="item-actions-cell">
                                  <button
                                    type="button"
                                    className="item-copy-btn"
                                    onClick={() => duplicateItem(it)}
                                    title="이 항목 복사"
                                    aria-label="복사"
                                  >복사</button>
                                  {Array.isArray(it.priceHistory) && it.priceHistory.length > 0 && (
                                    <button
                                      type="button"
                                      className="item-expand-btn"
                                      onClick={() => setExpandedId(expanded ? null : it.id)}
                                      title={expanded ? '접기' : '단가 변경 이력 보기'}
                                    >
                                      {expanded ? '∧' : '∨'}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="closing-delete"
                                    onClick={() => handleDelete(it)}
                                    aria-label="삭제"
                                  >✕</button>
                                </td>
                              </SortableItemRow>
                              {expanded && Array.isArray(it.priceHistory) && it.priceHistory.length > 0 && (
                                <tr className="item-detail-row">
                                  <td colSpan={12}>
                                    <div className="item-detail-body">
                                      <div className="item-detail-section">
                                        <label className="item-detail-label">단가 변경 이력</label>
                                        <div className="price-history">
                                          {[...it.priceHistory].reverse().map((h, i) => (
                                            <div key={i} className="price-history-row">
                                              <div className="ph-info">
                                                <span className="price-history-date">{h.date}</span>
                                                {h.supplierName && <span className="ph-supplier">{h.supplierName}</span>}
                                                {Number(h.qty) > 0 && <span className="ph-qty">×{h.qty}</span>}
                                              </div>
                                              <strong>{Number(h.price).toLocaleString()}원</strong>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 엑셀 일괄 추가 모달 */}
      <Modal isOpen={bulkModal} onClose={() => setBulkModal(false)} title="엑셀 일괄 추가">
        <div className="form-group">
          <label>엑셀에서 복사한 내용 붙여넣기</label>
          <p className="field-hint">
            컬럼 순서: <strong>코드 · 품명 · 메이커 · 규격 · moq/단위 · 분류 · 단가</strong> (7개 열)<br />
            엑셀에서 해당 열들을 선택해 복사한 뒤 아래 칸에 붙여넣으세요. 첫 줄이 머리글(코드/품명…)이면 자동 제외됩니다.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={7}
            placeholder="엑셀 셀 범위를 복사해 여기에 붙여넣기"
          />
        </div>

        {parsedBulk.length > 0 && (
          <div className="bulk-preview">
            <div className="bulk-preview-head">{parsedBulk.length}개 품목 인식됨</div>
            <table className="table">
              <thead>
                <tr><th>코드</th><th>품명</th><th>메이커</th><th>규격</th><th>moq/단위</th><th>분류</th><th>단가</th></tr>
              </thead>
              <tbody>
                {parsedBulk.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.code || '-'}</td>
                    <td>{r.name}</td>
                    <td>{r.maker || '-'}</td>
                    <td>{r.spec || '-'}</td>
                    <td>{r.unit || '-'}</td>
                    <td>{r.category || '-'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {r.standardPrice ? Number(r.standardPrice).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsedBulk.length > 50 && (
              <p className="field-hint">… 미리보기는 50건까지, 등록은 전체 {parsedBulk.length}건</p>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleBulkSubmit}
            disabled={bulkSaving || parsedBulk.length === 0}
          >
            {bulkSaving ? '등록 중…' : `${parsedBulk.length}개 등록`}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setBulkModal(false)}>취소</button>
        </div>
      </Modal>
    </div>
  );
}
