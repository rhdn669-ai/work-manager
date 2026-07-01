import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getPurchaseItems,
  addPurchaseItem,
  updatePurchaseItem,
  recordPriceChange,
  deletePurchaseItems,
  getSuppliers,
  nextMainCode,
  nextSubCode,
  reorderGroupCodes,
  inferGroupKeys,
  repadItemCodes,
} from '../../services/purchaseService';
import { trashGeneric, restoreTrashItem } from '../../services/trashService';
import { useUndo } from '../../contexts/UndoContext';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../../components/common/Modal';
import Icon from '../../components/common/Icon';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import { useDialog } from '../../components/common/DialogProvider';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// 드래그 가능한 행 — useSortable 훅을 적용한 <tr>
function SortableItemRow({ id, isHighlight, isFillTarget, onActivate, onMouseEnter, children }) {
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
      className={`${isHighlight ? 'is-newly-added' : ''} ${isFillTarget ? 'is-fill-target' : ''}`.trim() || undefined}
      onPointerDown={isHighlight ? onActivate : undefined}
      onFocusCapture={isHighlight ? onActivate : undefined}
      onMouseEnter={onMouseEnter}
    >
      <td className="drag-handle-cell" data-label="">
        <button
          type="button"
          className="drag-handle-btn"
          aria-label="드래그하여 순서 변경"
          title="드래그하여 순서 변경"
          {...attributes}
          {...listeners}
        >
          <Icon name="move" />
        </button>
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
  const m = s.match(/(\d[\d,]*(?:\.\d+)?)[\s/()*x×-]*([^\d\s/()*x×,-]+)/);
  if (!m) return null;
  const qty = parseFloat(m[1].replace(/,/g, ''));
  if (!qty || qty <= 1) return null; // 1 이하는 곱셈 의미 없음 → 단순 단위 취급
  return {
    container: s.slice(0, m.index).trim(),
    qty,
    baseUnit: m[2].trim(),
  };
}

// 간단 모드 — "품명 + 개별단가" (엑셀 2열). 코드는 저장 시 자동 부여, 단가=개별단가(단순품목).
// 엑셀 2열(탭) 또는 "품명 [공백] 개별단가". 줄 끝 숫자만 단가로 봄(품명 끝 숫자는 공백 없어 안전).
function parseSimpleBulk(text) {
  const cleanNum = (v) => (v || '').replace(/[^0-9.]/g, '');
  return (text || '')
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return null;
      if (t.includes('\t')) {
        const cols = t.split('\t').map((c) => c.trim());
        const name = cols[0];
        const priceCol = cols.slice(1).find((c) => /\d/.test(c)) || '';
        return name ? { name, unitPrice: cleanNum(priceCol) } : null;
      }
      const m = t.match(/\s+([\d,]+(?:\.\d+)?)\s*$/);
      if (m) {
        const name = t.slice(0, m.index).trim();
        return name ? { name, unitPrice: m[1].replace(/,/g, '') } : null;
      }
      return { name: t, unitPrice: '' };
    })
    .filter(Boolean)
    .filter((r) => r.name && r.name !== '품명');
}

// 변동률 배지 — 상승 ▲빨강 / 하락 ▼파랑 / 동일 −회색
function RateBadge({ from, to, rate }) {
  const r = rate != null ? Number(rate) : (Number(from) > 0 ? ((Number(to) - Number(from)) / Number(from)) * 100 : 0);
  const up = r > 0;
  const down = r < 0;
  return (
    <span className={`rate-badge ${up ? 'up' : down ? 'down' : 'flat'}`}>
      {up ? '▲' : down ? '▼' : '−'} {up ? '+' : ''}
      {r.toFixed(1)}%
    </span>
  );
}

