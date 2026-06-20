import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getPurchases,
  addPurchase,
  setPurchaseStatus,
  getPurchaseConfig,
  setHqSite,
  deletePurchase,
  updatePurchase,
  getSuppliers,
  savePurchasesOrder,
  saveFactories,
} from '../../services/purchaseService';
import { trashPurchase, restoreTrashItem } from '../../services/trashService';
import { getAllSites } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import { useUndo } from '../../contexts/UndoContext';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';

const STATUS = {
  draft: { label: '대기', cls: 'draft' },
  ordered: { label: '발주', cls: 'ordered' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
};

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'draft', label: '대기' },
  { key: 'ordered', label: '발주' },
  { key: 'partial', label: '부분입고' },
  { key: 'received', label: '입고완료' },
  { key: 'settled', label: '정산완료' },
];

const EMPTY_FORM = { title: '', siteId: '', supplierId: '', deliveryDue: '', contactName: '', contactPhone: '' };

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


// 드래그 가능한 발주 카드 (전체 탭에서만 순서변경 활성)
function SortablePurchaseCard({ p, dragEnabled, onOpen, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
    disabled: !dragEnabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
    zIndex: isDragging ? 5 : undefined,
  };
  const st = STATUS[p.status] || { label: p.status, cls: 'ordered' };
  return (
    <div ref={setNodeRef} style={style} className="po-card" onClick={() => onOpen(p)}>
      <div className="po-card__top">
        <span className={`purchase-badge purchase-badge-${st.cls}`}>{st.label}</span>
        {dragEnabled && (
          <button
            type="button"
            className="po-card__drag"
            aria-label="드래그하여 순서 변경"
            title="드래그하여 순서 변경"
            onClick={(e) => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <Icon name="move" />
          </button>
        )}
      </div>
      <div className="po-card__title u-ellipsis-1" title={p.title || ''}>
        {p.title}
      </div>
      <div
        className="po-card__meta u-ellipsis-1"
        title={`${p.siteName || '프로젝트 미지정'}${p.supplierName ? ` · ${p.supplierName}` : ''}`}
      >
        <span>{p.siteName || '프로젝트 미지정'}</span>
        {p.supplierName && (
          <>
            <span className="po-card__dot">·</span>
            <span>{p.supplierName}</span>
          </>
        )}
      </div>
      <div className="po-card__bottom">
        <span className="po-card__amount" style={{ color: 'var(--accent, #F05819)' }}>
          {Number(p.totalAmount || 0).toLocaleString()}
          <em>원</em>
        </span>
        <span className="po-card__date">{fmtDate(p.createdAt || p.orderedAt)}</span>
      </div>
      <div className="po-card__foot">
        <span className="po-card__by" title={p.requesterName || '-'}>
          {p.requesterName || '-'}
        </span>
        <div className="po-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onEdit(e, p)}>
            수정
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>
            <Icon name="trash" className="btn-ic" />삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 칸반 보드 (상태 열로 드래그하면 상태 변경) =====
const BOARD_COLS = [
  { key: 'draft', label: '대기' },
  { key: 'ordered', label: '발주' },
  { key: 'partial', label: '부분입고' },
  { key: 'received', label: '입고완료' },
  { key: 'settled', label: '정산완료' },
];

function KanbanCard({ p, onOpen, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: p.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={{ ...style, minWidth: 0, overflow: 'hidden' }}
      className="kb-card"
      onClick={() => onOpen(p)}
      {...attributes}
      {...listeners}
    >
      <div className="kb-card__title u-ellipsis-1" title={p.title || ''}>
        {p.title}
      </div>
      <div
        className="kb-card__meta u-ellipsis-1"
        title={`${p.siteName || '프로젝트 미지정'}${p.supplierName ? ` · ${p.supplierName}` : ''}`}
      >
        {p.siteName || '프로젝트 미지정'}
        {p.supplierName ? ` · ${p.supplierName}` : ''}
      </div>
      <div className="kb-card__amount" style={{ color: 'var(--accent, #F05819)' }}>
        {Number(p.totalAmount || 0).toLocaleString()}
        <em>원</em>
      </div>
      <div className="kb-card__foot">
        <span className="kb-card__date">{fmtDate(p.createdAt || p.orderedAt)}</span>
        <div className="kb-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onEdit(e, p)}>
            수정
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>
            <Icon name="trash" className="btn-ic" />삭제
          </button>
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({ col, cards, onOpen, onEdit, onDelete }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={`kb-col ${isOver ? 'is-over' : ''}`}>
      <div className="kb-col__head">
        <span className={`purchase-badge purchase-badge-${col.key}`}>{col.label}</span>
        <span className="kb-col__count">{cards.length}</span>
      </div>
      <div className="kb-col__body">
        {cards.map((p) => (
          <KanbanCard key={p.id} p={p} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />
        ))}
        {cards.length === 0 && <div className="kb-col__empty">여기로 카드를 끌어다 놓으세요</div>}
      </div>
    </div>
  );
}

export default function PurchaseListPage() {
  const { userProfile } = useAuth();
  const { alert, confirm } = useDialog();
  const { push: pushUndo } = useUndo();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const navigate = useNavigate();

  const [trashOpen, setTrashOpen] = useState(false);
  const [purchases, setPurchases] = useState([]);
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [recentSiteId, setRecentSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('board'); // 'board'(칸반) | 'list'(목록)
  const [factories, setFactories] = useState([]);
  const [factoryModalOpen, setFactoryModalOpen] = useState(false);
  const [factoryForm, setFactoryForm] = useState([]);

  const [formModal, setFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null); // null=등록, id=수정
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [p, st, cfg, us, sup] = await Promise.all([
        getPurchases(),
        getAllSites(),
        getPurchaseConfig(),
        getUsers(),
        getSuppliers(),
      ]);
      setUsers(us);
      setSuppliers(sup);
      setFactories(cfg.factories || []);
      const validStatus = ['draft', 'ordered', 'partial', 'received', 'settled'];
      const legacy = p.filter((x) => !validStatus.includes(x.status));
      if (legacy.length > 0) {
        await Promise.all(legacy.map((x) => setPurchaseStatus(x.id, 'ordered')));
        legacy.forEach((x) => {
          x.status = 'ordered';
        });
      }
      setPurchases(p);
      setSites(st);
      setRecentSiteId(cfg.hqSiteId || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    const c = { all: purchases.length };
    for (const p of purchases) c[p.status] = (c[p.status] || 0) + 1;
    c.printed = purchases.filter((p) => Number(p.printCount) > 0).length;
    return c;
  }, [purchases]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = purchases.filter((p) => {
      if (tab === 'printed') {
        if (!(Number(p.printCount) > 0)) return false;
      } else if (tab !== 'all' && p.status !== tab) {
        return false;
      }
      if (!kw) return true;
      return [p.title, p.supplierName, p.siteName, p.requesterName].some((v) => (v || '').toLowerCase().includes(kw));
    });
    if (tab === 'printed') {
      const t = (p) => {
        const d = p.lastPrintedAt?.toDate
          ? p.lastPrintedAt.toDate()
          : p.lastPrintedAt
            ? new Date(p.lastPrintedAt)
            : null;
        return d ? d.getTime() : 0;
      };
      list.sort((a, b) => t(b) - t(a)); // 최근 출력순
    } else if (tab === 'all') {
      // 전체 탭: 수동 순서(order)대로 — 드래그앤드롭 순서변경 반영, 없으면 최신순
      const ord = (p) => (typeof p.order === 'number' ? p.order : 1e9);
      list.sort((a, b) => {
        const ao = ord(a);
        const bo = ord(b);
        if (ao !== bo) return ao - bo;
        return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
      });
    }
    return list;
  }, [purchases, tab, search]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, siteId: recentSiteId || '' });
    setFormModal(true);
  }

  function openEdit(e, p) {
    e.stopPropagation();
    setEditingId(p.id);
    setForm({
      title: p.title || '',
      siteId: p.siteId || '',
      supplierId: p.supplierId || '',
      deliveryDue: p.deliveryDue || '',
      contactName: p.contactName || '',
      contactPhone: p.contactPhone || '',
    });
    setFormModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      alert('제목을 입력해주세요.');
      return;
    }
    if (!form.siteId) {
      alert('프로젝트를 선택해주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const site = sites.find((s) => s.id === form.siteId);
      const supplier = suppliers.find((s) => s.id === form.supplierId);
      const base = {
        title: form.title.trim(),
        siteId: form.siteId,
        siteName: site?.name || '',
        supplierId: form.supplierId || '',
        supplierName: supplier?.name || '',
        deliveryDue: form.deliveryDue.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
      };
      if (editingId) {
        const prev = purchases.find((x) => x.id === editingId);
        const prevBase = prev
          ? {
              title: prev.title || '',
              siteId: prev.siteId || '',
              siteName: prev.siteName || '',
              supplierId: prev.supplierId || '',
              supplierName: prev.supplierName || '',
              deliveryDue: prev.deliveryDue || '',
              contactName: prev.contactName || '',
              contactPhone: prev.contactPhone || '',
            }
          : null;
        await updatePurchase(editingId, base);
        setPurchases((prev2) => prev2.map((x) => (x.id === editingId ? { ...x, ...base } : x)));
        setFormModal(false);
        if (prevBase) {
          const targetId = editingId;
          pushUndo(`구매 "${base.title}" 수정`, async () => {
            await updatePurchase(targetId, prevBase);
            setPurchases((prev2) => prev2.map((x) => (x.id === targetId ? { ...x, ...prevBase } : x)));
          });
        }
      } else {
        const ref = await addPurchase({
          ...base,
          items: [],
          totalAmount: 0,
          requesterId: userProfile?.uid || '',
          requesterName: userProfile?.name || '',
        });
        if (form.siteId !== recentSiteId) {
          await setHqSite(form.siteId, site?.name || '');
          setRecentSiteId(form.siteId);
        }
        pushUndo(`구매 "${base.title}" 추가`, async () => {
          await trashPurchase(ref.id, userProfile?.name || '');
          await deletePurchase(ref.id);
        });
        setFormModal(false);
        navigate(`/admin/purchase/${ref.id}`);
      }
    } catch (err) {
      alert((editingId ? '수정' : '등록') + ' 중 오류: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function openFactoryModal() {
    setFactoryForm(factories.map((f) => ({ ...f })));
    setFactoryModalOpen(true);
  }

  async function handleSaveFactories() {
    try {
      const cleaned = factoryForm.filter((f) => f.name.trim());
      await saveFactories(cleaned);
      setFactories(cleaned);
      setFactoryModalOpen(false);
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  }

  async function handleDelete(e, p) {
    e.stopPropagation();
    if (!(await confirm(`"${p.title}" 구매 건을 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`))) return;
    try {
      const tid = await trashPurchase(p.id, userProfile?.name || '');
      await deletePurchase(p.id);
      setPurchases((prev) => prev.filter((x) => x.id !== p.id));
      if (tid) pushUndo(`구매 "${p.title}" 삭제`, async () => {
        await restoreTrashItem(tid);
        const ps = await getPurchases();
        setPurchases(ps);
      });
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  const dragEnabled = tab === 'all' && !search.trim();

  async function handleReorder(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = filtered.map((p) => p.id);
    const oldIndex = ids.indexOf(active.id);
    const newIndex = ids.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrderIds = arrayMove(ids, oldIndex, newIndex);
    // 전체 목록 order 재계산 — 화면 순서대로 0..n
    const orderMap = new Map(newOrderIds.map((id, idx) => [id, idx]));
    setPurchases((prev) => prev.map((p) => (orderMap.has(p.id) ? { ...p, order: orderMap.get(p.id) } : p)));
    try {
      await savePurchasesOrder(newOrderIds);
    } catch (err) {
      alert('순서 저장 오류: ' + err.message);
    }
  }

  // 칸반: 상태 열로 드래그 → 확인 후 상태 변경 (실수/오배치 방지)
  async function handleBoardDrag(e) {
    const { active, over } = e;
    if (!over) return;
    const cardId = active.id;
    const newStatus = over.id;
    const card = purchases.find((p) => p.id === cardId);
    if (!card || !BOARD_COLS.some((c) => c.key === newStatus) || (card.status || 'ordered') === newStatus) return;
    const oldLabel = STATUS[card.status || 'ordered']?.label || card.status;
    const newLabel = STATUS[newStatus]?.label || newStatus;
    const ok = await confirm({
      title: '상태 변경',
      message:
        `"${card.title}"\n상태를 [${oldLabel}] → [${newLabel}] 로 변경할까요?\n\n` +
        '※ 실제 입고·정산 수량 내역은 상세 페이지에서 관리됩니다. 보드 상태는 관리용 표시입니다.',
    });
    if (!ok) return; // 취소 시 카드는 원래 열에 그대로 (상태 변경 안 함)
    setPurchases((prev) => prev.map((p) => (p.id === cardId ? { ...p, status: newStatus } : p)));
    try {
      await setPurchaseStatus(cardId, newStatus);
    } catch (err) {
      alert('상태 변경 오류: ' + err.message);
      // 실패 시 원복
      setPurchases((prev) => prev.map((p) => (p.id === cardId ? { ...p, status: card.status } : p)));
    }
  }
  // 보드용: 검색만 적용 후 상태별 그룹
  const boardSource = purchases.filter((p) => {
    const kw = search.trim().toLowerCase();
    if (!kw) return true;
    return [p.title, p.supplierName, p.siteName, p.requesterName].some((v) => (v || '').toLowerCase().includes(kw));
  });
  const boardGroups = BOARD_COLS.map((col) => ({
    col,
    cards: boardSource.filter((p) => (p.status || 'ordered') === col.key),
  }));

  if (loading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="purchase-list-page printable-page">
      <div className="page-header">
        <h2>구매 · 발주 현황</h2>
        <div className="page-actions no-print">
          <button type="button" className="btn btn-sm btn-outline" onClick={openFactoryModal}>
            공장 관리
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setTrashOpen(true)}
          >
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            구매 등록
          </button>
        </div>
      </div>

      <button
        type="button"
        className="pdf-print-fab no-print"
        onClick={() => window.print()}
        title="PDF로 저장하려면 인쇄 다이얼로그에서 'PDF로 저장'을 선택하세요"
      >
        PDF 출력
      </button>

      {viewMode === 'list' && (
        <div className="tab-nav closing-tab-nav no-print">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`tab-nav-item ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {counts[t.key] > 0 && <span className="tab-nav-count">{counts[t.key]}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="purchase-filters no-print">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="제목 · 구매처 · 프로젝트 · 등록자 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div
          className="tab-nav"
          role="tablist"
          aria-label="보기 전환"
          style={{ marginBottom: 0, flex: '0 0 auto', width: 'auto', maxWidth: 'none' }}
        >
          <button
            type="button"
            className={`tab-nav-item ${viewMode === 'board' ? 'active' : ''}`}
            onClick={() => setViewMode('board')}
          >
            보드
          </button>
          <button
            type="button"
            className={`tab-nav-item ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            목록
          </button>
        </div>
      </div>

      {viewMode === 'board' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleBoardDrag}>
          <style>{`
            /* 발주 보드: 769px 이상에서 5개 컬럼을 한 줄로 (홈 칸반엔 영향 없음) */
            @media (min-width: 769px) {
              .purchase-list-page .kb-board {
                grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
                grid-auto-flow: unset !important;
                grid-auto-columns: unset !important;
                overflow-x: unset !important;
                scroll-snap-type: unset !important;
                padding-bottom: 0 !important;
                gap: 5px !important;
              }
              .purchase-list-page .kb-col { padding: 3px !important; }
              .purchase-list-page .kb-col__head { padding: 5px 6px 8px !important; }
              .purchase-list-page .kb-card { padding: 7px !important; }
            }
            @media (max-width: 320px) { .kb-board { grid-template-columns: 1fr !important; overflow-x: auto; } }
            @media (max-width: 430px) { .kb-board { grid-template-columns: 1fr !important; } }
            @media (max-width: 768px) { .kb-board { grid-template-columns: 1fr !important; } }
            .po-card { gap: 4px; width: 100%; box-sizing: border-box; }
            .po-card__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .po-card__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .po-card__by { overflow: hidden; text-overflow: ellipsis; word-break: break-word; white-space: normal; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; min-width: 0; }
            .po-card__actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: stretch; min-height: 36px; }
            .po-card__actions .btn { min-height: 36px; flex: 1 1 auto; }
            @media (max-width: 430px) { .po-card { padding: 6px !important; } .po-card-list { gap: 2px !important; } }
            @media (max-width: 360px) { .po-card { padding: 6px !important; gap: 3px !important; } .po-card-list { gap: 2px !important; } }
            .kb-card__title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .kb-card__meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .kb-card__actions { display: flex; gap: 4px; align-items: center; }
            .kb-card__actions .btn { min-height: 36px; }
            .kb-col__head { background: var(--navy, #002050); color: var(--text-sidebar, #fff); }
            @media (max-width: 480px) { .field-hint { font-size: 12px; margin-top: 4px; } }
          `}</style>
          <div className="table-scroll-x no-print">
            <div className="kb-board">
              {boardGroups.map(({ col, cards }) => (
                <KanbanColumn
                  key={col.key}
                  col={col}
                  cards={cards}
                  onOpen={(pp) => navigate(`/admin/purchase/${pp.id}`)}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : filtered.length === 0 ? (
        <p className="purchase-empty">
          {purchases.length === 0 ? '등록된 구매 건이 없습니다.' : '해당 조건의 구매 건이 없습니다.'}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorder}>
          <SortableContext items={filtered.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            <div className="po-card-list">
              {filtered.map((p) => (
                <SortablePurchaseCard
                  key={p.id}
                  p={p}
                  dragEnabled={dragEnabled}
                  onOpen={(pp) => navigate(`/admin/purchase/${pp.id}`)}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {dragEnabled && filtered.length > 1 && (
        <p className="field-hint no-print" style={{ marginTop: 8, fontSize: '12px' }}>
          핸들을 끌어 순서를 변경할 수 있습니다.
        </p>
      )}

      <Modal isOpen={formModal} onClose={() => setFormModal(false)} title={editingId ? '구매 수정' : '구매 등록'}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>제목 *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>프로젝트 *</label>
            <Select
              value={form.siteId}
              onChange={(v) => setForm({ ...form, siteId: v })}
              options={sites
                .filter((s) => (s.status || 'active') !== 'completed')
                .map((s) => ({ value: s.id, label: s.name }))}
              placeholder="선택"
              ariaLabel="프로젝트 선택"
            />
            <p className="field-hint">최근 선택한 프로젝트가 다음 등록 시 자동 입력됩니다.</p>
          </div>

          <div className="form-group">
            <label>구매처</label>
            <Select
              value={form.supplierId}
              onChange={(v) => setForm({ ...form, supplierId: v })}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="선택 (미지정 시 첫 품목 기본 구매처 자동 적용)"
              ariaLabel="구매처 선택"
            />
          </div>

          <div className="form-group">
            <label>납기 (납품기일)</label>
            <input
              type="text"
              value={form.deliveryDue}
              onChange={(e) => setForm({ ...form, deliveryDue: e.target.value })}
            />
            <p className="field-hint">날짜 또는 "협의·긴급" 등 자유 입력. 비워두면 발주서에 "긴급"으로 표시됩니다.</p>
          </div>

          <div className="form-group">
            <label>직원에서 불러오기</label>
            <Select
              value=""
              onChange={(v) => {
                const u = users.find((x) => x.id === v);
                if (u) setForm({ ...form, contactName: u.name || '', contactPhone: u.phone || '' });
              }}
              options={users.map((u) => ({
                value: u.id,
                label: `${u.name}${u.position ? ` · ${u.position}` : ''}${u.phone ? ` · ${u.phone}` : ''}`,
              }))}
              placeholder="직원 선택 (담당자·연락처 자동 입력)"
              ariaLabel="직원 선택"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>담당자</label>
              <input
                type="text"
                value={form.contactName}
                title={form.contactName || ''}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>연락처</label>
              <input
                type="text"
                value={form.contactPhone}
                onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
              />
            </div>
          </div>

          <p className="field-hint">
            {editingId
              ? '제목·프로젝트·납기·담당자 등 기본정보를 수정합니다. 품목·수량·단가는 상세 페이지에서 관리합니다.'
              : '등록 즉시 상세 페이지로 이동합니다. 거기서 품목·수량·단가를 추가하세요. 구매처는 첫 품목의 기본 구매처에서 자동 적용됩니다.'}
          </p>

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (editingId ? '저장 중...' : '등록 중...') : editingId ? '수정 저장' : '등록하고 품목 추가'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setFormModal(false)} disabled={submitting}>
              취소
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={factoryModalOpen} onClose={() => setFactoryModalOpen(false)} title="공장 관리">
        <p className="field-hint">
          납품 장소 프리셋을 설정합니다. 발주서에서 공장을 선택하면 주소가 자동 입력됩니다.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {factoryForm.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="공장명 (예: 1공장)"
                value={f.name}
                onChange={(e) =>
                  setFactoryForm((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                style={{ width: 100, flexShrink: 0 }}
              />
              <input
                type="text"
                placeholder="주소"
                value={f.address}
                onChange={(e) =>
                  setFactoryForm((prev) => prev.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))
                }
                style={{ flex: 1, minWidth: 120 }}
              />
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => setFactoryForm((prev) => prev.filter((_, j) => j !== i))}
              >
                삭제
              </button>
            </div>
          ))}
          {factoryForm.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13 }}>등록된 공장이 없습니다.</p>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => setFactoryForm((prev) => [...prev, { name: '', address: '' }])}
        >
          <Icon name="plus" className="btn-ic" />
          공장 추가
        </button>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={handleSaveFactories}>
            저장
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setFactoryModalOpen(false)}>
            취소
          </button>
        </div>
      </Modal>

      <TrashModal
        isOpen={trashOpen}
        onClose={() => setTrashOpen(false)}
        types={['purchase']}
        title="구매·발주 휴지통"
        onChange={() => {}}
      />
    </div>
  );
}
