import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { calcPaymentDue, paymentTermLabel } from '../../utils/paymentTerms';
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
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  getPurchaseById,
  updatePurchase,
  settlePurchase,
  cancelSettlePurchase,
  receivePurchaseLine,
  bulkReceivePurchase,
  setPurchaseStatus,
  getSuppliers,
  subscribePurchaseItems,
  confirmPurchase,
  markSupplierSent,
  unmarkSupplierSent,
  markSupplierReplied,
  unmarkSupplierReplied,
  markPaymentRequested,
  unmarkPaymentRequested,
  setPurchaseReplied,
  getPurchaseConfig,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { trashPurchase, restoreTrashItem } from '../../services/trashService';
import { getBomProjects, getBomBySite } from '../../services/bomService';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { useUndo } from '../../contexts/useUndo';
import Modal from '../../components/common/Modal';
import MoneyInput from '../../components/common/MoneyInput';
import Icon from '../../components/common/Icon';
import Select from '../../components/common/Select';
import Skeleton from '../../components/common/Skeleton';
import { subscribeFolders, ensureProjectFolders, ensureFolder } from '../../services/fileLibraryService';
import { captureToPdfBlob, uploadPdfToLibrary } from '../../utils/pdfExport';
import { callSendEmail, ensureAnonymousAuth } from '../../config/firebase';
import PurchaseOrderPrintForm from '../../components/admin/PurchaseOrderPrintForm';
import {
  PO_DEFAULTS,
  poDateStr,
  poNumber,
  deriveSupplier,
  computeSupplierList as computeSupplierListPure,
} from '../../utils/purchaseOrder';

const STATUS = {
  draft: { label: '발주대기', cls: 'draft' },
  ordered: { label: '발주완료', cls: 'ordered' },
  replied: { label: '회신', cls: 'replied' },
  partial: { label: '부분입고', cls: 'partial' },
  received: { label: '입고완료', cls: 'received' },
  settled: { label: '정산완료', cls: 'settled' },
  closed: { label: '종결', cls: 'closed' },
};

const EMPTY_LINE = { itemId: '', name: '', spec: '', unit: '', qty: 1, unitPrice: 0, box: '' };

// 창고에 있는 만큼은 사지 않는다 — 품목 재고(재고 탭에서 손으로 적는 값)를 발주 수량에서 뺀다.
// 뺀 사실은 stockUsed 로 줄에 남겨, 재고 숫자가 틀렸을 때 배지를 눌러 되돌릴 수 있게 한다.
// 한 번에 여러 줄을 넣을 때 같은 품목이 두 번 나오면 재고를 두 번 쓰지 않도록 left 로 남은 양을 추적한다.
function deductStock(need, master, left) {
  const want = Number(need) || 0;
  if (!master || want <= 0) return { qty: want };
  const have = left.has(master.id) ? left.get(master.id) : Number(master.stockQty) || 0;
  if (have <= 0) return { qty: want };
  const used = Math.min(have, want);
  left.set(master.id, have - used);
  return { qty: want - used, stockUsed: used, stockNeed: want };
}

