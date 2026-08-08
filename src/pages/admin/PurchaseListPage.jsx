import { useState, useEffect, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getPurchases,
  addPurchase,
  setPurchaseStatus,
  getPurchaseConfig,
  deletePurchase,
  releasePurchaseStock,
  updatePurchase,
  getSuppliers,
  saveFactories,
  subscribePurchaseConfig,
  addPurchaseNote,
  updatePurchaseNote,
  removePurchaseNote,
} from '../../services/purchaseService';
import { trashPurchase, restoreTrashItem } from '../../services/trashService';
import { getAllSites } from '../../services/siteService';
import { getUsers } from '../../services/userService';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { useUndo } from '../../contexts/useUndo';
import Modal from '../../components/common/Modal';
import TrashModal from '../../components/common/TrashModal';
import Select from '../../components/common/Select';
import Icon from '../../components/common/Icon';
import Skeleton from '../../components/common/Skeleton';
import RegenOrderPdfModal from '../../components/admin/RegenOrderPdfModal';
import RegenOrderPdfRunner from '../../components/admin/RegenOrderPdfRunner';

const STATUS = {
  draft: { label: '발주대기', cls: 'draft' },
  ordered: { label: '발주완료', cls: 'ordered' },
  replied: { label: '회신', cls: 'replied' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
  closed: { label: '종결', cls: 'closed' },
};

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'draft', label: '발주대기' },
  { key: 'ordered', label: '발주완료' },
  { key: 'replied', label: '회신' },
  { key: 'partial', label: '부분입고' },
  { key: 'received', label: '입고완료' },
  { key: 'settled', label: '정산완료' },
];

const EMPTY_FORM = {
  title: '',
  subtitle: '',
  siteId: '',
  supplierId: '',
  deliveryDue: '',
  contactName: '',
  contactPhone: '',
  factoryKey: '',
  deliveryPlace: '',
};

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 발주 건의 품목 수 + 개별 수량 합계
function itemStats(p) {
  const items = Array.isArray(p.items) ? p.items : [];
  const qty = items.reduce((s, x) => s + (Number(x.qty) || 0), 0);
  return { count: items.length, qty };
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
      {p.subtitle && (
        <div className="po-card__subtitle u-ellipsis-1" title={p.subtitle}>
          {p.subtitle}
        </div>
      )}
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
        <span className="po-card__amount" style={{ color: 'var(--accent)' }}>
          {Number(p.totalAmount || 0).toLocaleString()}
          <em>원</em>
        </span>
      </div>
      <div className="po-card__amount-vat">
        <span>부가세 포함</span>
        {Math.round(Number(p.totalAmount || 0) * 1.1).toLocaleString()}원
      </div>
      <div className="po-card__foot">
        <div className="po-card__dates">
          <span>작성일: {fmtDate(p.createdAt || p.orderedAt)}</span>
          <span>납기: {p.deliveryDue || '-'}</span>
        </div>
        <div className="po-card__actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onEdit(e, p)}>
            수정
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>
            <Icon name="trash" className="btn-ic" />
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== 칸반 보드 (상태 열로 드래그하면 상태 변경) =====
const BOARD_COLS = [
  { key: 'draft', label: '발주대기' },
  { key: 'ordered', label: '발주완료' },
  { key: 'replied', label: '회신' },
  { key: 'partial', label: '부분입고' },
  { key: 'received', label: '입고완료' },
  { key: 'settled', label: '정산완료' },
];

function KanbanCard({ p, onOpen, onEdit, onDelete, onClose }) {
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
      {p.subtitle && (
        <div className="kb-card__subtitle u-ellipsis-1" title={p.subtitle}>
          {p.subtitle}
        </div>
      )}
      <div
        className="kb-card__meta u-ellipsis-1"
        title={`${p.siteName || '프로젝트 미지정'}${p.supplierName ? ` · ${p.supplierName}` : ''}`}
      >
        {p.siteName || '프로젝트 미지정'}
        {p.supplierName ? ` · ${p.supplierName}` : ''}
      </div>
      <div className="kb-card__items">
        품목 {itemStats(p).count} · 수량 {itemStats(p).qty}
      </div>
      <div className="kb-card__amount" style={{ color: 'var(--accent)' }}>
        {Number(p.totalAmount || 0).toLocaleString()}
        <em>원</em>
      </div>
      <div className="kb-card__amount-vat">
        <span>부가세 포함</span>
        {Math.round(Number(p.totalAmount || 0) * 1.1).toLocaleString()}원
      </div>
      <div className="kb-card__foot">
        <div className="kb-card__dates">
          <span>작성일: {fmtDate(p.createdAt || p.orderedAt)}</span>
          <span>납기: {p.deliveryDue || '-'}</span>
        </div>
        <div className="kb-card__actions" onClick={(e) => e.stopPropagation()}>
          {p.status === 'settled' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onClose(e, p)}>
              종결
            </button>
          )}
          <button type="button" className="btn btn-sm btn-outline" onClick={(e) => onEdit(e, p)}>
            수정
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={(e) => onDelete(e, p)}>
            <Icon name="trash" className="btn-ic" />
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({ col, cards, onOpen, onEdit, onDelete, onClose }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });
  return (
    <div ref={setNodeRef} className={`kb-col ${isOver ? 'is-over' : ''}`}>
      <div className="kb-col__head">
        <span className={`purchase-badge purchase-badge-${col.key}`}>{col.label}</span>
        <span className="kb-col__count">{cards.length}</span>
      </div>
      <div className="kb-col__body">
        {cards.map((p) => (
          <KanbanCard key={p.id} p={p} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} onClose={onClose} />
        ))}
        {cards.length === 0 && <div className="kb-col__empty">여기로 카드를 끌어다 놓으세요</div>}
      </div>
    </div>
  );
}

