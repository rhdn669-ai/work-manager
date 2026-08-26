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
  markSupplierClosed,
  unmarkSupplierClosed,
  setPurchaseReplied,
  getPurchaseConfig,
  consumeItemStock,
  releasePurchaseStock,
} from '../../services/purchaseService';
import { getAllSites } from '../../services/siteService';
import { trashPurchase, restoreTrashItem } from '../../services/trashService';
import { getBomProjects, getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { subscribePanels } from '../../services/productionService';
import { panelReceiveStatus } from '../../utils/panelAllocation';
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
import { isStockTracked } from '../../domain/stock';
import { contactsOf, hasChoice, mailToLine, resolveEmail, supplierKey } from '../../domain/supplierContacts';
import { paidList, payButtonLabel, unpaidAmount } from '../../domain/payment';
import { poFingerprint } from '../../utils/poFingerprint';
import { mergeSetLots, setLotsLabel, totalSetCount } from '../../utils/setLots';
import {
  PO_DEFAULTS,
  poDateStr,
  poNumber,
  deriveSupplier,
  computeSupplierList as computeSupplierListPure,
} from '../../utils/purchaseOrder';

// 발주서 미리 만들기 — 위 useEffect 주석 참고. 출력 경로 직렬화가 끝나면 다시 켠다.
const PREBUILD_ENABLED = true;

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
// 「BOM 가져오기」에서 쓴다 — 이미 발주서에 있는 품목이면 줄을 새로 만들지 않고 수량만 올린다.
// 같은 자재가 여러 줄로 흩어지면 몇 개를 사는지 한눈에 안 보이고, 입고 처리도 나뉜다.
// 품목과 BOX가 모두 같을 때만 한 줄로 본다 — BOX가 다르면 현장에서 쓰이는 자리가 다르다.
// ※ 「품목 불러오기」로 낱개를 담을 때는 합치지 않고 새 줄로 넣는다.
const lineKeyOf = (ln) => `${ln.itemId || `name:${(ln.name || '').trim()}|${(ln.spec || '').trim()}`}@@${ln.box || ''}`;

function mergeLines(existing, incoming) {
  const kept = existing.filter((ln) => (ln.name || '').trim() || ln.itemId);
  const byKey = new Map(kept.map((ln, i) => [lineKeyOf(ln), i]));
  const merged = [...kept];
  let addedCount = 0;
  let mergedCount = 0;
  for (const line of incoming) {
    const at = byKey.get(lineKeyOf(line));
    if (at === undefined) {
      byKey.set(lineKeyOf(line), merged.length);
      merged.push(line);
      addedCount += 1;
      continue;
    }
    // 이미 있는 줄 — 수량만 더한다. 단가·비고·입고 등 기존 값은 그대로 둔다.
    const cur = merged[at];
    merged[at] = {
      ...cur,
      qty: (Number(cur.qty) || 0) + (Number(line.qty) || 0),
      // 재고로 뺀 몫과 원래 필요했던 몫도 함께 더해야 「2 / 5」 표기가 맞는다
      stockUsed: (Number(cur.stockUsed) || 0) + (Number(line.stockUsed) || 0),
      stockNeed: (Number(cur.stockNeed) || Number(cur.qty) || 0) + (Number(line.stockNeed) || Number(line.qty) || 0),
    };
    mergedCount += 1;
  }
  return { merged, addedCount, mergedCount };
}

function deductStock(need, master) {
  const want = Number(need) || 0;
  if (!isStockTracked(master) || want <= 0) return { qty: want };
  // 담는 순간 자동으로 빼지 않는다 (2026-08-11 대표님).
  // 재고 칸에 「0 / 11」 버튼만 띄워 두고, 쓸지 말지는 사람이 눌러서 정한다.
  return { qty: want, stockUsed: 0, stockNeed: want };
}

// 서버 렌더(브라우저 PDF)는 보통 7~13초. 응답이 아예 없으면 진행률이 영영 멈추므로
// 시간을 끊어 실패로 돌린다 — 사람이 다시 눌러 볼 수 있어야 한다.
const PDF_TIMEOUT_MS = 60000;
function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what}이(가) ${Math.round(ms / 1000)}초 안에 끝나지 않았습니다`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
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
    setLots: [], // 담은 세트 내역 — [{ name: 타입명, count: 세트수 }]
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
  // 같은 업체라도 담당자별로 갈라 출력·발송한다 (예: COSEL 담당 / 델타 담당)
  const [printContactFilter, setPrintContactFilter] = useState(null);
  // 메일 모달에서 미리 떠 두는 첨부본 — 미리보기로 여는 파일이 그대로 첨부된다
  const [mailPdf, setMailPdf] = useState({ blob: null, url: '', name: '', error: '' });
  // 업체별로 미리 만들어 둔 발주서 — { [키]: { sig, blob, url } }
  // sig 는 그 업체 발주서의 「내용 지문」. 내용이 그대로면 다시 만들지 않는다.
  const poCacheRef = useRef(new Map());
  const preFormRef = useRef(null); // 미리 만들기 전용 양식 (화면 폼과 분리)
  const [preTarget, setPreTarget] = useState(null); // { supplierName, contact } — 있을 때만 전용 양식을 띄운다
  const preBuildRef = useRef({ running: false, timer: 0 });
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
  // 이 발주가 어느 생산 호기 것인지 — 여러 대에 걸칠 수 있다(입고는 한 번에 되므로 발주서 단위로 건다)
  const [allPanels, setAllPanels] = useState([]);
  const [panelPickOpen, setPanelPickOpen] = useState(false);
  const [panelPickProject, setPanelPickProject] = useState('');
  // 세트 내역 고치기 — BOM으로 담을 땐 저절로 쌓이지만, 옛 발주서나 잘못 담은 건 손으로 맞춘다
  const [setLotsDraft, setSetLotsDraft] = useState(null); // null = 닫힘
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
  const [closeModal, setCloseModal] = useState(null); // 마감 시 월 선택 모달 { supplierName, monthKey, amount, payDue } | null
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
    const unsubPanels = subscribePanels(setAllPanels);
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
      unsubPanels();
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
        panels: Array.isArray(p.panels) ? p.panels : [],
        factoryKey: p.factoryKey || '',
        deliveryPlace: p.deliveryPlace || '',
        items: p.items && p.items.length > 0 ? p.items.map((it) => ({ ...EMPTY_LINE, ...it })) : [{ ...EMPTY_LINE }],
        deletedItems: Array.isArray(p.deletedItems) ? p.deletedItems : [],
        note: p.note || '',
        supplierNotes: p.supplierNotes || {},
        setCount: Number(p.setCount) || 0,
        setLots: Array.isArray(p.setLots) ? p.setLots : [],
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

  // 발주서가 가져다 쓴 만큼 창고 재고를 실제로 줄인다(되돌릴 땐 음수로 주면 되돌아온다).
  // 이걸 안 하면 같은 재고를 여러 발주서가 각각 빼 써서 없는 자재를 있다고 계산하게 된다.
  async function applyStockUse(lines, sign, note) {
    const byItem = new Map();
    for (const ln of lines) {
      if (!ln.itemId) continue;
      // 가져다 쓴 몫(stockUsed)과 모자라서 메운 몫(stockShort)은 방향이 반대다
      const d = (Number(ln.stockUsed) || 0) - (Number(ln.stockShort) || 0);
      if (d === 0) continue;
      byItem.set(ln.itemId, (byItem.get(ln.itemId) || 0) + d * sign);
    }
    if (byItem.size === 0) return;
    try {
      await Promise.all(
        [...byItem].map(([itemId, delta]) =>
          consumeItemStock(itemId, delta, { byName: userProfile?.name || '', note }),
        ),
      );
    } catch {
      toast('재고 반영 중 오류가 발생했습니다 — 재고 화면에서 수량을 확인해 주세요', 'error', 0);
    }
  }

  // 재고를 쓸지 말지 한 버튼으로 오간다.
  //   쓰는 중 → 누르면 창고로 되돌리고 원래 필요 수량으로 발주
  //   안 쓰는 중 → 누르면 지금 창고에 남은 만큼 다시 가져다 쓴다
  function toggleStockLine(idx) {
    const ln = formRef.current.items[idx];
    if (!ln) return;
    const used = Number(ln.stockUsed) || 0;
    const need = Number(ln.stockNeed) || Number(ln.qty) || 0;
    if (need <= 0) return;

    if (used > 0) {
      applyStockUse([ln], -1, `발주 되돌림 · ${formRef.current.title || ''}`);
      updateLine(idx, { qty: need, stockUsed: 0, stockNeed: need });
      return;
    }
    // 다시 쓰기 — 처음 담을 때가 아니라 '지금' 남은 재고를 기준으로 한다
    const master = ln.itemId ? itemMaster.find((m) => m.id === ln.itemId) : null;
    const have = Number(master?.stockQty) || 0;
    if (have <= 0) {
      toast('창고에 남은 재고가 없습니다', 'error');
      return;
    }
    const use = Math.min(have, need);
    applyStockUse([{ ...ln, stockUsed: use }], 1, `발주 사용 · ${formRef.current.title || ''}`);
    updateLine(idx, { qty: need - use, stockUsed: use, stockNeed: need });
  }

  // 창고가 모자란 만큼(재고 음수) 발주 수량에 얹는다.
  // 메우고 나면 부족분이 사라지므로 재고는 0으로 올라간다.
  function fillShortage(idx, short) {
    const ln = formRef.current.items[idx];
    if (!ln || short <= 0) return;
    // stockShort 에 얼마를 메웠는지 남긴다 — 이게 없으면 창고가 0이 되는 순간
    // 빨간 배지가 사라져 되돌릴 방법이 없어진다.
    updateLine(idx, { qty: (Number(ln.qty) || 0) + short, stockShort: (Number(ln.stockShort) || 0) + short });
    if (ln.itemId) {
      consumeItemStock(ln.itemId, -short, {
        byName: userProfile?.name || '',
        note: `부족분 발주로 채움 · ${formRef.current.title || ''}`,
      }).catch(() => toast('재고 반영 중 오류가 발생했습니다', 'error'));
    }
    toast(`모자란 ${short}개를 발주 수량에 더했습니다`);
  }

  // 메웠던 부족분을 도로 뺀다 — 다시 모자란 상태로 돌아간다
  function undoShortage(idx) {
    const ln = formRef.current.items[idx];
    const filled = Number(ln?.stockShort) || 0;
    if (filled <= 0) return;
    updateLine(idx, { qty: Math.max(0, (Number(ln.qty) || 0) - filled), stockShort: 0 });
    if (ln.itemId) {
      consumeItemStock(ln.itemId, filled, {
        byName: userProfile?.name || '',
        note: `부족분 메움 취소 · ${formRef.current.title || ''}`,
      }).catch(() => toast('재고 반영 중 오류가 발생했습니다', 'error'));
    }
    toast(`더했던 ${filled}개를 도로 뺐습니다`);
  }

  // ---- 생산 호기 걸기 ----
  // 입고는 한 번에 되므로 발주서 단위로 여러 대를 건다.
  // 목록 순서(납기 → 호기)가 곧 생산 순서라, 자재가 모자라면 뒤 호기가 미입고로 남는다.
  const panelProjects = useMemo(() => {
    const names = new Set(allPanels.map((p) => (p.프로젝트 || '').trim()).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [allPanels]);

  function togglePanel(p) {
    setForm((f) => {
      const cur = Array.isArray(f.panels) ? f.panels : [];
      const has = cur.some((x) => x.id === p.id);
      const next = has
        ? cur.filter((x) => x.id !== p.id)
        : [...cur, { id: p.id, 프로젝트: p.프로젝트 || '', 호기: p.호기 || '' }];
      // 생산 순서(구독 정렬)를 그대로 따르게 다시 줄 세운다
      const order = new Map(allPanels.map((x, i) => [x.id, i]));
      next.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
      return { ...f, panels: next };
    });
    scheduleAutoSave();
  }

  // 세트 내역 고치기 — 옛 발주서엔 타입명 없이 세트 수만 남아 있어 이름을 채워 넣어야 한다
  function openSetLots() {
    const cur = (form.setLots || []).filter((l) => l && (String(l.name ?? '').trim() || Number(l.count) > 0));
    if (cur.length)
      return setSetLotsDraft(cur.map((l) => ({ name: String(l.name || ''), count: Number(l.count) || 0 })));
    // 내역이 없으면 지금 숫자를 한 줄로 옮겨 준다 — 이름만 적으면 끝나게
    const n = Number(form.setCount) || 0;
    setSetLotsDraft([{ name: '', count: n > 0 ? n : 1 }]);
  }

  function saveSetLots() {
    const clean = (setLotsDraft || [])
      .map((l) => ({ name: String(l.name || '').trim(), count: Number(l.count) || 0 }))
      .filter((l) => l.name && l.count > 0);
    setForm((f) => ({ ...f, setLots: clean, setCount: totalSetCount(clean) }));
    scheduleAutoSave();
    setSetLotsDraft(null);
    toast(clean.length ? `세트 내역을 ${clean.length}줄로 저장했습니다.` : '세트 내역을 비웠습니다.');
  }

  // 걸린 호기별로 자재를 다 받았는지 — 앞 호기부터 채우고 모자라면 뒤가 미입고
  const panelStatus = useMemo(() => panelReceiveStatus(form.items, form.panels || []), [form.items, form.panels]);

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
    for (const [itemId, qtyInput] of itemPicked) {
      const m = itemMaster.find((x) => x.id === itemId);
      if (!m) continue;
      newLines.push({
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        unitPrice: Number(m.standardPrice) || 0,
        ...deductStock(qtyInput, m),
      });
    }
    if (newLines.length === 0) {
      setItemPickerOpen(false);
      return;
    }
    // 낱개로 담는 것이라 이미 같은 품목이 있어도 합치지 않고 새 줄로 넣는다
    setForm((f) => {
      const existing = f.items.filter((ln) => (ln.name || '').trim() || ln.itemId);
      return { ...f, items: [...existing, ...newLines] };
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
    const gone = formRef.current.items[idx];
    if (gone) applyStockUse([gone], -1, '발주 품목 삭제로 되돌림'); // 안 사게 됐으니 창고로 반환
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
    const back = (formRef.current.deletedItems || [])[i];
    if (back) applyStockUse([back], 1, '발주 품목 복원'); // 되살렸으니 재고를 다시 쓴다
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
    applyStockUse(formRef.current.items, -1, '발주 품목 전체 삭제로 되돌림');
    setForm((f) => ({ ...f, items: [{ ...EMPTY_LINE }], setCount: 0, setLots: [] }));
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
  // variantKey 를 주면 그 타입(형번)에 들어가는 품목만 — 공통 + 그 타입 전용 — 가져온다.
  async function importBom(bp, variantKey = '') {
    const setCount = Math.max(1, Number(bomSetCount) || 1);
    setBomImporting(true);
    try {
      const all = await getBomBySite(bp.id);
      const items = bomItemsForVariant(all, variantKey);
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
            ...deductStock((Number(b.qty) || 1) * setCount, m), // 세트 수량(배수) 반영
            unitPrice: m && m.standardPrice != null ? Number(m.standardPrice) : Number(b.unitPrice) || 0,
            box: b.box || '', // 품목별 소속 BOX (BOM에서 그대로 복사, PDF 품목표에 출력)
            note: b.note || '',
          };
        });
      // 이미 발주서에 있는 품목은 새 줄을 만들지 않고 수량을 올린다
      const vLabel = variantKey ? (bp.variants || []).find((v) => v.key === variantKey)?.label : '';
      let report = null;
      setForm((f) => {
        const r = mergeLines(f.items, newLines);
        report = r;
        // 타입마다 몇 세트인지 따로 남긴다 — 숫자 하나로 두면 나중에 담은 타입이 앞의 것을 덮어쓴다
        const setLots = mergeSetLots(f.setLots, vLabel || bp.name, setCount);
        return { ...f, items: r.merged, setLots, setCount: totalSetCount(setLots) };
      });
      scheduleAutoSave();
      setBomModalOpen(false);
      const tail =
        report?.mergedCount > 0
          ? `품목 ${report.addedCount}개 추가 · 이미 있던 ${report.mergedCount}개는 수량을 더했습니다.`
          : `품목 ${newLines.length}개를 가져왔습니다.`;
      toast(`"${bp.name}"${vLabel ? ` · ${vLabel}` : ''} BOM에서 ${tail}`);
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
  // 재고를 건드릴 수 있는 건 아직 발주가 나가지 않은 「발주대기」뿐이다.
  // 발주 뒤에 수량이 바뀌면 업체에 보낸 발주서와 앱 숫자가 어긋나고,
  // 회신·입고 처리도 그 수량을 기준으로 하므로 정합성이 깨진다.
  const canUseStock = !isReadOnly && purchase?.status === 'draft';

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
        panels: f.panels || [], // 이 발주가 어느 생산 호기 것인지 (여러 대 가능)
        factoryKey: f.factoryKey || '',
        deliveryPlace: f.deliveryPlace || '',
        items,
        totalAmount,
        supplierId,
        supplierName,
        note: f.note,
        supplierNotes: f.supplierNotes || {},
        setCount: Number(f.setCount) || 0,
        setLots: f.setLots || [],
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
        setLots: f.setLots || [],
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
  // 업체별 「PDF 출력」 — 메일 첨부와 같은 서버 렌더로 만든다.
  // 브라우저 인쇄로 뽑으면 만드는 엔진·폰트·최종 처리가 달라 같은 내용인데도
  // 셀 높이·글자 두께가 미세하게 어긋난다 (2026-08-20 대표님).
  // 미리 구워 둔 것이 있으면 그대로 열어 기다림이 없다.
  async function printForSupplier(supName, contact = null) {
    const fileName = `${['발주서', purchase?.title, supName]
      .filter(Boolean)
      .map((x) => String(x).trim())
      .join('_')}.pdf`.replace(/[/\\]/g, '_');
    const hit = poCacheRef.current.get(poCacheKey(supName, contact, 'inner'));
    if (hit && hit.sig === poSigOf(supName, contact, 'inner')) {
      window.open(hit.url, '_blank');
      return;
    }
    // 클릭 순간에 창을 열어 둔다 — 다 만든 뒤에 열면 팝업 차단에 걸린다
    const win = window.open('', '_blank');
    try {
      const made = await ensurePoPdf(supName, contact, fileName, true, 'inner');
      if (win) win.location = made.url;
      else window.open(made.url, '_blank');
    } catch (err) {
      if (win) win.close();
      toast(`발주서를 만들지 못했습니다: ${err?.message || err}`, 'error');
    }
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
      // 발주서가 쥐고 있던 재고를 창고로 돌려준다 — 안 그러면 지운 만큼 재고가 사라진다
      const goneItems = formRef.current?.items || [];
      const tid = await trashPurchase(id, userProfile?.name || '');
      await releasePurchaseStock(goneItems, {
        byName: userProfile?.name || '',
        note: `발주 삭제로 되돌림 · ${purchase.title || ''}`,
      });
      const title = purchase.title;
      const purchaseId = id;
      navigate('/admin/purchase');
      if (tid)
        pushGlobalUndo(`발주 "${title}" 삭제`, async () => {
          await restoreTrashItem(tid);
          // 되살렸으니 재고도 다시 가져다 쓴다
          await releasePurchaseStock(goneItems, {
            byName: userProfile?.name || '',
            note: `발주 복원 · ${title}`,
            back: false,
          });
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

  // ── 발주서 미리 만들기 ─────────────────────────────────────────────
  // 품목을 고치고 손을 멈추면(3초), 아직 안 보낸 업체의 발주서를 뒤에서 한 장씩 떠 둔다.
  // 메일 모달을 열 때 이미 준비돼 있으면 기다리는 시간이 0이 된다.
  //
  // 낭비를 막는 장치 —
  //   · 타이핑 중에는 안 만든다 (3초 조용해야 시작)
  //   · 내용 지문이 그대로면 다시 안 만든다
  //   · 이미 발송한 업체는 건너뛴다
  //   · 한 번에 한 장씩, 발송 큐와 같은 줄에 서서 (렌더 폼을 동시에 만지지 않게)
  //   · 창을 닫거나 품목이 또 바뀌면 그 자리에서 멈춘다
  async function preBuildAll(alive) {
    if (preBuildRef.current.running) return;
    preBuildRef.current.running = true;
    try {
      const cur = purchaseRef.current || purchase;
      // 발주대기 건만 미리 만든다. 이미 내보낸 발주서는 다시 보낼 일이 드물어,
      // 열어 보기만 해도 업체 수만큼 굽는 것은 그냥 낭비다.
      if ((cur?.status || 'draft') !== 'draft') return;
      const sent = cur?.supplierSent || {};
      for (const sup of computeSupplierList()) {
        if (!alive()) break;
        if (!sup.orderCount) continue; // 재고로 다 채운 업체 — 보낼 발주서가 없다
        // ★ 화면의 「메일 발송」 버튼과 똑같은 값을 써야 한다 —
        //   여기서 다른 값을 쓰면 캐시 키가 어긋나 미리 만들어 둔 것을 못 찾는다.
        const contact = sup.contact ?? null;
        if (sent[supplierKey(sup.name, contact)]) continue; // 이미 보낸 업체
        const key = supplierKey(sup.name, contact);
        const hit = poCacheRef.current.get(key);
        if (hit && hit.sig === poSigOf(sup.name, contact)) continue; // 그대로면 그대로 둔다
        const fileName = `${['발주서', purchase?.title, sup.name]
          .filter(Boolean)
          .map((x) => String(x).trim())
          .join('_')}.pdf`.replace(/[/\\]/g, '_');
        // 한 장 실패해도 나머지는 계속 — 어차피 모달에서 다시 만들 수 있다
        // 메일용(계좌 없음·현장명 공백)과 내부용(계좌 표시·실제 현장명) 두 벌
        for (const kind of ['mail', 'inner']) {
          if (!alive()) break;
          await ensurePoPdf(sup.name, contact, fileName, true, kind).catch(() => null);
        }
      }
    } finally {
      preBuildRef.current.running = false;
    }
  }

  const preBuildSig = (form.items || [])
    .map((ln) => `${ln.itemId || ''}:${ln.name || ''}:${ln.qty || 0}:${ln.unitPrice || 0}:${ln.box || ''}`)
    .join('~');
  useEffect(() => {
    // ★ 미리 만들기 일시 중지 (2026-08-20)
    //   발주서 렌더 폼이 화면에 하나뿐이라, 뒤에서 업체를 바꿔가며 굽는 동안
    //   사용자가 「PDF 출력」·「자료실 저장」을 누르면 그때 폼에 걸려 있던
    //   다른 업체 상태로 캡처된다 — 엉뚱한 발주서가 나갈 수 있다.
    //   출력 경로를 전부 한 줄에 세운 뒤에 다시 켠다.
    if (!PREBUILD_ENABLED) return undefined;
    // 모달이 열려 있어도 계속 굽는다 — 전용 양식을 쓰므로 화면 작업과 겹치지 않는다
    if (!id || !purchase) return undefined;
    let alive = true;
    clearTimeout(preBuildRef.current.timer);
    // 4초 — 타이핑 중에는 안 굽되, 필요할 때 준비돼 있을 만큼은 일찍 시작한다
    preBuildRef.current.timer = setTimeout(() => preBuildAll(() => alive), 4000);
    return () => {
      alive = false;
      clearTimeout(preBuildRef.current.timer);
    };

    // itemMaster·suppliers 는 넣지 않는다 — 구독으로 배열 참조가 자주 바뀌어
    // 타이머가 계속 되감기면 미리 만들기가 영영 시작되지 않는다.
  }, [preBuildSig, id, itemMaster.length, suppliers.length]);

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
      // 담당자가 갈린 업체는 담당별로 따로 센다 — 키를 업체명만 쓰면 COSEL·델타가
      // 한 칸에 쌓여 두 줄에 같은 금액이 찍힌다. 발송 목록과 같은 키를 쓴다.
      const who = contactsOf(sup).find((c) => c.email === resolveEmail(sup, master?.contactEmail));
      const key = supplierKey(supName, hasChoice(sup) ? who?.email || '' : '');
      const savedQty = Number(ln.qty) || 0;
      const receivedQty = Number(ln.receivedQty) || 0;
      const full = savedQty > 0 && receivedQty >= savedQty;
      if (!map[key]) map[key] = { total: 0, full: 0, latest: null, recvAmount: 0, pendingCount: 0, pendingAmount: 0 };
      map[key].total += 1;
      if (full) map[key].full += 1;
      const price = Number(ln.unitPrice) || 0;
      const got = Math.min(receivedQty, savedQty); // 초과 입고는 발주 수량까지만 센다
      map[key].recvAmount += got * price;
      const left = savedQty - got;
      if (left > 0) {
        map[key].pendingCount += 1;
        map[key].pendingAmount += left * price;
      }
      if (ln.receivedAt) {
        const d = ln.receivedAt.toDate ? ln.receivedAt.toDate() : new Date(ln.receivedAt);
        if (!Number.isNaN(d.getTime()) && (!map[key].latest || d > map[key].latest)) map[key].latest = d;
      }
    }
    return map;
  }

  // 모든 업체 메일 발송 완료 + 현재 '발주대기' 상태면 → '발주완료'로 자동 확정 (확인창 없이)
  async function maybeAutoConfirm(sentMap) {
    const cur = purchaseRef.current || purchase;
    if (!cur || (cur.status || 'draft') !== 'draft') return; // 발주대기 상태에서만 자동 전환
    const supList = computeSupplierList().filter((s) => s.orderCount > 0);
    if (supList.length === 0) return;
    const allSent = supList.every((s) => sentMap[supplierKey(s.name, s.contact ?? null)]);
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
  async function markSent(supplierName, contact = null) {
    try {
      const sentKey = supplierKey(supplierName, contact);
      await markSupplierSent(id, sentKey, userProfile?.name || '');
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

  async function handleMarkSupplierSent(supplierName, contact = null) {
    if (!(await confirm(`"${supplierName}" 업체에 발주 완료 표시하시겠습니까?`))) return;
    // 담당이 갈린 업체는 담당까지 넘겨야 그 줄에 표시가 붙는다 (회신 확인과 같은 규칙)
    await markSent(supplierName, contact);
  }

  // 모든 업체 회신 확인 + 현재 '발주완료' 상태면 → '회신'으로 자동 전환
  async function maybeAutoReply(repliedMap) {
    const cur = purchaseRef.current || purchase;
    if (!cur || (cur.status || 'draft') !== 'ordered') return; // 발주완료 상태에서만 전환
    // 보낼 것이 없던 업체는 회신도 없다 — 자동 전환 판정에서 뺀다 (발주완료 전환과 같은 규칙)
    const supList = computeSupplierList().filter((s) => s.orderCount > 0);
    if (supList.length === 0) return;
    const allReplied = supList.every((s) => repliedMap[supplierKey(s.name, s.contact ?? null)]);
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
  function handleMarkSupplierReplied(supplierName, contact = null) {
    const key = supplierKey(supplierName, contact);
    const prevDue = purchase.supplierReplied?.[key]?.deliveryDue || purchase.deliveryDue || '';
    setReplyModal({ supplierName, contact, due: prevDue });
  }

  // 납기 입력 후 회신 확인 확정
  async function confirmReplyWithDue() {
    if (!replyModal) return;
    const { supplierName, contact = null, due } = replyModal;
    setReplyModal(null);
    try {
      const key = supplierKey(supplierName, contact);
      await markSupplierReplied(id, key, userProfile?.name || '', due || '');
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
  async function handleUnmarkSupplierReplied(supplierName, contact = null) {
    if (!(await confirm(`"${supplierName}" 업체의 회신 확인을 취소하시겠습니까?`))) return;
    try {
      const key = supplierKey(supplierName, contact);
      await unmarkSupplierReplied(id, key);
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

  // 결제 키 — 결제는 회사 대 회사라 담당이 갈려도 업체 하나로 묶는다 (2026-08-20 대표님).
  // 발송·발주완료·회신은 담당별로 갈리지만, 돈은 업체 앞으로 한 번에 나간다.
  function payKey(supplierName) {
    return supplierKey(supplierName, null);
  }

  // 업체별 마감 — 회신 확인과 결제 요청 사이의 단계.
  //
  // 「이 업체에서 이번 달에 이만큼 납품받았다」를 담당자가 확정한다. 앱이 입고일로 짐작하지
  // 않는 이유는, 부분입고나 늦게 찍힌 입고일 때문에 엉뚱한 달로 새기 때문이다.
  // 여기서 정한 달·금액이 그대로 마감 리스트에 확정으로 올라간다 (2026-08-26 대표님).
  function handleCloseSupplier(supplierName, receivedAt, amount) {
    const key = payKey(supplierName);
    const prev = purchase.supplierClosed?.[key];
    const sup = suppliers.find((x) => x.name === supplierName);
    const base = receivedAt || new Date(); // 납품 완료일이 기준, 없으면 오늘
    const d = base instanceof Date ? base : new Date(base);
    const auto = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    setCloseModal({
      supplierName,
      monthKey: prev?.monthKey || auto,
      amount: prev?.amount ?? amount ?? 0,
      payDue: prev?.payDue || calcPaymentDue(sup, base),
      termLabel: paymentTermLabel(sup),
      baseDate: base,
    });
  }

  async function confirmCloseSupplier() {
    if (!closeModal) return;
    const { supplierName, monthKey, amount, payDue } = closeModal;
    setCloseModal(null);
    try {
      const key = payKey(supplierName);
      const info = {
        vendor: supplierName,
        monthKey,
        amount: Number(amount) || 0,
        payDue: payDue || '',
        by: userProfile?.name || '',
      };
      await markSupplierClosed(id, key, info);
      const next = { ...(purchaseRef.current?.supplierClosed || {}), [key]: { ...info, at: new Date() } };
      purchaseRef.current = { ...(purchaseRef.current || {}), supplierClosed: next };
      setPurchase((prev) => ({ ...prev, supplierClosed: next }));
      toast('마감했습니다. 마감 리스트에서 확인하세요.');
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  async function handleCancelClose(supplierName) {
    if (!(await confirm(`"${supplierName}" 업체 건의 마감을 취소하시겠습니까?`))) return;
    try {
      const key = payKey(supplierName);
      await unmarkSupplierClosed(id, key);
      setPurchase((prev) => {
        const next = { ...(prev.supplierClosed || {}) };
        delete next[key];
        purchaseRef.current = { ...(purchaseRef.current || {}), supplierClosed: next };
        return { ...prev, supplierClosed: next };
      });
      toast('마감을 취소했습니다');
    } catch {
      toast('처리 중 오류가 발생했습니다', 'error');
    }
  }

  // 업체별 결제 요청 → 결제 마감일 입력 모달을 먼저 띄운다.
  // 구매처에 결제 조건이 있으면 마감일을 미리 계산해 채워 둔다. 사람은 확인만 하면 된다.
  function handleRequestPayment(supplierName, receivedAt) {
    const key = payKey(supplierName);
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
      const key = payKey(supplierName);
      await markPaymentRequested(id, key, userProfile?.name || '', due || '');
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
      const key = payKey(supplierName);
      await unmarkPaymentRequested(id, key);
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
  function openMailPreview(
    supplierName,
    toEmail,
    subject,
    htmlBody,
    poNo,
    contact = null,
    contactName = '',
    bodyText = '',
    head = '',
    tail = '',
  ) {
    const build = (arr) =>
      `${arr
        .filter(Boolean)
        .map((s) => String(s).trim())
        .filter(Boolean)
        .join('_')}.pdf`.replace(/[/\\]/g, '_');
    const fileName = build(['발주서', purchase.title, supplierName]); // 발송용(제목·업체명까지만)
    const saveFileName = build(['발주서', purchase.title, purchase.subtitle, supplierName, poNo]); // 저장용(부제 포함)
    setMailExtraFiles([]); // 추가 첨부 초기화
    setMailPreview({
      supplierName,
      contact,
      contactName,
      to: toEmail,
      subject,
      html: htmlBody,
      // 이 건만 고쳐 보낼 수 있게 본문 글을 따로 싣는다 — 공통 문구(form.mailBody)는 건드리지 않는다
      bodyText,
      head,
      tail,
      fileName,
      saveFileName,
    });
    // ★ 이전 업체 첨부본을 먼저 비운다 — 안 비우면 새 첨부가 준비되기 전에 발송했을 때
    //   앞 업체 발주서가 그대로 붙어 나갈 수 있다.
    setMailPdf({ blob: null, url: '', name: fileName, error: '' });
    buildMailPdf(supplierName, contact, fileName);
  }

  // 미리보기 모달에서 "첨부파일" 클릭 → 실제 첨부될 발주서 PDF를 그 자리에서 생성해 새 탭으로 열어 확인.
  // (발송 전 양식이 정상인지 눈으로 검증 — 깨진 채 발송되는 것 방지)
  // 첨부본을 미리 떠 둔다 — 모달을 여는 순간 시작해 사람이 본문을 읽는 동안 끝난다.
  // 여기서 만든 그 파일이 미리보기로도 열리고 메일에도 그대로 붙는다.
  // 그 업체 발주서의 지문 — 내용이 그대로면 미리 만든 것을 다시 쓴다
  // 같은 업체라도 내부용(inner)과 메일용(mail)은 다른 문서다 — 캐시를 따로 둔다
  function poCacheKey(supplierName, contact, kind) {
    return `${supplierKey(supplierName, contact)}::${kind}`;
  }

  function poSigOf(supplierName, contact, kind = 'mail') {
    const cur = purchaseRef.current || purchase;
    const key = supplierKey(supplierName, contact);
    const mine = (formRef.current?.items || []).filter((ln) => {
      const m = ln.itemId ? itemMaster.find((x) => x.id === ln.itemId) : null;
      const sup = m?.defaultSupplierId ? suppliers.find((x) => x.id === m.defaultSupplierId) : null;
      const name = sup?.name || cur?.supplierName || '(구매처 미지정)';
      if (name !== supplierName) return false;
      return contact == null || resolveEmail(sup, m?.contactEmail) === contact;
    });
    return poFingerprint(mine, {
      supplierName,
      contact: `${contact ?? ''}|${kind}`,
      title: cur?.title,
      subtitle: cur?.subtitle,
      deliveryDue: cur?.deliveryDue,
      note: formRef.current?.supplierNotes?.[key] || formRef.current?.note || '',
    });
  }

  // 한 업체 발주서를 떠서 캐시에 넣는다. 이미 같은 내용이 있으면 그냥 돌려준다.
  //
  // ★ 반드시 한 줄로 선다 — 발송·미리 만들기·미리보기가 모두 같은 렌더 폼(printRef) 하나를
  //   쓴다. 둘이 겹치면 업체 필터를 서로 덮어써서 엉뚱한 발주서가 만들어진다.
  function ensurePoPdf(supplierName, contact, fileName, background = false, kind = 'mail') {
    // 미리 만들기는 전용 양식을 쓰므로 발송 줄에 서지 않는다 — 서면 발송이 끝날 때까지 굶는다.
    if (background) return buildPoPdfNow(supplierName, contact, fileName, true, kind);
    const run = mailSendChainRef.current.then(() => buildPoPdfNow(supplierName, contact, fileName, false, kind));
    mailSendChainRef.current = run.catch(() => {}); // 한 장이 실패해도 줄은 계속 흐르게
    return run;
  }

  //   background=true 면 전용 양식(preFormRef)으로 뜬다 — 화면 폼을 건드리지 않으므로
  //   그 사이 사용자가 「PDF 출력」·「자료실 저장」을 눌러도 서로 방해하지 않는다.
  async function buildPoPdfNow(supplierName, contact, fileName, background = false, kind = 'mail') {
    const key = poCacheKey(supplierName, contact, kind);
    const sig = poSigOf(supplierName, contact, kind);
    const hit = poCacheRef.current.get(key);
    if (hit && hit.sig === sig) return hit;
    await ensureAnonymousAuth();
    await flushAutoSave();
    let blob = null;
    if (background) {
      setPreTarget({ supplierName, contact: contact ?? null, kind });
      await new Promise((r) => setTimeout(r, 350)); // 전용 양식이 그려질 때까지
      try {
        const el = preFormRef.current;
        if (el) blob = await withTimeout(captureToPdfBlob(el, fileName), PDF_TIMEOUT_MS, '발주서 PDF 생성');
      } finally {
        setPreTarget(null);
      }
    } else {
      setPrintSiteNameMode(kind === 'inner' ? null : 'blank');
      setPrintAccountMode(kind === 'inner');
      setPrintSupplierFilter(supplierName);
      setPrintContactFilter(contact ?? null);
      await new Promise((r) => setTimeout(r, 250));
      try {
        const el = printRef.current;
        if (el) blob = await withTimeout(captureToPdfBlob(el, fileName), PDF_TIMEOUT_MS, '발주서 PDF 생성');
      } finally {
        setPrintSupplierFilter(null);
        setPrintContactFilter(null);
        setPrintSiteNameMode(null);
        setPrintAccountMode(false);
      }
    }
    if (!blob) throw new Error('PDF를 만들지 못했습니다 (배포 환경에서만 동작)');
    if (hit?.url) URL.revokeObjectURL(hit.url);
    const made = { sig, blob, url: URL.createObjectURL(blob), name: fileName };
    poCacheRef.current.set(key, made);
    return made;
  }

  // 모달에서 쓸 첨부본을 채운다 — 미리 만들어 둔 것이 있으면 그것을 그대로 쓴다
  async function buildMailPdf(supplierName, contact, fileName) {
    const hit = poCacheRef.current.get(poCacheKey(supplierName, contact, 'mail'));
    if (hit && hit.sig === poSigOf(supplierName, contact, 'mail')) {
      setMailPdf({ blob: hit.blob, url: hit.url, name: hit.name || fileName, error: '' });
      return;
    }
    // busy 여도 그냥 줄을 선다 — 여기서 되돌아가면 첨부본이 앞 업체 것으로 남는다
    setMailPdf({ blob: null, url: '', name: fileName, error: '' });
    setMailAttachBusy(true);
    try {
      const made = await ensurePoPdf(supplierName, contact, fileName);
      setMailPdf({ blob: made.blob, url: made.url, name: made.name, error: '' });
    } catch (err) {
      setMailPdf({ blob: null, url: '', name: fileName, error: err.message || String(err) });
    } finally {
      setMailAttachBusy(false);
    }
  }

  // 미리보기 모달의 "발송" → 모달 즉시 닫고 백그라운드로 PDF 생성·발송 (대기 없음)
  function confirmSendMail() {
    if (!mailPreview) return;
    const {
      supplierName,
      to,
      subject,
      html,
      fileName,
      saveFileName,
      contact: contactFilter = null,
      bodyText = '',
      head = '',
      tail = '',
    } = mailPreview;
    // 모달에서 고친 본문으로 다시 짠다. 앞뒤 틀(발신·수신·명함)은 그대로 둔다.
    const editedHtml = head
      ? head +
        String(bodyText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') +
        tail
      : html;
    // 미리보기로 확인한 바로 그 파일. 단 파일명이 이 업체 것과 다르면 쓰지 않는다
    // (앞 업체 첨부본이 남아 있을 때 그대로 나가는 것을 막는 마지막 빗장)
    const readyPdf = mailPdf.blob && mailPdf.name === fileName ? mailPdf.blob : null;
    const extraFiles = mailExtraFiles; // 발송 시점의 추가 첨부 캡처
    setMailPreview(null);
    setMailExtraFiles([]);
    // 발송 중 표시는 담당까지 넣은 키로 — 업체명만 쓰면 델타·COSEL 처럼 담당이 갈린
    // 업체에서 버튼이 잠기지 않아 같은 발주서를 두 번 보낼 수 있다.
    const sendingKey = supplierKey(supplierName, contactFilter);
    const setPct = (pct) => setMailSending((prev) => ({ ...prev, [sendingKey]: pct }));
    const clearPct = () =>
      setMailSending((prev) => {
        const next = { ...prev };
        delete next[sendingKey];
        return next;
      });
    // ★ 안전 가드 — 업체명이 비어 있으면 필터가 무력화되어 "전체 품목"이 첨부될 수 있으므로
    //   발송을 거부한다. (전체 리스트가 한 업체에 나가던 사고의 두 번째 경로 차단)
    if (!supplierName || !String(supplierName).trim()) {
      toast('업체가 지정되지 않아 발송을 중단했습니다. (전체 발주서 오발송 방지)', 'error');
      clearPct();
      return;
    }
    // 받는 사람은 담당자 + 참조(CC)라 여럿일 수 있다 — 한 줄에 쉼표로 들어온다
    const toList = String(to || '')
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const badTo = toList.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (toList.length === 0 || badTo) {
      toast(badTo ? `받는 사람 주소가 올바르지 않습니다: ${badTo}` : '받는 사람 메일 주소를 입력해 주세요.', 'error');
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
        setPrintContactFilter(contactFilter);
        setPrintStamp(fmtDateTime(new Date()));
        await new Promise((r) => setTimeout(r, 250));
        setPct(40);
        let attachments = [];
        let pdfBlob = null;
        try {
          const el = printRef.current;
          if (el) {
            // 메일에 붙일 것만 먼저 만든다 (계좌 없음).
            // 내부 보관본은 발송이 끝난 뒤에 만든다 — 서버 렌더가 한 번에 7~13초라
            // 두 장을 앞에서 다 만들면 보내는 사람이 20초 넘게 기다리게 된다.
            setPct(45);
            // 모달을 열 때 떠 둔 것이 있으면 그대로 쓴다 — 본 것과 다른 파일이 갈 일이 없고 빠르다
            pdfBlob =
              readyPdf || (await withTimeout(captureToPdfBlob(el, fileName), PDF_TIMEOUT_MS, '발주서 PDF 생성'));
            setPct(60);
            const base64 = await blobToBase64(pdfBlob);
            attachments = [{ filename: fileName, content: base64, encoding: 'base64' }];
          }
        } finally {
          setPrintSupplierFilter(null);
          setPrintContactFilter(null);
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
        let sendHtml = editedHtml;
        const cardMatch = editedHtml.match(/src="(\/cards\/[^"]*)"/);
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
              sendHtml = editedHtml.replace(cardMatch[1], 'cid:bizcard');
            }
          } catch {
            /* 명함 로드 실패 시 경로 이미지 그대로 발송 */
          }
        }
        // 사용자가 추가한 첨부파일(도면·사양서 등)을 메일에 함께 첨부
        if (extraFiles.length > 0) {
          const totalExtra = extraFiles.reduce((s, f) => s + (f.size || 0), 0);
          // 발주서·명함이 함께 가므로 추가 첨부만으로 6MB 를 넘기면 거의 확실히 못 보낸다
          if (totalExtra > 6 * 1024 * 1024) {
            toast('추가 첨부 용량이 너무 큽니다(총 6MB 이하). 일부를 빼고 다시 보내세요.', 'error');
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
        // 보내기 직전 실제 전송 크기 확인 — base64 는 원본보다 1/3 커져서,
        // 원본 기준으로만 재면 다 만들어 놓고 서버에서 거부당한다(한계 10MB).
        const totalB64 = attachments.reduce((acc, a) => acc + (a.content?.length || 0), 0);
        if (totalB64 > 9 * 1024 * 1024) {
          toast(
            `첨부 용량이 커서 보낼 수 없습니다 (약 ${Math.round(totalB64 / 1024 / 1024)}MB). 추가 첨부를 줄여 다시 보내세요.`,
            'error',
          );
          clearPct();
          return;
        }
        await withTimeout(callSendEmail({ to, subject, html: sendHtml, attachments }), PDF_TIMEOUT_MS, '메일 발송');
        setPct(100);
        toast(`"${supplierName}" 발주서(PDF 첨부)를 발송했습니다.`);
        const sentKey = supplierKey(supplierName, contactFilter);
        // purchase 는 이 발송이 시작될 때의 값이라 오래됐을 수 있다 — 최신 것으로 본다
        if (!purchaseRef.current?.supplierSent?.[sentKey]) markSent(supplierName, contactFilter);
        // 발송 성공 → 프로젝트 자료실 "발주이력 > YYYY-MM" 월 폴더에 발주서 PDF 자동 보관
        // 내부 저장본은 계좌 포함(saveBlob), 없으면 메일본(pdfBlob)
        // 보관본(계좌 포함·실제 현장명)은 여기서 다시 뜬다 — 사람은 이미 발송 완료를 봤다.
        let archiveBlob = pdfBlob;
        if (purchase.siteName && printRef.current) {
          try {
            setPrintSupplierFilter(supplierName);
            setPrintContactFilter(contactFilter);
            setPrintAccountMode(true);
            setPrintSiteNameMode(null);
            await new Promise((r) => setTimeout(r, 250));
            archiveBlob = await withTimeout(
              captureToPdfBlob(printRef.current, saveFileName),
              PDF_TIMEOUT_MS,
              '보관용 PDF 생성',
            );
          } catch (e) {
            console.warn('[자료실] 보관본 재캡처 실패 — 메일본으로 대체:', e);
          } finally {
            setPrintSupplierFilter(null);
            setPrintContactFilter(null);
            setPrintAccountMode(false);
            setPrintSiteNameMode(null);
          }
        }
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
        const msg = err.message || String(err);
        // 시간 초과는 「실패」가 아니다 — 서버가 이미 보냈을 수 있다.
        // 실패로 단정하면 다시 눌러 같은 발주서를 두 번 보내게 된다.
        if (/끝나지 않았습니다|시간이 초과|timeout/i.test(msg)) {
          toast(
            `"${supplierName}" 발송 결과를 확인하지 못했습니다. 보내진 편지함을 확인한 뒤 다시 보내세요.`,
            'error',
            0,
          );
        } else {
          toast('메일 발송 실패: ' + msg, 'error');
        }
      } finally {
        // 100% 잠깐 보여준 뒤 이 업체만 정리
        setTimeout(clearPct, 600);
      }
    };
    // 이전 발송 체인 뒤에 직렬 연결 (실패해도 다음 발송은 계속되도록 catch로 흡수)
    mailSendChainRef.current = mailSendChainRef.current.then(runSend, runSend);
  }

  async function handleUnmarkSupplierSent(supplierName, contact = null) {
    if (!(await confirm(`"${supplierName}" 업체의 발주 완료 표시를 취소하시겠습니까?`))) return;
    try {
      const sentKey = supplierKey(supplierName, contact);
      await unmarkSupplierSent(id, sentKey);
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
          .purchase-detail-top-actions .btn { font-size: 12px !important; padding: 0 6px !important; white-space: nowrap; flex-shrink: 0; }
          .bom-flat-table tbody tr { min-height: 36px !important; }
          .u-right-numeric input { min-width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        }
        @media (max-width: 360px) {
          .bom-flat-table th { padding: 4px 2px !important; font-size: 12px; min-width: 35px; }
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
            {/* 담은 타입마다 「T5391 5세트」처럼 따로 보여 준다.
                옛 발주서는 세트 내역 없이 숫자만 있으므로 그때는 「6세트」로 그대로 둔다. */}
            {setLotsLabel(form.setLots)
              ? (form.setLots || [])
                  .filter((l) => l && String(l.name ?? '').trim() && Number(l.count) > 0)
                  .map((l) => (
                    <button
                      key={l.name}
                      type="button"
                      className="purchase-badge po-set-badge"
                      onClick={isReadOnly ? undefined : openSetLots}
                      disabled={isReadOnly}
                      title={isReadOnly ? '' : '눌러서 세트 내역 고치기'}
                    >
                      {l.name} {Number(l.count)}세트
                    </button>
                  ))
              : Number(form.setCount) > 0 && (
                  <button
                    type="button"
                    className="purchase-badge po-set-badge"
                    onClick={isReadOnly ? undefined : openSetLots}
                    disabled={isReadOnly}
                    title={isReadOnly ? '' : '눌러서 타입별 세트 내역 적기'}
                  >
                    {form.setCount}세트
                  </button>
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
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => setPanelPickOpen(true)}
                title="이 발주가 어느 생산 호기 것인지 고르기"
              >
                생산 호기{' '}
                {(form.panels || []).length > 0 && (
                  <strong className={panelStatus.some((st) => !st.done) ? 'po-panel-short' : undefined}>
                    {(form.panels || []).length}
                  </strong>
                )}
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
        printContactFilter={printContactFilter}
        printAccountMode={printAccountMode}
        printSiteNameMode={printSiteNameMode}
        printStamp={printStamp}
        hideAmount={printHideAmount}
        showBox={printShowBox}
      />

      {/* 미리 만들기 전용 양식 — 화면 밖에 잠깐 띄웠다 내린다.
          화면 폼(printRef)을 뒤에서 바꿔 쓰면, 그 사이 사용자가 「PDF 출력」을 눌렀을 때
          엉뚱한 업체 상태로 찍힌다. 그래서 아예 따로 둔다. */}
      {preTarget && (
        <div className="no-print" style={{ position: 'fixed', left: -99999, top: 0, width: '210mm' }} aria-hidden>
          <PurchaseOrderPrintForm
            ref={preFormRef}
            purchase={purchase}
            form={form}
            suppliers={suppliers}
            sites={sites}
            itemMaster={itemMaster}
            printSupplierFilter={preTarget.supplierName}
            printContactFilter={preTarget.contact ?? null}
            printAccountMode={preTarget.kind === 'inner'}
            printSiteNameMode={preTarget.kind === 'inner' ? null : 'blank'}
            printStamp=""
            hideAmount={false}
            showBox={false}
          />
        </div>
      )}

      <div className="purchase-meta-bar screen-only">
        <div className="purchase-meta-items">
          <span title={purchase.siteName || ''}>
            <em>프로젝트</em>
            {purchase.siteName || '-'}
          </span>
          {/* 걸린 호기는 정보 줄에 글자로만 — 고르는 것은 우측 「생산 호기」 버튼 */}
          {(form.panels || []).length > 0 && (
            <span>
              <em>생산 호기</em>
              {(form.panels || []).map((p, i) => {
                const st = panelStatus[i];
                return (
                  <span key={p.id} className={st && !st.done ? 'po-panel-short' : undefined}>
                    {i > 0 && <span className="po-panel-sep">·</span>}
                    {p.호기 || p.프로젝트 || '호기'}
                  </span>
                );
              })}
            </span>
          )}
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
                      {[2, 5, 6, 12, 7, 17, 5, 3, 4, 7, 7, 6, 6, 6, 8].map((pct, i) => (
                        <col key={i} style={{ width: `${pct}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="bom-no-col">
                          No
                        </th>
                        <th scope="col">코드</th>
                        <th scope="col">BOX</th>
                        <th scope="col">품명</th>
                        <th scope="col">메이커</th>
                        <th scope="col">규격</th>
                        <th scope="col">분류</th>
                        <th scope="col">수량</th>
                        <th scope="col" className="no-print">
                          재고
                        </th>
                        <th scope="col">단가</th>
                        <th scope="col">합계</th>
                        <th scope="col">기본 구매처</th>
                        <th scope="col">비고</th>
                        <th scope="col" className="no-print">
                          입고
                        </th>
                        <th scope="col" className="bom-action-col no-print" aria-hidden="true"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {form.items.length === 0 && (
                        <tr>
                          <td colSpan={16} className="text-muted text-sm" style={{ textAlign: 'center', padding: 16 }}>
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
                        // 재고 칸은 「재고」 탭에 올린 품목에만 (2026-08-11 대표님).
                        // 재고를 세지 않는 품목까지 버튼이 뜨면 어느 줄이 관리 대상인지 알 수 없다.
                        // 이미 가져다 쓴 줄은 재고 항목을 나중에 지웠더라도 되돌릴 수 있게 남긴다.
                        const showStock =
                          isStockTracked(master) || Number(ln.stockUsed) > 0 || Number(ln.stockShort) > 0;
                        // 재고 기능을 넣기 전에 담은 줄엔 stockNeed 가 없다 — 그 줄은 발주 수량을 필요 수량으로 본다
                        const stockNeed = Number(ln.stockNeed) || Number(ln.qty) || 0;
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
                            <td data-label="수량">
                              {/* 재고를 쓰는 중이면 원래 필요했던 수량에 줄을 그어 보여준다.
                                  실제로 사는 수량은 옆 「재고」 칸의 「쓴 재고 / 필요」로 읽는다. */}
                              <input
                                className={`num-input bom-readonly-input${isReadOnly ? '' : ' purchase-qty-clickable'}${
                                  Number(ln.stockUsed) > 0 ? ' qty-struck' : ''
                                }`}
                                type="text"
                                value={
                                  Number(ln.stockUsed) > 0
                                    ? Number(ln.stockNeed || ln.qty).toLocaleString()
                                    : Number(ln.qty)
                                      ? Number(ln.qty).toLocaleString()
                                      : ''
                                }
                                readOnly
                                tabIndex={-1}
                                onClick={isReadOnly ? undefined : () => openQtyModal(idx)}
                                title={
                                  Number(ln.stockUsed) > 0
                                    ? `원래 ${Number(ln.stockNeed).toLocaleString()}개 필요 · 재고 ${ln.stockUsed}개를 써서 ${Number(ln.qty).toLocaleString()}개만 발주합니다`
                                    : isReadOnly
                                      ? ''
                                      : '클릭해 발주 수량 변경 (보유자재 있으면 감량)'
                                }
                              />
                            </td>
                            {/* 재고로 뺀 수량 — 수량 칸 아래에 두면 그 줄만 높아지므로 열을 따로 둔다 */}
                            <td data-label="재고" className="no-print">
                              {!showStock ? null /* 창고가 모자란 품목(재고 음수) — 눌러 그만큼 발주 수량에 얹는다.
                                  이미 메운 줄은 되돌릴 수 있도록 배지를 남긴다. */ : Math.max(
                                  0,
                                  -(Number(master?.stockQty) || 0),
                                ) > 0 || Number(ln.stockShort) > 0 ? (
                                <button
                                  type="button"
                                  className={`stock-used-badge is-short${Number(ln.stockShort) > 0 ? ' is-filled' : ''}`}
                                  disabled={!canUseStock}
                                  onClick={
                                    !canUseStock
                                      ? undefined
                                      : Number(ln.stockShort) > 0
                                        ? () => undoShortage(idx)
                                        : () => fillShortage(idx, Math.max(0, -(Number(master?.stockQty) || 0)))
                                  }
                                  title={
                                    !canUseStock
                                      ? '발주가 나간 뒤에는 재고를 건드릴 수 없습니다'
                                      : Number(ln.stockShort) > 0
                                        ? `모자란 ${ln.stockShort}개를 발주 수량에 더해 둔 상태 — 눌러서 도로 빼기`
                                        : `창고에 ${Math.max(0, -(Number(master?.stockQty) || 0))}개 모자랍니다 — 눌러서 발주 수량에 더하기`
                                  }
                                >
                                  {Number(ln.stockShort) > 0
                                    ? `+${Number(ln.stockShort).toLocaleString()}`
                                    : `−${Math.max(0, -(Number(master?.stockQty) || 0)).toLocaleString()}`}
                                </button>
                              ) : (
                                stockNeed > 0 && (
                                  <button
                                    type="button"
                                    className={`stock-used-badge${Number(ln.stockUsed) > 0 ? '' : ' is-off'}`}
                                    disabled={!canUseStock}
                                    onClick={!canUseStock ? undefined : () => toggleStockLine(idx)}
                                    title={
                                      !canUseStock
                                        ? `창고 재고 ${ln.stockUsed || 0}개를 빼고 발주한 수량입니다 (발주 뒤에는 잠김)`
                                        : Number(ln.stockUsed) > 0
                                          ? `창고 재고 ${ln.stockUsed}개를 쓰는 중 — 눌러서 ${stockNeed.toLocaleString()}개 전부 발주로 되돌리기`
                                          : '창고 재고를 쓰지 않고 전부 발주하는 중 — 눌러서 남은 재고만큼 빼기'
                                    }
                                  >
                                    <span className="stock-used-n">{Number(ln.stockUsed).toLocaleString()}</span>
                                    <span className="stock-need-sep">/</span>
                                    <span className="stock-need-n">{stockNeed.toLocaleString()}</span>
                                  </button>
                                )
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
        const liveList = supList.filter((s) => s.orderCount > 0); // 실제로 보낼 것이 있는 업체
        const sentCount = liveList.filter(
          (s) => purchase.supplierSent?.[supplierKey(s.name, s.contact ?? null)],
        ).length;
        return (
          <div className="form-group screen-only">
            <label>
              업체별 발주 현황
              <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                {liveList.length}개 업체 · {sentCount}개 발주완료
              </span>
            </label>
            <p className="field-hint">
              각 업체별로 「PDF 출력」하면 그 업체 품목만 발주서가 만들어집니다. 메일 발송 시 발주완료로 표시됩니다.
            </p>
            {!isReadOnly && (
              <div className="form-group" style={{ marginBottom: 12 }}>
                <label>발주서 메일 본문 (공통 문구 — 수정 가능)</label>
                <textarea
                  aria-label="발주서 메일 본문 (공통 문구 — 수정 가능)"
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
                    <th scope="col" style={{ minWidth: 140 }}>
                      구매처
                    </th>
                    <th scope="col" style={{ minWidth: 80, width: 100 }}>
                      품목
                    </th>
                    <th scope="col" style={{ minWidth: 170, width: 200 }}>
                      발행번호
                    </th>
                    <th scope="col" style={{ minWidth: 170, width: 170 }}>
                      발주 상태
                    </th>
                    <th scope="col" style={{ minWidth: 170, width: 170 }}>
                      회신
                    </th>
                    <th scope="col" style={{ minWidth: 140, width: 150 }}>
                      입고
                    </th>
                    <th scope="col" style={{ minWidth: 130, width: 150 }}>
                      결제 대상
                    </th>
                    <th scope="col" style={{ minWidth: 130, width: 150 }}>
                      미입고
                    </th>
                    <th scope="col" style={{ minWidth: 110, width: 130 }}>
                      납기
                    </th>
                    <th scope="col" style={{ minWidth: 200, width: '100%' }}>
                      특이사항
                    </th>
                    <th scope="col" className="col-action" aria-label="작업"></th>
                  </tr>
                </thead>
                <tbody>
                  {supList.map((sup, supIdx) => {
                    // 재고로 다 채워 보낼 것이 없는 업체는 줄을 내지 않는다.
                    // (목록에서 빼지 않고 건너뛰기만 한다 — supIdx 가 발행번호라 순번이 밀리면 안 된다)
                    if (!sup.orderCount) return null;
                    // 담당자가 갈린 업체는 담당까지 넣은 키로 — COSEL 에 보낸 것이 델타 줄에 뜨지 않게
                    const sentKey = supplierKey(sup.name, sup.contact ?? null);
                    const sendingPct = mailSending[sentKey]; // 발송 진행률 — 발송 쪽과 같은 키
                    // 결제는 업체 단위라, 담당이 갈려 두 줄인 업체는 첫 줄에만 결제 버튼을 둔다.
                    // (줄마다 버튼이 있으면 담당별로 따로 결제하는 것처럼 읽힌다)
                    const isFirstOfSupplier = supList.findIndex((x) => x.name === sup.name) === supIdx;
                    const sent = purchase.supplierSent?.[sentKey];
                    const replied = purchase.supplierReplied?.[sentKey];
                    // 담당자가 갈린 업체는 담당별 키로 찾는다 (computeSupplierReceiveStatus 와 같은 규칙)
                    const recv = recvStatus[sentKey] ||
                      recvStatus[sup.name] || {
                        total: 0,
                        full: 0,
                        latest: null,
                        recvAmount: 0,
                        pendingCount: 0,
                        pendingAmount: 0,
                      };
                    const recvDone = recv.total > 0 && recv.full === recv.total; // 전량 입고
                    // 결제는 업체 단위 — 담당이 갈린 업체는 두 줄이 같은 결제 상태를 본다
                    const closed = purchase.supplierClosed?.[payKey(sup.name)];
                    const payReq = purchase.paymentRequested?.[payKey(sup.name)];
                    const paidRaw = purchase.supplierPaid?.[payKey(sup.name)];
                    const paidRows = paidList(paidRaw);
                    // 나눠 들어오는 물량은 나눠 낸다 — 들어온 금액에서 이미 낸 금액을 뺀 몫이 남아 있으면
                    // 「2차 결제요청」으로 다시 열린다. 새로 들어온 것이 없으면 「결제완료」 그대로.
                    const unpaidLeft = unpaidAmount(recv.recvAmount, paidRaw);
                    const paid = paidRows.length > 0 && unpaidLeft <= 0;
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
                    const mailHead = `<p style="margin:0 0 4px;font-weight:700">발신 : (주)아이오피엔</p><p style="margin:0 0 14px;font-weight:700">수신 : ${sup.label || sup.name}</p><br><br><p>`;
                    const mailTail = `</p>${cardHtml}`;
                    const mailHtml = `${mailHead}${bodyHtml}${mailTail}`;
                    return (
                      <tr key={sentKey}>
                        <td data-label="구매처" title={sup.label || sup.name}>
                          <strong>{sup.name}</strong>
                          {sup.contactName ? <em className="purchase-sup-contact">{sup.contactName}</em> : null}
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
                            value={form.supplierNotes?.[sentKey] || ''}
                            onChange={(e) => {
                              setForm((f) => ({
                                ...f,
                                supplierNotes: { ...f.supplierNotes, [sentKey]: e.target.value },
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
                              onClick={() => printForSupplier(sup.name, sup.contact ?? null)}
                              title={`${sup.label || sup.name} 품목만 발주서 PDF 출력`}
                            >
                              <Icon name="download" className="btn-ic" />
                              PDF 출력
                            </button>
                            <button
                              type="button"
                              className={`btn btn-sm btn-outline purchase-sup-mail${sup.email ? '' : ' is-no-email'}${sendingPct != null ? ' is-sending' : ''}`}
                              disabled={sendingPct != null}
                              onClick={() => {
                                if (!sup.email) {
                                  toast(
                                    `"${sup.name}"에 등록된 이메일이 없습니다.\n구매처 관리에서 이메일을 먼저 등록해주세요.`,
                                    'error',
                                  );
                                  return;
                                }
                                openMailPreview(
                                  sup.name,
                                  // 담당자 + 그 업체 참조(CC) — 구매처 등록의 「참조」 칸
                                  mailToLine(
                                    sup.email,
                                    suppliers.find((x) => x.name === sup.name),
                                  ),
                                  mailSubject,
                                  mailHtml,
                                  supPoNo,
                                  sup.contact ?? null,
                                  sup.contactName || '',
                                  bodyText, // 늘 쓰는 문구 — 모달에 채워 두고 이 건만 고쳐 보낸다
                                  mailHead,
                                  mailTail,
                                );
                              }}
                              title={sup.email ? '발주서 메일 발송' : '이메일 미등록 — 구매처 관리에서 등록하세요'}
                            >
                              {sendingPct != null ? `발송 중 ${sendingPct}%` : '메일 발송'}
                            </button>
                            {sent ? (
                              <button
                                type="button"
                                className="btn btn-sm po-act-btn--on purchase-sup-toggle"
                                onClick={() => handleUnmarkSupplierSent(sup.name, sup.contact ?? null)}
                              >
                                발주 취소
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline purchase-sup-toggle"
                                onClick={() => handleMarkSupplierSent(sup.name, sup.contact ?? null)}
                              >
                                발주 완료 표시
                              </button>
                            )}
                            {replied ? (
                              <button
                                type="button"
                                className="btn btn-sm po-act-btn--on purchase-sup-toggle"
                                onClick={() => handleUnmarkSupplierReplied(sup.name, sup.contact ?? null)}
                              >
                                회신 취소
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline purchase-sup-toggle"
                                onClick={() => handleMarkSupplierReplied(sup.name, sup.contact ?? null)}
                              >
                                회신 확인
                              </button>
                            )}
                            {isFirstOfSupplier &&
                              (closed ? (
                                <button
                                  type="button"
                                  className="btn btn-sm po-act-btn--on purchase-sup-toggle"
                                  onClick={() => handleCloseSupplier(sup.name, recv.latest, recv.recvAmount)}
                                  title={`${closed.monthKey} 마감 · ${(closed.amount || 0).toLocaleString()}원 — 눌러서 마감 내역 보기·고치기`}
                                >
                                  마감내역 확인
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline purchase-sup-toggle"
                                  onClick={() => handleCloseSupplier(sup.name, recv.latest, recv.recvAmount)}
                                  title="이 업체에서 이번 달 납품받은 금액을 마감합니다 — 마감 리스트에 올라갑니다"
                                >
                                  마감
                                </button>
                              ))}
                            {!isFirstOfSupplier ? (
                              <span
                                className="btn btn-sm purchase-sup-toggle is-static"
                                style={{ opacity: 0.5 }}
                                title={`결제는 "${sup.name}" 업체 단위로 위 줄에서 함께 처리됩니다`}
                              >
                                업체 합산
                              </span>
                            ) : paid ? (
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
                                title={
                                  paidRows.length > 0
                                    ? `이미 ${paidRows.length}회 결제했습니다. 새로 들어온 ${unpaidLeft.toLocaleString()}원을 요청합니다`
                                    : '결제를 요청하면 결제 페이지에 결제 대기로 올라갑니다'
                                }
                              >
                                {payButtonLabel(paidRaw)}
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
                        aria-label="입고일"
                        type="date"
                        value={bulkForm.date}
                        onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>검수 메모</label>
                      <textarea
                        aria-label="검수 메모"
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
                aria-label="입고 수량"
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
                aria-label="입고일"
                type="date"
                value={receiveForm.date}
                onChange={(e) => setReceiveForm({ ...receiveForm, date: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>검수 메모</label>
              <textarea
                aria-label="검수 메모"
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

      <Modal isOpen={!!setLotsDraft} onClose={() => setSetLotsDraft(null)} title="세트 내역">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          BOM에서 가져올 때는 저절로 쌓이지만, 예전에 만든 발주서는 타입 구분 없이 세트 수만 남아 있습니다. 타입명을
          적어 주세요.
        </p>
        <div className="po-setlot-list">
          {(setLotsDraft || []).map((l, i) => (
            <div key={i} className="po-setlot-row">
              <input
                type="text"
                value={l.name}
                placeholder="타입명 (예: T5391)"
                onChange={(e) =>
                  setSetLotsDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
              />
              <input
                type="number"
                min="0"
                value={l.count}
                aria-label="세트 수"
                onChange={(e) =>
                  setSetLotsDraft((d) => d.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))
                }
              />
              <span className="po-setlot-unit">세트</span>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => setSetLotsDraft((d) => d.filter((_, j) => j !== i))}
              >
                <Icon name="trash" className="btn-ic" />
                삭제
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setSetLotsDraft((d) => [...(d || []), { name: '', count: 1 }])}
        >
          <Icon name="plus" className="btn-ic" />
          타입 추가
        </button>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setSetLotsDraft(null)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={saveSetLots}>
            저장
          </button>
        </div>
      </Modal>

      <Modal isOpen={panelPickOpen} onClose={() => setPanelPickOpen(false)} title="생산 호기 걸기" size="lg">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          이 발주가 어느 호기 자재인지 고릅니다. 여러 대를 걸 수 있고, 자재가 모자라면{' '}
          <strong>생산이 뒤인 호기가 미입고</strong>로 남습니다.
        </p>
        <div className="stock-filters no-print">
          <Select
            value={panelPickProject}
            onChange={setPanelPickProject}
            options={[{ value: '', label: '전체 프로젝트' }, ...panelProjects.map((n) => ({ value: n, label: n }))]}
            className="stock-filter-select"
            ariaLabel="프로젝트 고르기"
          />
          <span className="stock-summary">
            걸린 호기 <strong>{(form.panels || []).length}</strong>대
          </span>
        </div>
        <div className="po-panel-list">
          {allPanels
            .filter((p) => !panelPickProject || (p.프로젝트 || '') === panelPickProject)
            .map((p) => {
              const on = (form.panels || []).some((x) => x.id === p.id);
              return (
                <label key={p.id} className={`po-panel-row${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => togglePanel(p)} />
                  <span className="po-panel-proj">{p.프로젝트 || '(프로젝트 없음)'}</span>
                  <span className="po-panel-no">{p.호기 || '(호기 없음)'}</span>
                  <span className="po-panel-due">{p.납기 ? `납기 ${p.납기}` : ''}</span>
                </label>
              );
            })}
          {allPanels.length === 0 && <p className="purchase-empty">생산현황에 등록된 판넬이 없습니다.</p>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => setPanelPickOpen(false)}>
            닫기
          </button>
        </div>
      </Modal>

      <Modal isOpen={bomModalOpen} onClose={() => setBomModalOpen(false)} title="BOM에서 품목 가져오기">
        <p className="field-hint">
          선택한 BOM(프로젝트)의 품목·수량·단가를 이 발주에 불러옵니다. 불러온 뒤 목록·수량·단가(금액)를 수정할 수 있고,
          저장해야 반영됩니다.
        </p>
        <div className="form-group">
          <label>세트 수량 (배수)</label>
          <input
            aria-label="세트 수량 (배수)"
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
            {bomProjects.map((bp) => {
              const vs = Array.isArray(bp.variants) ? bp.variants : [];
              // 타입이 있는 BOM은 어느 형번으로 발주할지 먼저 고른다
              if (vs.length > 0) {
                return (
                  <div key={bp.id} className="bom-import-group">
                    <div className="bom-import-name">{bp.name}</div>
                    <p className="field-hint">타입을 고르면 그 형번에 들어가는 자재만 담깁니다.</p>
                    <div className="bom-import-variants">
                      {vs.map((v) => (
                        <button
                          type="button"
                          key={v.key}
                          className="btn btn-sm btn-primary"
                          onClick={() => importBom(bp, v.key)}
                          disabled={bomImporting}
                        >
                          {v.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => importBom(bp, '')}
                        disabled={bomImporting}
                        title="타입을 가리지 않고 등록된 자재를 전부 가져옵니다"
                      >
                        전체
                      </button>
                    </div>
                  </div>
                );
              }
              return (
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
              );
            })}
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
            aria-label="파일명"
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
                aria-label="발주 수량"
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
                aria-label="받는 사람"
                type="text"
                value={mailPreview.to}
                onChange={(e) => setMailPreview((p) => ({ ...p, to: e.target.value }))}
                placeholder="담당자 주소 (여러 명은 쉼표로)"
              />
              <p className="field-hint">
                구매처에 「참조」를 적어 두면 담당자와 함께 자동으로 들어옵니다. 이 건만 빼거나 더하려면 여기서
                고치세요.
              </p>
            </div>
            <div className="form-group">
              <label>제목</label>
              <input
                aria-label="제목"
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
                onClick={() => {
                  if (mailPdf.url) window.open(mailPdf.url, '_blank', 'noopener');
                  else if (mailPdf.error)
                    buildMailPdf(mailPreview.supplierName, mailPreview.contact, mailPreview.fileName);
                }}
                disabled={mailAttachBusy}
                title={mailAttachBusy ? '첨부본을 만드는 중입니다' : '눌러서 실제 첨부될 발주서를 확인합니다'}
              >
                <Icon name={mailAttachBusy ? 'clock' : 'download'} className="btn-ic" />
                {mailAttachBusy ? '첨부본 준비 중…' : mailPdf.error ? '다시 만들기' : mailPreview.fileName}
              </button>
              <p className="field-hint">
                {mailPdf.error
                  ? `첨부본을 만들지 못했습니다 — ${mailPdf.error}`
                  : '여기서 여는 파일이 그대로 첨부됩니다. 모달을 여는 순간 만들어 두므로 발송도 바로 끝납니다.'}
              </p>
            </div>
            <div className="form-group">
              <label>추가 첨부파일 (선택)</label>
              <input
                aria-label="추가 첨부파일 (선택)"
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
              <label>본문 (이 건만 고쳐 보냅니다)</label>
              <textarea
                className="mail-body-edit"
                rows={8}
                value={mailPreview.bodyText || ''}
                onChange={(e) => setMailPreview((p) => ({ ...p, bodyText: e.target.value }))}
                aria-label="메일 본문"
              />
              <p className="field-hint">
                여기서 고친 글은 이번 발송에만 쓰입니다. 늘 쓰는 문구는 상단 「메일 본문」에서 바꾸세요.
              </p>
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
                  <th scope="col">품명</th>
                  <th scope="col">규격</th>
                  <th scope="col" style={{ width: 70 }}>
                    수량
                  </th>
                  <th scope="col" style={{ width: 90 }}>
                    단가
                  </th>
                  <th scope="col" style={{ width: 130 }}>
                    삭제일시
                  </th>
                  <th scope="col" className="col-action" style={{ width: 150 }}>
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
                aria-label="납기일"
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

      {/* 마감 — 그달 납품받은 금액을 확정해 마감 리스트로 올린다 */}
      <Modal isOpen={!!closeModal} onClose={() => setCloseModal(null)} title="마감 — 납품 내역 확정">
        {closeModal && (
          <>
            <p className="field-hint">
              <strong>{closeModal.supplierName}</strong> 업체에서 납품받은 내역을 마감합니다. 마감한 금액은 마감
              리스트에 확정으로 올라갑니다.
            </p>
            <div className="form-group">
              <label>마감 월</label>
              <input
                aria-label="마감 월"
                type="month"
                value={closeModal.monthKey || ''}
                onChange={(e) => setCloseModal((p) => ({ ...p, monthKey: e.target.value }))}
                autoFocus
              />
              <p className="field-hint">납품받은 달입니다. 늦게 처리하실 때는 지난달로 고치세요.</p>
            </div>
            <div className="form-group">
              <label>납품 금액</label>
              <input
                aria-label="납품 금액"
                inputMode="numeric"
                value={(Number(closeModal.amount) || 0).toLocaleString()}
                onChange={(e) =>
                  setCloseModal((p) => ({ ...p, amount: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 }))
                }
              />
              <p className="field-hint">입고된 만큼으로 채워 두었습니다. 다르면 고치세요.</p>
            </div>
            <div className="form-group">
              <label>결제 예정일</label>
              <input
                aria-label="결제 예정일"
                type="date"
                value={closeModal.payDue || ''}
                onChange={(e) => setCloseModal((p) => ({ ...p, payDue: e.target.value }))}
              />
              {closeModal.termLabel && (
                <p className="field-hint">
                  이 구매처의 결제 조건은 <strong>{closeModal.termLabel}</strong>입니다 — 그 조건으로 미리 채웠습니다.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setCloseModal(null)}>
                취소
              </button>
              {purchase.supplierClosed?.[payKey(closeModal.supplierName)] && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => {
                    setCloseModal(null);
                    handleCancelClose(closeModal.supplierName);
                  }}
                >
                  <Icon name="trash" className="btn-ic" />
                  마감 취소
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={confirmCloseSupplier}>
                마감
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
                aria-label="결제 마감일"
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