// 단가 변경 이력 — 전 품목 통합, 최근순
function PriceHistoryView({ items }) {
  const rows = items
    .flatMap((it) => (it.priceChangeHistory || []).map((h) => ({ ...h, name: it.name, code: it.code })))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  if (rows.length === 0)
    return (
      <p className="text-muted" style={{ padding: '28px 0', textAlign: 'center' }}>
        단가 변경 이력이 없습니다 — 품목 탭에서 단가를 수정하면 여기에 기록됩니다.
      </p>
    );
  return (
    <div className="table-scroll-x">
      <table className="table pc-history-table">
        <thead>
          <tr>
            <th style={{ width: 110 }}>날짜</th>
            <th>품목</th>
            <th>구매처</th>
            <th className="num">이전가</th>
            <th className="num">변경가</th>
            <th style={{ width: 110 }}>변동률</th>
            <th>사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h, i) => (
            <tr key={i}>
              <td>{h.date}</td>
              <td>{h.name}</td>
              <td>{h.supplierName || '-'}</td>
              <td className="num">{Number(h.from).toLocaleString()}원</td>
              <td className="num">{Number(h.to).toLocaleString()}원</td>
              <td>
                <RateBadge from={h.from} to={h.to} rate={h.rate} />
              </td>
              <td>{h.reason || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PurchaseItemPage() {
  const { confirm, alert, toast } = useDialog();
  const { userProfile } = useAuth();
  const { push: pushUndo } = useUndo();
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [trashOpen, setTrashOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchParams] = useSearchParams();
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  // ── 단가 변경 이력 ──
  const [activeTab, setActiveTab] = useState('items'); // 'items' | 'history'
  const [priceChangeModal, setPriceChangeModal] = useState(null); // { itemId, from, to, supplierName, restData }
  const [pcReason, setPcReason] = useState('');
  const editStartPriceRef = useRef({}); // 단가 input 포커스 시 원본가 보관 (직접 수정 변동 감지용)
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
  // 엑셀식 셀 채우기 (드래그) — { field, value, rowIds:[], start, end } | null
  const [fill, setFill] = useState(null);
  // 그룹 안 일괄 추가 (규격·개별단가)
  const [groupBulk, setGroupBulk] = useState(null); // { repItem } | null
  const [groupBulkText, setGroupBulkText] = useState('');
  const [groupBulkSupplier, setGroupBulkSupplier] = useState('');
  const [groupBulkSaving, setGroupBulkSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // BOM 등에서 ?focus=코드 로 진입하면 해당 품목으로 검색 필터
  useEffect(() => {
    const f = searchParams.get('focus');
    if (f) setSearch(f);
  }, [searchParams]);

  async function loadData() {
    try {
      const [it, sp] = await Promise.all([getPurchaseItems(), getSuppliers()]);
      // 기존 5자리 코드(IOPN-00001)를 3자리(IOPN-001)로 1회 재패딩 (변경분만 저장)
      const repadded = await repadItemCodes(it);
      setItems(inferGroupKeys(repadded));
      setSuppliers(sp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((it) => {
      if (it.category) set.add(it.category);
    });
    return [...set].sort();
  }, [items]);

  const hasActiveFilter = !!(search.trim() || filterCategory || filterSupplier);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const result = items.filter((it) => {
      if (kw && ![it.code, it.name, it.spec, it.maker, it.category].some((v) => (v || '').toLowerCase().includes(kw)))
        return false;
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
  function toggleGroup(mainCode) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(mainCode)) next.delete(mainCode);
      else next.add(mainCode);
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

    const m = (mainCode || '').match(/^IOPN-(\d+)/);
    if (!m) return;
    const prefix = `IOPN-${m[1]}`;

    const newOrder = arrayMove(groupItems, oldIndex, newIndex);
    const orderedIds = newOrder.map((it) => it.id);
    const newCodeById = new Map();
    orderedIds.forEach((id, idx) => {
      // 하위 항목은 모두 -1, -2 … (대분류 prefix는 대표 품목 전용) — 서버 reorderGroupCodes와 동일
      newCodeById.set(id, `${prefix}-${idx + 1}`);
    });

    // 낙관적 로컬 업데이트
    setItems((prev) =>
      prev.map((it) => {
        const nc = newCodeById.get(it.id);
        return nc && nc !== it.code ? { ...it, code: nc } : it;
      }),
    );

    try {
      await reorderGroupCodes(orderedIds, groupItems, mainCode);
    } catch (err) {
      alert('순서 변경 저장 중 오류: ' + err.message);
      await loadData(); // 롤백
    }
  }

  // 그룹 일괄: "규격 + 개별단가" 파싱 (parseSimpleBulk의 name을 규격으로 사용)
  const parsedGroupBulk = useMemo(() => parseSimpleBulk(groupBulkText), [groupBulkText]);

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
        setItems((prev) =>
          prev.map((x) => {
            if (x.id === id) return { ...x, id: ref.id, code: payload.code };
            if (x.groupKey === id) return { ...x, groupKey: ref.id }; // 베어 메인 tmp id를 가리키던 서브들도 새 id로 갱신
            return x;
          }),
        );
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
        // 단가 input을 직접 포커스해 편집한 경우에만 변동 감지 (자동계산 경로는 포커스가 없어 제외됨)
        const oldPrice = editStartPriceRef.current[id];
        if (oldPrice != null) {
          delete editStartPriceRef.current[id];
          const newPrice = Number(data.standardPrice) || 0;
          if (oldPrice !== newPrice) {
            // 단가 변동 → 사유 입력 모달에서 기록. 나머지 필드는 restData로 함께 저장.
            const { standardPrice: _sp, ...restData } = data;
            const sup = suppliers.find((x) => x.id === it.defaultSupplierId);
            setPcReason('');
            setPriceChangeModal({ itemId: id, from: oldPrice, to: newPrice, supplierName: sup?.name || '', restData });
            return;
          }
        }
        await updatePurchaseItem(id, data);
      }
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  // 단가 변경 모달 — 저장(기록) / 취소(단가 롤백)
  async function confirmPriceChange() {
    const m = priceChangeModal;
    if (!m) return;
    try {
      await recordPriceChange(m.itemId, { from: m.from, to: m.to, reason: pcReason, supplierName: m.supplierName });
      if (m.restData && Object.keys(m.restData).length) await updatePurchaseItem(m.itemId, m.restData);
      toast('단가 변경 이력이 기록되었습니다.', 'success');
    } catch (err) {
      alert('기록 실패: ' + err.message);
    }
    setPriceChangeModal(null);
  }
  function cancelPriceChange() {
    const m = priceChangeModal;
    if (m) updateField(m.itemId, { standardPrice: m.from }); // 단가 롤백
    setPriceChangeModal(null);
  }

  function addRow() {
    const tmpId = `tmp-${Date.now()}`;
    const newCode = nextMainCode(items);
    setItems((prev) => [
      {
        id: tmpId,
        code: newCode,
        name: '',
        spec: '',
        maker: '',
        unit: '',
        category: '',
        standardPrice: 0,
        unitPrice: 0,
        defaultSupplierId: '',
        note: '',
        priceHistory: [],
        // 베어 메인: groupKey 없음 (own id가 anchor)
      },
      ...prev,
    ]);
    setExpandedId(null);
    setSearch('');
    setFilterCategory('');
    setFilterSupplier('');
    expandGroup(tmpId); // groupKey = own id (베어의 tmp id, flushItem에서 real id로 교체됨)
  }

  function duplicateItem(item) {
    const code = nextSubCode(items, item.code);
    if (!code) {
      alert('코드 자동 부여 실패 — 부모 코드를 확인하세요.');
      return;
    }
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
    if (!code) {
      alert('부모 코드가 잘못되어 동일품명을 추가할 수 없습니다.');
      return;
    }
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
    if (!(await confirm(`"${mainCode}" 대분류와 하위 항목 ${count}개를 모두 삭제하시겠습니까?\n(되돌릴 수 없습니다)`)))
      return;
    const ids = groupItems.map((it) => it.id);
    try {
      await deletePurchaseItems(ids);
      setItems((prev) => prev.filter((it) => !ids.includes(it.id)));
    } catch (err) {
      alert('대분류 삭제 중 오류: ' + err.message);
    }
  }

  async function handleDelete(it) {
    if (!(await confirm(`"${it.name || '이 항목'}"을(를) 삭제하시겠습니까?\n휴지통에서 복원할 수 있습니다.`))) return;
    if (String(it.id).startsWith('tmp-')) {
      setItems((prev) => prev.filter((x) => x.id !== it.id));
      return;
    }
    // 삭제 대상이 하위분류(-N)면, 같은 대분류의 뒷번호를 당겨 빈 번호를 채움
    const subMatch = (it.code || '').match(/^(IOPN-\d+)-(\d+)$/);
    try {
      const tid = await trashGeneric(
        'purchaseItems',
        it.id,
        {
          title: it.name || '(품명 없음)',
          summary: [it.code, it.spec].filter(Boolean).join(' · '),
        },
        userProfile?.name || '',
      );
      toast('휴지통으로 이동했습니다.');
      if (tid) pushUndo(`품목 "${it.name || '항목'}" 삭제`, async () => {
        await restoreTrashItem(tid);
        await loadData();
      });
      const remaining = items.filter((x) => x.id !== it.id);
      setItems(remaining);

      if (subMatch) {
        const mainCode = subMatch[1];
        const siblings = remaining
          .filter((x) => {
            const m = (x.code || '').match(/^(IOPN-\d+)-(\d+)$/);
            return m && m[1] === mainCode;
          })
          .sort((a, b) => {
            const na = parseInt((a.code.match(/-(\d+)$/) || [])[1] || '0', 10);
            const nb = parseInt((b.code.match(/-(\d+)$/) || [])[1] || '0', 10);
            return na - nb;
          });
        if (siblings.length > 0) {
          const updates = await reorderGroupCodes(
            siblings.map((x) => x.id),
            siblings,
            mainCode,
          );
          if (updates && updates.length > 0) {
            const codeById = new Map(updates.map((u) => [u.id, u.code]));
            setItems((prev) => prev.map((x) => (codeById.has(x.id) ? { ...x, code: codeById.get(x.id) } : x)));
          }
        }
      }
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
      await loadData(); // 코드 재정렬 실패 시 서버 상태로 복구
    }
  }

  // ---- 엑셀식 셀 채우기 (드래그) ----
  function startFill(e, field, value, rowIds, startIndex) {
    e.preventDefault();
    e.stopPropagation();
    setFill({ field, value, rowIds, start: startIndex, end: startIndex });
  }
  function fillEnter(idx) {
    setFill((f) => (f ? { ...f, end: idx } : f));
  }
  function buildFillPatch(field, value, it) {
    if (field === 'unitPrice') {
      const cu = parseCompoundUnit(it.unit);
      const qty = cu ? cu.qty : 1;
      const up = Number(String(value).replace(/[^0-9]/g, '')) || 0;
      return { unitPrice: up, standardPrice: Math.round(up * qty) };
    }
    if (field === 'standardPrice') {
      return { standardPrice: Number(String(value).replace(/[^0-9]/g, '')) || 0 };
    }
    return { [field]: value };
  }
  async function applyFill(f) {
    const lo = Math.min(f.start, f.end);
    const hi = Math.max(f.start, f.end);
    const patchById = new Map();
    for (let i = lo; i <= hi; i++) {
      const id = f.rowIds[i];
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      patchById.set(id, buildFillPatch(f.field, f.value, it));
    }
    if (patchById.size === 0) return;
    // 로컬 즉시 반영
    setItems((prev) => prev.map((x) => (patchById.has(x.id) ? { ...x, ...patchById.get(x.id) } : x)));
    // 저장 (신규 tmp 행은 자체 flush로 저장됨 — 건너뜀)
    for (const [id, patch] of patchById) {
      if (String(id).startsWith('tmp-')) continue;
      const it = items.find((x) => x.id === id);
      if (!it) continue;
      try {
        const { id: _i, createdAt: _c, updatedAt: _u, ...data } = { ...it, ...patch };
        await updatePurchaseItem(id, data);
      } catch (err) {
        console.error('셀 채우기 저장 오류:', err);
      }
    }
  }
  useEffect(() => {
    if (!fill) return undefined;
    // 드래그한 범위에 값 복사(아래로 채우기) — 마우스를 떼면 실행
    const onUp = () => {
      if (fill.start !== fill.end) applyFill(fill);
      setFill(null);
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  // ---- 그룹 안 일괄 추가 (규격·개별단가) ----
  function openGroupBulk(repItem) {
    if (!repItem) return;
    setGroupBulkText('');
    setGroupBulkSupplier(repItem.defaultSupplierId || '');
    setGroupBulk({ repItem });
  }

  async function handleGroupBulkSubmit() {
    if (!groupBulk) return;
    const repItem = groupBulk.repItem;
    if (!/^IOPN-\d+/.test(repItem.code || '')) {
      alert('이 그룹은 IOPN 코드가 아니어서 일괄 추가할 수 없습니다.');
      return;
    }
    if (parsedGroupBulk.length === 0) {
      alert('인식된 항목이 없습니다.');
      return;
    }
    setGroupBulkSaving(true);
    try {
      let buf = [...items];
      const payloads = parsedGroupBulk.map((r) => {
        const code = nextSubCode(buf, repItem.code);
        buf = [...buf, { code, name: repItem.name }];
        return {
          code,
          name: repItem.name || '', // 품명은 대표 품목명 유지
          spec: r.name, // 붙여넣은 첫 칸 = 규격
          maker: repItem.maker || '',
          unit: repItem.unit || '',
          category: repItem.category || '',
          unitPrice: Number(r.unitPrice) || 0,
          standardPrice: Number(r.unitPrice) || 0, // 단순 품목: 단가 = 개별단가
          defaultSupplierId: groupBulkSupplier || '',
          groupKey: repItem.groupKey || repItem.id,
          priceHistory: [],
        };
      });
      await Promise.all(payloads.map((d) => addPurchaseItem(d)));
      setGroupBulk(null);
      setGroupBulkText('');
      await loadData();
      expandGroup(repItem.groupKey || repItem.id);
      alert(`${payloads.length}개 규격을 추가했습니다.`);
    } catch (err) {
      alert('일괄 추가 중 오류: ' + err.message);
    } finally {
      setGroupBulkSaving(false);
    }
  }

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-item-page">
      <style>{`
        @media (max-width: 480px) {
          .inline-edit-table th, .inline-edit-table td { padding: 8px 6px; font-size: 12px; }
          .inline-edit-table th { min-width: 50px; }
          .inline-edit-table td input, .inline-edit-table td[data-label] { min-width: 60px; word-break: break-word; overflow-wrap: break-word; }
          .inline-edit-table td { min-width: 0; }
        }
        @media (max-width: 390px) {
          .inline-edit-table th, .inline-edit-table td { padding: 6px 4px; font-size: 11px; }
          .inline-edit-table th { min-width: 40px; }
        }
        @media (max-width: 360px) {
          .item-group-header { flex-direction: column !important; gap: 8px !important; }
          .item-group-code-input, .item-group-name-input { width: 100% !important; flex: 1 1 auto; }
          .inline-edit-table td input, .inline-edit-table td[data-label] { min-width: 35px; word-break: break-word; overflow-wrap: break-word; }
          .inline-edit-table td { min-width: 0; }
        }
        .inline-edit-table td input { min-width: 0; overflow-wrap: break-word; word-break: break-word; }
        .inline-edit-table td[data-label="규격"] input,
        .inline-edit-table td[data-label="품명"] input,
        .inline-edit-table td[data-label="비고"] input {
          display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
          overflow: hidden; white-space: normal; word-break: break-word;
        }
        /* 작업 셀 — table-cell 유지(헤더 +추가/일괄 컬럼과 정렬 일치). flex 금지 */
        .item-actions-cell { text-align: center; white-space: nowrap; vertical-align: middle; min-height: 36px; overflow: visible; }
        .item-actions-cell > * + * { margin-left: 6px; }
        .item-actions-cell .btn { min-height: var(--btn-h-sm); vertical-align: middle; }
        .item-actions-cell .item-expand-btn { min-height: var(--btn-h-sm); vertical-align: middle; }
        .item-group-name-input { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
        /* 기본 구매처 드롭다운 — 컬럼(고정폭) 가득 채워 펼친 폭과 트리거 폭 통일 */
        .po-supplier-select { width: 100%; }
        /* 트리거 높이를 dense 행(36px)에 고정 — 행 높이 들뜸/세로 어긋남 방지. 드롭다운 패널은 별도 오버레이라 영향 없음 */
        .po-supplier-select .ds-select__trigger { width: 100%; min-height: 36px; height: 36px; }
        /* 검색 중에는 그룹 헤더(대분류 윗줄) 숨김 — 아이템 행과 중복 제거 */
        .item-group-header.is-search-hidden { display: none !important; }

        /* 탭 · 단가 변경 이력 */
        .pi-tabs { display:flex; gap:6px; margin-bottom:14px; border-bottom:1px solid var(--border); }
        .pi-tabs button { padding:9px 16px; font-size:13px; font-weight:700; color:var(--text-muted); background:none; border:none; border-bottom:2px solid transparent; cursor:pointer; margin-bottom:-1px; }
        .pi-tabs button.on { color:var(--primary); border-bottom-color:var(--primary); }
        .rate-badge { display:inline-flex; align-items:center; gap:2px; font-size:12px; font-weight:800; padding:2px 8px; border-radius:999px; font-variant-numeric:tabular-nums; white-space:nowrap; }
        .rate-badge.up { color:#c53030; background:#fdecec; }
        .rate-badge.down { color:#1d4ed8; background:#e8f0fe; }
        .rate-badge.flat { color:#6b7280; background:#f1f3f5; }
        .pc-modal { display:flex; flex-direction:column; gap:14px; }
        .pc-change { display:flex; align-items:center; gap:10px; font-size:16px; font-weight:800; flex-wrap:wrap; }
        .pc-price { color:#6b7280; }
        .pc-price.to { color:var(--primary); }
        .pc-arrow { color:#9aa0ad; }
        .pc-supplier { font-size:12px; color:#6b7280; }
        .pc-history-table td.num, .pc-history-table th.num { text-align:right; font-variant-numeric:tabular-nums; }
      `}</style>
      <div className="page-header">
        <h2>구매 품목 관리</h2>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={addRow}>
            <Icon name="plus" className="btn-ic" />
            품목 추가
          </button>
        </div>
      </div>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['purchaseItems']}
        title="품목 휴지통"
        onChange={loadData}
      />

      {/* 탭: 품목 / 단가 변경 이력 */}
      <div className="pi-tabs">
        <button
          type="button"
          className={activeTab === 'items' ? 'on' : ''}
          onClick={() => setActiveTab('items')}
        >
          품목
        </button>
        <button
          type="button"
          className={activeTab === 'history' ? 'on' : ''}
          onClick={() => setActiveTab('history')}
        >
          단가 변경 이력
        </button>
      </div>

      {activeTab === 'history' && <PriceHistoryView items={items} />}
      {activeTab === 'items' && (
        <>
      <div className="purchase-filters">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="코드 · 품명 · 규격 · 메이커 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          value={filterSupplier}
          onChange={(v) => setFilterSupplier(v)}
          options={[{ value: '', label: '구매처 전체' }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
          ariaLabel="구매처 필터"
        />
      </div>

      {groups.length === 0 ? (
        <p className="text-muted text-sm" style={{ padding: '20px 0', textAlign: 'center' }}>
          {items.length === 0
            ? '등록된 품목이 없습니다 — 우측 상단 "+ 품목 추가" 또는 "엑셀 일괄 추가"'
            : '조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group-list">
          {groups.map(([groupKey, groupItems]) => {
            // 필터(검색·분류·구매처) 활성화 시 매칭된 그룹은 자동 펼침
            const isExpanded = hasActiveFilter || expandedGroups.has(groupKey);
            const repItem = repItemForGroup(groupItems);
            const repName = repItem?.name || '';
            const repCode = repItem?.code || '';
            // 검색 시: 진짜 대분류(베어 메인)만 결과에서 제외하고 나머지는 모두 행으로 표시.
            //   ★ 대표(repItem)는 진짜 대분류가 없을 때 임의 항목이 될 수 있으므로 그걸로 제외하면
            //     실제 품목이 사라진다(같은 그룹의 EW32/EW50 중 하나만 보이던 버그). → trueMain만 제외.
            const trueMain = groupItems.find((it) => !it.groupKey || it.groupKey === it.id);
            const subItems = hasActiveFilter
              ? trueMain
                ? groupItems.filter((it) => it.id !== trueMain.id)
                : groupItems
              : repItem
                ? groupItems.filter((it) => it.id !== repItem.id)
                : groupItems;
            const subIds = subItems.map((s) => s.id);
            return (
              <div key={groupKey} className={`item-group ${isExpanded ? 'is-expanded' : ''}`}>
                <div
                  className={`item-group-header${hasActiveFilter ? ' is-search-hidden' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  style={{ minHeight: 42, padding: '10px 12px', gap: 12 }}
                  onClick={() => toggleGroup(groupKey)}
                  onKeyDown={(e) => {
                    // 내부 입력칸에서 올라온 키는 무시 (스페이스 띄어쓰기 보존)
                    if (e.target !== e.currentTarget) return;
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
                    title={repCode || ''}
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
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    disabled={!repItem}
                  />
                  <input
                    type="text"
                    className="item-group-name-input"
                    value={repName}
                    title={repName || ''}
                    placeholder="(품명 없음)"
                    onChange={(e) => repItem && updateField(repItem.id, { name: e.target.value })}
                    onBlur={() => repItem && flushItem(repItem.id)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    disabled={!repItem}
                  />
                  <span className="item-group-count" aria-hidden="true">
                    {subItems.length}개
                  </span>
                  <span className="item-group-arrow" aria-hidden="true">
                    <Icon name="chevronDown" />
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(repCode || '(코드 없음)', groupItems);
                    }}
                    aria-label="대분류 삭제"
                    title="대분류와 모든 하위 항목 삭제"
                  >
                    <Icon name="trash" className="btn-ic" />삭제
                  </button>
                </div>
                {isExpanded && (
                  <div className="item-group-detail">
                    <div className="item-group-detail-toolbar">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          addSameItem(subItems[subItems.length - 1] || repItem);
                        }}
                        title="같은 품명으로 다른 규격 추가 (소분류 -N)"
                      >
                        <Icon name="plus" className="btn-ic" />
                        추가
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          openGroupBulk(repItem);
                        }}
                        title="규격·금액 여러 개 붙여넣어 한 번에 추가"
                      >
                        일괄
                      </button>
                    </div>
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(e) => handleDragEnd(e, repCode, subItems)}
                    >
                      <SortableContext items={subItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                        <div className="table-scroll-x">
                          <table className="table inline-edit-table cards-sm sortable-rows">
                            <thead>
                              <tr>
                                <th style={{ width: 32 }} aria-label="순서 변경"></th>
                                <th style={{ width: 110 }}>코드</th>
                                <th style={{ width: 150 }}>품명</th>
                                <th style={{ width: 110 }}>메이커</th>
                                <th style={{ width: 240 }}>규격</th>
                                <th style={{ width: 170 }}>분류</th>
                                <th style={{ width: 170 }}>인증</th>
                                <th style={{ width: 100 }}>수량/단위</th>
                                <th style={{ width: 100 }}>개별단가</th>
                                <th style={{ width: 100 }}>단가</th>
                                <th style={{ width: 150 }}>기본 구매처</th>
                                <th style={{ width: 110 }}>비고</th>
                                <th className="item-group-add-th">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      addSameItem(subItems[subItems.length - 1] || repItem);
                                    }}
                                    title="같은 품명으로 다른 규격 추가 (소분류 -N)"
                                  >
                                    <Icon name="plus" className="btn-ic" />
                                    추가
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    style={{ marginLeft: 4 }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openGroupBulk(repItem);
                                    }}
                                    title="규격·금액 여러 개 붙여넣어 한 번에 추가"
                                  >
                                    일괄
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {subItems.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={13}
                                    className="text-muted text-sm"
                                    style={{ textAlign: 'center', padding: 16 }}
                                  >
                                    소분류가 없습니다 — 우측 상단 "+ 추가"로 등록하세요.
                                  </td>
                                </tr>
                              )}
                              {subItems.map((it, rowIdx) => {
                                const expanded = expandedId === it.id;
                                const fillIdx = fill ? fill.rowIds.indexOf(it.id) : -1;
                                const inFillRange =
                                  fillIdx >= 0 &&
                                  fillIdx >= Math.min(fill.start, fill.end) &&
                                  fillIdx <= Math.max(fill.start, fill.end);
                                // 드래그 중인 "그 열"의 셀에만 색상 — 행 전체 X
                                const fillCol = (field) =>
                                  inFillRange && fill?.field === field ? 'cell-fill-on' : undefined;
                                return (
                                  <Fragment key={it.id}>
                                    <SortableItemRow
                                      id={it.id}
                                      isHighlight={highlightIds.has(it.id)}
                                      onActivate={() => clearHighlight(it.id)}
                                      onMouseEnter={
                                        fill
                                          ? () => {
                                              if (fillIdx >= 0) fillEnter(fillIdx);
                                            }
                                          : undefined
                                      }
                                    >
                                      <td
                                        data-label="코드"
                                        title={it.code || ''}
                                        style={{ minWidth: 0, overflowWrap: 'break-word' }}
                                      >
                                        <input
                                          type="text"
                                          value={it.code || ''}
                                          title={it.code || ''}
                                          placeholder="코드"
                                          onChange={(e) => updateField(it.id, { code: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                          autoFocus={String(it.id).startsWith('tmp-') && !highlightIds.has(it.id)}
                                        />
                                      </td>
                                      <td
                                        data-label="품명"
                                        className={fillCol('name')}
                                        title={it.name || ''}
                                        style={{ minWidth: 0, overflowWrap: 'break-word' }}
                                      >
                                        <input
                                          type="text"
                                          value={it.name || ''}
                                          title={it.name || ''}
                                          placeholder="품명"
                                          onChange={(e) => updateField(it.id, { name: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) => startFill(e, 'name', it.name || '', subIds, rowIdx)}
                                        />
                                      </td>
                                      <td
                                        data-label="메이커"
                                        className={fillCol('maker')}
                                        title={it.maker || ''}
                                        style={{ minWidth: 0, overflowWrap: 'break-word' }}
                                      >
                                        <input
                                          type="text"
                                          value={it.maker || ''}
                                          title={it.maker || ''}
                                          onChange={(e) => updateField(it.id, { maker: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) => startFill(e, 'maker', it.maker || '', subIds, rowIdx)}
                                        />
                                      </td>
                                      <td
                                        data-label="규격"
                                        className={fillCol('spec')}
                                        title={it.spec || ''}
                                        style={{ minWidth: 0, overflowWrap: 'break-word' }}
                                      >
                                        <input
                                          type="text"
                                          value={it.spec || ''}
                                          title={it.spec || ''}
                                          onChange={(e) => updateField(it.id, { spec: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) => startFill(e, 'spec', it.spec || '', subIds, rowIdx)}
                                        />
                                      </td>
                                      <td data-label="분류" className={fillCol('category')} title={it.category || ''}>
                                        <input
                                          type="text"
                                          value={it.category || ''}
                                          title={it.category || ''}
                                          onChange={(e) => updateField(it.id, { category: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) =>
                                            startFill(e, 'category', it.category || '', subIds, rowIdx)
                                          }
                                        />
                                      </td>
                                      <td
                                        data-label="인증"
                                        className={fillCol('certification')}
                                        title={it.certification || ''}
                                      >
                                        <input
                                          type="text"
                                          value={it.certification || ''}
                                          title={it.certification || ''}
                                          placeholder="CE · KS …"
                                          onChange={(e) => updateField(it.id, { certification: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) =>
                                            startFill(e, 'certification', it.certification || '', subIds, rowIdx)
                                          }
                                        />
                                      </td>
                                      <td data-label="수량/단위" className={fillCol('unit')} title={it.unit || ''}>
                                        <input
                                          type="text"
                                          value={it.unit || ''}
                                          title={it.unit || ''}
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
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) => startFill(e, 'unit', it.unit || '', subIds, rowIdx)}
                                        />
                                      </td>
                                      {(() => {
                                        const cu = parseCompoundUnit(it.unit);
                                        const qty = cu ? cu.qty : 1; // 단순 단위는 qty=1로 취급
                                        const unitPrice = Number(it.unitPrice) || 0;
                                        return (
                                          <td
                                            data-label="개별단가"
                                            className={`item-cell-unit-price ${fillCol('unitPrice') || ''}`}
                                          >
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
                                            <span
                                              className="cell-fill"
                                              title="드래그하여 아래로 채우기"
                                              onMouseDown={(e) =>
                                                startFill(e, 'unitPrice', it.unitPrice || 0, subIds, rowIdx)
                                              }
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
                                          <td
                                            data-label="단가"
                                            className={`item-cell-price ${fillCol('standardPrice') || ''}`}
                                          >
                                            <input
                                              type="text"
                                              inputMode="numeric"
                                              className={`num-input ${isAuto ? 'is-readonly' : ''}`}
                                              value={total ? Number(total).toLocaleString() : ''}
                                              readOnly={isAuto}
                                              onFocus={() => {
                                                if (!isAuto)
                                                  editStartPriceRef.current[it.id] = Number(it.standardPrice) || 0;
                                              }}
                                              onChange={(e) => {
                                                if (isAuto) return;
                                                const raw = e.target.value.replace(/[^0-9]/g, '');
                                                updateField(it.id, { standardPrice: raw ? Number(raw) : 0 });
                                              }}
                                              onBlur={() => flushItem(it.id)}
                                            />
                                            {it.priceHistory?.length > 0 && (
                                              <span className="price-since">
                                                {it.priceHistory[it.priceHistory.length - 1].date}~
                                              </span>
                                            )}
                                            {!isAuto && (
                                              <span
                                                className="cell-fill"
                                                title="드래그하여 아래로 채우기"
                                                onMouseDown={(e) =>
                                                  startFill(e, 'standardPrice', total, subIds, rowIdx)
                                                }
                                              />
                                            )}
                                          </td>
                                        );
                                      })()}
                                      <td
                                        data-label="기본 구매처"
                                        className={fillCol('defaultSupplierId')}
                                        title={suppliers.find((s) => s.id === it.defaultSupplierId)?.name || ''}
                                      >
                                        <Select
                                          className="po-supplier-select"
                                          value={it.defaultSupplierId || ''}
                                          onChange={(val) => {
                                            updateField(it.id, { defaultSupplierId: val });
                                            // 신규(tmp) 행은 품명 저장 시 함께 저장됨 — 즉시 저장은 기존 행만
                                            if (!String(it.id).startsWith('tmp-')) {
                                              const {
                                                id: _i,
                                                createdAt: _c,
                                                updatedAt: _u,
                                                ...data
                                              } = { ...it, defaultSupplierId: val };
                                              updatePurchaseItem(it.id, data).catch((err) =>
                                                alert('구매처 저장 오류: ' + err.message),
                                              );
                                            }
                                          }}
                                          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                                          placeholder="선택"
                                          ariaLabel="기본 구매처 선택"
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) =>
                                            startFill(
                                              e,
                                              'defaultSupplierId',
                                              it.defaultSupplierId || '',
                                              subIds,
                                              rowIdx,
                                            )
                                          }
                                        />
                                      </td>
                                      <td
                                        data-label="비고"
                                        className={fillCol('note')}
                                        title={it.note || ''}
                                        style={{ minWidth: 0, overflowWrap: 'break-word' }}
                                      >
                                        <input
                                          type="text"
                                          value={it.note || ''}
                                          title={it.note || ''}
                                          placeholder="-"
                                          onChange={(e) => updateField(it.id, { note: e.target.value })}
                                          onBlur={() => flushItem(it.id)}
                                        />
                                        <span
                                          className="cell-fill"
                                          title="드래그하여 아래로 채우기"
                                          onMouseDown={(e) => startFill(e, 'note', it.note || '', subIds, rowIdx)}
                                        />
                                      </td>
                                      <td
                                        className="item-actions-cell"
                                        style={{
                                          textAlign: 'right',
                                          whiteSpace: 'nowrap',
                                          verticalAlign: 'middle',
                                          overflow: 'visible',
                                        }}
                                      >
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-outline"
                                          onClick={() => duplicateItem(it)}
                                          title="이 항목 복사"
                                          aria-label="복사"
                                        >
                                          복사
                                        </button>
                                        {Array.isArray(it.priceHistory) && it.priceHistory.length > 0 && (
                                          <button
                                            type="button"
                                            className="item-expand-btn"
                                            onClick={() => setExpandedId(expanded ? null : it.id)}
                                            title={expanded ? '접기' : '단가 변경 이력 보기'}
                                          >
                                            <Icon name={expanded ? 'chevronRight' : 'chevronDown'} />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="btn btn-sm btn-danger"
                                          onClick={() => handleDelete(it)}
                                          aria-label="삭제"
                                          title="삭제"
                                        >
                                          <Icon name="trash" className="btn-ic" />삭제
                                        </button>
                                      </td>
                                    </SortableItemRow>
                                    {expanded && Array.isArray(it.priceHistory) && it.priceHistory.length > 0 && (
                                      <tr className="item-detail-row">
                                        <td colSpan={13}>
                                          <div className="item-detail-body">
                                            <div className="item-detail-section">
                                              <label className="item-detail-label">단가 변경 이력</label>
                                              <div className="price-history">
                                                {[...it.priceHistory].reverse().map((h, i) => (
                                                  <div key={i} className="price-history-row">
                                                    <div className="ph-info">
                                                      <span className="price-history-date">{h.date}</span>
                                                      {h.supplierName && (
                                                        <span className="ph-supplier">{h.supplierName}</span>
                                                      )}
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
                        </div>
                      </SortableContext>
                    </DndContext>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* 단가 변경 기록 모달 */}
      <Modal isOpen={!!priceChangeModal} onClose={cancelPriceChange} title="단가 변경 기록">
        {priceChangeModal && (
          <div className="pc-modal">
            <div className="pc-change">
              <span className="pc-price">{priceChangeModal.from.toLocaleString()}원</span>
              <span className="pc-arrow">→</span>
              <span className="pc-price to">{priceChangeModal.to.toLocaleString()}원</span>
              <RateBadge from={priceChangeModal.from} to={priceChangeModal.to} />
            </div>
            {priceChangeModal.supplierName && (
              <div className="pc-supplier">구매처 · {priceChangeModal.supplierName}</div>
            )}
            <div className="form-group">
              <label>변경 사유 (선택)</label>
              <input
                type="text"
                value={pcReason}
                onChange={(e) => setPcReason(e.target.value)}
                placeholder="예: 원자재 인상, 환율 변동"
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-sm btn-outline" onClick={cancelPriceChange}>
                취소
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={confirmPriceChange}>
                저장
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 그룹 안 일괄 추가 (규격·금액) */}
      <Modal
        isOpen={!!groupBulk}
        onClose={() => setGroupBulk(null)}
        title={`일괄 추가 — ${groupBulk?.repItem?.name || ''}`}
      >
        <div className="form-group">
          <label>규격 · 개별단가 붙여넣기</label>
          <p className="field-hint">
            이 그룹(<strong>{groupBulk?.repItem?.name}</strong>)에 <strong>규격 + 개별단가</strong>를 한 번에
            추가합니다. 품명은 대표 품목명(<strong>{groupBulk?.repItem?.name}</strong>)으로 동일하게 들어가고, 코드는
            소분류(-N)로 자동 부여됩니다.
            <br />
            엑셀 2열(규격·개별단가) 또는 한 줄에 <code>규격 [공백] 개별단가</code> 형식.
          </p>
          <textarea
            value={groupBulkText}
            onChange={(e) => setGroupBulkText(e.target.value)}
            rows={6}
            placeholder={'예)\n케이블 타이	1500\n릴레이 G2RV	3000\n터미널 블록 800'}
          />
        </div>

        <div className="form-group">
          <label>
            구매처 선택 <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(선택)</span>
          </label>
          <Select
            value={groupBulkSupplier}
            onChange={(v) => setGroupBulkSupplier(v)}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="구매처 미지정"
            ariaLabel="구매처 선택"
          />
          <p className="field-hint">추가하는 규격들의 기본 구매처로 지정됩니다. (기본값: 대표 품목 구매처)</p>
        </div>

        {parsedGroupBulk.length > 0 && (
          <div className="bulk-preview">
            <div className="bulk-preview-head">{parsedGroupBulk.length}개 인식됨</div>
            <table className="table">
              <thead>
                <tr>
                  <th>규격</th>
                  <th style={{ textAlign: 'right' }}>개별단가</th>
                </tr>
              </thead>
              <tbody>
                {parsedGroupBulk.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td style={{ textAlign: 'right' }}>{r.unitPrice ? Number(r.unitPrice).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGroupBulkSubmit}
            disabled={groupBulkSaving || parsedGroupBulk.length === 0}
          >
            {groupBulkSaving ? '추가 중…' : `${parsedGroupBulk.length}개 추가`}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setGroupBulk(null)}>
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}