export default function PurchaseListPage() {
  const { userProfile } = useAuth();
  const { alert, confirm, toast } = useDialog();
  const { push: pushUndo } = useUndo();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const navigate = useNavigate();

  const [trashOpen, setTrashOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTask, setRegenTask] = useState(null); // 백그라운드 재생성 잡 { jobs, suppliers, sites, itemMaster }
  const [purchases, setPurchases] = useState([]);
  const [sites, setSites] = useState([]);
  const [users, setUsers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [, setRecentSiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('board'); // 기본: 칸반(보드). '목록'(표)은 토글로 선택
  const [factories, setFactories] = useState([]);
  const [factoryModalOpen, setFactoryModalOpen] = useState(false);
  const [factoryForm, setFactoryForm] = useState([]);

  const [formModal, setFormModal] = useState(false);
  const [editingId, setEditingId] = useState(null); // null=등록, id=수정
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 참고 사항 — 한 건씩 개별 등록/삭제 (전 관리자 공유, notes 배열)
  const [notes, setNotes] = useState([]);
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteEditId, setNoteEditId] = useState(null); // null 이면 새로 추가, 아니면 그 건 수정

  useEffect(() => {
    loadData();
    const unsub = subscribePurchaseConfig((cfg) => {
      // 배열(notes) 우선, 과거 단일 메모(commonNote)는 1건으로 하위호환 표시
      if (Array.isArray(cfg.notes)) setNotes(cfg.notes);
      else if (cfg.commonNote?.text)
        setNotes([
          {
            id: 'legacy',
            text: cfg.commonNote.text,
            byName: cfg.commonNote.updatedByName,
            at: cfg.commonNote.updatedAt,
          },
        ]);
      else setNotes([]);
    });
    return () => unsub();
  }, []);

  async function saveNote() {
    if (noteSaving || !noteDraft.trim()) return;
    setNoteSaving(true);
    const editing = noteEditId;
    try {
      if (editing) await updatePurchaseNote(editing, noteDraft, userProfile?.name || '');
      else await addPurchaseNote(noteDraft, userProfile?.name || '');
      setNoteDraft('');
      setNoteEditId(null);
      setNoteModalOpen(false);
      toast(editing ? '참고 사항을 수정했습니다.' : '참고 사항을 추가했습니다.', 'success', 0);
    } catch {
      toast(editing ? '수정 중 오류가 발생했습니다.' : '추가 중 오류가 발생했습니다.', 'error', 0);
    } finally {
      setNoteSaving(false);
    }
  }
  const openNoteModal = (note = null) => {
    setNoteEditId(note?.id || null);
    setNoteDraft(note?.text || '');
    setNoteModalOpen(true);
  };
  async function deleteNote(id) {
    if (!(await confirm('이 참고 사항을 삭제할까요?'))) return;
    try {
      await removePurchaseNote(id);
      toast('삭제했습니다.');
    } catch {
      toast('삭제 중 오류가 발생했습니다.', 'error', 0);
    }
  }

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
      // 아는 상태는 STATUS 정의가 유일한 기준이다. 여기에 목록을 또 적어두면
      // 상태를 새로 만들 때마다 그 건들이 '모르는 값'으로 몰려 ordered 로 되돌아간다.
      const legacy = p.filter((x) => !STATUS[x.status]);
      if (legacy.length > 0) {
        await Promise.all(legacy.map((x) => setPurchaseStatus(x.id, 'ordered')));
        legacy.forEach((x) => {
          x.status = 'ordered';
        });
      }
      // siteId는 있는데 siteName이 비어 "프로젝트 미지정"으로 보이던 발주 — siteId로 프로젝트명 보정
      const siteById = Object.fromEntries(st.map((s) => [s.id, s.name]));
      const patched = p.map((x) =>
        !x.siteName && x.siteId && siteById[x.siteId] ? { ...x, siteName: siteById[x.siteId] } : x,
      );
      setPurchases(patched);
      setSites(st);
      setRecentSiteId(cfg.hqSiteId || '');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // 종결 건은 진행 화면에서 빠진다. 세는 것도 보는 것도 이 목록이 기준.
  const openPurchases = useMemo(() => purchases.filter((p) => p.status !== 'closed'), [purchases]);

  const counts = useMemo(() => {
    const c = { all: openPurchases.length };
    for (const p of openPurchases) c[p.status] = (c[p.status] || 0) + 1;
    c.printed = openPurchases.filter((p) => Number(p.printCount) > 0).length;
    return c;
  }, [openPurchases]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    const list = openPurchases.filter((p) => {
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
  }, [openPurchases, tab, search]);

  function openCreate() {
    setEditingId(null);
    // 납품 공장 기본값: '본사'가 있으면 자동 선택 + 주소 채움
    const hq = factories.find((f) => f.name === '본사') || factories[0];
    setForm({ ...EMPTY_FORM, factoryKey: hq?.name || '', deliveryPlace: hq?.address || '' });
    setFormModal(true);
  }

  function openEdit(e, p) {
    e.stopPropagation();
    setEditingId(p.id);
    setForm({
      title: p.title || '',
      subtitle: p.subtitle || '',
      siteId: p.siteId || '',
      supplierId: p.supplierId || '',
      deliveryDue: p.deliveryDue || '',
      contactName: p.contactName || '',
      contactPhone: p.contactPhone || '',
      factoryKey: p.factoryKey || '',
      deliveryPlace: p.deliveryPlace || '',
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
        subtitle: form.subtitle.trim(),
        siteId: form.siteId,
        siteName: site?.name || '',
        supplierId: form.supplierId || '',
        supplierName: supplier?.name || '',
        deliveryDue: form.deliveryDue.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        factoryKey: form.factoryKey || '',
        deliveryPlace: (form.deliveryPlace || '').trim(),
      };
      if (editingId) {
        const prev = purchases.find((x) => x.id === editingId);
        const prevBase = prev
          ? {
              title: prev.title || '',
              subtitle: prev.subtitle || '',
              siteId: prev.siteId || '',
              siteName: prev.siteName || '',
              supplierId: prev.supplierId || '',
              supplierName: prev.supplierName || '',
              deliveryDue: prev.deliveryDue || '',
              contactName: prev.contactName || '',
              contactPhone: prev.contactPhone || '',
              factoryKey: prev.factoryKey || '',
              deliveryPlace: prev.deliveryPlace || '',
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
        pushUndo(`구매 "${base.title}" 추가`, async () => {
          await trashPurchase(ref.id, userProfile?.name || '');
          await deletePurchase(ref.id);
        });
        setFormModal(false);
        navigate(`/admin/purchase/${ref.id}`);
      }
    } catch {
      toast((editingId ? '수정' : '등록') + ' 중 오류가 발생했습니다', 'error');
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
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleDelete(e, p) {
    e.stopPropagation();
    if (!(await confirm(`"${p.title}" 구매 건을 삭제하시겠습니까?\n(휴지통에서 복원할 수 있습니다)`))) return;
    try {
      const tid = await trashPurchase(p.id, userProfile?.name || '');
      await deletePurchase(p.id);
      // 발주서가 쥐고 있던 재고를 창고로 돌려준다
      await releasePurchaseStock(p.items || [], {
        byName: userProfile?.name || '',
        note: `발주 삭제로 되돌림 · ${p.title || ''}`,
      });
      setPurchases((prev) => prev.filter((x) => x.id !== p.id));
      if (tid)
        pushUndo(`구매 "${p.title}" 삭제`, async () => {
          await restoreTrashItem(tid);
          await releasePurchaseStock(p.items || [], {
            byName: userProfile?.name || '',
            note: `발주 복원 · ${p.title || ''}`,
            back: false,
          });
          const ps = await getPurchases();
          setPurchases(ps);
        });
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  const dragEnabled = tab === 'all' && !search.trim();

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
    } catch {
      toast('상태 변경 중 오류가 발생했습니다', 'error');
      // 실패 시 원복
      setPurchases((prev) => prev.map((p) => (p.id === cardId ? { ...p, status: card.status } : p)));
    }
  }
  async function handleClose(e, p) {
    e.stopPropagation();
    const ok = await confirm({
      title: '발주 종결',
      message: `"${p.title}"

종결하면 보드에서 빠지고 종결 목록으로 옮겨집니다.
삭제가 아니므로 종결 목록에서 언제든 되돌릴 수 있습니다.`,
    });
    if (!ok) return;
    setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'closed' } : x)));
    try {
      await setPurchaseStatus(p.id, 'closed', { closedAt: new Date() });
    } catch {
      toast('종결 처리 중 오류가 발생했습니다', 'error');
      setPurchases((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: p.status } : x)));
    }
  }

  // 보드용: 검색만 적용 후 상태별 그룹
  const boardSource = openPurchases.filter((p) => {
    const kw = search.trim().toLowerCase();
    if (!kw) return true;
    return [p.title, p.supplierName, p.siteName, p.requesterName].some((v) => (v || '').toLowerCase().includes(kw));
  });
  const boardGroups = BOARD_COLS.map((col) => ({
    col,
    cards: boardSource.filter((p) => (p.status || 'ordered') === col.key),
  }));

  if (loading) return <Skeleton.Rows count={6} />;

  return (
    <div className="purchase-list-page printable-page">
      <div className="page-header">
        <h2>구매 · 발주 현황</h2>
        <div className="page-actions no-print">
          <button type="button" className="btn btn-sm btn-outline" onClick={openFactoryModal}>
            공장 관리
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setTrashOpen(true)}>
            <Icon name="trash" className="btn-ic" />
            휴지통
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setRegenOpen(true)}
            title="자료실 발주이력에 저장된 발주서를 현재 내부용 양식(계좌+현장명)으로 일괄 재생성합니다"
          >
            <Icon name="archive" className="btn-ic" />
            저장본 일괄 재생성
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
            <Icon name="plus" className="btn-ic" />
            구매 등록
          </button>
        </div>
      </div>

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

      {/* 참고 사항 — 한 건씩 개별 등록/삭제 (상단 고정, 전 관리자 공유) */}
      <div className="pur-note-card no-print">
        <div className="pur-note-head">
          <span className="pur-note-title">
            <Icon name="alert" className="btn-ic" />
            참고 사항
          </span>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => openNoteModal()}>
            <Icon name="plus" className="btn-ic" />
            추가
          </button>
        </div>
        {notes.length > 0 ? (
          <ul className="pur-note-list">
            {notes.map((n) => (
              <li key={n.id} className="pur-note-item">
                <span className="pur-note-dot" aria-hidden="true" />
                <div className="pur-note-item-body">
                  <p className="pur-note-text">{n.text}</p>
                  {n.byName && (
                    <p className="pur-note-meta">
                      {n.byName}
                      {n.at ? ` · ${fmtDate(n.at)}` : ''}
                    </p>
                  )}
                </div>
                {n.id !== 'legacy' && (
                  <button
                    type="button"
                    className="pur-note-edit"
                    onClick={() => openNoteModal(n)}
                    aria-label="수정"
                    title="수정"
                  >
                    <Icon name="edit" />
                  </button>
                )}
                <button
                  type="button"
                  className="pur-note-del"
                  onClick={() => deleteNote(n.id)}
                  aria-label="삭제"
                  title="삭제"
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pur-note-empty">등록된 참고 사항이 없습니다. "추가"로 한 건씩 등록하세요.</p>
        )}
      </div>

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
            /* 발주 보드: 769px 이상에서 6개 컬럼을 한 줄로 (홈 칸반엔 영향 없음) */
            @media (min-width: 769px) {
              .purchase-list-page .kb-board {
                grid-template-columns: repeat(6, minmax(0, 1fr)) !important;
                grid-auto-flow: unset !important;
                grid-auto-columns: unset !important;
                overflow-x: unset !important;
                scroll-snap-type: unset !important;
                padding-bottom: 0 !important;
                gap: 8px !important;
              }
              .purchase-list-page .kb-col { padding: 5px !important; }
              .purchase-list-page .kb-col__head { padding: 7px 9px 9px !important; }
              .purchase-list-page .kb-card { padding: 11px !important; }
            }
            @media (max-width: 320px) { .kb-board { grid-template-columns: 1fr !important; overflow-x: auto; } }
            @media (max-width: 430px) { .kb-board { grid-template-columns: 1fr !important; } }
            @media (max-width: 768px) { .kb-board { grid-template-columns: 1fr !important; } }
            .po-card { gap: 5px; width: 100%; box-sizing: border-box; padding: 14px; }
            .po-card__title { font-size: 15px; font-weight: 700; line-height: 1.35; color: var(--text, #1a1a1a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .po-card__subtitle, .kb-card__subtitle { font-size: 12px; font-weight: 400; color: var(--text-secondary, #8a94a6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .po-card__meta { font-size: 12px; color: var(--text-secondary, #8a94a6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .po-card__by { overflow: hidden; text-overflow: ellipsis; word-break: break-word; white-space: normal; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; min-width: 0; }
            .po-card__actions { display: flex; flex-wrap: nowrap; gap: 4px; align-items: center; flex-shrink: 0; }
            .po-card__actions .btn { min-height: 32px; white-space: nowrap; }
            @media (max-width: 430px) { .po-card { padding: 6px !important; } .po-card-list { gap: 2px !important; } }
            @media (max-width: 360px) { .po-card { padding: 6px !important; gap: 3px !important; } .po-card-list { gap: 2px !important; } }
            .kb-card__title { font-size: 14px; font-weight: 700; line-height: 1.35; color: var(--text, #1a1a1a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .kb-card__meta { font-size: 12px; color: var(--text-secondary, #8a94a6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .kb-card__actions { display: flex; gap: 4px; align-items: center; flex-shrink: 0; flex-wrap: nowrap; }
            .kb-card__actions .btn { min-height: 32px; white-space: nowrap; }
            .kb-col__head { background: var(--navy, #002050); color: var(--text-sidebar, #fff); border-radius: 11px 11px 0 0; }
            /* ── 발주 보드 카드 소폭 개선 (발주 화면 한정) ── */
            .purchase-list-page .kb-col { background: var(--canvas, #f2f4f6); border-radius: 0 0 11px 11px; }
            .purchase-list-page .kb-card { background: #fff; border: 1px solid var(--border, #e5e8eb); border-radius: 13px; box-shadow: 0 1px 3px rgba(0,23,51,0.04); transition: box-shadow .15s ease, transform .15s ease; }
            .purchase-list-page .kb-card:hover { box-shadow: 0 8px 20px rgba(0,23,51,0.10); transform: translateY(-1px); }
            .purchase-list-page .kb-card__title { color: var(--primary, #002050); }
            .purchase-list-page .kb-card { display: flex; flex-direction: column; gap: 4px; }
            .purchase-list-page .kb-card__title { font-size: 14px; line-height: 1.3; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
            .purchase-list-page .kb-card__meta { font-size: 12px; color: var(--muted, #8b95a1); }
            .purchase-list-page .kb-card__items { align-self: flex-start; font-size: 11px; color: var(--slate, #4e5968); background: var(--canvas, #f2f4f6); border-radius: var(--radius-sm); padding: 2px 7px; margin: 1px 0; }
            .purchase-list-page .kb-card__amount { font-size: 16px; font-weight: 800; color: var(--safety-orange, #f05819); line-height: 1.1; }
            .purchase-list-page .kb-card__amount em { font-weight: 700; font-size: 12px; margin-left: 2px; font-style: normal; }
            .purchase-list-page .kb-card__amount-vat { font-size: 11px; color: var(--muted, #8b95a1); }
            .purchase-list-page .kb-card__dates { display: flex; flex-direction: column; gap: 1px; font-size: 11px; color: var(--muted, #8b95a1); }
            .purchase-list-page .kb-card__foot { margin-top: 3px; display: flex; align-items: flex-end; justify-content: space-between; gap: 6px; }
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
                  onClose={handleClose}
                />
              ))}
            </div>
          </div>
        </DndContext>
      ) : filtered.length === 0 ? (
        <p className="purchase-empty">
          {openPurchases.length === 0 ? '등록된 구매 건이 없습니다.' : '해당 조건의 구매 건이 없습니다.'}
        </p>
      ) : (
        <div className="table-scroll-x pur-table-wrap">
          <table className="table pur-table">
            <thead>
              <tr>
                <th className="pur-c-status">상태</th>
                <th className="pur-c-title">제목</th>
                <th className="pur-c-sup">구매처</th>
                <th className="pur-c-proj">프로젝트</th>
                <th className="pur-c-items">품목/수량</th>
                <th className="pur-c-amt">금액</th>
                <th className="pur-c-vat">부가세 포함</th>
                <th className="pur-c-date">작성일</th>
                <th className="pur-c-date">납기</th>
                <th className="pur-c-act col-action">작업</th>
              </tr>
            </thead>
            <tbody>
              {BOARD_COLS.map((col) => {
                const rows = filtered.filter((p) => (p.status || 'ordered') === col.key);
                if (rows.length === 0) return null;
                return (
                  <Fragment key={col.key}>
                    <tr className="pur-group-row">
                      <td className="pur-group-cell" colSpan={10}>
                        {col.label}
                        <span className="pur-group-count">{rows.length}</span>
                      </td>
                    </tr>
                    {rows.map((p) => {
                      const st = STATUS[p.status] || { label: p.status, cls: 'ordered' };
                      const amt = Number(p.totalAmount || 0);
                      return (
                        <tr key={p.id} className="pur-row" onClick={() => navigate(`/admin/purchase/${p.id}`)}>
                          <td data-label="상태">
                            <span className={`purchase-badge purchase-badge-${st.cls}`}>{st.label}</span>
                          </td>
                          <td data-label="제목" className="pur-c-title">
                            <div className="pur-title u-ellipsis-1" title={p.title || ''}>
                              {p.title || '-'}
                            </div>
                            {p.subtitle && (
                              <div className="pur-sub u-ellipsis-1" title={p.subtitle}>
                                {p.subtitle}
                              </div>
                            )}
                          </td>
                          <td data-label="구매처" className="pur-c-sup u-ellipsis-1" title={p.supplierName || ''}>
                            {p.supplierName || '-'}
                          </td>
                          <td data-label="프로젝트" className="pur-c-proj u-ellipsis-1" title={p.siteName || ''}>
                            {p.siteName || '프로젝트 미지정'}
                          </td>
                          <td data-label="품목/수량" className="pur-c-items pur-items">
                            품목 {itemStats(p).count} · 수량 {itemStats(p).qty}
                          </td>
                          <td data-label="금액" className="pur-c-amt pur-amt">
                            {amt.toLocaleString()}원
                          </td>
                          <td data-label="부가세 포함" className="pur-c-vat pur-vat">
                            {Math.round(amt * 1.1).toLocaleString()}원
                          </td>
                          <td data-label="작성일" className="pur-c-date">
                            {fmtDate(p.createdAt || p.orderedAt)}
                          </td>
                          <td data-label="납기" className="pur-c-date">
                            {p.deliveryDue || '-'}
                          </td>
                          <td data-label="작업" className="pur-c-act col-action" onClick={(e) => e.stopPropagation()}>
                            <div className="row-actions">
                              {p.status === 'settled' && (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  onClick={(e) => handleClose(e, p)}
                                >
                                  종결
                                </button>
                              )}
                              <button type="button" className="btn btn-sm btn-outline" onClick={(e) => openEdit(e, p)}>
                                수정
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={(e) => handleDelete(e, p)}
                              >
                                <Icon name="trash" className="btn-ic" />
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
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
              placeholder="보안사항 기입 금지 (업체에 보여지는 제목)"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>부제 (내부용)</label>
            <input
              type="text"
              value={form.subtitle}
              onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
              placeholder="현장명 등 내부 식별용 — 업체 발송물에는 표시되지 않습니다"
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
            <label>납품 공장 (납품 위치)</label>
            {factories.length > 0 && (
              <Select
                value={form.factoryKey}
                onChange={(v) => {
                  const factory = factories.find((f) => f.name === v);
                  setForm((prev) => ({
                    ...prev,
                    factoryKey: v,
                    deliveryPlace: factory?.address || prev.deliveryPlace,
                  }));
                }}
                options={factories.map((f) => ({ value: f.name, label: f.name }))}
                placeholder="선택"
                ariaLabel="납품 공장 선택"
              />
            )}
            <input
              type="text"
              value={form.deliveryPlace}
              onChange={(e) => setForm({ ...form, deliveryPlace: e.target.value })}
              placeholder="납품 장소 주소 (발주서에 표시)"
              style={{ marginTop: 8 }}
            />
            <p className="field-hint">공장을 선택하면 주소가 자동으로 채워집니다. 직접 수정도 가능합니다.</p>
          </div>

          <div className="form-group">
            <label>납기 (납품기일)</label>
            <input
              type="text"
              value={form.deliveryDue}
              onChange={(e) => setForm({ ...form, deliveryDue: e.target.value })}
            />
            <p className="field-hint">날짜 또는 "협의·긴급" 등 자유 입력. 비워두면 발주서에 "협의"로 표시됩니다.</p>
          </div>

          <div className="form-group">
            <label>직원에서 불러오기</label>
            <Select
              value=""
              onChange={(v) => {
                const u = users.find((x) => x.id === v);
                if (u) setForm({ ...form, contactName: u.name || '', contactPhone: u.phone || '' });
              }}
              options={users
                .filter((u) => u.isActive !== false)
                .map((u) => ({
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
            <button type="button" className="btn btn-outline" onClick={() => setFormModal(false)} disabled={submitting}>
              취소
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? (editingId ? '저장 중...' : '등록 중...') : editingId ? '수정 저장' : '등록하고 품목 추가'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={factoryModalOpen} onClose={() => setFactoryModalOpen(false)} title="공장 관리">
        <p className="field-hint">납품 장소 프리셋을 설정합니다. 발주서에서 공장을 선택하면 주소가 자동 입력됩니다.</p>
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
            <p className="text-muted" style={{ fontSize: 13 }}>
              등록된 공장이 없습니다.
            </p>
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
          <button type="button" className="btn btn-outline" onClick={() => setFactoryModalOpen(false)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSaveFactories}>
            저장
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={noteModalOpen}
        onClose={() => setNoteModalOpen(false)}
        title={noteEditId ? '참고 사항 수정' : '참고 사항 추가'}
      >
        <div className="form-group">
          <label>내용 (한 건씩 등록 · 이 페이지를 보는 관리자에게 공유)</label>
          <textarea
            className="pur-note-textarea"
            rows={4}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && noteDraft.trim()) saveNote();
            }}
            placeholder="예: 8월 발주건에 메티스부스바 WSG-00-405 2개 추가 구매"
            autoFocus
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setNoteModalOpen(false)}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={saveNote}
            disabled={noteSaving || !noteDraft.trim()}
          >
            {noteSaving ? '저장 중…' : noteEditId ? '수정' : '추가'}
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

      <RegenOrderPdfModal
        isOpen={regenOpen}
        onClose={() => setRegenOpen(false)}
        onStart={(payload) => setRegenTask(payload)}
        busy={!!regenTask}
      />
      <RegenOrderPdfRunner task={regenTask} onDone={() => setRegenTask(null)} />
    </div>
  );
}
