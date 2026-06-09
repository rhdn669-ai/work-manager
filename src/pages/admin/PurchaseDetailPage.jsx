import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getPurchaseById, updatePurchase, deletePurchase,
  settlePurchase, cancelSettlePurchase, receivePurchaseLine, bulkReceivePurchase,
  getSuppliers, getPurchaseItems, addPurchasePrintLog, getPurchasePrintLogs,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { getBomProjects, getBomBySite } from '../../services/bomService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';
import { specFontClass, effLen } from '../../utils/printText';

const STATUS = {
  ordered: { label: '발주', cls: 'ordered' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
};

const EMPTY_LINE = { itemId: '', name: '', spec: '', unit: '', qty: 1, unitPrice: 0 };

// 자사 정보 (IOPN_v4 양식 기준 — 발주서 PDF 상단 자사 박스에 표시)
const SELF_INFO = {
  companyAndCeo: '(주)아이오피엔 / 이종현',
  businessNumber: '222-81-36621',
  address: '충남 천안시 서북구 성환읍 율금1길 8-15',
  telFax: '041-415-0766 / 041-415-0767',
  email: 'iopn2024@naver.com',
  contact: '손성욱 / 010-7704-0331',
};
const PO_DEFAULTS = {
  validity: '협의',
  payment: '납품완료후 익월말',
  delivery: '긴급',
};
function poNumber(purchase) {
  const d = purchase.orderedAt?.toDate ? purchase.orderedAt.toDate() : (purchase.orderedAt ? new Date(purchase.orderedAt) : new Date(purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date()));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `IOPN${yyyy}${mm}${dd}`;
}

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 첫 품목의 defaultSupplierId 자동 추출 — 모두 같은 구매처면 그 값, 혼합/없음이면 빈값
function deriveSupplier(lines, itemMaster, suppliers) {
  const ids = lines
    .map((ln) => {
      const m = itemMaster.find((x) => x.id === ln.itemId);
      return m?.defaultSupplierId || '';
    })
    .filter(Boolean);
  if (ids.length === 0) return { supplierId: '', supplierName: '' };
  const unique = [...new Set(ids)];
  if (unique.length === 1) {
    const sup = suppliers.find((s) => s.id === unique[0]);
    return { supplierId: unique[0], supplierName: sup?.name || '' };
  }
  return { supplierId: '', supplierName: '' };
}

export default function PurchaseDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { confirm, alert } = useDialog();

  const [purchase, setPurchase] = useState(null);
  const [sites, setSites] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [loading, setLoading] = useState(true);

  // 편집 가능한 폼 상태 (실시간 자동 저장 — 저장 버튼 없음)
  const [form, setForm] = useState({
    title: '', siteId: '', items: [{ ...EMPTY_LINE }], note: '',
  });
  const [saveState, setSaveState] = useState('saved'); // 'saving' | 'saved' | 'error'

  const [receiveModal, setReceiveModal] = useState(null); // { lineIdx, line } | null
  const [receiveForm, setReceiveForm] = useState({ qty: '', date: todayStr(), note: '' });
  const [bulkModal, setBulkModal] = useState(null); // { mode: 'remaining' | 'close-as-is' } | null
  const [bulkForm, setBulkForm] = useState({ date: todayStr(), note: '' });

  // 출력 시 구매처별로 묶어서 정렬
  const [groupBySupplier, setGroupBySupplier] = useState(false);

  // BOM 가져오기
  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemPickerSearch, setItemPickerSearch] = useState('');
  const [itemPicked, setItemPicked] = useState(new Map()); // itemId -> 수량
  const [bomProjects, setBomProjects] = useState([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomImporting, setBomImporting] = useState(false);

  // 출력 이력(스냅샷)
  const [printLogsOpen, setPrintLogsOpen] = useState(false);
  const [printLogs, setPrintLogs] = useState([]);
  const [printLogsLoading, setPrintLogsLoading] = useState(false);
  const [viewSnapshot, setViewSnapshot] = useState(null); // 이력 보기 중인 스냅샷

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      const [p, st, sp, im] = await Promise.all([
        getPurchaseById(id), getAllSites(), getSuppliers(), getPurchaseItems(),
      ]);
      if (!p) {
        alert('해당 구매 건을 찾을 수 없습니다.');
        navigate('/admin/purchase');
        return;
      }
      setPurchase(p);
      setSites(st);
      setSuppliers(sp);
      setItemMaster(im);
      setForm({
        title: p.title || '',
        siteId: p.siteId || '',
        items: (p.items && p.items.length > 0)
          ? p.items.map((it) => ({ ...EMPTY_LINE, ...it }))
          : [{ ...EMPTY_LINE }],
        note: p.note || '',
      });
    } catch (err) {
      console.error(err);
      alert('불러오기 오류: ' + err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function patchForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
    scheduleAutoSave();
  }

  function updateLine(idx, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)),
    }));
    scheduleAutoSave();
  }

  function updateLineName(idx, name) {
    const trimmed = name;
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => {
        if (i !== idx) return ln;
        const m = itemMaster.find((x) => x.name === trimmed);
        if (m) {
          return {
            ...ln,
            itemId: m.id,
            name: m.name,
            spec: m.spec || ln.spec,
            unit: m.unit || ln.unit,
            unitPrice: Number(ln.unitPrice) > 0 ? ln.unitPrice : (Number(m.standardPrice) || 0),
          };
        }
        return { ...ln, itemId: '', name: trimmed };
      }),
    }));
    scheduleAutoSave();
  }


  // ---- 품목 불러오기 (BOM 상세 「품목 선택」 피커와 동일: 체크박스 다중선택 + 수량) ----
  function openItemPicker() {
    setItemPickerSearch('');
    setItemPicked(new Map());
    setItemPickerOpen(true);
  }
  function toggleItemPick(itemId) {
    setItemPicked((prev) => {
      const next = new Map(prev);
      if (next.has(itemId)) next.delete(itemId); else next.set(itemId, 1);
      return next;
    });
  }
  function setItemPickQty(itemId, value) {
    setItemPicked((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.set(itemId, value);
      return next;
    });
  }
  function addPickedToPO(e) {
    if (e) e.preventDefault();
    if (itemPicked.size === 0) { setItemPickerOpen(false); return; }
    const newLines = [];
    for (const [itemId, qtyInput] of itemPicked) {
      const m = itemMaster.find((x) => x.id === itemId);
      if (!m) continue;
      newLines.push({
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        qty: Number(qtyInput) || 0,
        unitPrice: Number(m.standardPrice) || 0,
      });
    }
    if (newLines.length === 0) { setItemPickerOpen(false); return; }
    setForm((f) => {
      const first = f.items[0];
      const onlyEmpty = f.items.length === 1 && !first?.name && !first?.itemId;
      return { ...f, items: onlyEmpty ? newLines : [...f.items, ...newLines] };
    });
    scheduleAutoSave();
    setItemPicked(new Map());
    setItemPickerOpen(false);
  }

  function removeLine(idx) {
    setForm((f) => ({
      ...f,
      items: f.items.length > 1 ? f.items.filter((_, i) => i !== idx) : f.items,
    }));
    scheduleAutoSave();
  }

  // BOM 가져오기 모달 열기 (프로젝트 목록 지연 로드)
  async function openBomModal() {
    setBomModalOpen(true);
    if (bomProjects.length === 0) {
      setBomLoading(true);
      try {
        const projs = await getBomProjects();
        setBomProjects(projs);
      } catch (err) {
        alert('BOM 목록 불러오기 오류: ' + err.message);
      } finally {
        setBomLoading(false);
      }
    }
  }

  // 선택한 BOM의 품목을 발주 라인으로 불러오기 (수량·단가는 그대로, 이후 수정 가능)
  async function importBom(bp) {
    setBomImporting(true);
    try {
      const items = await getBomBySite(bp.id);
      if (!items || items.length === 0) {
        alert('해당 BOM에 품목이 없습니다.');
        return;
      }
      const newLines = [...items]
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
        .map((b) => {
          const m = b.itemId ? itemMaster.find((x) => x.id === b.itemId) : null;
          return {
            ...EMPTY_LINE,
            itemId: b.itemId || '',
            name: m?.name || b.name || '',
            spec: m?.spec || b.spec || '',
            unit: m?.unit || b.unit || '',
            qty: Number(b.qty) || 1,
            unitPrice: (m && m.standardPrice != null) ? Number(m.standardPrice) : (Number(b.unitPrice) || 0),
            note: b.note || '',
          };
        });
      setForm((f) => {
        const existing = f.items.filter((ln) => (ln.name || '').trim()); // 빈 라인 제거 후 합치기
        return { ...f, items: [...existing, ...newLines] };
      });
      scheduleAutoSave();
      setBomModalOpen(false);
      alert(`"${bp.name}" BOM에서 ${newLines.length}개 품목을 가져왔습니다.\n수량·단가는 자동 저장됩니다.`);
    } catch (err) {
      alert('BOM 가져오기 오류: ' + err.message);
    } finally {
      setBomImporting(false);
    }
  }

  const formTotal = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );

  const isReadOnly = purchase?.status === 'settled';

  // ---- 실시간 자동 저장 (저장 버튼 없음) ----
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const purchaseRef = useRef(purchase); // 입고 액션에서 최신 purchase 참조용
  useEffect(() => { purchaseRef.current = purchase; }, [purchase]);
  const autoSaveRef = useRef(null);

  // 현재 폼을 Firestore에 저장 (입고/수정값 보존, 화면 리로드 없이 로컬 동기화)
  async function persistPO() {
    const f = formRef.current;
    if (!f || !f.title?.trim() || !f.siteId) return;
    if (purchase?.status === 'settled') return; // 정산완료는 잠금
    const lines = f.items.filter((ln) => (ln.name || '').trim());
    const items = lines.map((ln) => ({
      ...ln, // itemId·입고수량(receivedQty)·입고일 등 기존 필드 보존
      qty: Number(ln.qty) || 0,
      unitPrice: Number(ln.unitPrice) || 0,
      amount: (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0),
    }));
    const totalAmount = items.reduce((s, it) => s + it.amount, 0);
    const site = sites.find((s) => s.id === f.siteId);
    const { supplierId, supplierName } = deriveSupplier(items, itemMaster, suppliers);
    try {
      setSaveState('saving');
      await updatePurchase(id, {
        title: f.title.trim(), siteId: f.siteId, siteName: site?.name || '',
        items, totalAmount, supplierId, supplierName, note: f.note,
      });
      const updated = {
        ...(purchaseRef.current || {}),
        items, totalAmount, supplierId, supplierName, note: f.note,
        title: f.title.trim(), siteId: f.siteId, siteName: site?.name || '',
      };
      purchaseRef.current = updated; // 동기 갱신 → flush 직후 입고 액션이 최신 사용
      setPurchase(updated);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      console.error('자동 저장 오류:', err);
    }
  }

  function scheduleAutoSave() {
    setSaveState('saving');
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => { persistPO(); }, 700);
  }

  async function flushAutoSave() {
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); autoSaveRef.current = null; }
    await persistPO();
  }

  // 라인을 마스터와 매칭해 출력용 명칭·규격·구매처 부여
  function mapPrintItems(items) {
    return (items || []).map((ln) => {
      const mst = itemMaster.find((x) => x.id === ln.itemId);
      const sup = mst ? suppliers.find((s) => s.id === mst.defaultSupplierId) : null;
      return { ...ln, _supplier: sup?.name || '', _name: mst?.name || ln.name, _spec: mst?.spec || ln.spec };
    });
  }

  // 출력 시점 발주서 상태 스냅샷
  function buildPrintSnapshot() {
    const od = purchase.orderedAt?.toDate ? purchase.orderedAt.toDate()
      : (purchase.orderedAt ? new Date(purchase.orderedAt)
        : (purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date()));
    const supplier = suppliers.find((s) => s.id === purchase.supplierId);
    return {
      title: purchase.title || '',
      siteName: sites.find((s) => s.id === purchase.siteId)?.name || purchase.siteName || '',
      deliveryPlace: purchase.deliveryPlace || SELF_INFO.address,
      deliveryDue: purchase.deliveryDue || PO_DEFAULTS.delivery,
      payment: purchase.payment || PO_DEFAULTS.payment,
      contactName: purchase.contactName || purchase.requesterName || '',
      contactPhone: purchase.contactPhone || '',
      supplierName: supplier?.name || derivedSupplier || '',
      note: form.note || '',
      orderDateKo: `${od.getFullYear()}년 ${od.getMonth() + 1}월 ${od.getDate()}일`,
      poNumber: poNumber(purchase),
      groupBySupplier,
      items: mapPrintItems(form.items.filter((ln) => (ln.name || '').trim())).map((ln) => ({
        itemId: ln.itemId || '', _name: ln._name || '', _spec: ln._spec || '', _supplier: ln._supplier || '',
        qty: Number(ln.qty) || 0, unitPrice: Number(ln.unitPrice) || 0,
        receivedQty: Number(ln.receivedQty) || 0, note: ln.note || '',
      })),
    };
  }

  // 발주서 출력 이력 기록 (PDF 출력 시 — 스냅샷 저장 + 횟수 갱신)
  function recordPrint() {
    if (!id) return;
    const snapshot = buildPrintSnapshot();
    const next = {
      lastPrintedAt: new Date(),
      lastPrintedBy: userProfile?.name || '',
      printCount: (Number(purchaseRef.current?.printCount) || 0) + 1,
    };
    setPurchase((p) => ({ ...(p || {}), ...next }));
    purchaseRef.current = { ...(purchaseRef.current || {}), ...next };
    Promise.all([
      updatePurchase(id, next),
      addPurchasePrintLog(id, snapshot, userProfile?.name || ''),
    ]).catch((e) => console.error('출력 이력 저장 오류:', e));
  }

  async function openPrintLogs() {
    setPrintLogsOpen(true);
    setPrintLogsLoading(true);
    try {
      setPrintLogs(await getPurchasePrintLogs(id));
    } catch (err) {
      console.error(err);
    } finally {
      setPrintLogsLoading(false);
    }
  }

  // 이력 스냅샷을 그 시점 그대로 재출력
  function printSnapshot(log) {
    setPrintLogsOpen(false);
    setViewSnapshot(log.snapshot || null);
  }
  // viewSnapshot 렌더 완료 후 인쇄 → 라이브로 복원
  useEffect(() => {
    if (!viewSnapshot) return;
    const t = setTimeout(() => {
      window.print();
      setViewSnapshot(null);
    }, 180);
    return () => clearTimeout(t);
  }, [viewSnapshot]);

  // 페이지 이탈 시 미저장분 flush
  useEffect(() => () => {
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); persistPO(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openReceive(lineIdx) {
    await flushAutoSave();
    const line = purchaseRef.current?.items?.[lineIdx];
    if (!line) return;
    const remaining = Math.max(0, (Number(line.qty) || 0) - (Number(line.receivedQty) || 0));
    setReceiveForm({
      qty: remaining > 0 ? String(remaining) : String(Number(line.qty) || 0),
      date: line.receivedAt ? fmtDate(line.receivedAt) : todayStr(),
      note: line.receiveNote || '',
    });
    setReceiveModal({ lineIdx, line });
  }

  async function submitReceive(e) {
    e.preventDefault();
    if (!receiveModal) return;
    try {
      await receivePurchaseLine(purchaseRef.current, receiveModal.lineIdx, {
        qty: receiveForm.qty,
        date: receiveForm.date,
        note: receiveForm.note,
        receivedBy: userProfile?.name || '',
      });
      setReceiveModal(null);
      await loadData({ silent: true });
    } catch (err) {
      alert('입고 처리 중 오류: ' + err.message);
    }
  }

  async function openBulk(mode) {
    await flushAutoSave();
    setBulkForm({ date: todayStr(), note: '' });
    setBulkModal({ mode });
  }

  async function submitBulk(e) {
    e.preventDefault();
    if (!bulkModal) return;
    const mode = bulkModal.mode;
    const cur = purchaseRef.current || purchase;
    const remainingCount = (cur.items || []).filter((it) => {
      const r = Number(it.receivedQty) || 0;
      const q = Number(it.qty) || 0;
      return q > 0 && r < q;
    }).length;
    if (mode === 'remaining' && remainingCount === 0) {
      alert('잔여 입고할 라인이 없습니다.');
      return;
    }
    const msg = mode === 'close-as-is'
      ? '현재 입고된 수량으로 발주 수량을 정정하고 입고를 종결합니다.\n미입고 라인은 수량 0으로 처리됩니다. 계속할까요?'
      : `잔여 ${remainingCount}개 라인을 동일 입고일로 일괄 입고 처리하시겠습니까?`;
    if (!await confirm(msg)) return;
    try {
      await bulkReceivePurchase(purchaseRef.current, {
        mode,
        date: bulkForm.date,
        note: bulkForm.note,
        receivedBy: userProfile?.name || '',
      });
      setBulkModal(null);
      await loadData({ silent: true });
    } catch (err) {
      alert('일괄 입고 처리 중 오류: ' + err.message);
    }
  }

  async function clearLineReceive(lineIdx) {
    await flushAutoSave();
    if (!await confirm('이 라인의 입고 기록을 취소하시겠습니까?')) return;
    try {
      await receivePurchaseLine(purchaseRef.current, lineIdx, {
        qty: 0, date: null, note: '', receivedBy: '',
      });
      await loadData({ silent: true });
    } catch (err) {
      alert('입고 취소 중 오류: ' + err.message);
    }
  }

  async function handleSettle() {
    if (!purchase) return;
    await flushAutoSave();
    const where = purchase.siteName || '귀속 프로젝트';
    if (!await confirm(
      `"${purchase.title}" 건을 정산하시겠습니까?\n금액 ${Number(purchase.totalAmount || 0).toLocaleString()}원이 ${where} 지출로 자동 등록됩니다.`,
    )) return;
    try {
      await settlePurchase(purchase, userProfile?.name || '');
      await loadData({ silent: true });
    } catch (err) {
      alert('정산 중 오류: ' + err.message);
    }
  }

  async function handleCancelSettle() {
    if (!purchase) return;
    if (!await confirm(
      `"${purchase.title}" 정산을 취소하시겠습니까?\n등록된 지출 항목이 삭제되고, 품목 단가 이력에서도 이 구매 기록이 제거됩니다.\n구매 상태는 '입고'로 되돌아갑니다.`,
    )) return;
    try {
      await cancelSettlePurchase(purchase);
      await loadData({ silent: true });
    } catch (err) {
      alert('정산 취소 중 오류: ' + err.message);
    }
  }

  async function handleDelete() {
    if (!purchase) return;
    if (!await confirm(`"${purchase.title}" 구매 건을 삭제하시겠습니까?`)) return;
    try {
      await deletePurchase(id);
      navigate('/admin/purchase');
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  if (loading || !purchase) return <div className="loading">로딩 중...</div>;

  const status = purchase.status || 'ordered';
  const derivedSupplier = purchase.supplierName || (() => {
    const { supplierName } = deriveSupplier(form.items, itemMaster, suppliers);
    return supplierName;
  })();

  return (
    <div className="purchase-detail-page printable-page">
      <div className="page-header screen-only">
        <div className="purchase-detail-header-left">
          <h2>{purchase.title || '(제목 없음)'}</h2>
          <span className={`purchase-badge purchase-badge-${STATUS[status]?.cls || 'ordered'}`}>
            {STATUS[status]?.label || status}
          </span>
        </div>
        <div className="page-actions purchase-detail-top-actions">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/purchase')}>목록</button>
          <button type="button" className="btn btn-outline" onClick={openPrintLogs}>출력 이력{purchase.printCount > 0 ? ` (${purchase.printCount})` : ''}</button>
          {!isReadOnly && (
            <>
              <button type="button" className="btn btn-primary" onClick={openItemPicker}>+ 품목 불러오기</button>
              <button type="button" className="btn btn-outline" onClick={openBomModal}>BOM 가져오기</button>
            </>
          )}
          <button
            type="button"
            className={`btn ${groupBySupplier ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => setGroupBySupplier((v) => !v)}
            title="ON: 출력 시 구매처별로 각각 별도 발주서 생성"
          >구매처별 {groupBySupplier ? 'ON' : 'OFF'}</button>
          {!isReadOnly && saveState === 'error' && (
            <span className="purchase-save-indicator error" aria-live="polite">⚠ 저장 실패</span>
          )}
          {(status === 'ordered' || status === 'partial') && (() => {
            const remainingCount = (purchase.items || []).filter((it) => {
              const r = Number(it.receivedQty) || 0;
              const q = Number(it.qty) || 0;
              return q > 0 && r < q;
            }).length;
            const hasAnyReceived = (purchase.items || []).some((it) => Number(it.receivedQty) > 0);
            return (
              <>
                {remainingCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => openBulk('remaining')}
                    title="잔여 라인 일괄 입고"
                  >일괄 입고</button>
                )}
                {status === 'partial' && hasAnyReceived && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => openBulk('close-as-is')}
                    title="현재 입고된 수량으로 발주 수량을 정정하고 종결"
                  >잔여 무시하고 종결</button>
                )}
              </>
            );
          })()}
          {status === 'received' && (
            <button type="button" className="btn btn-primary" onClick={handleSettle}>정산 처리</button>
          )}
          {status === 'settled' && (
            <button type="button" className="btn btn-danger" onClick={handleCancelSettle}>정산 취소</button>
          )}
          {status !== 'settled' && (
            <button type="button" className="btn btn-danger" onClick={handleDelete}>삭제</button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="pdf-print-fab no-print"
        onClick={() => { recordPrint(); window.print(); }}
        title="PDF로 저장하려면 인쇄 다이얼로그에서 'PDF로 저장'을 선택하세요"
      >
        PDF 출력
      </button>

      {/* 인쇄 전용 IOPN_v4 발주서 양식 */}
      {(() => {
        const supplier = suppliers.find((s) => s.id === purchase.supplierId);
        const site = sites.find((s) => s.id === purchase.siteId);
        const liveOrderDate = purchase.orderedAt?.toDate ? purchase.orderedAt.toDate()
          : (purchase.orderedAt ? new Date(purchase.orderedAt)
            : (purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date()));
        const liveOrderDateKo = `${liveOrderDate.getFullYear()}년 ${liveOrderDate.getMonth() + 1}월 ${liveOrderDate.getDate()}일`;
        const liveSupplierTitle = supplier?.name ? `${supplier.name} 귀하` : (derivedSupplier ? `${derivedSupplier} 귀하` : '');

        // 출력 소스: 이력 보기 중이면 그 시점 스냅샷, 아니면 현재(라이브) 데이터
        const src = viewSnapshot ? {
          siteName: viewSnapshot.siteName || '',
          deliveryPlace: viewSnapshot.deliveryPlace || SELF_INFO.address,
          deliveryDue: viewSnapshot.deliveryDue || PO_DEFAULTS.delivery,
          payment: viewSnapshot.payment || PO_DEFAULTS.payment,
          contactLine: [viewSnapshot.contactName || '', viewSnapshot.contactPhone || ''].filter(Boolean).join(' / '),
          note: viewSnapshot.note || '',
          orderDateKo: viewSnapshot.orderDateKo || liveOrderDateKo,
          poNum: viewSnapshot.poNumber || poNumber(purchase),
          grouped: !!viewSnapshot.groupBySupplier,
          supplierTitle: viewSnapshot.supplierName ? `${viewSnapshot.supplierName} 귀하` : '',
          items: viewSnapshot.items || [],
        } : {
          siteName: site?.name || purchase.siteName || '',
          deliveryPlace: purchase.deliveryPlace || SELF_INFO.address,
          deliveryDue: purchase.deliveryDue || PO_DEFAULTS.delivery,
          payment: purchase.payment || PO_DEFAULTS.payment,
          contactLine: [purchase.contactName || purchase.requesterName || '', purchase.contactPhone || ''].filter(Boolean).join(' / '),
          note: form.note,
          orderDateKo: liveOrderDateKo,
          poNum: poNumber(purchase),
          grouped: groupBySupplier,
          supplierTitle: liveSupplierTitle,
          items: mapPrintItems(form.items),
        };

        // 문서 단위: 구매처별이면 구매처별로 각각 별도 발주서, 아니면 전체 1장
        let docs;
        if (src.grouped) {
          const gmap = new Map();
          for (const it of src.items) {
            if (!(it._name || it.name || '').trim()) continue;
            const key = it._supplier || '(구매처 미지정)';
            if (!gmap.has(key)) gmap.set(key, []);
            gmap.get(key).push(it);
          }
          docs = [...gmap.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, items]) => ({
              recvTitle: name !== '(구매처 미지정)' ? `${name} 귀하` : '',
              supplierLabel: name,
              items,
            }));
          if (docs.length === 0) docs = [{ recvTitle: src.supplierTitle, supplierLabel: '', items: [] }];
        } else {
          docs = [{ recvTitle: src.supplierTitle, supplierLabel: '', items: src.items.filter((ln) => (ln._name || ln.name || '').trim()) }];
        }

        // 페이지 추정 상수 — 프레임 고정 높이 250mm 안에서 합계까지 안전히 들어가도록 보수적
        const CHARS_PER_LINE = 26;
        const LINE1_MM = 7.2;
        const EXTRA_LINE_MM = 3.9;
        const HEADER_MM = 9;
        const FOOTER_MM = 13;
        const INFO_MM = 68;
        const TOTALS_MM = 30;
        const PAGE_MM = 238;  // 분할 기준(프레임 250mm보다 작게)
        const FILL_MM = 244;  // 빈 행 패딩 목표(프레임 하단까지)
        const rowH = (ln) => {
          const lines = Math.max(1, Math.ceil(effLen(ln?._spec || '') / CHARS_PER_LINE));
          return LINE1_MM + (lines - 1) * EXTRA_LINE_MM;
        };
        const budgetFor = (isFirst) => PAGE_MM - (isFirst ? INFO_MM : 0) - HEADER_MM - FOOTER_MM;

        // 한 문서(구매처)를 페이지 div 배열로 렌더
        const renderDoc = (rows, recvTitle, supplierLabel, docKey) => {
          const supplyAmount = rows.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0);
          const totalQty = rows.reduce((s, ln) => s + (Number(ln.qty) || 0), 0);
          const vat = Math.round(supplyAmount * 0.1);
          const grandTotal = supplyAmount + vat;
          const pages = [];
          let cur = { chunk: [], startNo: 0 };
          let used = 0;
          for (let idx = 0; idx < rows.length; idx++) {
            const h = rowH(rows[idx]);
            const budget = budgetFor(pages.length === 0);
            if (used + h > budget && cur.chunk.length > 0) {
              pages.push(cur);
              cur = { chunk: [], startNo: idx };
              used = 0;
            }
            cur.chunk.push(rows[idx]);
            used += h;
          }
          pages.push(cur);
          {
            const isFirstLast = pages.length === 1;
            const lastUsed = pages[pages.length - 1].chunk.reduce((s, ln) => s + rowH(ln), 0);
            if (lastUsed + TOTALS_MM > budgetFor(isFirstLast)) {
              pages.push({ chunk: [], startNo: rows.length });
            }
          }
          const pageCount = pages.length;

          return pages.map((pg, pageIdx) => {
              const isFirst = pageIdx === 0;
              const isLast = pageIdx === pageCount - 1;
              const fillBudget = FILL_MM - (isFirst ? INFO_MM : 0) - HEADER_MM - FOOTER_MM - (isLast ? TOTALS_MM : 0);
              const usedH = pg.chunk.reduce((s, ln) => s + rowH(ln), 0);
              const padCount = Math.max(0, Math.floor((fillBudget - usedH) / LINE1_MM));
              const padded = [...pg.chunk];
              for (let k = 0; k < padCount; k++) padded.push(null);
              return (
                <div className="bom-print-page po-doc-page" key={`${docKey}-${pageIdx}`}>
                  {isFirst && <div className="print-form-title">구 매 발 주 서</div>}

                  {isFirst && (
                    <table className="iopn-info-table">
                      <tbody>
                        <tr>
                          <th className="lbl">수 신</th>
                          <td className="val">{recvTitle}</td>
                          <th className="lbl">사업자등록번호</th>
                          <td className="val">{SELF_INFO.businessNumber}</td>
                        </tr>
                        <tr>
                          <th className="lbl">현 장 명</th>
                          <td className="val">{src.siteName}</td>
                          <th className="lbl">회사명/대표</th>
                          <td className="val">{SELF_INFO.companyAndCeo}</td>
                        </tr>
                        <tr>
                          <th className="lbl">납품장소</th>
                          <td className="val">{src.deliveryPlace}</td>
                          <th className="lbl">주 소</th>
                          <td className="val">{SELF_INFO.address}</td>
                        </tr>
                        <tr>
                          <th className="lbl">발행번호</th>
                          <td className="val">{src.poNum}</td>
                          <th className="lbl">TEL/FAX</th>
                          <td className="val">{SELF_INFO.telFax}</td>
                        </tr>
                        <tr>
                          <th className="lbl">발 주 일</th>
                          <td className="val">{src.orderDateKo}</td>
                          <th className="lbl">납품기일</th>
                          <td className="val">{src.deliveryDue}</td>
                        </tr>
                        <tr>
                          <th className="lbl">지불조건</th>
                          <td className="val">{src.payment}</td>
                          <th className="lbl">담당/연락처</th>
                          <td className="val">{src.contactLine}</td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="iopn-amount-row">
                            총 금액(VAT 포함) : ₩ {grandTotal.toLocaleString()}원
                            <span className="iopn-amount-sub"> (공급가액 {supplyAmount.toLocaleString()} + VAT {vat.toLocaleString()})</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  <table className="iopn-items-table po-cols">
                    <thead>
                      <tr>
                        <th className="c-no">NO</th>
                        <th className="c-name">품목명</th>
                        <th className="c-spec">규격</th>
                        <th className="c-qty">수량</th>
                        <th className="c-price">단가</th>
                        <th className="c-amount">금액</th>
                        <th className="c-recv">입고</th>
                        <th className="c-supplier">구매처</th>
                        <th className="c-note">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {padded.map((ln, r) => {
                        if (!ln) return (
                          <tr key={`e-${r}`}>
                            <td className="c-no"></td>
                            <td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td>
                          </tr>
                        );
                        const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                        const q = Number(ln.qty) || 0;
                        const rq = Number(ln.receivedQty) || 0;
                        const recvText = q <= 0 ? '' : (rq >= q ? '완료' : (rq > 0 ? `${rq}/${q}` : '미입고'));
                        return (
                          <tr key={r}>
                            <td className="c-no">{pg.startNo + r + 1}</td>
                            <td className={`c-name ${specFontClass(ln._name, 11)}`}>{ln._name || ''}</td>
                            <td className="c-spec">{ln._spec || ''}</td>
                            <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                            <td className="c-price">{Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}</td>
                            <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                            <td className={`c-recv ${rq >= q && q > 0 ? 'recv-done' : (rq === 0 ? 'recv-none' : '')}`}>{recvText}</td>
                            <td className={`c-supplier ${specFontClass(ln._supplier, 11)}`}>{ln._supplier || ''}</td>
                            <td className={`c-note ${specFontClass(ln.note, 11)}`}>{ln.note || ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {isLast && (
                    <>
                      <table className="iopn-notes-table">
                        <tbody>
                          <tr>
                            <th className="lbl">특이사항</th>
                            <td className="val">{src.note || ''}</td>
                          </tr>
                        </tbody>
                      </table>

                      <table className="iopn-total-table">
                        <tbody>
                          <tr>
                            <th className="lbl">수량</th>
                            <td className="num">{totalQty.toLocaleString()}</td>
                            <th className="lbl">공급가액</th>
                            <td className="num">{supplyAmount.toLocaleString()}</td>
                            <th className="lbl">VAT</th>
                            <td className="num">{vat.toLocaleString()}</td>
                            <th className="lbl">합계</th>
                            <td className="num grand">{grandTotal.toLocaleString()}</td>
                          </tr>
                        </tbody>
                      </table>
                    </>
                  )}

                  <div className="iopn-form-footer">
                    <span>(주)아이오피엔 · 구매발주서{supplierLabel ? ` · ${supplierLabel}` : ''} · {src.poNum}</span>
                    <span>페이지 {pageIdx + 1} / {pageCount}</span>
                  </div>
                </div>
              );
          });
        };

        return (
          <div className="print-form-iopn print-form-paged print-only">
            {docs.map((d, di) => renderDoc(d.items, d.recvTitle, d.supplierLabel, `doc${di}`))}
          </div>
        );
      })()}

      <div className="purchase-meta-bar screen-only">
        <div className="purchase-meta-items">
          <span><em>프로젝트</em>{purchase.siteName || '-'}</span>
          <span><em>등록자</em>{purchase.requesterName || '-'}</span>
          <span><em>발주일</em>{fmtDate(purchase.orderedAt || purchase.createdAt)}</span>
          <span><em>구매처</em>{derivedSupplier || <span className="text-muted">자동 (품목 미선택)</span>}</span>
          {purchase.receivedBy && (
            <span><em>입고</em>{purchase.receivedBy} · {fmtDate(purchase.receivedAt)}</span>
          )}
          {purchase.settledBy && (
            <span><em>정산</em>{purchase.settledBy} · {fmtDate(purchase.settledAt)}</span>
          )}
        </div>
      </div>

      <div className="form-group screen-only">
        <label>품목</label>
        <p className="field-hint">우측 상단 「품목 불러오기」로 구매 품목을 선택해 추가하세요. 입력 즉시 자동 저장됩니다. 구매처는 첫 품목의 기본 구매처로 자동 적용.</p>
        <div className="item-group is-expanded bom-flat-group">
          <div className="item-group-detail">
            <table className="table inline-edit-table cards-sm bom-flat-table">
              <thead>
                <tr>
                  <th className="bom-spacer-col" aria-hidden="true"></th>
                  <th style={{ minWidth: 100 }}>코드</th>
                  <th style={{ minWidth: 160 }}>품명</th>
                  <th>메이커</th>
                  <th>규격</th>
                  <th>분류</th>
                  <th>인증</th>
                  <th>moq/단위</th>
                  <th>수량</th>
                  <th>단가</th>
                  <th>합계</th>
                  <th style={{ minWidth: 160 }}>비고</th>
                  <th style={{ minWidth: 160 }} className="no-print">입고</th>
                  <th className="bom-action-col no-print" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.length === 0 && (
                  <tr>
                    <td colSpan={14} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
                      품목이 없습니다 — 아래 "+ 품목 추가"로 시작하세요.
                    </td>
                  </tr>
                )}
                {form.items.map((ln, idx) => {
                  const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
                  const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                  // 입고 상태는 라인 자체 데이터로 — 삭제·인덱스 변동에 영향받지 않음 (입고 클릭 시 자동저장 flush)
                  const savedQty = Number(ln.qty) || 0;
                  const receivedQty = Number(ln.receivedQty) || 0;
                  const isLineSaved = (ln.name || '').trim().length > 0;
                  const isFullyReceived = isLineSaved && savedQty > 0 && receivedQty >= savedQty;
                  const isPartial = isLineSaved && receivedQty > 0 && receivedQty < savedQty;
                  return (
                    <tr key={idx}>
                      <td className="bom-spacer-col" aria-hidden="true"></td>
                      <td data-label="코드">
                        <input
                          type="text"
                          className="bom-readonly-input bom-code-input"
                          value={master?.code || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="품명">
                        <div className="purchase-line-item-wrap">
                          <input
                            className="purchase-line-item"
                            type="text"
                            placeholder="품목 불러오기 또는 직접 입력"
                            value={ln.name}
                            onChange={(e) => updateLineName(idx, e.target.value)}
                            autoComplete="off"
                            disabled={isReadOnly}
                          />
                        </div>
                      </td>
                      <td data-label="메이커">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.maker || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="규격">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.spec || ln.spec || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="분류">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.category || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="인증">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.certification || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="moq/단위">
                        <input
                          type="text"
                          className="bom-readonly-input"
                          value={master?.unit || ln.unit || ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="수량">
                        <input
                          className="num-input"
                          type="number" min="0"
                          value={ln.qty}
                          onChange={(e) => updateLine(idx, { qty: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="단가">
                        <MoneyInput
                          className="num-input"
                          value={ln.unitPrice}
                          onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="합계">
                        <input
                          type="text"
                          className="bom-readonly-input bom-amount-input"
                          value={amount ? amount.toLocaleString() : ''}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                      <td data-label="비고">
                        <input
                          type="text"
                          value={ln.note || ''}
                          placeholder="-"
                          onChange={(e) => updateLine(idx, { note: e.target.value })}
                          disabled={isReadOnly}
                        />
                      </td>
                      <td data-label="입고" className="no-print">
                        <div className="purchase-line-recv">
                          {!isLineSaved ? (
                            <span className="purchase-line-recv-hint">저장 후 입고</span>
                          ) : isFullyReceived ? (
                            <button
                              type="button"
                              className={`purchase-recv-chip is-full ${isReadOnly ? 'is-readonly' : ''}`}
                              onClick={() => !isReadOnly && openReceive(idx)}
                              title={isReadOnly ? '정산 완료' : '입고 수정'}
                              disabled={isReadOnly}
                            >
                              <span className="purchase-recv-chip-qty">완료 {receivedQty}/{savedQty}</span>
                              <span className="purchase-recv-chip-date">{fmtDate(ln.receivedAt)}</span>
                            </button>
                          ) : isPartial ? (
                            <button
                              type="button"
                              className={`purchase-recv-chip is-partial ${isReadOnly ? 'is-readonly' : ''}`}
                              onClick={() => !isReadOnly && openReceive(idx)}
                              title={isReadOnly ? '정산 완료' : '입고 추가/수정'}
                              disabled={isReadOnly}
                            >
                              <span className="purchase-recv-chip-qty">부분 {receivedQty}/{savedQty}</span>
                              <span className="purchase-recv-chip-date">{fmtDate(ln.receivedAt)}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline purchase-recv-btn"
                              onClick={() => openReceive(idx)}
                              disabled={isReadOnly || savedQty <= 0}
                              title={savedQty <= 0 ? '수량을 먼저 입력하세요' : ''}
                            >
                              입고
                            </button>
                          )}
                          {isLineSaved && receivedQty > 0 && !isReadOnly && (
                            <button
                              type="button"
                              className="purchase-recv-clear"
                              onClick={() => clearLineReceive(idx)}
                              aria-label="입고 취소"
                              title="입고 기록 취소"
                            >↺</button>
                          )}
                        </div>
                      </td>
                      <td className="bom-action-col no-print">
                        <button
                          type="button"
                          className="closing-delete"
                          onClick={() => removeLine(idx)}
                          aria-label="행 삭제"
                          disabled={isReadOnly}
                          title="삭제"
                        >✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="purchase-total-row screen-only">
        <span>합계</span>
        <strong>{formTotal.toLocaleString()}원</strong>
      </div>


      <div className="form-group screen-only">
        <label>메모</label>
        <textarea
          value={form.note}
          onChange={(e) => patchForm({ note: e.target.value })}
          rows={2}
          disabled={isReadOnly}
        />
      </div>

      {purchase.receiveNote && (
        <div className="form-group screen-only">
          <label>검수 메모</label>
          <p className="purchase-readonly-text">{purchase.receiveNote}</p>
        </div>
      )}

      {(status === 'ordered' || status === 'partial') && (
        <p className="purchase-status-hint screen-only">
          {status === 'partial'
            ? '부분 입고 진행 중 — 상단의 “일괄 입고” 또는 “잔여 무시하고 종결” 버튼을 사용하세요'
            : '품목별로 입고 처리하거나 상단 “일괄 입고”로 전체 완료 처리하세요'}
        </p>
      )}
      {status === 'settled' && (
        <p className="purchase-settled-note screen-only">
          정산 완료 — {purchase.siteName || '귀속 프로젝트'} 지출에 반영됨
        </p>
      )}

      <Modal
        isOpen={!!bulkModal}
        onClose={() => setBulkModal(null)}
        title={bulkModal?.mode === 'close-as-is' ? '잔여 무시하고 입고 종결' : '일괄 입고 처리'}
      >
        {bulkModal && (() => {
          const isClose = bulkModal.mode === 'close-as-is';
          const lines = purchase.items || [];
          const affected = isClose
            ? lines.filter((it) => (Number(it.receivedQty) || 0) > 0)
            : lines.filter((it) => {
              const r = Number(it.receivedQty) || 0;
              const q = Number(it.qty) || 0;
              return q > 0 && r < q;
            });
          return (
            <form onSubmit={submitBulk}>
              <div className="purchase-recv-modal-summary">
                <strong className="purchase-recv-modal-name">
                  {isClose ? '현재 입고된 수량으로 종결' : `잔여 ${affected.length}개 라인 일괄 입고`}
                </strong>
                <span className="purchase-recv-modal-meta">
                  {isClose
                    ? `미입고 라인은 수량 0으로 정리됩니다. 발주 금액이 입고 기준으로 재계산됩니다.`
                    : `각 라인의 잔여 수량만큼 동일한 입고일로 받습니다.`}
                </span>
              </div>

              {!isClose && (
                <>
                  <div className="form-group">
                    <label>입고일 *</label>
                    <input
                      type="date"
                      value={bulkForm.date}
                      onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>검수 메모</label>
                    <textarea
                      value={bulkForm.note}
                      onChange={(e) => setBulkForm({ ...bulkForm, note: e.target.value })}
                      rows={2}
                      placeholder="수량 확인 · 하자 여부 등"
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>{isClose ? '종결 대상 라인' : '대상 라인'}</label>
                <ul className="purchase-recv-bulk-list">
                  {affected.length === 0 ? (
                    <li className="purchase-recv-bulk-empty">대상 라인이 없습니다.</li>
                  ) : (
                    affected.map((it, i) => {
                      const r = Number(it.receivedQty) || 0;
                      const q = Number(it.qty) || 0;
                      return (
                        <li key={i}>
                          <span className="purchase-recv-bulk-name">{it.name || '(이름 없음)'}{it.spec ? ` (${it.spec})` : ''}</span>
                          <span className="purchase-recv-bulk-qty">
                            {isClose ? `${r}${it.unit || ''} 종결` : `${r}/${q}${it.unit || ''} → ${q}${it.unit || ''}`}
                          </span>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="modal-actions">
                <button type="submit" className={`btn ${isClose ? 'btn-danger' : 'btn-primary'}`}>
                  {isClose ? '종결 처리' : '일괄 입고'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setBulkModal(null)}>취소</button>
              </div>
            </form>
          );
        })()}
      </Modal>

      <Modal
        isOpen={!!receiveModal}
        onClose={() => setReceiveModal(null)}
        title="입고 검수"
      >
        {receiveModal && (
          <form onSubmit={submitReceive}>
            <div className="purchase-recv-modal-summary">
              <strong className="purchase-recv-modal-name">
                {receiveModal.line.name}
                {receiveModal.line.spec ? ` (${receiveModal.line.spec})` : ''}
              </strong>
              <span className="purchase-recv-modal-meta">
                발주 {Number(receiveModal.line.qty) || 0}{receiveModal.line.unit || ''}
                {Number(receiveModal.line.receivedQty) > 0 && (
                  <> · 이전 입고 {Number(receiveModal.line.receivedQty)}{receiveModal.line.unit || ''}</>
                )}
              </span>
            </div>

            <div className="form-group">
              <label>입고 수량 *</label>
              <input
                type="number"
                min="0"
                max={Number(receiveModal.line.qty) || 0}
                step="any"
                value={receiveForm.qty}
                onChange={(e) => setReceiveForm({ ...receiveForm, qty: e.target.value })}
                required
                autoFocus
              />
              <p className="field-hint">
                전체 {Number(receiveModal.line.qty) || 0}{receiveModal.line.unit || ''} 중 실제 입고된 수량을 입력하세요. 부분 입고 가능.
              </p>
            </div>
            <div className="form-group">
              <label>입고일 *</label>
              <input
                type="date"
                value={receiveForm.date}
                onChange={(e) => setReceiveForm({ ...receiveForm, date: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>검수 메모</label>
              <textarea
                value={receiveForm.note}
                onChange={(e) => setReceiveForm({ ...receiveForm, note: e.target.value })}
                rows={2}
                placeholder="수량 확인 · 하자 여부 등"
              />
            </div>
            <p className="field-hint">
              모든 라인이 발주 수량만큼 입고되면 전체 상태가 '입고완료'로 자동 전환됩니다.
              일부만 입고되면 '부분입고'로 표시됩니다.
            </p>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary">저장</button>
              <button type="button" className="btn btn-outline" onClick={() => setReceiveModal(null)}>취소</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={bomModalOpen} onClose={() => setBomModalOpen(false)} title="BOM에서 품목 가져오기">
        <p className="field-hint">
          선택한 BOM(프로젝트)의 품목·수량·단가를 이 발주에 불러옵니다.
          불러온 뒤 목록·수량·단가(금액)를 수정할 수 있고, 저장해야 반영됩니다.
        </p>
        {bomLoading ? (
          <p className="purchase-empty">불러오는 중...</p>
        ) : bomProjects.length === 0 ? (
          <p className="purchase-empty">등록된 BOM 프로젝트가 없습니다. (프로젝트별 BOM에서 먼저 만드세요)</p>
        ) : (
          <div className="bom-import-list">
            {bomProjects.map((bp) => (
              <button
                type="button"
                key={bp.id}
                className="bom-import-row"
                onClick={() => importBom(bp)}
                disabled={bomImporting}
              >
                <span className="bom-import-name">{bp.name}</span>
                <span className="bom-import-go">{bomImporting ? '가져오는 중...' : '가져오기 →'}</span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setBomModalOpen(false)}>닫기</button>
        </div>
      </Modal>

      <Modal isOpen={itemPickerOpen} onClose={() => setItemPickerOpen(false)} title="품목 선택">
        <form onSubmit={addPickedToPO}>
          <p className="field-hint">구매 품목 관리에 등록된 품목 중에서 선택해 발주에 추가합니다. 체크 후 수량을 입력하세요. (대분류 제외)</p>
          <div className="form-group">
            <input
              type="text"
              placeholder="코드 · 품명 · 규격 · 분류 검색"
              value={itemPickerSearch}
              onChange={(e) => setItemPickerSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="bom-picker-list">
            {(() => {
              const kw = itemPickerSearch.trim().toLowerCase();
              const list = itemMaster
                .filter((m) => !/^IOPN-\d+$/.test(m.code || '')) // 대분류(베어 메인) 제외
                .filter((m) => {
                  if (!kw) return true;
                  return [m.code, m.name, m.spec, m.category].some((v) => (v || '').toLowerCase().includes(kw));
                });
              const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
              const sorted = list.sort((a, b) => collator.compare(a.code || '', b.code || ''));
              if (sorted.length === 0) {
                return <p className="purchase-empty">{itemMaster.length === 0 ? '등록된 구매 품목이 없습니다.' : '검색 결과가 없습니다.'}</p>;
              }
              return sorted.map((m) => (
                <label key={m.id} className={`bom-picker-row ${itemPicked.has(m.id) ? 'is-checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={itemPicked.has(m.id)}
                    onChange={() => toggleItemPick(m.id)}
                  />
                  <span className="bom-picker-code">{m.code || '-'}</span>
                  <span className="bom-picker-name">
                    <strong>{m.name}</strong>
                    {m.spec && <span className="bom-picker-spec"> ({m.spec})</span>}
                  </span>
                  {m.standardPrice > 0 && (
                    <span className="bom-picker-price">{Number(m.standardPrice).toLocaleString()}원</span>
                  )}
                  {itemPicked.has(m.id) && (
                    <span
                      className="bom-picker-qty-wrap"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      <input
                        type="number"
                        min="0"
                        className="num-input bom-picker-qty"
                        value={itemPicked.get(m.id)}
                        onChange={(e) => setItemPickQty(m.id, e.target.value)}
                        onFocus={(e) => e.target.select()}
                        autoFocus
                        aria-label={`${m.name} 수량`}
                      />
                      <span className="bom-picker-qty-unit">{m.unit || '개'}</span>
                    </span>
                  )}
                </label>
              ));
            })()}
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={itemPicked.size === 0}>
              {itemPicked.size}개 추가
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setItemPickerOpen(false)}>취소</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={printLogsOpen} onClose={() => setPrintLogsOpen(false)} title="발주서 출력 이력">
        <p className="field-hint">출력했던 시점의 발주서 상태가 저장되어 있습니다. 「이 시점 PDF 출력」을 누르면 그때 모습 그대로 다시 출력·PDF 저장할 수 있습니다.</p>
        {printLogsLoading ? (
          <p className="purchase-empty">불러오는 중...</p>
        ) : printLogs.length === 0 ? (
          <p className="purchase-empty">출력 이력이 없습니다.</p>
        ) : (
          <div className="bom-import-list" style={{ maxHeight: 420 }}>
            {printLogs.map((log) => {
              const snap = log.snapshot || {};
              const items = snap.items || [];
              const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
              const vat = Math.round(total * 0.1);
              return (
                <div key={log.id} className="bom-import-row" style={{ cursor: 'default' }}>
                  <span className="bom-import-name">
                    <strong>{fmtDateTime(log.at)}</strong>
                    <span className="text-muted" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
                      {log.by || '-'} · {items.length}품목 · ₩{(total + vat).toLocaleString()}{snap.groupBySupplier ? ' · 구매처별' : ''}
                    </span>
                  </span>
                  <button type="button" className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => printSnapshot(log)}>
                    이 시점 PDF 출력
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setPrintLogsOpen(false)}>닫기</button>
        </div>
      </Modal>
    </div>
  );
}