// SELF_INFO / PO_DEFAULTS / poDateStr / poNumber / deriveSupplier 는 utils/purchaseOrder 로 이관(공용)
// 발주 담당자 명함 — public/cards/{이름}.png 에 이미지를 두면 메일 하단에 자동 첨부됨
const BUSINESS_CARD_NAMES = ['이주현', '박정현', '라혜림', '하성민', '이종현', '이종나', '하혜정', '이승빈', '손성욱'];
function cardFileFor(name) {
  const n = (name || '').trim();
  return BUSINESS_CARD_NAMES.includes(n) ? `/cards/${encodeURIComponent(n)}.png` : '';
}
// 발주서 메일 기본(공통) 본문 — 담당자명 동적. 발주별로 수정 가능, 비우면 이 문구 사용
function buildDefaultMailBody(name) {
  return [
    '안녕하세요.',
    `아이오피엔 ${name || ''}입니다.`,
    '해당 건 관련하여 발주서 첨부드립니다.',
    '',
    '바쁘시겠지만 납기 및 특이사항 확인하신 후 회신 부탁드리겠습니다.',
    '감사합니다.',
  ].join('\n');
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

// 드래그로 순서를 바꾸는 품목 행 — BOM 상세와 같은 모양(핸들을 No 칸 안에 둔다).
// 검색·업체 필터로 일부만 보일 때는 끌어봐야 어디에 놓이는지 알 수 없어 핸들을 숨긴다.
function SortableItemRow({ id, canDrag, no, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canDrag,
  });
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
    <tr ref={setNodeRef} style={style}>
      <td className="bom-no-col" data-label="No">
        <span className="bom-no-wrap">
          {canDrag && (
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
          )}
          {no}
        </span>
      </td>
      {children}
    </tr>
  );
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
    supplierNotes: {},
    setCount: 0,
    mailBody: '',
    deletedItems: [], // 삭제된 품목 행 휴지통
  });
  const [lineTrashOpen, setLineTrashOpen] = useState(false);
  const [saveState, setSaveState] = useState('saved'); // 'saving' | 'saved' | 'error'

  const [receiveModal, setReceiveModal] = useState(null); // { lineIdx, line } | null
  const [receiveForm, setReceiveForm] = useState({ qty: '', date: todayStr(), note: '' });
  const [bulkModal, setBulkModal] = useState(null); // { mode: 'remaining' | 'close-as-is' } | null
  const [bulkForm, setBulkForm] = useState({ date: todayStr(), note: '' });

  // 특정 업체 품목만 PDF 출력 (null = 전체 발주서)
  const [printSupplierFilter, setPrintSupplierFilter] = useState(null);
  // ★ 메일 발송 직렬화 체인 — 여러 업체를 연속 발송해도 단일 PDF 렌더 폼(printRef)을
  //   동시에 만지지 않도록 한 번에 하나씩 순차 처리한다. (한 업체에 전체 품목이 첨부되던
  //   레이스 컨디션 사고 방지) 사용자는 그대로 빠르게 눌러도 내부에서 큐로 직렬 실행.
  const mailSendChainRef = useRef(Promise.resolve());

  // 품목 검색 (표시 필터 — 데이터는 보존, 원본 인덱스 유지)
  const [itemSearch, setItemSearch] = useState('');
  // 품목 업체별 필터 (기본 구매처 기준 표시 필터)
  const [itemSupplierFilter, setItemSupplierFilter] = useState('all');

  // BOM 가져오기
  const [bomModalOpen, setBomModalOpen] = useState(false);
  const [bomSetCount, setBomSetCount] = useState(1); // BOM 가져올 때 세트 수량(배수)
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemPickerSearch, setItemPickerSearch] = useState('');
  const [itemPicked, setItemPicked] = useState(new Map()); // itemId -> 수량
  const [itemPickerTargetIdx, setItemPickerTargetIdx] = useState(null); // null=추가 모드, 숫자=그 행 품목 교체 모드
  const [bomProjects, setBomProjects] = useState([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomImporting, setBomImporting] = useState(false);

  const [printStamp, setPrintStamp] = useState(''); // 출력물 하단에 표시할 출력 시각

  // PDF → 자료실 저장
  const printRef = useRef(null); // 인쇄 양식 DOM (PDF 캡처 대상)
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfFolders, setPdfFolders] = useState([]); // [{ id, label }] 경로 라벨 포함 평면 목록
  const [pdfFolderId, setPdfFolderId] = useState('');
  const [pdfFileName, setPdfFileName] = useState('');

  // 메일 발송 미리보기 모달
  const [mailPreview, setMailPreview] = useState(null); // { supplierName, to, subject, html, fileName } | null
  const [mailAttachBusy, setMailAttachBusy] = useState(false); // 첨부 미리보기 PDF 생성 중
  const [mailExtraFiles, setMailExtraFiles] = useState([]); // 메일에 함께 보낼 추가 첨부파일(도면·사양서 등)
  const [mailDropOver, setMailDropOver] = useState(false); // 추가 첨부 드래그앤드롭 hover 상태
  const mailFileInputRef = useRef(null);
  const [replyModal, setReplyModal] = useState(null); // 회신 확인 시 납기 입력 모달 { supplierName, due } | null
  const [payReqModal, setPayReqModal] = useState(null); // 결제 요청 시 마감일 입력 모달 { supplierName, due } | null
  // 메일 발송 진행 상태 — 업체별 맵 { [업체명]: 진행률% } (동시 발송 각각 추적)
  const [mailSending, setMailSending] = useState({});
  // 백그라운드 PDF 캡처 시 현장명 표시 모드 (null=실제 현장명, 'hidden'=미공개, 'blank'=공백)
  const [printSiteNameMode, setPrintSiteNameMode] = useState(null);
  // 내부 저장용 PDF에만 구매처 계좌정보 표시 (메일 첨부엔 미표시)
  const [printAccountMode, setPrintAccountMode] = useState(false);
  // 「PDF 출력」 옵션 — 금액(단가·금액·합계) 표기 여부. 수동 출력 시에만 적용(메일·자료실 저장은 항상 금액 포함)
  const [printHideAmount, setPrintHideAmount] = useState(false);
  const [pdfOptOpen, setPdfOptOpen] = useState(false); // 출력 옵션 모달
  const [pdfShowAmount, setPdfShowAmount] = useState(true); // 옵션: 금액 표기(기본 ON)
  const [pdfShowBox, setPdfShowBox] = useState(true); // 옵션: BOX 열 표시 (BOX 값이 있을 때만 노출)
  const [printShowBox, setPrintShowBox] = useState(false); // 실제 출력 시 BOX 열 렌더 여부 — 전체 PDF 출력에서만 켬
  // 발주 수량 변경 모달 — { idx, name, receivedQty, value } | null (보유자재 반영 감량)
  const [qtyModal, setQtyModal] = useState(null);

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
        // ★ 단가(unitPrice)는 발주 시점 스냅샷을 그대로 유지한다. 품목 마스터의 단가가
        //   이후에 인상/변경돼도 기존 발주서 단가는 건드리지 않는다(과거 발주·정산 기록 왜곡 방지).
        //   명칭·규격·단위만 최신으로 동기화.
        if (newName === ln.name && newSpec === ln.spec && newUnit === ln.unit) return ln;
        changed = true;
        return { ...ln, name: newName, spec: newSpec, unit: newUnit };
      });
      if (!changed) return prev;
      skipUndoPushRef.current = true;
      setTimeout(() => {
        scheduleAutoSave();
        skipUndoPushRef.current = false;
      }, 0);
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
        deletedItems: Array.isArray(p.deletedItems) ? p.deletedItems : [],
        note: p.note || '',
        supplierNotes: p.supplierNotes || {},
        setCount: Number(p.setCount) || 0,
        // 비어 있으면 기본 공통 문구를 '실제 값'으로 채워 바로 편집 가능하게 (placeholder만 보여 수정 불가처럼 보이던 문제)
        mailBody:
          p.mailBody && String(p.mailBody).trim() ? p.mailBody : buildDefaultMailBody(p.contactName || p.requesterName),
      });
    } catch (err) {
      console.error(err);
      toast('불러오기 중 오류가 발생했습니다', 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // 표에서 같은 '열'을 세로로 드래그하면 그 열의 값들만 클립보드로 복사 (엑셀 붙여넣기용)
  function handleColumnDragCopy(e) {
    if (e.button !== 0) return;
    const td = e.target.closest('td');
    if (!td) return;
    // 버튼·셀렉트 등 조작 위젯이 있는 칸(작업·입고)은 제외 — 클릭 동작 보존
    if (td.querySelector('button, a, select')) return;
    const tr = td.closest('tr');
    const tbody = tr?.closest('tbody');
    if (!tbody) return;
    const rows = [...tbody.rows];
    const startRow = rows.indexOf(tr);
    const col = td.cellIndex;
    if (startRow < 0) return;
    e.preventDefault();
    const clear = () => tbody.querySelectorAll('.col-copy-sel').forEach((el) => el.classList.remove('col-copy-sel'));
    const apply = (r) => {
      const a = Math.min(startRow, r);
      const b = Math.max(startRow, r);
      rows.forEach((t, i) => {
        const c = t.cells[col];
        if (c) c.classList.toggle('col-copy-sel', i >= a && i <= b);
      });
    };
    clear();
    apply(startRow);
    const move = (ev) => {
      const overTd = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('td');
      if (!overTd) return;
      const i = rows.indexOf(overTd.closest('tr'));
      if (i >= 0) apply(i);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      const cells = [...tbody.querySelectorAll('.col-copy-sel')]
        .map((c) => {
          const inp = c.querySelector('input, textarea');
          return (inp ? inp.value : c.textContent || '').trim();
        })
        .filter((v) => v !== '');
      if (cells.length && navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(cells.join('\n'))
          .then(() => toast(`${cells.length}칸 복사됨 (붙여넣기 가능)`))
          .catch(() => toast('복사 실패', 'error'));
      }
      setTimeout(clear, 800);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const itemDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function handleItemDragEnd(event) {
    const { active, over } = event;
    if (!canDragItems || !over || active.id === over.id) return;
    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);
    if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return;
    setForm((f) => ({ ...f, items: arrayMove(f.items, oldIndex, newIndex) }));
    scheduleAutoSave();
  }

  function updateLine(idx, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)),
    }));
    scheduleAutoSave();
  }

  // 재고분 차감 되돌리기 — 재고 숫자가 실제와 다를 때 원래 필요 수량으로 되돌린다.
  // 입고가 시작된 줄은 수량을 늘려도 정합성에 문제가 없으므로 그대로 허용한다.
  function restoreStockLine(idx) {
    const ln = formRef.current.items[idx];
    if (!ln || !(Number(ln.stockUsed) > 0)) return;
    updateLine(idx, { qty: Number(ln.stockNeed) || Number(ln.qty) || 0, stockUsed: 0 });
  }

  // 발주 수량 변경 모달 열기 (보유자재 있으면 감량)
  function openQtyModal(idx) {
    const ln = formRef.current.items[idx];
    if (!ln) return;
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    setQtyModal({
      idx,
      name: ln.itemId && master ? master.name : ln.name || '(품목 미지정)',
      receivedQty: Number(ln.receivedQty) || 0,
      value: String(Number(ln.qty) || 0),
    });
  }

  // 수량 저장 — 입고분 미만으로는 줄일 수 없음(정합성)
  function saveQtyModal() {
    if (!qtyModal) return;
    const n = Number(String(qtyModal.value).replace(/[^\d]/g, '')) || 0;
    if (qtyModal.receivedQty > 0 && n < qtyModal.receivedQty) {
      toast(`이미 ${qtyModal.receivedQty}개 입고됨 — 발주 수량을 그보다 작게 할 수 없습니다`, 'error', 0);
      return;
    }
    updateLine(qtyModal.idx, { qty: n });
    setQtyModal(null);
  }

  // ---- 품목 불러오기 (BOM 상세 「품목 선택」 피커와 동일: 체크박스 다중선택 + 수량) ----
  function openItemPicker() {
    setItemPickerTargetIdx(null); // 추가 모드
    setItemPickerSearch('');
    setItemPicked(new Map());
    setItemPickerOpen(true);
  }
  // 특정 행의 품목을 다른 품목으로 교체하기 위해 picker 열기
  function openItemPickerReplace(idx) {
    setItemPickerTargetIdx(idx);
    setItemPickerSearch('');
    setItemPicked(new Map());
    setItemPickerOpen(true);
  }
  // 선택한 마스터 품목으로 해당 행을 교체 (수량·비고는 유지, 단가는 표준단가로)
  function replaceLineWithMaster(idx, m) {
    if (idx == null || !m) return;
    setForm((f) => ({
      ...f,
      items: f.items.map((ln, i) =>
        i === idx
          ? {
              ...ln,
              itemId: m.id,
              name: m.name || '',
              spec: m.spec || '',
              unit: m.unit || ln.unit || '',
              unitPrice: Number(m.standardPrice) || Number(ln.unitPrice) || 0,
            }
          : ln,
      ),
    }));
    scheduleAutoSave();
    setItemPickerOpen(false);
    setItemPickerTargetIdx(null);
  }
  function closeItemPicker() {
    setItemPickerOpen(false);
    setItemPickerTargetIdx(null);
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
    const stockLeft = new Map();
    for (const [itemId, qtyInput] of itemPicked) {
      const m = itemMaster.find((x) => x.id === itemId);
      if (!m) continue;
      newLines.push({
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        unitPrice: Number(m.standardPrice) || 0,
        ...deductStock(qtyInput, m, stockLeft),
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

  // 품목 검색·업체 매칭 (코드·품명·메이커·규격·분류·구매처·비고 + 기본 구매처 필터)
  function lineMatchesSearch(ln) {
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    const supName = master?.defaultSupplierId
      ? suppliers.find((s) => s.id === master.defaultSupplierId)?.name || ''
      : '';
    // 업체별 필터 — 선택된 구매처와 다르면 숨김
    if (itemSupplierFilter !== 'all' && supName !== itemSupplierFilter) return false;
    const kw = itemSearch.trim().toLowerCase();
    if (!kw) return true;
    const dispName = ln.itemId && master ? master.name : ln.name;
    return [master?.code, dispName, master?.maker, master?.spec || ln.spec, master?.category, supName, ln.note].some(
      (v) => (v || '').toLowerCase().includes(kw),
    );
  }

  async function removeLine(idx) {
    if (!(await confirm('이 품목 행을 삭제하시겠습니까?\n발주 휴지통에서 복원할 수 있습니다.'))) return;
    setForm((f) => {
      const removed = f.items[idx];
      const hasContent = (removed?.name || '').trim() || removed?.itemId;
      const rest = f.items.filter((_, i) => i !== idx);
      const items = rest.length > 0 ? rest : [{ ...EMPTY_LINE }];
      const deletedItems = hasContent
        ? [{ ...removed, _deletedAt: Date.now(), _deletedBy: userProfile?.name || '' }, ...(f.deletedItems || [])]
        : f.deletedItems || [];
      return { ...f, items, deletedItems };
    });
    scheduleAutoSave();
  }

  // 발주 품목 휴지통 — 복원 / 영구삭제
  function restoreDeletedItem(i) {
    setForm((f) => {
      const dl = (f.deletedItems || [])[i];
      if (!dl) return f;
      const { _deletedAt, _deletedBy, ...line } = dl;
      const kept = f.items.filter((ln) => (ln.name || '').trim() || ln.itemId);
      return {
        ...f,
        items: [...kept, line],
        deletedItems: (f.deletedItems || []).filter((_, k) => k !== i),
      };
    });
    scheduleAutoSave();
    toast('복원되었습니다.');
  }
  function purgeDeletedItem(i) {
    setForm((f) => ({ ...f, deletedItems: (f.deletedItems || []).filter((_, k) => k !== i) }));
    scheduleAutoSave();
  }

  // 품목 전체 삭제 — 모든 행 제거 후 빈 행 1개로 초기화
  async function clearAllLines() {
    const count = form.items.filter((ln) => (ln.name || '').trim()).length;
    if (count === 0) return;
    if (!(await confirm(`품목 ${count}개를 모두 삭제하시겠습니까?\n저장하면 반영됩니다.`))) return;
    setForm((f) => ({ ...f, items: [{ ...EMPTY_LINE }], setCount: 0 }));
    scheduleAutoSave();
  }

  // BOM 가져오기 모달 열기 (프로젝트 목록 지연 로드)
  async function openBomModal() {
    setBomSetCount(1);
    setBomModalOpen(true);
    if (bomProjects.length === 0) {
      setBomLoading(true);
      try {
        const projs = await getBomProjects();
        setBomProjects(projs);
      } catch {
        toast('BOM 목록 불러오기 중 오류가 발생했습니다', 'error');
      } finally {
        setBomLoading(false);
      }
    }
  }

  // 선택한 BOM의 품목을 발주 라인으로 불러오기 (수량·단가는 그대로, 이후 수정 가능)
  async function importBom(bp) {
    const setCount = Math.max(1, Number(bomSetCount) || 1);
    setBomImporting(true);
    try {
      const items = await getBomBySite(bp.id);
      if (!items || items.length === 0) {
        alert('해당 BOM에 품목이 없습니다.');
        return;
      }
      const stockLeft = new Map();
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
            ...deductStock((Number(b.qty) || 1) * setCount, m, stockLeft), // 세트 수량(배수) 반영 후 재고분 차감
            unitPrice: m && m.standardPrice != null ? Number(m.standardPrice) : Number(b.unitPrice) || 0,
            box: b.box || '', // 품목별 소속 BOX (BOM에서 그대로 복사, PDF 품목표에 출력)
            note: b.note || '',
          };
        });
      setForm((f) => {
        const existing = f.items.filter((ln) => (ln.name || '').trim()); // 빈 라인 제거 후 합치기
        return { ...f, items: [...existing, ...newLines], setCount };
      });
      scheduleAutoSave();
      setBomModalOpen(false);
      toast(`"${bp.name}" BOM에서 품목 ${newLines.length}개를 가져왔습니다.`);
    } catch {
      toast('BOM 가져오기 중 오류가 발생했습니다', 'error');
    } finally {
      setBomImporting(false);
    }
  }

  const formTotal = useMemo(
    () => form.items.reduce((s, ln) => s + (Number(ln.qty) || 0) * (Number(ln.unitPrice) || 0), 0),
    [form.items],
  );

  // 품목 업체별 필터 옵션 — 이 발주에 실제 등장하는 기본 구매처만
  const itemSupplierOptions = useMemo(() => {
    const set = new Set();
    for (const ln of form.items) {
      const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
      const supName = master?.defaultSupplierId
        ? suppliers.find((s) => s.id === master.defaultSupplierId)?.name || ''
        : '';
      if (supName) set.add(supName);
    }
    return [
      { value: 'all', label: '전체 업체' },
      ...Array.from(set)
        .sort((a, b) => a.localeCompare(b, 'ko'))
        .map((n) => ({ value: n, label: n })),
    ];
  }, [form.items, itemMaster, suppliers]);

  const isReadOnly = purchase?.status === 'settled' || purchase?.status === 'closed';
  // 검색·업체 필터가 걸리면 일부만 보여 순서를 옮길 수 없다
  const canDragItems = !isReadOnly && !itemSearch.trim() && itemSupplierFilter === 'all';

  // 발주 종결 — 보드에서 내려 종결 목록으로 옮긴다. 삭제가 아니라 이동이다.
  async function handleClosePurchase() {
    const ok = await confirm({
      title: '발주 종결',
      message: '종결하면 보드에서 빠지고 종결 목록으로 옮겨집니다. 삭제가 아니므로 언제든 되돌릴 수 있습니다.',
    });
    if (!ok) return;
    try {
      await setPurchaseStatus(id, 'closed', { closedAt: new Date() });
      setPurchase((prev) => ({ ...prev, status: 'closed' }));
      toast('종결 목록으로 옮겼습니다', 'success');
    } catch {
      toast('종결 처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleReopenPurchase() {
    const ok = await confirm({ title: '종결 해제', message: '종결을 풀고 정산완료 상태로 되돌립니다.' });
    if (!ok) return;
    try {
      await setPurchaseStatus(id, 'settled', { closedAt: null });
      setPurchase((prev) => ({ ...prev, status: 'settled' }));
      toast('보드로 되돌렸습니다', 'success');
    } catch {
      toast('되돌리는 중 오류가 발생했습니다', 'error');
    }
  }

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
    if (autoSaveRef.current) {
      clearTimeout(autoSaveRef.current);
      autoSaveRef.current = null;
    }
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
    if (purchase?.status === 'settled' || purchase?.status === 'closed') return; // 정산완료·종결은 잠금
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
        supplierNotes: f.supplierNotes || {},
        setCount: Number(f.setCount) || 0,
        mailBody: f.mailBody || '',
        deletedItems: f.deletedItems || [],
      });
      const updated = {
        ...(purchaseRef.current || {}),
        items,
        totalAmount,
        supplierId,
        supplierName,
        note: f.note,
        supplierNotes: f.supplierNotes || {},
        setCount: Number(f.setCount) || 0,
        mailBody: f.mailBody || '',
        deletedItems: f.deletedItems || [],
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

  // 특정 업체 품목만 PDF 출력 (발주완료도 함께 표시)
  // PDF 출력은 발주완료 표시를 하지 않는다 (발주완료는 메일 발송 시에만)
  function printForSupplier(supName) {
    setPrintSupplierFilter(supName);
    setPrintAccountMode(true); // 수동 출력 = 내부용: 계좌 표시 (현장명은 기본 null=실제)
    setPrintStamp(fmtDateTime(new Date()));
    setTimeout(() => {
      window.print();
      setPrintSupplierFilter(null);
      setPrintAccountMode(false);
    }, 200);
  }

  // PDF 자료실 저장 모달 열기 — 기본 파일명/스탬프 세팅
  function openPdfModal() {
    if (!purchase) return;
    const no = poNumber(purchase);
    const safeTitle = (purchase.title || '발주서').replace(/[/\\]/g, '_');
    setPdfFileName(`${no}_${safeTitle}`);
    setPdfModalOpen(true);
  }

  // 「PDF 출력」 — 옵션(금액 표기 등) 선택 모달을 먼저 연다.
  function handlePdfOutput() {
    setPdfShowAmount(true); // 매번 기본값(금액 표기)으로 리셋
    setPdfShowBox(formRef.current.items.some((ln) => (ln.box || '').trim())); // BOX 값 있으면 기본 ON
    setPdfOptOpen(true);
  }

  // 옵션 선택 후 실제 출력 — 브라우저 인쇄(window.print). 금액 표기·BOX 열 반영.
  function runPdfOutput() {
    setPdfOptOpen(false);
    setPrintHideAmount(!pdfShowAmount);
    setPrintShowBox(pdfShowBox);
    setPrintStamp(fmtDateTime(new Date()));
    setTimeout(() => {
      window.print();
      setPrintHideAmount(false); // 출력 후 원복 — 메일·자료실 저장에 영향 없음
      setPrintShowBox(false); // BOX 열은 전체 PDF 출력에서만 — 업체별·메일·자료실 미표시
    }, 200);
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
    // 모달 즉시 닫기 — 시작 토스트 없음, 결과만 sticky 토스트로 알림(총괄 수칙)
    setPdfModalOpen(false);
    // fire-and-forget — await로 화면을 막지 않음
    (async () => {
      try {
        await flushAutoSave();
        setPrintStamp(fmtDateTime(new Date()));
        setPrintAccountMode(true); // 내부 저장본: 계좌 포함
        await new Promise((r) => setTimeout(r, 250));
        const blob = await captureToPdfBlob(el, fileName);
        setPrintAccountMode(false);
        await uploadPdfToLibrary(blob, pdfFileName, folderId, userProfile);
        toast(`자료실에 저장되었습니다: ${fileName}`, 'success', 0);
      } catch (err) {
        setPrintAccountMode(false);
        toast(`자료실 저장 실패: ${err?.message || err}`, 'error', 0);
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
    } catch {
      toast('입고 처리 중 오류가 발생했습니다', 'error');
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
        ? '현재 입고된 수량으로 발주 수량을 정정하고 입고를 마감합니다.\n미입고 라인은 수량 0으로 처리됩니다. 계속할까요?'
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
    } catch {
      toast('일괄 입고 처리 중 오류가 발생했습니다', 'error');
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
    } catch {
      toast('입고 취소 중 오류가 발생했습니다', 'error');
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
    } catch {
      toast('정산 중 오류가 발생했습니다', 'error');
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
    } catch {
      toast('정산 취소 중 오류가 발생했습니다', 'error');
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
      if (tid)
        pushGlobalUndo(`발주 "${title}" 삭제`, async () => {
          await restoreTrashItem(tid);
          navigate(`/admin/purchase/${purchaseId}`);
        });
    } catch {
      toast('삭제 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleConfirmPurchase() {
    if (!(await confirm(`"${purchase.title}" 발주를 확정하시겠습니까?\n대기 → 발주 상태로 변경됩니다.`))) return;
    try {
      await flushAutoSave();
      await confirmPurchase(id, userProfile?.name || '');
      await loadData({ silent: true });
    } catch {
      toast('발주 확정 중 오류가 발생했습니다', 'error');
    }
  }

  // 현재 품목들을 구매처별로 그룹화한 목록 — 발주현황 표·자동전환 판정 공용 (공용 순수함수 위임)
  function computeSupplierList() {
    return computeSupplierListPure(form.items, itemMaster, suppliers, purchaseRef.current || purchase);
  }

  // 업체별 입고 집계 — 상단 품목 입고 처리(receivedQty)를 업체 단위로 모아 자동 판정
  // { [업체명]: { total, full, latest, recvAmount, pendingCount, pendingAmount } }
  //   recvAmount    입고된 수량 × 단가 — 이 금액만 결제로 넘어간다
  //   pendingCount  아직 안 들어온 품목 수 (부분 입고도 남은 수량이 있으면 센다)
  //   pendingAmount 그 남은 수량의 금액
  function computeSupplierReceiveStatus() {
    const items = form.items || [];
    const cur = purchaseRef.current || purchase;
    const fallbackSup = cur?.supplierId ? suppliers.find((s) => s.id === cur.supplierId) : null;
    const map = {};
    for (const ln of items) {
      if (!(ln.name || '').trim()) continue;
      const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
      const supId = master?.defaultSupplierId || '';
      const sup = (supId ? suppliers.find((s) => s.id === supId) : null) || fallbackSup || null;
      const supName = sup?.name || cur?.supplierName || '(구매처 미지정)';
      const savedQty = Number(ln.qty) || 0;
      const receivedQty = Number(ln.receivedQty) || 0;
      const full = savedQty > 0 && receivedQty >= savedQty;
      if (!map[supName])
        map[supName] = { total: 0, full: 0, latest: null, recvAmount: 0, pendingCount: 0, pendingAmount: 0 };
      map[supName].total += 1;
      if (full) map[supName].full += 1;
      const price = Number(ln.unitPrice) || 0;
      const got = Math.min(receivedQty, savedQty); // 초과 입고는 발주 수량까지만 센다
      map[supName].recvAmount += got * price;
      const left = savedQty - got;
      if (left > 0) {
        map[supName].pendingCount += 1;
        map[supName].pendingAmount += left * price;
      }
      if (ln.receivedAt) {
        const d = ln.receivedAt.toDate ? ln.receivedAt.toDate() : new Date(ln.receivedAt);
        if (!Number.isNaN(d.getTime()) && (!map[supName].latest || d > map[supName].latest)) map[supName].latest = d;
      }
    }
    return map;
  }

  // 모든 업체 메일 발송 완료 + 현재 '발주대기' 상태면 → '발주완료'로 자동 확정 (확인창 없이)
  async function maybeAutoConfirm(sentMap) {
    const cur = purchaseRef.current || purchase;
    if (!cur || (cur.status || 'draft') !== 'draft') return; // 발주대기 상태에서만 자동 전환
    const supList = computeSupplierList();
    if (supList.length === 0) return;
    const allSent = supList.every((s) => sentMap[s.name.replace(/\./g, '_')]);
    if (!allSent) return;
    try {
      await confirmPurchase(id, userProfile?.name || '');
      await loadData({ silent: true });
      toast('모든 업체 메일 발송 완료 — 「발주완료」 상태로 이동했습니다.');
    } catch (err) {
      console.error('자동 발주 전환 오류:', err);
    }
  }

  // 발주완료 마킹 (확인창 없이 바로 — 메일 발송 후 자동 호출용)
  async function markSent(supplierName) {
    try {
      await markSupplierSent(id, supplierName, userProfile?.name || '');
      const sentKey = supplierName.replace(/\./g, '_');
      const nextSent = {
        ...(purchaseRef.current?.supplierSent || {}),
        [sentKey]: { sentAt: new Date(), sentBy: userProfile?.name || '' },
      };
      purchaseRef.current = { ...(purchaseRef.current || {}), supplierSent: nextSent };
      setPurchase((prev) => ({ ...prev, supplierSent: nextSent }));
      await maybeAutoConfirm(nextSent);
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleMarkSupplierSent(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체에 발주 완료 표시하시겠습니까?`))) return;
    await markSent(supplierName);
  }

  // 모든 업체 회신 확인 + 현재 '발주완료' 상태면 → '회신'으로 자동 전환
  async function maybeAutoReply(repliedMap) {
    const cur = purchaseRef.current || purchase;
    if (!cur || (cur.status || 'draft') !== 'ordered') return; // 발주완료 상태에서만 전환
    const supList = computeSupplierList();
    if (supList.length === 0) return;
    const allReplied = supList.every((s) => repliedMap[s.name.replace(/\./g, '_')]);
    if (!allReplied) return;
    try {
      await setPurchaseReplied(id, userProfile?.name || '');
      await loadData({ silent: true });
      toast('모든 업체 회신 확인 — 「회신」 상태로 이동했습니다.');
    } catch (err) {
      console.error('자동 회신 전환 오류:', err);
    }
  }

  // 업체별 회신 확인 — 납기 입력 모달을 먼저 띄운다
  function handleMarkSupplierReplied(supplierName) {
    const key = supplierName.replace(/\./g, '_');
    const prevDue = purchase.supplierReplied?.[key]?.deliveryDue || purchase.deliveryDue || '';
    setReplyModal({ supplierName, due: prevDue });
  }

  // 납기 입력 후 회신 확인 확정
  async function confirmReplyWithDue() {
    if (!replyModal) return;
    const { supplierName, due } = replyModal;
    setReplyModal(null);
    try {
      await markSupplierReplied(id, supplierName, userProfile?.name || '', due || '');
      const key = supplierName.replace(/\./g, '_');
      const nextReplied = {
        ...(purchaseRef.current?.supplierReplied || {}),
        [key]: { repliedAt: new Date(), repliedBy: userProfile?.name || '', deliveryDue: due || '' },
      };
      purchaseRef.current = { ...(purchaseRef.current || {}), supplierReplied: nextReplied };
      setPurchase((prev) => ({ ...prev, supplierReplied: nextReplied }));
      await maybeAutoReply(nextReplied);
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // 업체별 회신 확인 취소
  async function handleUnmarkSupplierReplied(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체의 회신 확인을 취소하시겠습니까?`))) return;
    try {
      await unmarkSupplierReplied(id, supplierName);
      const key = supplierName.replace(/\./g, '_');
      setPurchase((prev) => {
        const next = { ...(prev.supplierReplied || {}) };
        delete next[key];
        purchaseRef.current = { ...(purchaseRef.current || {}), supplierReplied: next };
        return { ...prev, supplierReplied: next };
      });
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // 업체별 결제 요청 → 결제 마감일 입력 모달을 먼저 띄운다.
  // 구매처에 결제 조건이 있으면 마감일을 미리 계산해 채워 둔다. 사람은 확인만 하면 된다.
  function handleRequestPayment(supplierName, receivedAt) {
    const key = supplierName.replace(/\./g, '_');
    const prevDue = purchase.paymentRequested?.[key]?.dueDate || '';
    const sup = suppliers.find((x) => x.name === supplierName);
    const base = receivedAt || new Date(); // 입고 완료일이 기준, 없으면 오늘
    const autoDue = prevDue ? '' : calcPaymentDue(sup, base);
    setPayReqModal({
      supplierName,
      due: prevDue || autoDue,
      termLabel: paymentTermLabel(sup),
      autoFilled: !!autoDue,
      baseDate: base,
    });
  }

  // 마감일 입력 후 결제 요청 확정 → 결제 페이지에 결제 대기로 노출
  async function confirmPaymentRequest() {
    if (!payReqModal) return;
    const { supplierName, due } = payReqModal;
    setPayReqModal(null);
    try {
      await markPaymentRequested(id, supplierName, userProfile?.name || '', due || '');
      const key = supplierName.replace(/\./g, '_');
      const next = {
        ...(purchaseRef.current?.paymentRequested || {}),
        [key]: { requestedAt: new Date(), requestedBy: userProfile?.name || '', dueDate: due || '' },
      };
      purchaseRef.current = { ...(purchaseRef.current || {}), paymentRequested: next };
      setPurchase((prev) => ({ ...prev, paymentRequested: next }));
      toast('결제 요청했습니다. 결제 페이지에서 확인하세요.');
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }
  async function handleCancelPaymentRequest(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체의 결제 요청을 취소하시겠습니까?`))) return;
    try {
      await unmarkPaymentRequested(id, supplierName);
      const key = supplierName.replace(/\./g, '_');
      setPurchase((prev) => {
        const next = { ...(prev.paymentRequested || {}) };
        delete next[key];
        purchaseRef.current = { ...(purchaseRef.current || {}), paymentRequested: next };
        return { ...prev, paymentRequested: next };
      });
      toast('결제 요청을 취소했습니다.');
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // Blob → base64 문자열 (data URL 접두 제거)
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 메일 발송 버튼 → 미리보기 모달 열기 (실제 발송은 모달의 "발송"에서)
  // 발송(첨부) 파일명 = 발주서_제목_업체명_발행번호 (부제 제외 — 외부 노출)
  // 저장(자료실) 파일명 = 발주서_제목_부제_업체명_발행번호 (부제 포함 — 내부 식별)
  function openMailPreview(supplierName, toEmail, subject, htmlBody, poNo) {
    const build = (arr) =>
      `${arr
        .filter(Boolean)
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join('_')}.pdf`.replace(/[/\\]/g, '_');
    const fileName = build(['발주서', purchase.title, supplierName]); // 발송용(제목·업체명까지만)
    const saveFileName = build(['발주서', purchase.title, purchase.subtitle, supplierName, poNo]); // 저장용(부제 포함)
    setMailExtraFiles([]); // 추가 첨부 초기화
    setMailPreview({ supplierName, to: toEmail, subject, html: htmlBody, fileName, saveFileName });
  }

  // 미리보기 모달에서 "첨부파일" 클릭 → 실제 첨부될 발주서 PDF를 그 자리에서 생성해 새 탭으로 열어 확인.
  // (발송 전 양식이 정상인지 눈으로 검증 — 깨진 채 발송되는 것 방지)
  async function previewMailAttachment() {
    if (!mailPreview || mailAttachBusy) return;
    const { supplierName, fileName } = mailPreview;
    setMailAttachBusy(true);
    try {
      await ensureAnonymousAuth();
      await flushAutoSave();
      // 메일 첨부본과 동일 조건: 현장명 공백 + 계좌 미표시 + 해당 업체만
      setPrintSiteNameMode('blank');
      setPrintAccountMode(false);
      setPrintSupplierFilter(supplierName);
      setPrintStamp(fmtDateTime(new Date()));
      await new Promise((r) => setTimeout(r, 250));
      let blob = null;
      try {
        const el = printRef.current;
        if (el) blob = await captureToPdfBlob(el, fileName);
      } finally {
        setPrintSupplierFilter(null);
        setPrintSiteNameMode(null);
        setPrintAccountMode(false);
      }
      if (!blob) {
        toast('미리보기 생성에 실패했습니다. (배포 환경에서만 동작)', 'error');
        return;
      }
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (err) {
      toast('미리보기 실패: ' + (err.message || err), 'error');
    } finally {
      setMailAttachBusy(false);
    }
  }

  // 미리보기 모달의 "발송" → 모달 즉시 닫고 백그라운드로 PDF 생성·발송 (대기 없음)
  function confirmSendMail() {
    if (!mailPreview) return;
    const { supplierName, to, subject, html, fileName, saveFileName } = mailPreview;
    const extraFiles = mailExtraFiles; // 발송 시점의 추가 첨부 캡처
    setMailPreview(null);
    setMailExtraFiles([]);
    const setPct = (pct) => setMailSending((prev) => ({ ...prev, [supplierName]: pct }));
    const clearPct = () =>
      setMailSending((prev) => {
        const next = { ...prev };
        delete next[supplierName];
        return next;
      });
    // ★ 안전 가드 — 업체명이 비어 있으면 필터가 무력화되어 "전체 품목"이 첨부될 수 있으므로
    //   발송을 거부한다. (전체 리스트가 한 업체에 나가던 사고의 두 번째 경로 차단)
    if (!supplierName || !String(supplierName).trim()) {
      toast('업체가 지정되지 않아 발송을 중단했습니다. (전체 발주서 오발송 방지)', 'error');
      clearPct();
      return;
    }
    setPct(5);
    // ★ 직렬화 — 이전 발송이 끝난 뒤에만 이 발송을 시작한다(단일 printRef 동시 접근 차단).
    //   사용자는 여러 업체를 빠르게 눌러도 되고, 내부에서 큐로 순서대로 처리된다.
    const runSend = async () => {
      try {
        await ensureAnonymousAuth();
        setPct(20);
        // 해당 업체 품목만 발주서 렌더 + 현장명 공백 처리 → PDF 캡처
        await flushAutoSave();
        setPrintSiteNameMode('blank');
        setPrintAccountMode(false); // 메일 첨부용: 계좌 미표시
        setPrintSupplierFilter(supplierName);
        setPrintStamp(fmtDateTime(new Date()));
        await new Promise((r) => setTimeout(r, 250));
        setPct(40);
        let attachments = [];
        let pdfBlob = null;
        let saveBlob = null;
        try {
          const el = printRef.current;
          if (el) {
            // ① 메일 첨부용 (계좌 없음)
            pdfBlob = await captureToPdfBlob(el, fileName);
            const base64 = await blobToBase64(pdfBlob);
            attachments = [{ filename: fileName, content: base64, encoding: 'base64' }];
            // ② 내부 저장용 (계좌 포함 + 실제 현장명) — 별도 재캡처
            setPrintAccountMode(true);
            setPrintSiteNameMode(null); // 저장본은 실제 현장명(프로젝트) 표시
            await new Promise((r) => setTimeout(r, 250));
            saveBlob = await captureToPdfBlob(el, saveFileName);
          }
        } finally {
          setPrintSupplierFilter(null);
          setPrintSiteNameMode(null);
          setPrintAccountMode(false);
        }
        if (attachments.length === 0) {
          toast('발주서 PDF 생성에 실패했습니다. (배포 환경에서만 동작)', 'error');
          clearPct();
          return;
        }
        setPct(70);
        // 본문 명함 이미지를 cid 인라인 첨부로 변환 (메일 클라이언트 이미지 차단 방지)
        let sendHtml = html;
        const cardMatch = html.match(/src="(\/cards\/[^"]*)"/);
        if (cardMatch) {
          try {
            const res = await fetch(cardMatch[1]);
            if (res.ok) {
              const cardB64 = await blobToBase64(await res.blob());
              attachments.push({
                filename: 'businesscard.png',
                content: cardB64,
                encoding: 'base64',
                contentType: 'image/png',
                contentDisposition: 'inline',
                cid: 'bizcard',
              });
              sendHtml = html.replace(cardMatch[1], 'cid:bizcard');
            }
          } catch {
            /* 명함 로드 실패 시 경로 이미지 그대로 발송 */
          }
        }
        // 사용자가 추가한 첨부파일(도면·사양서 등)을 메일에 함께 첨부
        if (extraFiles.length > 0) {
          const totalExtra = extraFiles.reduce((s, f) => s + (f.size || 0), 0);
          if (totalExtra > 8 * 1024 * 1024) {
            toast('추가 첨부 용량이 너무 큽니다(총 8MB 이하). 일부를 빼고 다시 보내세요.', 'error');
            clearPct();
            return;
          }
          setPct(80);
          for (const f of extraFiles) {
            const b64 = await blobToBase64(f);
            attachments.push({ filename: f.name, content: b64, encoding: 'base64' });
          }
        }
        setPct(88);
        await callSendEmail({ to, subject, html: sendHtml, attachments });
        setPct(100);
        toast(`"${supplierName}" 발주서(PDF 첨부)를 발송했습니다.`);
        const sentKey = supplierName.replace(/\./g, '_');
        if (!purchase.supplierSent?.[sentKey]) markSent(supplierName);
        // 발송 성공 → 프로젝트 자료실 "발주이력 > YYYY-MM" 월 폴더에 발주서 PDF 자동 보관
        // 내부 저장본은 계좌 포함(saveBlob), 없으면 메일본(pdfBlob)
        const archiveBlob = saveBlob || pdfBlob;
        if (archiveBlob && purchase.siteName) {
          try {
            const result = await ensureProjectFolders(purchase.siteName, userProfile);
            const histId = result?.sub?.['발주이력'];
            if (histId) {
              // 발주일 기준 월 폴더(YYYY-MM) 자동 생성
              const od = purchase.orderedAt?.toDate
                ? purchase.orderedAt.toDate()
                : purchase.orderedAt
                  ? new Date(purchase.orderedAt)
                  : purchase.createdAt?.toDate
                    ? purchase.createdAt.toDate()
                    : new Date();
              const ym = `${od.getFullYear()}-${String(od.getMonth() + 1).padStart(2, '0')}`;
              const monthId = await ensureFolder(ym, userProfile, histId, { protected: true });
              const baseName = (saveFileName || fileName).replace(/\.pdf$/i, '');
              await uploadPdfToLibrary(archiveBlob, baseName, monthId, userProfile);
            }
          } catch (e) {
            console.warn('[자료실] 발주이력 자동 저장 실패:', e);
          }
        }
      } catch (err) {
        setPrintSupplierFilter(null);
        setPrintSiteNameMode(null);
        toast('메일 발송 실패: ' + (err.message || err), 'error');
      } finally {
        // 100% 잠깐 보여준 뒤 이 업체만 정리
        setTimeout(clearPct, 600);
      }
    };
    // 이전 발송 체인 뒤에 직렬 연결 (실패해도 다음 발송은 계속되도록 catch로 흡수)
    mailSendChainRef.current = mailSendChainRef.current.then(runSend, runSend);
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
    } catch {
      toast('취소 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading || !purchase) return <Skeleton.Rows count={6} />;

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
        <div
          className="purchase-detail-header-left"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 0 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: 0 }}>
            <h2 style={{ margin: 0 }}>{purchase.title || '(제목 없음)'}</h2>
            <span className={`purchase-badge purchase-badge-${STATUS[status]?.cls || 'ordered'}`}>
              {STATUS[status]?.label || status}
            </span>
            {Number(form.setCount) > 0 && (
              <span className="purchase-badge" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
                {form.setCount}세트
              </span>
            )}
          </div>
          {purchase.subtitle && (
            <div
              style={{
                margin: 0,
                fontSize: 16,
                color: 'var(--text-secondary, #6b7280)',
                fontWeight: 600,
                letterSpacing: '-0.02em',
              }}
            >
              {purchase.subtitle}
            </div>
          )}
        </div>
        <div
          className="page-actions purchase-detail-top-actions"
          style={{ flexWrap: 'wrap', gap: 4, alignItems: 'center' }}
        >
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
                      잔여 무시하고 입고 마감
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
          {status === 'settled' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={handleClosePurchase}>
              종결
            </button>
          )}
          {status === 'closed' && (
            <button type="button" className="btn btn-sm btn-outline" onClick={handleReopenPurchase}>
              종결 해제
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
          <Icon name="folder" />
          자료실 저장
        </button>
        <button
          type="button"
          className="pdf-print-fab"
          onClick={handlePdfOutput}
          title="브라우저 인쇄로 발주서를 출력합니다 (인쇄 대화상자에서 'PDF로 저장' 선택 가능)"
        >
          <Icon name="doc" />
          PDF 출력
        </button>
      </div>

      {/* 인쇄 전용 IOPN_v4 발주서 양식 — 공용 컴포넌트로 분리(저장본 일괄 재생성과 동일 양식 공유) */}
      <PurchaseOrderPrintForm
        ref={printRef}
        purchase={purchase}
        form={form}
        suppliers={suppliers}
        sites={sites}
        itemMaster={itemMaster}
        printSupplierFilter={printSupplierFilter}
        printAccountMode={printAccountMode}
        printSiteNameMode={printSiteNameMode}
        printStamp={printStamp}
        hideAmount={printHideAmount}
        showBox={printShowBox}
      />

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <label style={{ margin: 0 }}>품목</label>
          <div className="row-actions">
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setLineTrashOpen(true)}>
              <Icon name="trash" className="btn-ic" />
              휴지통{form.deletedItems?.length ? ` (${form.deletedItems.length})` : ''}
            </button>
            {!isReadOnly && form.items.some((ln) => (ln.name || '').trim()) && (
              <button type="button" className="btn btn-sm btn-danger" onClick={clearAllLines}>
                <Icon name="trash" className="btn-ic" />
                전체 삭제
              </button>
            )}
          </div>
        </div>
        <p className="field-hint">
          우측 상단 「품목 불러오기」로 구매 품목을 선택해 추가하세요. 입력 즉시 자동 저장됩니다. 구매처는 첫 품목의
          기본 구매처로 자동 적용.
        </p>
        {form.items.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              className="purchase-filter-search"
              style={{ flex: '1 1 220px', maxWidth: 340, marginBottom: 0 }}
              placeholder="품목 검색 (코드 · 품명 · 메이커 · 규격 · 분류 · 구매처)"
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
            />
            {itemSupplierOptions.length > 2 && (
              <div style={{ flex: '0 0 auto', minWidth: 150, maxWidth: 220 }}>
                <Select
                  value={itemSupplierFilter}
                  onChange={setItemSupplierFilter}
                  options={itemSupplierOptions}
                  ariaLabel="업체별 필터"
                />
              </div>
            )}
          </div>
        )}
        <div className="item-group is-expanded bom-flat-group">
          <div className="item-group-detail">
            <DndContext sensors={itemDndSensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
              <SortableContext items={form.items.map((_, i) => String(i))} strategy={verticalListSortingStrategy}>
                <div className="table-scroll-x">
                  <table
                    className="table inline-edit-table cards-sm bom-flat-table po-item-table"
                    onMouseDown={handleColumnDragCopy}
                  >
                    {/* 칸 폭 배분(%) — 대표님 지정 1~4번, 나머지는 내용 길이에 맞춰 나눔 */}
                    <colgroup>
                      {[2, 5, 6, 10, 7, 18, 5, 3, 3, 7, 7, 6, 7, 6, 8].map((pct, i) => (
                        <col key={i} style={{ width: `${pct}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="bom-no-col">No</th>
                        <th>코드</th>
                        <th>BOX</th>
                        <th>품명</th>
                        <th>메이커</th>
                        <th>규격</th>
                        <th>분류</th>
                        <th>moq/단위</th>
                        <th>수량</th>
                        <th>단가</th>
                        <th>합계</th>
                        <th>기본 구매처</th>
                        <th>비고</th>
                        <th className="no-print">입고</th>
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
                      {form.items.length > 0 &&
                        (itemSearch.trim() || itemSupplierFilter !== 'all') &&
                        !form.items.some(lineMatchesSearch) && (
                          <tr>
                            <td
                              colSpan={15}
                              className="text-muted text-sm"
                              style={{ textAlign: 'center', padding: 16 }}
                            >
                              {itemSupplierFilter !== 'all' && !itemSearch.trim()
                                ? `"${itemSupplierFilter}" 업체 품목이 없습니다.`
                                : `"${itemSearch}" 검색 결과가 없습니다.`}
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
                          <SortableItemRow key={idx} id={String(idx)} canDrag={canDragItems} no={idx + 1}>
                            <td data-label="코드">
                              <input
                                type="text"
                                className="bom-readonly-input bom-code-input"
                                value={master?.code || ''}
                                readOnly
                                tabIndex={-1}
                              />
                            </td>
                            <td data-label="BOX" title={ln.box || ''}>
                              <input
                                type="text"
                                className="bom-readonly-input"
                                value={ln.box || ''}
                                title={ln.box || ''}
                                placeholder="-"
                                readOnly
                                tabIndex={-1}
                              />
                            </td>
                            <td
                              data-label="품명"
                              title={ln.itemId && master ? master.name : ln.name || ''}
                              style={{ minWidth: 90, maxWidth: 200 }}
                            >
                              <div className="purchase-line-item-wrap">
                                <input
                                  className="purchase-line-item bom-readonly-input"
                                  type="text"
                                  placeholder="‘변경’ 버튼으로 품목 선택"
                                  value={ln.itemId && master ? master.name : ln.name}
                                  title={ln.itemId && master ? master.name : ln.name || ''}
                                  readOnly
                                  tabIndex={-1}
                                  autoComplete="off"
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
                                className={`num-input bom-readonly-input${isReadOnly ? '' : ' purchase-qty-clickable'}`}
                                type="text"
                                value={Number(ln.qty) ? Number(ln.qty).toLocaleString() : ''}
                                readOnly
                                tabIndex={-1}
                                onClick={isReadOnly ? undefined : () => openQtyModal(idx)}
                                title={isReadOnly ? '' : '클릭해 발주 수량 변경 (보유자재 있으면 감량)'}
                              />
                              {Number(ln.stockUsed) > 0 && (
                                <button
                                  type="button"
                                  className="stock-used-badge"
                                  disabled={isReadOnly}
                                  onClick={isReadOnly ? undefined : () => restoreStockLine(idx)}
                                  title={
                                    isReadOnly
                                      ? `창고 재고 ${ln.stockUsed}개를 빼고 발주한 수량입니다`
                                      : `창고 재고 ${ln.stockUsed}개를 뺐습니다. 눌러서 ${Number(ln.stockNeed).toLocaleString()}개로 되돌리기`
                                  }
                                >
                                  재고 {Number(ln.stockUsed).toLocaleString()} 사용
                                </button>
                              )}
                            </td>
                            <td data-label="단가">
                              <input
                                className="num-input bom-readonly-input"
                                type="text"
                                value={Number(ln.unitPrice) ? Number(ln.unitPrice).toLocaleString() : ''}
                                readOnly
                                tabIndex={-1}
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
                                className="bom-readonly-input"
                                value={ln.note || ''}
                                title={ln.note || ''}
                                placeholder="-"
                                readOnly
                                tabIndex={-1}
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
                                    <span
                                      className={`purchase-recv-chip is-readonly ${isFullyReceived ? 'is-full' : 'is-partial'}`}
                                    >
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
                                        {isFullyReceived ? '완료' : '부분'} {receivedQty}/{savedQty} ·{' '}
                                        {fmtDate(ln.receivedAt)}
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
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  onClick={() => openItemPickerReplace(idx)}
                                  aria-label="품목 변경"
                                  disabled={isReadOnly}
                                  title="이 행의 품목을 다른 품목으로 변경"
                                >
                                  <Icon name="edit" className="btn-ic" />
                                  변경
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-danger"
                                  onClick={() => removeLine(idx)}
                                  aria-label="행 삭제"
                                  disabled={isReadOnly}
                                  title="삭제"
                                >
                                  <Icon name="trash" className="btn-ic" />
                                  삭제
                                </button>
                              </div>
                            </td>
                          </SortableItemRow>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
      </div>

      <div className="purchase-total-row screen-only">
        <span>합계</span>
        <div className="purchase-total-vals">
          <span className="purchase-total-supply">
            <span className="purchase-total-label">공급가액</span>
            <strong>{formTotal.toLocaleString()}원</strong>
          </span>
          <span className="purchase-total-vat">
            <span className="purchase-total-label">부가세 포함</span>
            <strong>{Math.round(formTotal * 1.1).toLocaleString()}원</strong>
          </span>
        </div>
      </div>

      {/* 업체별 발주 현황 — 메일 발송·발주 완료 추적 (품목 아래) */}
      {(() => {
        const supList = computeSupplierList();
        if (supList.length === 0) return null;
        const recvStatus = computeSupplierReceiveStatus(); // 업체별 입고 자동 집계
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
              각 업체별로 「PDF 출력」하면 그 업체 품목만 발주서가 만들어집니다. 메일 발송 시 발주완료로 표시됩니다.
            </p>
            {!isReadOnly && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>발주서 메일 본문 (공통 문구 — 수정 가능)</label>
                <textarea
                  value={form.mailBody}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, mailBody: e.target.value }));
                    scheduleAutoSave();
                  }}
                  rows={6}
                  placeholder={buildDefaultMailBody(purchase.contactName)}
                  style={{ fontSize: 14, lineHeight: 1.6 }}
                />
                <p className="field-hint">
                  메일 발송 시 발신·수신·담당자 명함과 함께 이 문구가 본문으로 들어갑니다. 발주 건마다 수정·저장할 수
                  있고, 비우면 기본 공통 문구가 사용됩니다.
                </p>
              </div>
            )}
            {!isReadOnly && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginBottom: 'var(--space-3)',
                }}
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
              <table className="table inline-edit-table cards-sm po-sup-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: 140 }}>구매처</th>
                    <th style={{ minWidth: 80, width: 100 }}>품목</th>
                    <th style={{ minWidth: 170, width: 200 }}>발행번호</th>
                    <th style={{ minWidth: 170, width: 170 }}>발주 상태</th>
                    <th style={{ minWidth: 170, width: 170 }}>회신</th>
                    <th style={{ minWidth: 140, width: 150 }}>입고</th>
                    <th style={{ minWidth: 130, width: 150 }}>결제 대상</th>
                    <th style={{ minWidth: 130, width: 150 }}>미입고</th>
                    <th style={{ minWidth: 110, width: 130 }}>납기</th>
                    <th style={{ minWidth: 200, width: '100%' }}>특이사항</th>
                    <th className="col-action" aria-label="작업"></th>
                  </tr>
                </thead>
                <tbody>
                  {supList.map((sup, supIdx) => {
                    const sentKey = sup.name.replace(/\./g, '_');
                    const sent = purchase.supplierSent?.[sentKey];
                    const replied = purchase.supplierReplied?.[sentKey];
                    const recv = recvStatus[sup.name] || {
                      total: 0,
                      full: 0,
                      latest: null,
                      recvAmount: 0,
                      pendingCount: 0,
                      pendingAmount: 0,
                    };
                    const recvDone = recv.total > 0 && recv.full === recv.total; // 전량 입고
                    const payReq = purchase.paymentRequested?.[sentKey];
                    const paid = purchase.supplierPaid?.[sentKey];
                    // 발행번호 = 발주일 + 구매처 순번 + 발주건 고유ID(겹침 방지) — IOPN{날짜}-{순번}-{ID4}
                    const poIdTail = (purchase.id || '').slice(0, 4).toUpperCase();
                    const supPoNo = `${poDateStr(purchase)}-${supIdx + 1}-${poIdTail}`;
                    const mailSubject = `[주식회사 아이오피엔] ${purchase.title || ''}`;
                    const cardSrc = cardFileFor(purchase.contactName);
                    const cardHtml = cardSrc
                      ? `<br><br><br><img src="${cardSrc}" alt="담당자 명함" width="220" style="width:220px;max-width:100%;border:1px solid #eee" />`
                      : '';
                    // 발주별 메일 본문(form.mailBody) 사용, 비었으면 공통 기본 문구
                    const bodyText =
                      form.mailBody && form.mailBody.trim()
                        ? form.mailBody
                        : buildDefaultMailBody(purchase.contactName);
                    const bodyHtml = bodyText
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/\n/g, '<br>');
                    const mailHtml = `<p style="margin:0 0 4px;font-weight:700">발신 : (주)아이오피엔</p><p style="margin:0 0 14px;font-weight:700">수신 : ${sup.name}</p><br><br><p>${bodyHtml}</p>${cardHtml}`;
                    return (
                      <tr key={sup.name}>
                        <td data-label="구매처" title={sup.name}>
                          <strong>{sup.name}</strong>
                        </td>
                        <td data-label="품목">{sup.count}품목</td>
                        <td data-label="발행번호">
                          <strong className="purchase-sup-pono">{supPoNo}</strong>
                        </td>
                        <td data-label="발주 상태">
                          {sent ? (
                            <span className="purchase-badge purchase-badge-received">
                              발주완료 · {fmtDate(sent.sentAt)}
                            </span>
                          ) : (
                            <span className="purchase-badge purchase-badge-draft">미발주</span>
                          )}
                        </td>
                        <td data-label="회신">
                          {replied ? (
                            <span className="purchase-badge purchase-badge-replied">
                              회신 · {fmtDate(replied.repliedAt)}
                            </span>
                          ) : (
                            <span className="purchase-badge purchase-badge-draft">미회신</span>
                          )}
                        </td>
                        <td data-label="입고">
                          <span title="상단 품목 입고 처리가 완료되면 자동으로 반영됩니다">
                            {recvDone ? (
                              <span className="purchase-badge purchase-badge-instock">
                                입고 · {fmtDate(recv.latest)}
                              </span>
                            ) : recv.full > 0 ? (
                              <span className="purchase-badge purchase-badge-partial">
                                부분 {recv.full}/{recv.total}
                              </span>
                            ) : (
                              <span className="purchase-badge purchase-badge-draft">미입고</span>
                            )}
                          </span>
                        </td>
                        <td data-label="결제 대상">
                          {recv.recvAmount > 0 ? (
                            <span className="purchase-sup-amt">
                              <strong>{recv.recvAmount.toLocaleString()}원</strong>
                              <em>
                                입고 {recv.full}/{recv.total}
                              </em>
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td data-label="미입고">
                          {recv.pendingCount > 0 ? (
                            <span className="purchase-sup-amt is-pending">
                              <strong>{recv.pendingAmount.toLocaleString()}원</strong>
                              <em>{recv.pendingCount}품목</em>
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td data-label="납기">
                          {replied?.deliveryDue ? (
                            <strong className="purchase-sup-due">{replied.deliveryDue}</strong>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td data-label="특이사항">
                          <input
                            type="text"
                            value={form.supplierNotes?.[sup.name.replace(/\./g, '_')] || ''}
                            onChange={(e) => {
                              const key = sup.name.replace(/\./g, '_');
                              setForm((f) => ({
                                ...f,
                                supplierNotes: { ...f.supplierNotes, [key]: e.target.value },
                              }));
                              scheduleAutoSave();
                            }}
                            placeholder=""
                            disabled={isReadOnly}
                            style={{ width: '100%', minWidth: 100 }}
                          />
                        </td>
                        <td data-label="작업" className="col-action">
                          <div className="row-actions purchase-sup-actions">
                            <button
                              type="button"
                              className="btn btn-sm po-act-btn"
                              onClick={() => printForSupplier(sup.name)}
                              title={`${sup.name} 품목만 발주서 PDF 출력`}
                            >
                              <Icon name="download" className="btn-ic" />
                              PDF 출력
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm btn-outline purchase-sup-mail${sup.email ? '' : ' is-no-email'}${mailSending[sup.name] != null ? ' is-sending' : ''}`}
                              disabled={mailSending[sup.name] != null}
                              onClick={() => {
                                if (!sup.email) {
                                  alert(
                                    `"${sup.name}"에 등록된 이메일이 없습니다.\n구매처 관리에서 이메일을 먼저 등록해주세요.`,
                                  );
                                  return;
                                }
                                openMailPreview(sup.name, sup.email, mailSubject, mailHtml, supPoNo);
                              }}
                              title={sup.email ? '발주서 메일 발송' : '이메일 미등록 — 구매처 관리에서 등록하세요'}
                            >
                              {mailSending[sup.name] != null ? `발송 중 ${mailSending[sup.name]}%` : '메일 발송'}
                            </button>
                            {sent ? (
                              <button
                                type="button"
                                className="btn btn-sm po-act-btn--on purchase-sup-toggle"
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
                            {replied ? (
                              <button
                                type="button"
                                className="btn btn-sm po-act-btn--on purchase-sup-toggle"
                                onClick={() => handleUnmarkSupplierReplied(sup.name)}
                              >
                                회신 취소
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline purchase-sup-toggle"
                                onClick={() => handleMarkSupplierReplied(sup.name)}
                              >
                                회신 확인
                              </button>
                            )}
                            {paid ? (
                              <span
                                className="btn btn-sm purchase-sup-toggle is-static po-act-paid"
                                title={`결제 완료 ${fmtDate(paid.paidAt)} — 결제 페이지에서 처리됨`}
                              >
                                결제완료
                              </span>
                            ) : payReq ? (
                              <button
                                type="button"
                                className="btn btn-sm po-act-btn--on purchase-sup-toggle"
                                onClick={() => handleCancelPaymentRequest(sup.name)}
                                title={`결제 요청됨 ${fmtDate(payReq.requestedAt)} — 클릭 시 요청 취소`}
                              >
                                요청 취소
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary purchase-sup-toggle"
                                onClick={() => handleRequestPayment(sup.name, recv.latest)}
                                title="결제를 요청하면 결제 페이지에 결제 대기로 올라갑니다"
                              >
                                결제 요청
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

      {purchase.receiveNote && (
        <div className="form-group screen-only">
          <label>검수 메모</label>
          <p className="purchase-readonly-text">{purchase.receiveNote}</p>
        </div>
      )}

      {(status === 'ordered' || status === 'partial') && (
        <p className="purchase-status-hint screen-only">
          {status === 'partial'
            ? '부분 입고 진행 중 — 상단의 “일괄 입고” 또는 “잔여 무시하고 입고 마감” 버튼을 사용하세요'
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
        title={bulkModal?.mode === 'close-as-is' ? '잔여 무시하고 입고 마감' : '일괄 입고 처리'}
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
                    {isClose ? '현재 입고된 수량으로 입고 마감' : `잔여 ${affected.length}개 라인 일괄 입고`}
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
                  <button type="button" className="btn btn-outline" onClick={() => setBulkModal(null)}>
                    취소
                  </button>
                  <button type="submit" className={`btn ${isClose ? 'btn-danger' : 'btn-primary'}`}>
                    {isClose ? '종결 처리' : '일괄 입고'}
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
              <button type="button" className="btn btn-outline" onClick={() => setReceiveModal(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                저장
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
        <div className="form-group">
          <label>세트 수량 (배수)</label>
          <input
            type="number"
            min="1"
            value={bomSetCount}
            onChange={(e) => setBomSetCount(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="1"
            style={{ maxWidth: 160, fontSize: 18, fontWeight: 700, textAlign: 'center' }}
          />
          <p className="field-hint">BOM 1세트 기준 수량에 곱해집니다. 예) 5세트 입력 → 각 품목 수량 ×5로 불러옵니다.</p>
        </div>
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

      <Modal
        isOpen={itemPickerOpen}
        onClose={closeItemPicker}
        title={itemPickerTargetIdx !== null ? `품목 변경 (${itemPickerTargetIdx + 1}번 행)` : '품목 선택'}
      >
        <form onSubmit={addPickedToPO}>
          <p className="field-hint">
            {itemPickerTargetIdx !== null
              ? '교체할 품목을 클릭하면 해당 행이 그 품목으로 바뀝니다. (수량·비고 유지, 단가는 표준단가 적용)'
              : '구매 품목 관리에 등록된 품목 중에서 선택해 발주에 추가합니다. 체크 후 수량을 입력하세요. (대분류 제외)'}
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
              return sorted.map((m) => {
                const meta = (
                  <>
                    <span className="bom-picker-code">{m.code || '-'}</span>
                    <span className="bom-picker-name">
                      <strong>{m.name}</strong>
                      {m.spec && <span className="bom-picker-spec"> ({m.spec})</span>}
                    </span>
                    {m.standardPrice > 0 && (
                      <span className="bom-picker-price">{Number(m.standardPrice).toLocaleString()}원</span>
                    )}
                  </>
                );
                // 교체 모드 — 클릭 즉시 해당 행 품목 교체
                if (itemPickerTargetIdx !== null) {
                  return (
                    <button
                      type="button"
                      key={m.id}
                      className="bom-picker-row bom-picker-row--btn"
                      onClick={() => replaceLineWithMaster(itemPickerTargetIdx, m)}
                    >
                      {meta}
                      <span className="bom-picker-pick">변경</span>
                    </button>
                  );
                }
                return (
                  <label key={m.id} className={`bom-picker-row ${itemPicked.has(m.id) ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={itemPicked.has(m.id)} onChange={() => toggleItemPick(m.id)} />
                    {meta}
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
                );
              });
            })()}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={closeItemPicker}>
              취소
            </button>
            {itemPickerTargetIdx === null && (
              <button type="submit" className="btn btn-primary" disabled={itemPicked.size === 0}>
                {itemPicked.size}개 추가
              </button>
            )}
          </div>
        </form>
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
          <button type="button" className="btn btn-outline" onClick={() => setPdfModalOpen(false)}>
            취소
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSavePdfToLibrary}
            disabled={!pdfFileName.trim()}
          >
            자료실에 저장
          </button>
        </div>
      </Modal>

      <Modal isOpen={pdfOptOpen} onClose={() => setPdfOptOpen(false)} title="PDF 출력 옵션">
        <p className="field-hint">발주서 출력 형식을 선택하세요.</p>
        <div className="toggle-row" style={{ marginBottom: 10 }}>
          <div className="toggle-row-text">
            <span className="toggle-row-title">금액 표기</span>
            <small className="text-muted">
              단가·금액·합계·총액 표시. 끄면 수량·품목만 출력됩니다 (메일 발송·자료실 저장은 항상 금액 포함)
            </small>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={pdfShowAmount} onChange={(e) => setPdfShowAmount(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="toggle-row" style={{ marginBottom: 10 }}>
          <div className="toggle-row-text">
            <span className="toggle-row-title">BOX 표시</span>
            <small className="text-muted">품목표의 품번 옆에 BOX 열을 추가합니다 (전체 PDF 출력에만 적용)</small>
          </div>
          <label className="toggle-switch">
            <input type="checkbox" checked={pdfShowBox} onChange={(e) => setPdfShowBox(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setPdfOptOpen(false)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={runPdfOutput}>
            PDF 출력
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!qtyModal} onClose={() => setQtyModal(null)} title="발주 수량 변경">
        {qtyModal && (
          <>
            <p className="field-hint">
              「<strong>{qtyModal.name}</strong>」의 발주 수량을 입력하세요. 보유자재가 있으면 그만큼 줄이면 됩니다.
            </p>
            <div className="form-group">
              <label>발주 수량</label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={qtyModal.value}
                onChange={(e) => setQtyModal({ ...qtyModal, value: e.target.value.replace(/[^\d]/g, '') })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveQtyModal();
                }}
                placeholder="0"
              />
              {qtyModal.receivedQty > 0 && (
                <p className="field-hint">
                  이미 <strong>{qtyModal.receivedQty}개</strong> 입고됨 — 이보다 작게는 설정할 수 없습니다.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setQtyModal(null)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={saveQtyModal}>
                저장
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={!!mailPreview}
        onClose={() => {
          setMailPreview(null);
          setMailExtraFiles([]);
        }}
        title="발주서 메일 미리보기"
        size="lg"
      >
        {mailPreview && (
          <>
            <div className="form-group">
              <label>받는 사람</label>
              <input
                type="email"
                value={mailPreview.to}
                onChange={(e) => setMailPreview((p) => ({ ...p, to: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>제목</label>
              <input
                type="text"
                value={mailPreview.subject}
                onChange={(e) => setMailPreview((p) => ({ ...p, subject: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>첨부파일</label>
              <button
                type="button"
                className="mail-attach-chip mail-attach-chip--btn"
                onClick={previewMailAttachment}
                disabled={mailAttachBusy}
                title="클릭하면 실제 첨부될 발주서 PDF를 새 탭에서 미리 확인합니다"
              >
                <Icon name={mailAttachBusy ? 'clock' : 'download'} className="btn-ic" />
                {mailAttachBusy ? '미리보기 생성 중…' : mailPreview.fileName}
              </button>
              <p className="field-hint">
                첨부파일을 클릭하면 실제 발송될 발주서 PDF를 미리 확인할 수 있습니다. 발송 시 동일한 PDF가 첨부됩니다.
              </p>
            </div>
            <div className="form-group">
              <label>추가 첨부파일 (선택)</label>
              <input
                ref={mailFileInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const fs = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (fs.length) setMailExtraFiles((prev) => [...prev, ...fs]);
                }}
              />
              <div
                className={`pdf-dropzone ${mailDropOver ? 'is-over' : ''}`}
                onClick={() => mailFileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setMailDropOver(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget)) return; // 자식 이동 오발동 방지
                  setMailDropOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setMailDropOver(false);
                  const fs = Array.from(e.dataTransfer.files || []);
                  if (fs.length) setMailExtraFiles((prev) => [...prev, ...fs]);
                }}
              >
                <Icon name="plus" className="pdf-dropzone-icon" />
                <span>파일을 끌어다 놓거나 클릭해서 첨부 (여러 개 가능)</span>
              </div>
              {mailExtraFiles.length > 0 && (
                <ul className="mail-extra-list">
                  {mailExtraFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="mail-extra-item">
                      <Icon name="doc" className="mail-extra-ic" />
                      <span className="mail-extra-name" title={f.name}>
                        {f.name}
                      </span>
                      <span className="mail-extra-size">
                        {f.size < 1024 * 1024
                          ? `${Math.max(1, Math.round(f.size / 1024))}KB`
                          : `${(f.size / 1024 / 1024).toFixed(1)}MB`}
                      </span>
                      <button
                        type="button"
                        className="mail-extra-del"
                        onClick={() => setMailExtraFiles((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="첨부 제거"
                        title="제거"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="field-hint">
                발주서 PDF 외에 도면·사양서 등을 함께 보낼 수 있습니다. (추가 첨부 합계 8MB 이하)
              </p>
            </div>
            <div className="form-group">
              <label>본문 미리보기</label>
              <div className="mail-body-preview" dangerouslySetInnerHTML={{ __html: mailPreview.html }} />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => {
                  setMailPreview(null);
                  setMailExtraFiles([]);
                }}
              >
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmSendMail}>
                발송
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* 발주 품목 휴지통 */}
      <Modal isOpen={lineTrashOpen} onClose={() => setLineTrashOpen(false)} title="발주 품목 휴지통" size="lg">
        <p className="field-hint">삭제한 품목 행이 보관됩니다. 복원하면 품목 목록으로 되살아납니다.</p>
        {(form.deletedItems || []).length === 0 ? (
          <div className="trash-empty">삭제한 품목이 없습니다.</div>
        ) : (
          <div className="table-scroll-x">
            <table className="table cards-sm">
              <thead>
                <tr>
                  <th>품명</th>
                  <th>규격</th>
                  <th style={{ width: 70 }}>수량</th>
                  <th style={{ width: 90 }}>단가</th>
                  <th style={{ width: 130 }}>삭제일시</th>
                  <th className="col-action" style={{ width: 150 }}>
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {(form.deletedItems || []).map((d, i) => {
                  const m = d.itemId ? itemMaster.find((x) => x.id === d.itemId) : null;
                  return (
                    <tr key={`${d.itemId || d.name}-${i}`}>
                      <td data-label="품명">
                        <strong>{(m && m.name) || d.name || '(이름 없음)'}</strong>
                      </td>
                      <td data-label="규격">{(m && m.spec) || d.spec || '-'}</td>
                      <td data-label="수량">{Number(d.qty) ? Number(d.qty).toLocaleString() : '-'}</td>
                      <td data-label="단가">{Number(d.unitPrice) ? Number(d.unitPrice).toLocaleString() : '-'}</td>
                      <td data-label="삭제일시">{d._deletedAt ? fmtDateTime(new Date(d._deletedAt)) : '-'}</td>
                      <td data-label="작업" className="col-action">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => restoreDeletedItem(i)}
                            disabled={isReadOnly}
                          >
                            <Icon name="restore" className="btn-ic" />
                            복원
                          </button>
                          <button type="button" className="btn btn-sm btn-danger" onClick={() => purgeDeletedItem(i)}>
                            <Icon name="trash" className="btn-ic" />
                            영구삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* 회신 확인 — 납기 입력 모달 */}
      <Modal isOpen={!!replyModal} onClose={() => setReplyModal(null)} title="회신 확인 — 납기 입력">
        {replyModal && (
          <>
            <p className="field-hint">
              <strong>{replyModal.supplierName}</strong> 업체의 회신을 확인 처리합니다. 회신받은 납기일을 입력하세요.
            </p>
            <div className="form-group">
              <label>납기일</label>
              <input
                type="date"
                value={replyModal.due || ''}
                onChange={(e) => setReplyModal((p) => ({ ...p, due: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setReplyModal(null)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmReplyWithDue}>
                회신 확인
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* 결제 요청 — 결제 마감일 입력 */}
      <Modal isOpen={!!payReqModal} onClose={() => setPayReqModal(null)} title="결제 요청 — 마감일 입력">
        {payReqModal && (
          <>
            <p className="field-hint">
              <strong>{payReqModal.supplierName}</strong> 업체 건의 결제를 요청합니다. 결제 마감일을 입력하면 결제
              페이지에 함께 전달됩니다.
            </p>
            {payReqModal.termLabel && (
              <p className="field-hint">
                이 구매처의 결제 조건은 <strong>{payReqModal.termLabel}</strong>입니다
                {payReqModal.autoFilled
                  ? ` — ${fmtDate(payReqModal.baseDate)} 기준으로 마감일을 미리 채웠습니다. 그대로 두거나 고치세요.`
                  : '.'}
              </p>
            )}
            <div className="form-group">
              <label>결제 마감일</label>
              <input
                type="date"
                value={payReqModal.due || ''}
                onChange={(e) => setPayReqModal((p) => ({ ...p, due: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setPayReqModal(null)}>
                취소
              </button>
              <button type="button" className="btn btn-primary" onClick={confirmPaymentRequest}>
                결제 요청
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
