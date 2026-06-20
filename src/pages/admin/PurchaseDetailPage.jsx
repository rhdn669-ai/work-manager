import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getPurchaseById,
  updatePurchase,
  settlePurchase,
  cancelSettlePurchase,
  receivePurchaseLine,
  bulkReceivePurchase,
  getSuppliers,
  subscribePurchaseItems,
  addPurchasePrintLog,
  getPurchasePrintLogs,
  confirmPurchase,
  markSupplierSent,
  unmarkSupplierSent,
  getPurchaseConfig,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { trashPurchase, restoreTrashItem } from '../../services/trashService';
import { getBomProjects, getBomBySite } from '../../services/bomService';
import { useAuth } from '../../contexts/AuthContext';
import { useDialog } from '../../components/common/DialogProvider';
import { useUndo } from '../../contexts/UndoContext';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import { specFontClass } from '../../utils/printText';
import { subscribeFolders } from '../../services/fileLibraryService';
import { captureToPdfBlob, uploadPdfToLibrary } from '../../utils/pdfExport';

const STATUS = {
  draft: { label: '대기', cls: 'draft' },
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
// 발행번호 순번(-N)의 숫자만 추출 (정렬용)
function poSeqOf(po) {
  const m = (po || '').match(/-(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}
// 발주 건에 발행번호가 하나라도 부여됐는지 (업체별 발행 or 구버전 건 단위)
function hasIssuedPo(purchase) {
  const ss = purchase.supplierSent || {};
  return Object.values(ss).some((s) => s && s.poNo) || !!purchase.poNo;
}
// 발주 건 '대표' 발행번호 — 업체별 발행번호 중 가장 빠른(작은 순번) 것
function poNumber(purchase) {
  const ss = purchase.supplierSent || {};
  const nums = Object.values(ss)
    .map((s) => s && s.poNo)
    .filter(Boolean);
  if (nums.length > 0) return nums.sort((a, b) => poSeqOf(a) - poSeqOf(b))[0];
  if (purchase.poNo) return purchase.poNo; // 구버전(발주 건 단위) 호환
  // 미발행 — 날짜 기반 fallback (순번 없음)
  const d = purchase.orderedAt?.toDate
    ? purchase.orderedAt.toDate()
    : purchase.orderedAt
      ? new Date(purchase.orderedAt)
      : new Date(purchase.createdAt?.toDate ? purchase.createdAt.toDate() : new Date());
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
  const { confirm, alert, toast } = useDialog();
  const { push: pushGlobalUndo } = useUndo();

  const [purchase, setPurchase] = useState(null);
  const [sites, setSites] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(true);

  // 편집 가능한 폼 상태 (실시간 자동 저장 — 저장 버튼 없음)
  const [form, setForm] = useState({
    title: '',
    siteId: '',
    factoryKey: '',
    deliveryPlace: '',
    items: [{ ...EMPTY_LINE }],
    note: '',
  });
  const [saveState, setSaveState] = useState('saved'); // 'saving' | 'saved' | 'error'

  const [receiveModal, setReceiveModal] = useState(null); // { lineIdx, line } | null
  const [receiveForm, setReceiveForm] = useState({ qty: '', date: todayStr(), note: '' });
  const [bulkModal, setBulkModal] = useState(null); // { mode: 'remaining' | 'close-as-is' } | null
  const [bulkForm, setBulkForm] = useState({ date: todayStr(), note: '' });

  // 특정 업체 품목만 PDF 출력 (null = 전체 발주서)
  const [printSupplierFilter, setPrintSupplierFilter] = useState(null);

  // 품목 검색 (표시 필터 — 데이터는 보존, 원본 인덱스 유지)
  const [itemSearch, setItemSearch] = useState('');

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
  const [printStamp, setPrintStamp] = useState(''); // 출력물 하단에 표시할 출력 시각

  // PDF → 자료실 저장
  const printRef = useRef(null); // 인쇄 양식 DOM (PDF 캡처 대상)
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfFolders, setPdfFolders] = useState([]); // [{ id, label }] 경로 라벨 포함 평면 목록
  const [pdfFolderId, setPdfFolderId] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');

  useEffect(() => {
    loadData();
    const unsub = subscribePurchaseItems(setItemMaster);
    const unsubFolders = subscribeFolders((list) => {
      // 중첩 폴더를 "상위 / 하위" 경로 라벨로 평탄화
      const byId = new Map(list.map((f) => [f.id, f]));
      const labelOf = (f) => {
        const parts = [];
        let cur = f;
        let guard = 0;
        while (cur && guard < 20) {
          parts.unshift(cur.name);
          cur = cur.parentId ? byId.get(cur.parentId) : null;
          guard += 1;
        }
        return parts.join(' / ');
      };
      setPdfFolders(list.map((f) => ({ id: f.id, label: labelOf(f) })).sort((a, b) => a.label.localeCompare(b.label)));
    });
    return () => {
      unsub();
      unsubFolders();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 품목 마스터 변경 시 form.items의 연결된 품목 필드 실시간 동기화 (명칭·규격·단위·단가)
  useEffect(() => {
    if (!itemMaster.length) return;
    setForm((prev) => {
      let changed = false;
      const items = prev.items.map((ln) => {
        if (!ln.itemId) return ln;
        const m = itemMaster.find((x) => x.id === ln.itemId);
        if (!m) return ln;
        const newName = m.name || ln.name;
        const newSpec = m.spec || ln.spec;
        const newUnit = m.unit || ln.unit;
        const newUnitPrice = m.standardPrice != null ? Number(m.standardPrice) : ln.unitPrice;
        if (
          newName === ln.name &&
          newSpec === ln.spec &&
          newUnit === ln.unit &&
          newUnitPrice === Number(ln.unitPrice)
        )
          return ln;
        changed = true;
        return { ...ln, name: newName, spec: newSpec, unit: newUnit, unitPrice: newUnitPrice };
      });
      if (!changed) return prev;
      skipUndoPushRef.current = true;
      setTimeout(() => { scheduleAutoSave(); skipUndoPushRef.current = false; }, 0);
      return { ...prev, items };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemMaster]);

  async function loadData({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      const [p, st, sp, cfg] = await Promise.all([
        getPurchaseById(id),
        getAllSites(),
        getSuppliers(),
        getPurchaseConfig(),
      ]);
      if (!p) {
        alert('해당 구매 건을 찾을 수 없습니다.');
        navigate('/admin/purchase');
        return;
      }
      setPurchase(p);
      setSites(st);
      setSuppliers(sp);
      setFactories(cfg.factories || []);
      setForm({
        title: p.title || '',
        siteId: p.siteId || '',
        factoryKey: p.factoryKey || '',
        deliveryPlace: p.deliveryPlace || '',
        items: p.items && p.items.length > 0 ? p.items.map((it) => ({ ...EMPTY_LINE, ...it })) : [{ ...EMPTY_LINE }],
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
            unitPrice: Number(ln.unitPrice) > 0 ? ln.unitPrice : Number(m.standardPrice) || 0,
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
      if (next.has(itemId)) next.delete(itemId);
      else next.set(itemId, 1);
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
    if (itemPicked.size === 0) {
      setItemPickerOpen(false);
      return;
    }
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
    if (newLines.length === 0) {
      setItemPickerOpen(false);
      return;
    }
    setForm((f) => {
      const first = f.items[0];
      const onlyEmpty = f.items.length === 1 && !first?.name && !first?.itemId;
      return { ...f, items: onlyEmpty ? newLines : [...f.items, ...newLines] };
    });
    scheduleAutoSave();
    setItemPicked(new Map());
    setItemPickerOpen(false);
  }

  // 품목 검색 매칭 (코드·품명·메이커·규격·분류·구매처·비고)
  function lineMatchesSearch(ln) {
    const kw = itemSearch.trim().toLowerCase();
    if (!kw) return true;
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    const supName = master?.defaultSupplierId
      ? suppliers.find((s) => s.id === master.defaultSupplierId)?.name || ''
      : '';
    const dispName = ln.itemId && master ? master.name : ln.name;
    return [master?.code, dispName, master?.maker, master?.spec || ln.spec, master?.category, supName, ln.note].some(
      (v) => (v || '').toLowerCase().includes(kw),
    );
  }

  async function removeLine(idx) {
    if (!(await confirm('이 품목 행을 삭제하시겠습니까?'))) return;
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
            unitPrice: m && m.standardPrice != null ? Number(m.standardPrice) : Number(b.unitPrice) || 0,
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
  useEffect(() => {
    formRef.current = form;
  }, [form]);
  const purchaseRef = useRef(purchase); // 입고 액션에서 최신 purchase 참조용
  useEffect(() => {
    purchaseRef.current = purchase;
  }, [purchase]);
  const autoSaveRef = useRef(null);

  // ---- Ctrl+Z 실행취소 ----
  const undoStackRef = useRef([]); // 폼 스냅샷 스택 (최대 30개)
  const skipUndoPushRef = useRef(false); // 마스터 자동 동기화 시 push 방지
  const handleUndoRef = useRef(null);

  function pushUndo() {
    if (skipUndoPushRef.current) return;
    const clone = JSON.parse(JSON.stringify(formRef.current));
    undoStackRef.current.push(clone);
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();
  }

  function handleUndo() {
    const s = undoStackRef.current;
    if (s.length === 0) return;
    const prev = s.pop();
    setForm(prev);
    if (autoSaveRef.current) { clearTimeout(autoSaveRef.current); autoSaveRef.current = null; }
    setSaveState('saving');
    autoSaveRef.current = setTimeout(() => persistPO(), 700);
  }
  handleUndoRef.current = handleUndo;

  useEffect(() => {
    function onKeyDown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (undoStackRef.current.length > 0) {
        // 로컬 폼 스냅샷이 있으면 로컬 undo 우선 처리, 전역 핸들러는 차단
        e.preventDefault();
        e.stopImmediatePropagation();
        handleUndoRef.current?.();
      }
      // 로컬 스택이 비어있으면 전역 UndoContext 핸들러가 처리
    }
    window.addEventListener('keydown', onKeyDown, true); // capture phase: 전역보다 먼저 실행
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

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
    // 품목에서 구매처가 도출되면 그 값으로, 아니면 기존(등록 시 수동 선택) 구매처 유지
    const derived = deriveSupplier(items, itemMaster, suppliers);
    const supplierId = derived.supplierId || purchaseRef.current?.supplierId || '';
    const supplierName = derived.supplierId ? derived.supplierName : purchaseRef.current?.supplierName || '';
    try {
      setSaveState('saving');
      await updatePurchase(id, {
        title: f.title.trim(),
        siteId: f.siteId,
        siteName: site?.name || '',
        factoryKey: f.factoryKey || '',
        deliveryPlace: f.deliveryPlace || '',
        items,
        totalAmount,
        supplierId,
        supplierName,
        note: f.note,
      });
      const updated = {
        ...(purchaseRef.current || {}),
        items,
        totalAmount,
        supplierId,
        supplierName,
        note: f.note,
        title: f.title.trim(),
        siteId: f.siteId,
        siteName: site?.name || '',
        factoryKey: f.factoryKey || '',
        deliveryPlace: f.deliveryPlace || '',
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
    pushUndo(); // 변경 직전 상태를 스냅샷 (formRef.current는 아직 이전 값)
    setSaveState('saving');
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      persistPO();
    }, 700);
  }

  async function flushAutoSave() {
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = null;
    }
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

  // 출력 시점 발주서 상태 스냅샷 (supplierOverride: 특정 업체만 출력)
  function buildPrintSnapshot(supplierOverride) {
    const filterSup = supplierOverride !== undefined ? supplierOverride : printSupplierFilter;
    const od = purchase.orderedAt?.toDate
      ? purchase.orderedAt.toDate()
      : purchase.orderedAt
        ? new Date(purchase.orderedAt)
        : purchase.createdAt?.toDate
          ? purchase.createdAt.toDate()
          : new Date();
    const supplier = suppliers.find((s) => s.id === purchase.supplierId);
    return {
      title: purchase.title || '',
      siteName: sites.find((s) => s.id === purchase.siteId)?.name || purchase.siteName || '',
      deliveryPlace: form.deliveryPlace || purchase.deliveryPlace || SELF_INFO.address,
      deliveryDue: purchase.deliveryDue || PO_DEFAULTS.delivery,
      payment: purchase.payment || PO_DEFAULTS.payment,
      contactName: purchase.contactName || purchase.requesterName || '',
      contactPhone: purchase.contactPhone || '',
      supplierName: filterSup || supplier?.name || derivedSupplier || '',
      note: form.note || '',
      orderDateKo: `${od.getFullYear()}년 ${od.getMonth() + 1}월 ${od.getDate()}일`,
      poNumber: poNumber(purchase),
      printSupplier: filterSup || '',
      items: mapPrintItems(form.items.filter((ln) => (ln.name || '').trim()))
        .filter((ln) => !filterSup || (ln._supplier || '(구매처 미지정)') === filterSup)
        .map((ln) => ({
          itemId: ln.itemId || '',
          _name: ln._name || '',
          _spec: ln._spec || '',
          _supplier: ln._supplier || '',
          qty: Number(ln.qty) || 0,
          unitPrice: Number(ln.unitPrice) || 0,
          receivedQty: Number(ln.receivedQty) || 0,
          note: ln.note || '',
        })),
    };
  }

  // 발주서 출력 이력 기록 (PDF 출력 시 — 스냅샷 저장 + 횟수 갱신)
  function recordPrint(supplierOverride) {
    if (!id) return;
    const snapshot = buildPrintSnapshot(supplierOverride);
    const next = {
      lastPrintedAt: new Date(),
      lastPrintedBy: userProfile?.name || '',
      printCount: (Number(purchaseRef.current?.printCount) || 0) + 1,
    };
    setPurchase((p) => ({ ...(p || {}), ...next }));
    purchaseRef.current = { ...(purchaseRef.current || {}), ...next };
    Promise.all([updatePurchase(id, next), addPurchasePrintLog(id, snapshot, userProfile?.name || '')]).catch((e) =>
      console.error('출력 이력 저장 오류:', e),
    );
  }

  // 특정 업체 품목만 PDF 출력 (발주완료도 함께 표시)
  function printForSupplier(supName) {
    setPrintSupplierFilter(supName);
    setPrintStamp(fmtDateTime(new Date()));
    setTimeout(() => {
      recordPrint(supName);
      window.print();
      setPrintSupplierFilter(null);
      const sentKey = supName.replace(/\./g, '_');
      if (!purchaseRef.current?.supplierSent?.[sentKey]) markSent(supName);
    }, 140);
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
    setPrintStamp(fmtDateTime(new Date()));
    const t = setTimeout(() => {
      window.print();
      setViewSnapshot(null);
    }, 180);
    return () => clearTimeout(t);
  }, [viewSnapshot]);

  // PDF 자료실 저장 모달 열기 — 기본 파일명/스탬프 세팅
  function openPdfModal() {
    if (!purchase) return;
    const no = poNumber(purchase);
    const safeTitle = (purchase.title || '발주서').replace(/[/\\]/g, '_');
    setPdfFileName(`${no}_${safeTitle}`);
    setPdfModalOpen(true);
  }

  // 「PDF 출력」 — 대표님이 가장 선명하다고 하신 브라우저 인쇄(window.print)를 그대로 유지.
  function handlePdfOutput() {
    setPrintStamp(fmtDateTime(new Date()));
    recordPrint();
    setTimeout(() => window.print(), 120);
  }

  // 자료실 저장 — 버튼 누르면 즉시 모달을 닫고 PDF 생성·업로드는 백그라운드로 진행.
  // 대표님은 대기하지 않고 바로 다른 작업을 할 수 있으며, 완료/실패는 토스트로만 알린다.
  function handleSavePdfToLibrary() {
    const el = printRef.current;
    if (!el) {
      alert('인쇄 양식을 찾을 수 없습니다.');
      return;
    }
    const fileName = `${pdfFileName || '발주서'}.pdf`;
    const folderId = pdfFolderId || null;
    // 모달 즉시 닫기 + 백그라운드 시작 알림
    setPdfModalOpen(false);
    toast(`"${fileName}" 자료실 저장을 시작했습니다…`);
    // fire-and-forget — await로 화면을 막지 않음
    (async () => {
      try {
        await flushAutoSave();
        setPrintStamp(fmtDateTime(new Date()));
        await new Promise((r) => setTimeout(r, 80));
        const blob = await captureToPdfBlob(el, fileName);
        await uploadPdfToLibrary(blob, pdfFileName, folderId, userProfile);
        recordPrint();
        toast(`자료실에 저장되었습니다: ${fileName}`);
      } catch (err) {
        toast(`자료실 저장 실패: ${err?.message || err}`, 'error');
      }
    })();
  }

  // 페이지 이탈 시 미저장분 flush
  useEffect(
    () => () => {
      if (autoSaveRef.current) {
        clearTimeout(autoSaveRef.current);
        persistPO();
      }
    },
    [],
  );

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
    const msg =
      mode === 'close-as-is'
        ? '현재 입고된 수량으로 발주 수량을 정정하고 입고를 종결합니다.\n미입고 라인은 수량 0으로 처리됩니다. 계속할까요?'
        : `잔여 ${remainingCount}개 라인을 동일 입고일로 일괄 입고 처리하시겠습니까?`;
    if (!(await confirm(msg))) return;
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
    if (!(await confirm('이 라인의 입고 기록을 취소하시겠습니까?'))) return;
    try {
      await receivePurchaseLine(purchaseRef.current, lineIdx, {
        qty: 0,
        date: null,
        note: '',
        receivedBy: '',
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
    if (
      !(await confirm(
        `"${purchase.title}" 건을 정산하시겠습니까?\n금액 ${Number(purchase.totalAmount || 0).toLocaleString()}원이 ${where} 지출로 자동 등록됩니다.`,
      ))
    )
      return;
    try {
      await settlePurchase(purchase, userProfile?.name || '');
      await loadData({ silent: true });
    } catch (err) {
      alert('정산 중 오류: ' + err.message);
    }
  }

  async function handleCancelSettle() {
    if (!purchase) return;
    if (
      !(await confirm(
        `"${purchase.title}" 정산을 취소하시겠습니까?\n등록된 지출 항목이 삭제되고, 품목 단가 이력에서도 이 구매 기록이 제거됩니다.\n구매 상태는 '입고'로 되돌아갑니다.`,
      ))
    )
      return;
    try {
      await cancelSettlePurchase(purchase);
      await loadData({ silent: true });
    } catch (err) {
      alert('정산 취소 중 오류: ' + err.message);
    }
  }

  async function handleTrashPurchase() {
    if (!(await confirm(`"${purchase.title}" 발주 건을 휴지통으로 이동하시겠습니까?`))) return;
    try {
      await flushAutoSave();
      const tid = await trashPurchase(id, userProfile?.name || '');
      const title = purchase.title;
      const purchaseId = id;
      navigate('/admin/purchase');
      if (tid) pushGlobalUndo(`발주 "${title}" 삭제`, async () => {
        await restoreTrashItem(tid);
        navigate(`/admin/purchase/${purchaseId}`);
      });
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  }

  async function handleConfirmPurchase() {
    if (!(await confirm(`"${purchase.title}" 발주를 확정하시겠습니까?\n대기 → 발주 상태로 변경됩니다.`))) return;
    try {
      await flushAutoSave();
      await confirmPurchase(id, userProfile?.name || '');
      await loadData({ silent: true });
    } catch (err) {
      alert('발주 확정 중 오류: ' + err.message);
    }
  }

  // 현재 품목들을 구매처별로 그룹화한 목록 — 발주현황 표·자동전환 판정 공용
  function computeSupplierList() {
    const cur = purchaseRef.current || purchase;
    const fallbackSup = cur?.supplierId ? suppliers.find((s) => s.id === cur.supplierId) : null;
    const supMap = new Map();
    for (const ln of form.items) {
      if (!(ln.name || '').trim()) continue;
      const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
      const supId = master?.defaultSupplierId || '';
      const sup = (supId ? suppliers.find((s) => s.id === supId) : null) || fallbackSup || null;
      const supName = sup?.name || cur?.supplierName || '(구매처 미지정)';
      if (!supMap.has(supName)) supMap.set(supName, { name: supName, email: sup?.email || '', count: 0 });
      supMap.get(supName).count++;
    }
    return [...supMap.values()];
  }

  // 모든 업체 발주완료 + 현재 '대기' 상태면 → '발주'로 자동 확정 (확인창 없이)
  async function maybeAutoConfirm(sentMap) {
    const cur = purchaseRef.current || purchase;
    if (!cur || (cur.status || 'draft') !== 'draft') return; // 대기 상태에서만 자동 전환
    const supList = computeSupplierList();
    if (supList.length === 0) return;
    const allSent = supList.every((s) => sentMap[s.name.replace(/\./g, '_')]);
    if (!allSent) return;
    try {
      await confirmPurchase(id, userProfile?.name || '');
      await loadData({ silent: true });
      toast('모든 품목 발주완료 — 「발주」 상태로 이동했습니다.');
    } catch (err) {
      console.error('자동 발주 전환 오류:', err);
    }
  }

  // 발주완료 마킹 (확인창 없이 바로 — 메일 발송 후 자동 호출용)
  async function markSent(supplierName) {
    try {
      const poNo = await markSupplierSent(id, supplierName, userProfile?.name || '');
      const sentKey = supplierName.replace(/\./g, '_');
      const prevEntry = purchaseRef.current?.supplierSent?.[sentKey];
      const nextSent = {
        ...(purchaseRef.current?.supplierSent || {}),
        [sentKey]: { sentAt: new Date(), sentBy: userProfile?.name || '', poNo: prevEntry?.poNo || poNo },
      };
      purchaseRef.current = { ...(purchaseRef.current || {}), supplierSent: nextSent };
      setPurchase((prev) => ({ ...prev, supplierSent: nextSent }));
      await maybeAutoConfirm(nextSent);
    } catch (err) {
      alert('처리 중 오류: ' + err.message);
    }
  }

  async function handleMarkSupplierSent(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체에 발주 완료 표시하시겠습니까?`))) return;
    await markSent(supplierName);
  }

  // 메일 발송 → 메일 클라이언트 열고 발주완료 자동 표시
  function handleSendMail(supplierName, mailtoHref) {
    window.location.href = mailtoHref; // 메일 클라이언트 열기
    const sentKey = supplierName.replace(/\./g, '_');
    if (!purchase.supplierSent?.[sentKey]) {
      markSent(supplierName); // 아직 미발주면 완료 표시
    }
  }

  async function handleUnmarkSupplierSent(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체의 발주 완료 표시를 취소하시겠습니까?`))) return;
    try {
      await unmarkSupplierSent(id, supplierName);
      const sentKey = supplierName.replace(/\./g, '_');
      setPurchase((prev) => {
        const next = { ...(prev.supplierSent || {}) };
        delete next[sentKey];
        return { ...prev, supplierSent: next };
      });
    } catch (err) {
      alert('취소 중 오류: ' + err.message);
    }
  }

  if (loading || !purchase) return <div className="loading">로딩 중...</div>;

  const status = purchase.status || 'ordered';
  const derivedSupplier =
    purchase.supplierName ||
    (() => {
      const { supplierName } = deriveSupplier(form.items, itemMaster, suppliers);
      return supplierName;
    })();

  return (
    <div className="purchase-detail-page printable-page">
      <style>{`
        @media (max-width: 480px) {
          .purchase-recv-bulk-list li { flex-direction: column; gap: 4px; }
          .purchase-recv-bulk-qty { align-self: flex-start; }
          .inline-edit-table td input, .inline-edit-table td[data-label] { min-width: 60px; word-break: break-word; overflow-wrap: break-word; }
          .bom-flat-table { font-size: 12px; }
          .bom-flat-table th, .bom-flat-table td { padding: 6px 4px; }
          .bom-flat-table tbody tr { min-height: 36px !important; }
          .purchase-detail-top-actions { gap: 2px !important; }
          .purchase-detail-top-actions .btn { font-size: 12px; padding: 0 10px; }
        }
        @media (max-width: 390px) {
          .purchase-detail-top-actions { flex-wrap: nowrap !important; overflow-x: auto; }
          .purchase-detail-top-actions .btn { font-size: 11px !important; padding: 0 6px !important; white-space: nowrap; flex-shrink: 0; }
          .bom-flat-table tbody tr { min-height: 36px !important; }
          .u-right-numeric input { min-width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        }
        @media (max-width: 360px) {
          .bom-flat-table th { padding: 4px 2px !important; font-size: 10px; min-width: 35px; }
          .bom-flat-table td { padding: 4px 2px !important; }
          .bom-flat-table tbody tr { min-height: 34px !important; }
        }
        .page-actions.purchase-detail-top-actions .btn { height: var(--btn-h-sm, 36px); min-height: var(--btn-h-sm, 36px); }
        .bom-flat-table tbody tr { vertical-align: middle; min-height: 38px; }
        .bom-flat-table th { padding: 6px !important; }
        .bom-flat-table td { padding: 6px !important; }
        .purchase-detail-page { padding-bottom: 60px; }
        .purchase-line-item-wrap { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
        .purchase-line-item-wrap .purchase-line-item { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; }
      `}</style>
      <div className="page-header screen-only">
        <div className="purchase-detail-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2>{purchase.title || '(제목 없음)'}</h2>
          <span className={`purchase-badge purchase-badge-${STATUS[status]?.cls || 'ordered'}`}>
            {STATUS[status]?.label || status}
            {hasIssuedPo(purchase) && <span className="purchase-badge-pono">{poNumber(purchase)}</span>}
          </span>
        </div>
        <div
          className="page-actions purchase-detail-top-actions"
          style={{ flexWrap: 'wrap', gap: 4, alignItems: 'center', overflowX: 'auto' }}
        >
          <button type="button" className="btn btn-sm btn-outline" onClick={openPrintLogs}>
            출력 이력{purchase.printCount > 0 ? ` (${purchase.printCount})` : ''}
          </button>
          {!isReadOnly && (
            <>
              <button type="button" className="btn btn-sm btn-outline" onClick={openItemPicker}>
                <Icon name="plus" className="btn-ic" />
                품목 불러오기
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={openBomModal}>
                BOM 가져오기
              </button>
            </>
          )}
          {!isReadOnly && saveState === 'error' && (
            <span className="purchase-save-indicator error" aria-live="polite">
              <Icon name="alert" className="btn-ic" /> 저장 실패
            </span>
          )}
          {(status === 'ordered' || status === 'partial') &&
            (() => {
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
                      className="btn btn-sm btn-outline"
                      onClick={() => openBulk('remaining')}
                      title="잔여 라인 일괄 입고"
                    >
                      일괄 입고
                    </button>
                  )}
                  {status === 'partial' && hasAnyReceived && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => openBulk('close-as-is')}
                      title="현재 입고된 수량으로 발주 수량을 정정하고 종결"
                    >
                      잔여 무시하고 종결
                    </button>
                  )}
                </>
              );
            })()}
          {status === 'draft' && (
            <button type="button" className="btn btn-sm btn-primary" onClick={handleConfirmPurchase}>
              발주 확정
            </button>
          )}
          {status === 'received' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={handleSettle}>
              정산 처리
            </button>
          )}
          {status === 'settled' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={handleCancelSettle}>
              정산 취소
            </button>
          )}
          <button type="button" className="btn btn-sm btn-danger" onClick={handleTrashPurchase}>
            <Icon name="trash" className="btn-ic" />
            삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('/admin/purchase')}>
            목록
          </button>
        </div>
      </div>

      <div className="pdf-fab-group no-print">
        <button
          type="button"
          className="pdf-print-fab pdf-fab-secondary"
          onClick={openPdfModal}
          title="발주서를 PDF 파일로 만들어 사내 자료실에 저장합니다"
        >
          자료실 저장
        </button>
        <button
          type="button"
          className="pdf-print-fab"
          onClick={handlePdfOutput}
          title="브라우저 인쇄로 발주서를 출력합니다 (인쇄 대화상자에서 'PDF로 저장' 선택 가능)"
        >
          PDF 출력
        </button>
      </div>

      {/* 인쇄 전용 IOPN_v4 발주서 양식 */}
      {(() => {
        const supplier = suppliers.find((s) => s.id === purchase.supplierId);
        const site = sites.find((s) => s.id === purchase.siteId);
        const liveOrderDate = purchase.orderedAt?.toDate
          ? purchase.orderedAt.toDate()
          : purchase.orderedAt
            ? new Date(purchase.orderedAt)
            : purchase.createdAt?.toDate
              ? purchase.createdAt.toDate()
              : new Date();
        const liveOrderDateKo = `${liveOrderDate.getFullYear()}년 ${liveOrderDate.getMonth() + 1}월 ${liveOrderDate.getDate()}일`;
        const liveSupplierTitle = supplier?.name
          ? `${supplier.name} 귀하`
          : derivedSupplier
            ? `${derivedSupplier} 귀하`
            : '';

        // 출력 소스: 이력 보기 중이면 그 시점 스냅샷, 아니면 현재(라이브) 데이터
        const src = viewSnapshot
          ? {
              siteName: viewSnapshot.siteName || '',
              deliveryPlace: viewSnapshot.deliveryPlace || SELF_INFO.address,
              deliveryDue: viewSnapshot.deliveryDue || PO_DEFAULTS.delivery,
              payment: viewSnapshot.payment || PO_DEFAULTS.payment,
              contactLine: [viewSnapshot.contactName || '', viewSnapshot.contactPhone || '']
                .filter(Boolean)
                .join(' / '),
              note: viewSnapshot.note || '',
              orderDateKo: viewSnapshot.orderDateKo || liveOrderDateKo,
              poNum: viewSnapshot.poNumber || poNumber(purchase),
              supplierTitle: viewSnapshot.supplierName ? `${viewSnapshot.supplierName} 귀하` : '',
              supplierLabel: viewSnapshot.printSupplier || '',
              items: viewSnapshot.items || [],
            }
          : {
              siteName: site?.name || purchase.siteName || '',
              deliveryPlace: form.deliveryPlace || purchase.deliveryPlace || SELF_INFO.address,
              deliveryDue: purchase.deliveryDue || PO_DEFAULTS.delivery,
              payment: purchase.payment || PO_DEFAULTS.payment,
              contactLine: [purchase.contactName || purchase.requesterName || '', purchase.contactPhone || '']
                .filter(Boolean)
                .join(' / '),
              note: form.note,
              orderDateKo: liveOrderDateKo,
              // 업체별 출력이면 그 업체 발행번호, 전체 출력이면 발주 건 대표 발행번호
              poNum: printSupplierFilter
                ? purchase.supplierSent?.[printSupplierFilter.replace(/\./g, '_')]?.poNo || poNumber(purchase)
                : poNumber(purchase),
              supplierTitle: printSupplierFilter ? `${printSupplierFilter} 귀하` : liveSupplierTitle,
              supplierLabel: printSupplierFilter || '',
              // 특정 업체 출력이면 그 업체 품목만
              items: mapPrintItems(form.items).filter(
                (ln) => !printSupplierFilter || (ln._supplier || '(구매처 미지정)') === printSupplierFilter,
              ),
            };

        // 항상 1장 (특정 업체 또는 전체)
        const docs = [
          {
            recvTitle: src.supplierTitle,
            supplierLabel: src.supplierLabel || '',
            items: src.items.filter((ln) => (ln._name || ln.name || '').trim()),
          },
        ];

        // 행 개수 기반 페이지 분할 — 페이지를 거의 채우고 하단엔 합계·특이사항 크기(TOTALS_ROWS)만큼만 공백을 남김.
        // 1페이지는 상단 정보표 높이(INFO_ROWS)만큼 행을 줄여 다른 페이지와 하단 공백을 동일하게 맞춤.
        const OTHER_PAGE_ROWS = 33; // 일반 페이지(페이지를 거의 채우는 행수)
        const INFO_ROWS = 11; // 1페이지 상단 제목+정보표가 차지하는 행수
        const TOTALS_ROWS = 5; // 마지막 페이지 합계+특이사항이 차지하는 행수(= 모든 페이지 하단 공백 크기)
        const FIRST_PAGE_ROWS = OTHER_PAGE_ROWS - INFO_ROWS;

        // 한 문서(구매처)를 페이지 div 배열로 렌더
        const renderDoc = (rows, recvTitle, supplierLabel, docKey) => {
          const supplyAmount = rows.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0);
          const totalQty = rows.reduce((s, ln) => s + (Number(ln.qty) || 0), 0);
          const vat = Math.round(supplyAmount * 0.1);
          const grandTotal = supplyAmount + vat;
          // 행 개수로 페이지 분할
          const pages = [];
          let i = 0;
          while (i < rows.length) {
            const size = pages.length === 0 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
            pages.push({ chunk: rows.slice(i, i + size), startNo: i });
            i += size;
          }
          if (pages.length === 0) pages.push({ chunk: [], startNo: 0 });
          // 합계는 마지막 내용 페이지의 남는 공간에 그대로 출력 (별도 페이지 추가 안 함).
          // 단, 마지막 페이지가 물리적으로 꽉 차서 합계가 안 들어갈 때만 전용 페이지 추가.
          const lastFill = (pages.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS) + TOTALS_ROWS;
          if (pages[pages.length - 1].chunk.length + TOTALS_ROWS > lastFill) {
            pages.push({ chunk: [], startNo: rows.length });
          }
          const pageCount = pages.length;

          return pages.map((pg, pageIdx) => {
            const isFirst = pageIdx === 0;
            const isLast = pageIdx === pageCount - 1;
            const cap = isFirst ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
            let targetRows = cap - (isLast ? TOTALS_ROWS : 0);
            // 한 장짜리 짧은 발주서는 품목 + 소량 여유만 채워 표 아래 빈칸·하단 여백 최소화
            if (isLast && pageCount === 1) targetRows = Math.min(targetRows, pg.chunk.length + 4);
            const padded = [...pg.chunk];
            while (padded.length < targetRows) padded.push(null);
            return (
              <div className="bom-print-page po-doc-page" key={`${docKey}-${pageIdx}`}>
                {isFirst && <div className="print-form-title po-form-title">구매발주서</div>}

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
                          <span className="iopn-amount-sub">
                            {' '}
                            (공급가액 {supplyAmount.toLocaleString()} + VAT {vat.toLocaleString()})
                          </span>
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
                      <th className="c-note">비고</th>
                    </tr>
                  </thead>
                  <tbody>
                    {padded.map((ln, r) => {
                      if (!ln)
                        return (
                          <tr key={`e-${r}`}>
                            <td className="c-no"></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                            <td></td>
                          </tr>
                        );
                      const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                      const q = Number(ln.qty) || 0;
                      const rq = Number(ln.receivedQty) || 0;
                      const recvText = q <= 0 ? '' : rq >= q ? '완료' : rq > 0 ? `${rq}/${q}` : '미입고';
                      return (
                        <tr key={r}>
                          <td className="c-no">{pg.startNo + r + 1}</td>
                          <td className={`c-name ${specFontClass(ln._name, 11)}`} title={ln._name || ''}>
                            {ln._name || ''}
                          </td>
                          <td className="c-spec" title={ln._spec || ''}>
                            {ln._spec || ''}
                          </td>
                          <td className="c-qty">{Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}</td>
                          <td className="c-price">
                            {Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}
                          </td>
                          <td className="c-amount">{amount ? amount.toLocaleString() : ''}</td>
                          <td className={`c-recv ${rq >= q && q > 0 ? 'recv-done' : rq === 0 ? 'recv-none' : ''}`}>
                            {recvText}
                          </td>
                          <td className={`c-note ${specFontClass(ln.note, 11)}`} title={ln.note || ''}>
                            {ln.note || ''}
                          </td>
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

                <div className="bom-print-footer">
                  <span>
                    (주)아이오피엔 · 구매발주서{supplierLabel ? ` · ${supplierLabel}` : ''} · {src.poNum}
                  </span>
                  <span>{printStamp ? `출력 ${printStamp}` : ''}</span>
                  <span>
                    페이지 {pageIdx + 1} / {pageCount}
                  </span>
                </div>
              </div>
            );
          });
        };

        return (
          <div ref={printRef} className="print-form-iopn print-form-paged print-only">
            {docs.map((d, di) => renderDoc(d.items, d.recvTitle, d.supplierLabel, `doc${di}`))}
          </div>
        );
      })()}

      <div className="purchase-meta-bar screen-only">
        <div className="purchase-meta-items">
          <span title={purchase.siteName || ''}>
            <em>프로젝트</em>
            {purchase.siteName || '-'}
          </span>
          <span title={purchase.requesterName || ''}>
            <em>등록자</em>
            {purchase.requesterName || '-'}
          </span>
          <span title={fmtDate(purchase.orderedAt || purchase.createdAt)}>
            <em>발주일</em>
            {fmtDate(purchase.orderedAt || purchase.createdAt)}
          </span>
          <span title={derivedSupplier || ''}>
            <em>구매처</em>
            {derivedSupplier || <span className="text-muted">자동 (품목 미선택)</span>}
          </span>
          {purchase.receivedBy && (
            <span title={`${purchase.receivedBy} · ${fmtDate(purchase.receivedAt)}`}>
              <em>입고</em>
              {purchase.receivedBy} · {fmtDate(purchase.receivedAt)}
            </span>
          )}
          {purchase.settledBy && (
            <span title={`${purchase.settledBy} · ${fmtDate(purchase.settledAt)}`}>
              <em>정산</em>
              {purchase.settledBy} · {fmtDate(purchase.settledAt)}
            </span>
          )}
        </div>
      </div>

      <div className="form-group screen-only">
        <label>품목</label>
        <p className="field-hint">
          우측 상단 「품목 불러오기」로 구매 품목을 선택해 추가하세요. 입력 즉시 자동 저장됩니다. 구매처는 첫 품목의
          기본 구매처로 자동 적용.
        </p>
        {form.items.length > 0 && (
          <input
            type="text"
            className="purchase-filter-search"
            style={{ width: '100%', maxWidth: 340, marginBottom: 8 }}
            placeholder="품목 검색 (코드 · 품명 · 메이커 · 규격 · 분류 · 구매처)"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
          />
        )}
        <div className="item-group is-expanded bom-flat-group">
          <div className="item-group-detail">
            <div className="table-scroll-x">
              <table className="table inline-edit-table cards-sm bom-flat-table">
                <thead>
                  <tr>
                    <th className="bom-no-col">No</th>
                    <th style={{ minWidth: 90 }}>코드</th>
                    <th style={{ minWidth: 120 }}>품명</th>
                    <th>메이커</th>
                    <th>규격</th>
                    <th>분류</th>
                    <th>인증</th>
                    <th>moq/단위</th>
                    <th>수량</th>
                    <th>단가</th>
                    <th>합계</th>
                    <th>기본 구매처</th>
                    <th style={{ minWidth: 120 }}>비고</th>
                    <th style={{ minWidth: 130 }} className="no-print">
                      입고
                    </th>
                    <th className="bom-action-col no-print" aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.items.length === 0 && (
                    <tr>
                      <td colSpan={15} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
                        품목이 없습니다 — 상단 「품목 불러오기」로 시작하세요.
                      </td>
                    </tr>
                  )}
                  {form.items.length > 0 && itemSearch.trim() && !form.items.some(lineMatchesSearch) && (
                    <tr>
                      <td colSpan={15} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
                        "{itemSearch}" 검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                  {form.items.map((ln, idx) => {
                    if (!lineMatchesSearch(ln)) return null;
                    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
                    const amount = (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0);
                    const lineSupplierName = master?.defaultSupplierId
                      ? suppliers.find((s) => s.id === master.defaultSupplierId)?.name || ''
                      : '';
                    // 입고 상태는 라인 자체 데이터로 — 삭제·인덱스 변동에 영향받지 않음 (입고 클릭 시 자동저장 flush)
                    const savedQty = Number(ln.qty) || 0;
                    const receivedQty = Number(ln.receivedQty) || 0;
                    const isLineSaved = (ln.name || '').trim().length > 0;
                    const isFullyReceived = isLineSaved && savedQty > 0 && receivedQty >= savedQty;
                    return (
                      <tr key={idx}>
                        <td className="bom-no-col" data-label="No">
                          {idx + 1}
                        </td>
                        <td data-label="코드">
                          <input
                            type="text"
                            className="bom-readonly-input bom-code-input"
                            value={master?.code || ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="품명" title={(ln.itemId && master) ? master.name : (ln.name || '')} style={{ minWidth: 90, maxWidth: 200 }}>
                          <div className="purchase-line-item-wrap">
                            <input
                              className="purchase-line-item"
                              type="text"
                              placeholder="품목 불러오기 또는 직접 입력"
                              value={(ln.itemId && master) ? master.name : ln.name}
                              title={(ln.itemId && master) ? master.name : (ln.name || '')}
                              onChange={(e) => updateLineName(idx, e.target.value)}
                              autoComplete="off"
                              disabled={isReadOnly}
                            />
                          </div>
                        </td>
                        <td data-label="메이커" title={master?.maker || ''}>
                          <input
                            type="text"
                            className="bom-readonly-input"
                            value={master?.maker || ''}
                            title={master?.maker || ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="규격" title={master?.spec || ln.spec || ''}>
                          <input
                            type="text"
                            className="bom-readonly-input"
                            value={master?.spec || ln.spec || ''}
                            title={master?.spec || ln.spec || ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="분류" title={master?.category || ''}>
                          <input
                            type="text"
                            className="bom-readonly-input"
                            value={master?.category || ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="인증" title={master?.certification || ''}>
                          <input
                            type="text"
                            className="bom-readonly-input"
                            value={master?.certification || ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="moq/단위" title={master?.unit || ln.unit || ''}>
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
                            type="number"
                            min="0"
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
                        <td data-label="합계" title={amount ? amount.toLocaleString() : ''}>
                          <input
                            type="text"
                            className="bom-readonly-input bom-amount-input"
                            value={amount ? amount.toLocaleString() : ''}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="기본 구매처" title={lineSupplierName}>
                          <input
                            type="text"
                            className="bom-readonly-input"
                            value={lineSupplierName}
                            readOnly
                            tabIndex={-1}
                          />
                        </td>
                        <td data-label="비고" title={ln.note || ''} style={{ minWidth: 90 }}>
                          <input
                            type="text"
                            value={ln.note || ''}
                            title={ln.note || ''}
                            placeholder="-"
                            onChange={(e) => updateLine(idx, { note: e.target.value })}
                            disabled={isReadOnly}
                          />
                        </td>
                        <td data-label="입고" className="no-print">
                          <div
                            className="purchase-line-recv"
                            style={{ minHeight: 36, display: 'flex', alignItems: 'center' }}
                          >
                            {!isLineSaved ? (
                              <span
                                className="purchase-line-recv-hint"
                                style={{ display: 'inline-flex', alignItems: 'center', height: 32 }}
                              >
                                저장 후 입고
                              </span>
                            ) : receivedQty > 0 ? (
                              isReadOnly ? (
                                // 정산완료 등 읽기전용 — 상태만 표시
                                <span className={`purchase-recv-chip is-readonly ${isFullyReceived ? 'is-full' : 'is-partial'}`}>
                                  <span className="purchase-recv-chip-qty">
                                    {isFullyReceived ? '완료' : '부분'} {receivedQty}/{savedQty}
                                  </span>
                                  <span className="purchase-recv-chip-date">{fmtDate(ln.receivedAt)}</span>
                                </span>
                              ) : (
                                // 입고됨 — 누르면 바로 입고 취소 (별도 되돌리기 버튼 없음)
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger purchase-recv-cancel"
                                  onClick={() => clearLineReceive(idx)}
                                  title="클릭하면 입고 기록을 취소합니다"
                                >
                                  <span className="purchase-recv-cancel-status">
                                    {isFullyReceived ? '완료' : '부분'} {receivedQty}/{savedQty} · {fmtDate(ln.receivedAt)}
                                  </span>
                                  <span className="purchase-recv-cancel-act">입고 취소</span>
                                </button>
                              )
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
                          </div>
                        </td>
                        <td className="bom-action-col no-print">
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => removeLine(idx)}
                            aria-label="행 삭제"
                            disabled={isReadOnly}
                            title="삭제"
                          >
                            <Icon name="trash" className="btn-ic" />삭제
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="purchase-total-row screen-only">
        <span>합계</span>
        <strong>{formTotal.toLocaleString()}원</strong>
      </div>

      {/* 업체별 발주 현황 — 메일 발송·발주 완료 추적 (품목 아래) */}
      {(() => {
        const supList = computeSupplierList();
        if (supList.length === 0) return null;
        const sentCount = supList.filter((s) => purchase.supplierSent?.[s.name.replace(/\./g, '_')]).length;
        return (
          <div className="form-group screen-only">
            <label>
              업체별 발주 현황
              <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                {supList.length}개 업체 · {sentCount}개 발주완료
              </span>
            </label>
            <p className="field-hint">
              각 업체별로 「PDF 출력」하면 그 업체 품목만 발주서가 만들어집니다(출력 시 발주완료 자동 표시). 메일 발송도
              동일하게 발주완료로 표시됩니다.
            </p>
            {!isReadOnly && (
              <div
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>납품 공장</span>
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
                      scheduleAutoSave();
                    }}
                    placeholder="선택"
                    options={factories.map((f) => ({ value: f.name, label: f.name }))}
                    ariaLabel="납품 공장 선택"
                    style={{ width: 120, flexShrink: 0 }}
                  />
                )}
                <input
                  type="text"
                  placeholder="납품 장소 주소 (발주서에 표시)"
                  value={form.deliveryPlace}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, deliveryPlace: e.target.value }));
                    scheduleAutoSave();
                  }}
                  style={{ flex: 1, minWidth: 180 }}
                />
              </div>
            )}
            <div className="table-scroll-x">
              <table className="table inline-edit-table cards-sm">
                <thead>
                  <tr>
                    <th style={{ minWidth: 140 }}>구매처</th>
                    <th style={{ width: 110 }}>품목</th>
                    <th style={{ width: 240, paddingLeft: 24 }}>발주 상태</th>
                    <th className="col-action" style={{ width: '100%' }}>
                      작업
                    </th>
                  </tr>
                </thead>
                    <tbody>
                      {supList.map((sup) => {
                        const sentKey = sup.name.replace(/\./g, '_');
                        const sent = purchase.supplierSent?.[sentKey];
                        const mailSubject = `[발주] ${purchase.title || ''} - ${purchase.siteName || ''}`;
                        const mailBody = `안녕하세요,\n\n발주서를 첨부하여 보내드립니다.\n\n프로젝트: ${purchase.siteName || ''}\n발주 건명: ${purchase.title || ''}\n\n감사합니다.\n\n(주)아이오피엔`;
                        return (
                          <tr key={sup.name}>
                            <td data-label="구매처" title={sup.name}>
                              <strong>{sup.name}</strong>
                            </td>
                            <td data-label="품목">{sup.count}품목</td>
                            <td data-label="발주 상태" style={{ paddingLeft: 24 }}>
                              {sent ? (
                                <span className="purchase-badge purchase-badge-received">
                                  발주완료 · {fmtDate(sent.sentAt)}
                                  {sent.poNo ? (
                                    <strong className="purchase-sup-pono"> · {sent.poNo}</strong>
                                  ) : (
                                    ''
                                  )}
                                </span>
                              ) : (
                                <span className="purchase-badge purchase-badge-draft">미발주</span>
                              )}
                            </td>
                            <td data-label="작업" className="col-action">
                              <div className="row-actions purchase-sup-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-primary"
                                  onClick={() => printForSupplier(sup.name)}
                                  title={`${sup.name} 품목만 발주서 PDF 출력`}
                                >
                                  <Icon name="download" className="btn-ic" />
                                  PDF 출력
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn-sm btn-outline${sup.email ? '' : ' is-no-email'}`}
                                  onClick={() => {
                                    if (!sup.email) {
                                      alert(`"${sup.name}"에 등록된 이메일이 없습니다.\n구매처 관리에서 이메일을 먼저 등록해주세요.`);
                                      return;
                                    }
                                    handleSendMail(
                                      sup.name,
                                      `mailto:${sup.email}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`,
                                    );
                                  }}
                                  title={sup.email ? '발주서 메일 발송' : '이메일 미등록 — 구매처 관리에서 등록하세요'}
                                >
                                  메일 발송
                                </button>
                                {sent ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-danger purchase-sup-toggle"
                                    onClick={() => handleUnmarkSupplierSent(sup.name)}
                                  >
                                    발주 취소
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline purchase-sup-toggle"
                                    onClick={() => handleMarkSupplierSent(sup.name)}
                                  >
                                    발주 완료 표시
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
          </div>
        );
      })()}

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
        {bulkModal &&
          (() => {
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
                          <li
                            key={i}
                            style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap', minWidth: 0 }}
                          >
                            <span
                              className="purchase-recv-bulk-name u-wrap"
                              title={`${it.name || '(이름 없음)'}${it.spec ? ` (${it.spec})` : ''}`}
                              style={{
                                overflowWrap: 'break-word',
                                wordBreak: 'break-all',
                                minWidth: 0,
                                flex: '1 1 auto',
                              }}
                            >
                              {it.name || '(이름 없음)'}
                              {it.spec ? ` (${it.spec})` : ''}
                            </span>
                            <span className="purchase-recv-bulk-qty">
                              {isClose
                                ? `${r}${it.unit || ''} 종결`
                                : `${r}/${q}${it.unit || ''} → ${q}${it.unit || ''}`}
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
                  <button type="button" className="btn btn-outline" onClick={() => setBulkModal(null)}>
                    취소
                  </button>
                </div>
              </form>
            );
          })()}
      </Modal>

      <Modal isOpen={!!receiveModal} onClose={() => setReceiveModal(null)} title="입고 검수">
        {receiveModal && (
          <form onSubmit={submitReceive}>
            <div className="purchase-recv-modal-summary">
              <strong
                className="purchase-recv-modal-name"
                title={`${receiveModal.line.name || ''}${receiveModal.line.spec ? ` (${receiveModal.line.spec})` : ''}`}
              >
                {receiveModal.line.name}
                {receiveModal.line.spec ? ` (${receiveModal.line.spec})` : ''}
              </strong>
              <span className="purchase-recv-modal-meta">
                발주 {Number(receiveModal.line.qty) || 0}
                {receiveModal.line.unit || ''}
                {Number(receiveModal.line.receivedQty) > 0 && (
                  <>
                    {' '}
                    · 이전 입고 {Number(receiveModal.line.receivedQty)}
                    {receiveModal.line.unit || ''}
                  </>
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
                전체 {Number(receiveModal.line.qty) || 0}
                {receiveModal.line.unit || ''} 중 실제 입고된 수량을 입력하세요. 부분 입고 가능.
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
              모든 라인이 발주 수량만큼 입고되면 전체 상태가 '입고완료'로 자동 전환됩니다. 일부만 입고되면 '부분입고'로
              표시됩니다.
            </p>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary">
                저장
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setReceiveModal(null)}>
                취소
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={bomModalOpen} onClose={() => setBomModalOpen(false)} title="BOM에서 품목 가져오기">
        <p className="field-hint">
          선택한 BOM(프로젝트)의 품목·수량·단가를 이 발주에 불러옵니다. 불러온 뒤 목록·수량·단가(금액)를 수정할 수 있고,
          저장해야 반영됩니다.
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
                <span className="bom-import-go">
                  {bomImporting ? (
                    '가져오는 중...'
                  ) : (
                    <>
                      가져오기 <Icon name="chevronRight" className="btn-ic" />
                    </>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setBomModalOpen(false)}>
            닫기
          </button>
        </div>
      </Modal>

      <Modal isOpen={itemPickerOpen} onClose={() => setItemPickerOpen(false)} title="품목 선택">
        <form onSubmit={addPickedToPO}>
          <p className="field-hint">
            구매 품목 관리에 등록된 품목 중에서 선택해 발주에 추가합니다. 체크 후 수량을 입력하세요. (대분류 제외)
          </p>
          <div className="form-group">
            <input
              type="text"
              className="purchase-filter-search"
              style={{ width: '100%' }}
              placeholder="코드 · 품명 · 규격 · 분류 검색"
              value={itemPickerSearch}
              onChange={(e) => setItemPickerSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className="bom-picker-list">
            {(() => {
              const kw = itemPickerSearch.trim().toLowerCase();
              // 대분류(베어 메인) id 집합: 다른 하위 품목의 groupKey가 가리키는 id
              const mainIds = new Set(itemMaster.map((m) => m.groupKey).filter(Boolean));
              const list = itemMaster
                .filter((m) => !/^IOPN-\d+$/.test(m.code || '') && !mainIds.has(m.id)) // 대분류(베어 메인) 제외
                .filter((m) => {
                  if (!kw) return true;
                  return [m.code, m.name, m.spec, m.category].some((v) => (v || '').toLowerCase().includes(kw));
                });
              const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
              const sorted = list.sort((a, b) => collator.compare(a.code || '', b.code || ''));
              if (sorted.length === 0) {
                return (
                  <p className="purchase-empty">
                    {itemMaster.length === 0 ? '등록된 구매 품목이 없습니다.' : '검색 결과가 없습니다.'}
                  </p>
                );
              }
              return sorted.map((m) => (
                <label key={m.id} className={`bom-picker-row ${itemPicked.has(m.id) ? 'is-checked' : ''}`}>
                  <input type="checkbox" checked={itemPicked.has(m.id)} onChange={() => toggleItemPick(m.id)} />
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
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
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
            <button type="button" className="btn btn-outline" onClick={() => setItemPickerOpen(false)}>
              취소
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={printLogsOpen} onClose={() => setPrintLogsOpen(false)} title="발주서 출력 이력">
        <p className="field-hint">
          출력했던 시점의 발주서 상태가 저장되어 있습니다. 「이 시점 PDF 출력」을 누르면 그때 모습 그대로 다시 출력·PDF
          저장할 수 있습니다.
        </p>
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
                      {log.by || '-'} · {items.length}품목 · ₩{(total + vat).toLocaleString()}
                      {snap.printSupplier ? ` · ${snap.printSupplier}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    style={{ flexShrink: 0 }}
                    onClick={() => printSnapshot(log)}
                  >
                    이 시점 PDF 출력
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setPrintLogsOpen(false)}>
            닫기
          </button>
        </div>
      </Modal>

      <Modal isOpen={pdfModalOpen} onClose={() => setPdfModalOpen(false)} title="PDF로 자료실 저장">
        <p className="field-hint">
          현재 발주서 양식을 PDF 파일로 만들어 사내 자료실에 보관합니다. 저장 위치 폴더와 파일명을 지정하세요.
        </p>
        <div className="form-group">
          <label>파일명</label>
          <input
            type="text"
            value={pdfFileName}
            onChange={(e) => setPdfFileName(e.target.value)}
            placeholder="예: IOPN20260620_발주서"
          />
          <p className="field-hint">확장자(.pdf)는 자동으로 붙습니다.</p>
        </div>
        <div className="form-group">
          <label>저장 폴더</label>
          <Select
            value={pdfFolderId}
            onChange={setPdfFolderId}
            options={pdfFolders.map((f) => ({ value: f.id, label: f.label }))}
            placeholder="자료실 최상위 (폴더 없음)"
            ariaLabel="저장 폴더 선택"
          />
        </div>
        <p className="field-hint">
          「자료실에 저장」을 누르면 <strong>바로 닫히고</strong>, 생성·업로드는 뒤에서 진행됩니다. 완료되면 알림으로
          알려드려요 — 기다리실 필요 없습니다.
        </p>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSavePdfToLibrary}
            disabled={!pdfFileName.trim()}
          >
            자료실에 저장
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setPdfModalOpen(false)}>
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}
