import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
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
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveMany } from '../../domain/moveMany';
import { PAIR_OPTIONS, PAIR_DEFAULT } from '../../domain/bomPair';
import {
  getBomBySite,
  addBomItem,
  updateBomItem,
  deleteBomItem,
  restoreBomItem,
  getBomProjectById,
  getBomProjects,
  updateBomProject,
  saveBomItemsOrder,
  setBomPair,
  clearBomPair,
  trashBomItem,
  setBomVariants,
  removeBomVariant,
  isFreeIssue,
  snapshotBomRows,
  addBomHistory,
  bumpBomHistory,
  listBomHistory,
  pruneBomHistory,
} from '../../services/bomService';
import { subscribePurchaseItems, getSuppliers, updatePurchaseItem } from '../../services/purchaseService';
import Modal from '../../components/common/Modal';
import { diffBomRows, rowToCopy, mapVariantKeys } from '../../domain/bomDiff';
import Select from '../../components/common/Select';
import { COMPANIES } from '../../domain/production';
import Icon from '../../components/common/Icon';
import ViewSwitch from '../../components/common/ViewSwitch';
import Skeleton from '../../components/common/Skeleton';
import PdfFabGroup from '../../components/common/PdfFabGroup';
import { useDialog } from '../../components/common/useDialog';
import { MADE, MADE_TYPE, isMade, kindLabel, nextKind, inKindTab } from '../../domain/itemKind';
import { moveFreeToPaid, goneByItem } from '../../services/stockMoveService';
import { subscribePanels } from '../../services/productionService';
import { useUndo } from '../../contexts/useUndo';
import { useAuth } from '../../contexts/useAuth';
import { useEditLock } from '../../contexts/useEditLock';
import { getAllMaterials } from '../../services/panelMaterialsService';
import { specFontClass, effLen } from '../../utils/printText';
import { BOM_COLS_WITH_VARIANT, BOM_COLS_NO_VARIANT, bomColsTypeQty } from '../../domain/tableWidths';
import { BOX_OPTIONS, byBoxThenOrder } from '../../domain/boxes';
import { DIRS, dirsOf } from '../../domain/panelBom';
import { findMasterByToken, splitQty } from '../../domain/pasteMatch';

// 되돌리기가 맞추는 칸 — 수량·단가·비고·순서·품목·BOX·도급/사급·도번
const HIST_KEYS = [
  'qty',
  'unitPrice',
  'note',
  'order',
  'name',
  'spec',
  'unit',
  'itemId',
  'box',
  'supplyType',
  'drawingNo',
];

function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 드래그 가능한 품목 행 — 핸들을 No 칸 안에 넣어 표 모양(스페이서 0폭)은 원본 그대로 유지
// canDrag=false면 핸들 없이 번호만 렌더 (코드순·구매처별·검색 중엔 드래그 무의미)
function SortableBomRow({ id, canDrag, showCheck, no, checked, onCheck, children }) {
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
    <tr ref={setNodeRef} style={style} className={checked ? 'is-checked' : undefined}>
      {/* 맨 앞 칸은 표 바깥 여백이다 — 배경도 테두리도 없어 여기에 무언가를 두면
          네이비 머리가 왼쪽으로 삐져나온 것처럼 보인다. 그래서 드래그 핸들과 마찬가지로
          체크박스도 No 칸 안에 둔다 (2026-09-02 대표님 「파란줄 튀어나옴」). */}
      <td className="bom-spacer-col" aria-hidden="true"></td>
      <td className="col-no" data-label="No">
        {/* (2026-09-05 No 열 표준) */}
        <span className="bom-no-wrap">
          {/* 순서는 앱 공통: 손잡이 → 체크 → 번호 (생산현황과 같게, 2026-09-04 대표님 「통일」) */}
          {canDrag && (
            <button
              type="button"
              className="drag-handle-btn"
              aria-label="드래그하여 순서 변경"
              title="드래그하여 순서 변경"
              {...attributes}
              {...listeners}
            />
          )}
          {/* 잠금 중에는 아예 안 보인다 — 흐릿하게 남겨 두면 눌러도 되는 줄 안다 */}
          {showCheck && (
            <input
              type="checkbox"
              className="bom-del-check sel-check"
              checked={checked}
              onChange={() => onCheck(id)}
              aria-label="삭제할 줄 고르기"
            />
          )}
          {no}
        </span>
      </td>
      {children}
    </tr>
  );
}

// 글자가 길면 PDF 1줄에 맞게 글자 크기 자동 축소
// 한글·CJK는 라틴보다 폭이 넓으므로 가중치(1.8배)를 줘서 더 일찍·더 작게 축소
// BOX 가 안 적힌 줄을 고르는 값 — 빈 문자열은 「전체」와 구분되지 않는다
const NO_BOX = '(BOX 미지정)';

export default function BomDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { confirm, alert, toast } = useDialog();
  const { push: pushUndo } = useUndo();
  const { userProfile } = useAuth();
  // (2026-09-05 뒤로가기 표준)
  const back = () =>
    window.history.state?.idx > 0 ? navigate(-1) : navigate('/admin/purchase/bom', { replace: true });

  const [project, setProject] = useState(null);
  // 짝 BOM — 같은 판넬, 고객사만 다른 BOM 과 묶어 한쪽을 고치면 다른 쪽도 같이 (domain/bomPair.js)
  const [pairOpen, setPairOpen] = useState(false);
  const [pairDraft, setPairDraft] = useState({ projectId: '', sync: PAIR_DEFAULT });
  const [pairBusy, setPairBusy] = useState(false);
  const [splitOf, setSplitOf] = useState(null); // 줄 나누기 — { row, n, box }
  const [splitBusy, setSplitBusy] = useState(false);
  const [bomItems, setBomItems] = useState([]);
  const [itemMaster, setItemMaster] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('order'); // 'order'(추가/붙여넣기순) | 'code'(코드순)
  // 묶어 보기 — 'none' | 'supplier'(구매처별).
  // 도급·사급별 묶기는 줄마다 버튼이 돌아오며 걷었다 (2026-09-03 대표님 「이 버튼 삭제」).
  const [groupBy, setGroupBy] = useState('none');
  const groupBySupplier = groupBy !== 'none'; // 묶어 보는 중인가 (띠·소계·드래그 잠금 공용)
  // 도급 / 사급을 나눠 본다. 한 줄씩 눌러 구분을 바꾸는 대신, 골라서 한꺼번에 옮긴다
  // (2026-09-02 대표님 「도급 사급 구분 버튼으로 두지말고 도급 사급 페이지를 따로」).
  const [supplyTab, setSupplyTab] = useState('all'); // 'all' | 'paid'(도급) | 'free'(사급)
  // 사급 탭에서 담으면 사급으로 들어간다 — 「도급 사급 페이지를 따로」의 뜻이다
  // (2026-09-02 대표님 「사급에 따로 리스트를 추가 할거임」).
  const addAsFree = supplyTab === 'free';
  const [supplierFilter, setSupplierFilter] = useState(''); // 특정 구매처만 (이름)
  // BOX 로 거르기 — 한 판넬(P/W BOX·H/T BOX 상 …) 것만 뽑아 보고 그대로 출력한다
  // (2026-09-02 대표님 「박스 별 필터 걸수있게 하고 출력도 필터 상태의 박스만」)
  const [boxFilter, setBoxFilter] = useState('');
  // 지우려고 고른 줄 (2026-09-02 대표님 「전체삭제 버튼도 넣어줘 삭제할 목록 체크 되는 방식으로」)
  const [delPick, setDelPick] = useState(() => new Set());
  const [printStamp, setPrintStamp] = useState(''); // 출력물 하단 출력 시각
  // 값을 넣는 곳이 없어 종이에 시각이 비어 있었다 (2026-09-02 대표님 「출력물 시간 미표기」).
  // 화면에 들어올 때 한 번 찍고, 인쇄를 누르는 순간 다시 찍는다 — 종이에 남는 건 뽑은 시각이다.
  useEffect(() => {
    const stamp = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      setPrintStamp(
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
      );
    };
    stamp();
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);
  // 출력 옵션 — 발주서와 같은 문법 (2026-09-01 대표님 「BOM에서도 출력할때 박스,금액 옵션」).
  // BOX 는 값이 있는 BOM 에서만 뜻이 있어, 하나라도 적혀 있으면 기본으로 켠다.
  const [printShowBox, setPrintShowBox] = useState(false);
  const [printShowAmount, setPrintShowAmount] = useState(false);
  // 구매처는 기본으로 빼 둔다 — 「구매처별」로 묶어 출력하면 띠로 따로 나오고,
  // 열까지 있으면 같은 말이 두 번이다 (2026-09-01 대표님)
  const [printShowSupplier, setPrintShowSupplier] = useState(false);
  const [printShowDrawing, setPrintShowDrawing] = useState(false); // 도번 열

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [picked, setPicked] = useState(new Map()); // itemId -> 수량
  const [pickerTargetId, setPickerTargetId] = useState(null); // null=추가, BOM항목 id=그 행 품목 교체
  // 코드 붙여넣기 일괄 선택
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResult, setPasteResult] = useState(null); // { added, already:[], notFound:[] }
  // 프로젝트명 수정
  const [nameModalOpen, setNameModalOpen] = useState(false);
  // 발주서 입고가 어느 회사 통으로 갈지 — 프로젝트에 한 번만 정한다 (2026-09-15 설계 2단계)
  const [companyInput, setCompanyInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  // 타입(형번) — 같은 제품의 형번별 차이를 BOM 한 벌로 관리한다
  const [variantModalOpen, setVariantModalOpen] = useState(false);
  const [variantPick, setVariantPick] = useState(null); // 타입을 고르는 중인 BOM 품목
  // 도번을 치는 중인 줄 — { id, value }. 다 치고 칸을 벗어날 때 품목 마스터에 올린다.
  const [editingDrawing, setEditingDrawing] = useState(null);
  const [newVariant, setNewVariant] = useState('');

  // ---- Ctrl+Z 실행취소 ----
  const bomUndoStackRef = useRef([]); // bomItems 스냅샷 스택 (최대 30개)
  const handleBomUndoRef = useRef(null);
  const bomItemsRef = useRef(bomItems);
  useEffect(() => {
    bomItemsRef.current = bomItems;
  }, [bomItems]);

  // ── 잠금: 화면 오른쪽 아래 공용 자물쇠 하나를 쓴다. 기본은 잠금 — 실수로 고쳐지는 일이 잦았다
  // (2026-09-03 대표님 · 2026-09-11 대표님 「스크롤 해도 따라오는 버튼으로」) ──
  const unlocked = useEditLock({ onLock: () => setDelPick(new Set()) });
  const locked = !unlocked;
  const lockedRef = useRef(true);
  lockedRef.current = locked;
  // 잠금은 «칸 수정·품목 불러오기·변경·순서 이동·삭제» 전부를 막는다
  // (2026-09-04 대표님 「칸 수정도 잠그기로 했지 않나 — 실수로 눌러서 적히는 경우가 있어서」)
  const guard = () => {
    if (!lockedRef.current) return true;
    toast('오른쪽 아래 「잠금」을 푼 뒤에 고칠 수 있습니다', 'error');
    return false;
  };

  // ── 수정 이력: 수정 «직전» 스냅샷을 남긴다. 몇 분 안의 같은 종류 수정은 한 건으로 묶는다 ──
  const [historyOpen, setHistoryOpen] = useState(false);
  // ── 다른 BOM 과 맞대기 (2026-09-16 대표님 「도급사급 기준은 다르지만 나머지 리스트는 동일해야」) ──
  // 짝은 «품목 + BOX». 구분(도급·사급)은 회사마다 다른 것이 정상이라 차이로 보지 않는다.
  const [cmpOpen, setCmpOpen] = useState(false);
  const [cmpId, setCmpId] = useState(''); // 맞댈 BOM 프로젝트 id
  const [cmpRows, setCmpRows] = useState([]); // 그 BOM 의 줄
  const [cmpProject, setCmpProject] = useState(null);
  const [cmpBusy, setCmpBusy] = useState('');
  const [cmpDone, setCmpDone] = useState(() => new Set()); // 적용해 치운 줄 (창을 닫을 때까지)
  const [projects, setProjects] = useState([]);
  const [history, setHistory] = useState(null); // null = 아직 안 읽음
  const [historyBusy, setHistoryBusy] = useState('');
  const lastHistRef = useRef(null); // { id, label, startedAt, count }
  const HIST_MERGE_MS = 3 * 60 * 1000;
  // bump=false 는 「값이 바뀌기 직전」 신호(입력칸 onChange) — 스냅샷만 잡고 횟수는 안 센다.
  // 화면 상태가 먼저 바뀌고 나서 저장(flushItem)되므로, 저장 시점에 찍으면 이미 바뀐 값이 남는다.
  function recordHistory(label, { bump = true } = {}) {
    const by = userProfile?.name || '';
    const last = lastHistRef.current;
    if (last && last.label === label && Date.now() - last.startedAt < HIST_MERGE_MS) {
      if (!bump) return;
      last.count += 1;
      if (last.id) bumpBomHistory(last.id, last.count).catch(() => {});
      return;
    }
    const entry = { id: '', label, startedAt: Date.now(), count: 1 };
    lastHistRef.current = entry;
    addBomHistory(projectId, { label, by, snapshot: snapshotBomRows(bomItemsRef.current) })
      .then((id) => {
        entry.id = id;
        pruneBomHistory(projectId).catch(() => {});
      })
      .catch((e) => console.error('[BOM 이력] 저장 실패', e));
  }
  // 「프로버 (메티스)」 ↔ 「프로버 (디에이치)」 처럼 괄호 앞이 같은 BOM 을 짝으로 본다
  const guessTwin = (list, me) => {
    const head = (n) =>
      String(n || '')
        .split('(')[0]
        .trim();
    const h = head(me?.name);
    return h ? (list || []).find((p) => head(p.name) === h) : null;
  };

  // 맞댈 BOM 고르기 — 이 BOM 말고 나머지. 처음 열면 이름이 가장 비슷한 것을 고른다
  useEffect(() => {
    getBomProjects()
      .then((list) => setProjects(list.filter((p) => p.id !== projectId)))
      .catch(() => setProjects([]));
  }, [projectId]);

  const openCompare = async () => {
    setCmpOpen(true);
    setCmpDone(new Set());
    const pick = cmpId || project?.pair?.projectId || guessTwin(projects, project)?.id || projects[0]?.id || '';
    if (pick !== cmpId) setCmpId(pick);
    await loadCompare(pick);
  };

  async function loadCompare(id) {
    if (!id) {
      setCmpRows([]);
      setCmpProject(null);
      return;
    }
    setCmpBusy('load');
    try {
      const [rowsB, proj] = await Promise.all([getBomBySite(id), getBomProjectById(id)]);
      setCmpRows(rowsB || []);
      setCmpProject(proj || null);
    } catch {
      toast('맞댈 BOM 을 불러오지 못했습니다', 'error', 0);
      setCmpRows([]);
    } finally {
      setCmpBusy('');
    }
  }

  // 차이 한 줄 적용 — 「가져오기」는 내 BOM 에, 「보내기」는 상대 BOM 에 넣는다.
  // 수량이 다를 때는 어느 쪽 값으로 맞출지 고른다. 적용한 줄은 목록에서 사라진다.
  async function applyDiff(d, dir) {
    if (!guard()) return;
    setCmpBusy(d.key);
    try {
      const mineV = project?.variants || [];
      const theirV = cmpProject?.variants || [];
      if (d.kind === 'onlyTheirs' && dir === 'pull') {
        pushBomUndo('맞대기 가져오기');
        let n = Math.max(0, ...bomItems.map((r) => Number(r.order) || 0)) + 1;
        for (const src of d.theirRows)
          await addBomItem(
            projectId,
            rowToCopy(src, { toRows: bomItems, fromVariants: theirV, toVariants: mineV, order: n++ }),
            { sync: false },
          );
        setBomItems(await getBomBySite(projectId));
      } else if (d.kind === 'onlyMine' && dir === 'push') {
        let n = Math.max(0, ...cmpRows.map((r) => Number(r.order) || 0)) + 1;
        for (const src of d.mineRows)
          await addBomItem(
            cmpId,
            rowToCopy(src, { toRows: cmpRows, fromVariants: mineV, toVariants: theirV, order: n++ }),
            { sync: false },
          );
        await loadCompare(cmpId);
      } else if (d.kind === 'qty' && dir === 'pull') {
        pushBomUndo('맞대기 수량 맞춤');
        const to = d.theirQty;
        const first = d.mineRows[0];
        await updateBomItem(first.id, { qty: to - (d.mineQty - (Number(first.qty) || 0)) }, { sync: false });
        setBomItems(await getBomBySite(projectId));
      } else if (d.kind === 'variant') {
        // 타입만 다른 줄 — 받는 쪽 줄의 타입을 주는 쪽 라벨에 맞춘다
        const pull = dir === 'pull';
        if (pull) pushBomUndo('맞대기 타입 맞춤');
        const srcRows = pull ? d.theirRows : d.mineRows;
        const dstRows = pull ? d.mineRows : d.theirRows;
        const keys = mapVariantKeys(
          [...new Set(srcRows.flatMap((r) => (Array.isArray(r.variantKeys) ? r.variantKeys : [])))],
          pull ? theirV : mineV,
          pull ? mineV : theirV,
        );
        for (const r of dstRows) await updateBomItem(r.id, { variantKeys: keys }, { sync: false });
        if (pull) setBomItems(await getBomBySite(projectId));
        else await loadCompare(cmpId);
      } else if (d.kind === 'qty' && dir === 'push') {
        const to = d.mineQty;
        const first = d.theirRows[0];
        await updateBomItem(first.id, { qty: to - (d.theirQty - (Number(first.qty) || 0)) }, { sync: false });
        await loadCompare(cmpId);
      }
      setCmpDone((prev) => new Set(prev).add(d.key));
      toast('맞췄습니다', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || '적용하지 못했습니다', 'error', 0);
    } finally {
      setCmpBusy('');
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    try {
      setHistory(await listBomHistory(projectId));
    } catch {
      toast('이력을 불러오지 못했습니다', 'error');
      setHistory([]);
    }
  }

  function pushBomUndo(label = 'BOM 변경') {
    const clone = JSON.parse(JSON.stringify(bomItemsRef.current));
    bomUndoStackRef.current.push(clone);
    if (bomUndoStackRef.current.length > 30) bomUndoStackRef.current.shift();
    pushUndo('BOM 변경', () => handleBomUndoRef.current?.());
    recordHistory(label);
  }

  async function handleBomUndo() {
    const s = bomUndoStackRef.current;
    if (s.length === 0) return;
    const prev = s.pop();
    await applySnapshot(prev);
  }

  // 이력의 그 시점으로 되돌리기 — 되돌리기 자체도 이력에 남겨 다시 되돌릴 수 있다
  async function revertTo(entry) {
    if (!guard()) return;
    if (
      !(await confirm(`${entry.atLocal} (${entry.label}) 직전 상태로 BOM 을 되돌리시겠습니까?
지금 상태는 이력에 남아 다시 되돌릴 수 있습니다.`))
    )
      return;
    setHistoryBusy(entry.id);
    try {
      lastHistRef.current = null; // 되돌리기는 항상 새 이력으로
      await addBomHistory(projectId, {
        label: '되돌리기 전 상태',
        by: userProfile?.name || '',
        snapshot: snapshotBomRows(bomItemsRef.current),
      });
      await applySnapshot(entry.snapshot || []);
      toast(`${entry.atLocal} 시점으로 되돌렸습니다`, 'success');
      setHistory(await listBomHistory(projectId));
    } catch (e) {
      console.error(e);
      toast('되돌리기에 실패했습니다', 'error', 0);
    } finally {
      setHistoryBusy('');
    }
  }

  async function applySnapshot(prev) {
    const cur = bomItemsRef.current;
    const curMap = new Map(cur.map((b) => [b.id, b]));
    const prevMap = new Map(prev.map((b) => [b.id, b]));
    const toRestore = prev.filter((b) => !curMap.has(b.id));
    const toDelete = cur.filter((b) => !prevMap.has(b.id));
    const toUpdate = prev.filter((b) => {
      const c = curMap.get(b.id);
      if (!c) return false;
      const same = (k) => (b[k] ?? '') === (c[k] ?? '');
      return (
        !HIST_KEYS.every(same) ||
        JSON.stringify(b.variantKeys || []) !== JSON.stringify(c.variantKeys || []) ||
        JSON.stringify(b.dirs || []) !== JSON.stringify(c.dirs || []) ||
        JSON.stringify(b.qtyByVariant || {}) !== JSON.stringify(c.qtyByVariant || {})
      );
    });
    try {
      await Promise.all([
        ...toRestore.map((b) => restoreBomItem(b.id, projectId, b)),
        ...toDelete.map((b) => deleteBomItem(b.id)),
        ...toUpdate.map((b) =>
          updateBomItem(
            b.id,
            {
              ...Object.fromEntries(
                HIST_KEYS.map((k) => [k, b[k] ?? (k === 'qty' || k === 'unitPrice' || k === 'order' ? 0 : '')]),
              ),
              variantKeys: Array.isArray(b.variantKeys) ? b.variantKeys : [],
              dirs: Array.isArray(b.dirs) ? b.dirs : [],
              qtyByVariant: b.qtyByVariant && typeof b.qtyByVariant === 'object' ? b.qtyByVariant : {},
            },
            { sync: false },
          ),
        ),
      ]);
      setBomItems(prev);
    } catch {
      toast('실행 취소 중 오류가 발생했습니다', 'error');
    }
  }
  handleBomUndoRef.current = handleBomUndo;

  // Ctrl+Z는 전역 UndoContext가 처리 (saveBomSnapshot → pushUndo로 통합)

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const [p, sp] = await Promise.all([getBomProjectById(projectId), getSuppliers()]);
        if (!p) {
          alert('해당 프로젝트를 찾을 수 없습니다.');
          navigate('/admin/purchase/bom');
          return;
        }
        const items = await getBomBySite(projectId);
        setProject(p);
        setSuppliers(sp);
        setBomItems(items);
      } catch (err) {
        console.error(err);
        toast('불러오기 중 오류가 발생했습니다', 'error');
      } finally {
        setLoading(false);
      }
    })();
    const unsub = subscribePurchaseItems(setItemMaster);
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const masterMap = useMemo(() => {
    const m = {};
    itemMaster.forEach((it) => {
      m[it.id] = it;
    });
    return m;
  }, [itemMaster]);

  const supplierMap = useMemo(() => {
    const m = {};
    suppliers.forEach((s) => {
      m[s.id] = s.name;
    });
    return m;
  }, [suppliers]);

  // ※ 이 블록은 아래 목록 셈(displayItems·filtered)이 쓰므로 «그보다 위»에 있어야 한다.
  //    아래에 두었다가 「Cannot access before initialization」으로 BOM 화면이 죽었다 (2026-09-12).
  // (2026-09-12 대표님 「판금으로 명칭 하자 그러고 나 방식」)
  // 이 BOM 을 쓰는 호기들의 회사 — 재고는 회사별이라 어느 통에서 옮길지 이것으로 정한다
  const [panelsAll, setPanelsAll] = useState([]);
  useEffect(() => subscribePanels(setPanelsAll), []);
  const bomCompany = useMemo(() => {
    const set = new Set(panelsAll.filter((p) => p?.bomLink?.projectId === projectId && p.회사).map((p) => p.회사));
    return set.size === 1 ? [...set][0] : '';
  }, [panelsAll, projectId]);

  const isMadeRow = useCallback((it) => isMade(it), []);

  const displayItems = useMemo(
    () =>
      bomItems.map((b) => {
        const m = b.itemId ? masterMap[b.itemId] : null;
        return {
          ...b,
          code: m?.code || b.code || '',
          name: m?.name || b.name || '',
          spec: m?.spec || b.spec || '',
          unit: m?.unit || b.unit || '',
          maker: m?.maker || '',
          category: m?.category || '',
          // 도번은 품목에 적힌 것을 먼저 본다 — 품목에서 고치면 BOM 도 따라 바뀐다.
          // BOM 에서 따로 친 값이 있으면 그것을 쓴다(품목에 없는 일회성 도번) (2026-09-02 대표님)
          drawingNo: m?.drawingNo || b.drawingNo || '',
          supplier: m?.defaultSupplierId ? supplierMap[m.defaultSupplierId] || '' : '',
          // 단가는 마스터의 표준단가를 우선 표시 (마스터 변경 시 BOM도 자동 반영)
          unitPrice: m?.standardPrice ?? b.unitPrice ?? 0,
        };
      }),
    [bomItems, masterMap, supplierMap],
  );

  // 타입 목록과, 품목 한 줄이 어느 타입에 들어가는지 읽는 도우미
  const variants = useMemo(() => (Array.isArray(project?.variants) ? project.variants : []), [project]);
  // 「타입」 열은 옛 모양(타입 전용 줄)이 하나라도 남아 있을 때만 둔다. 타입별 수량으로 옮기고 나면
  // 수량 칸이 그 일을 대신하므로 열이 저절로 사라지고, 그 폭을 수량·규격이 받는다 (2026-09-21 대표님)
  const legacyVariantRows = useMemo(
    () => bomItems.some((b) => (Array.isArray(b.variantKeys) ? b.variantKeys.length : 0) > 0),
    [bomItems],
  );
  const typeQtyMode = variants.length > 0 && !legacyVariantRows;
  // 「T5391 / MT8311」은 칸에 안 들어간다 — 앞 토막만 적고 전체는 올려서 본다
  const shortV = (s) =>
    String(s || '')
      .split('/')[0]
      .trim();
  const vqOfRow = (it) => (it?.qtyByVariant && typeof it.qtyByVariant === 'object' ? it.qtyByVariant : {});
  function setVQty(it, key, raw) {
    const by = { ...vqOfRow(it) };
    const s = String(raw ?? '').trim();
    if (s === '') delete by[key];
    else by[key] = Math.max(0, Number(s) || 0);
    updateField(it.id, { qtyByVariant: by });
  }
  // 타입별 수량으로 줄을 합친 시각 — 그 «전»의 수정 이력은 되돌리면 합친 줄이 다시 쪼개져
  // 호기 체크 기록이 주인을 잃는다. 그래서 그 전 것은 보기만 한다 (2026-09-21 이전)
  const beforeMigration = (h) => {
    const at = project?.qtyMigratedAt;
    if (!at) return false;
    const ms = (v) => (v?.toDate ? v.toDate().getTime() : new Date(v).getTime() || 0);
    return ms(h?.at) < ms(at);
  };
  const variantKeysOf = (it) => (Array.isArray(it.variantKeys) ? it.variantKeys : []);
  // 아무 타입도 안 정했으면 공통 — 어느 형번으로 발주해도 함께 들어간다
  function variantLabelOf(it) {
    const ks = variantKeysOf(it);
    if (ks.length === 0) return '공통';
    const labels = ks.map((k) => variants.find((v) => v.key === k)?.label).filter(Boolean);
    return labels.length ? labels.join(', ') : '공통';
  }

  // 검색 + 구매처 필터 + 정렬
  const rows = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    const kw = search.trim().toLowerCase();
    let list = kw
      ? displayItems.filter((it) =>
          [it.code, it.drawingNo, it.name, it.spec, it.maker, it.category, it.note].some((v) =>
            (v || '').toLowerCase().includes(kw),
          ),
        )
      : displayItems;
    if (supplierFilter) {
      list = list.filter((it) => (it.supplier || '(구매처 미지정)') === supplierFilter);
    }
    if (boxFilter) {
      list = list.filter((it) => (it.box || '').trim() === (boxFilter === NO_BOX ? '' : boxFilter));
    }
    if (supplyTab !== 'all') list = list.filter((it) => inKindTab(it, supplyTab === MADE ? 'made' : supplyTab));
    const sorted = [...list];
    if (sortBy === 'code') {
      sorted.sort((a, b) => collator.compare(a.code || '', b.code || ''));
    } else {
      // BOX 순으로 먼저 모으고 그 안에서만 손 순서 — 새 줄·BOX 바뀐 줄이 저절로 제 묶음으로
      sorted.sort(byBoxThenOrder);
    }
    return sorted;
  }, [displayItems, search, sortBy, supplierFilter, boxFilter, supplyTab, isMadeRow]);

  // BOX 가 하나라도 적혀 있으면 옵션을 기본으로 켠다 — 값이 없는 BOM 에서 빈 열만 늘리지 않게
  const hasBox = useMemo(() => bomItems.some((b) => (b.box || '').trim()), [bomItems]);
  useEffect(() => {
    setPrintShowBox(hasBox);
  }, [hasBox]);

  const hasDrawing = useMemo(() => bomItems.some((b) => (b.drawingNo || '').trim()), [bomItems]);
  useEffect(() => {
    setPrintShowDrawing(hasDrawing);
  }, [hasDrawing]);

  // ---- 드래그 순서변경 (추가순·전체보기에서만 — 코드순/구매처별/검색/필터 중엔 순서가 화면과 달라 비활성) ----
  const canDragRows = sortBy === 'order' && !groupBySupplier && !supplierFilter && !boxFilter && !search.trim();
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  async function handleRowDragEnd(event) {
    const { active, over } = event;
    if (!canDragRows || !over || active.id === over.id) return;
    // 표가 BOX 순으로 모이므로 다른 BOX 로 끌어도 제자리로 돌아온다 — 미리 막고 알린다
    const boxOf = (id) => (rows.find((r) => r.id === id)?.box || '').trim();
    if (boxOf(active.id) !== boxOf(over.id)) {
      toast('같은 BOX 안에서만 옮길 수 있습니다 — BOX 를 바꾸려면 그 줄의 BOX 칸을 고치세요', 'error');
      return;
    }
    if (!guard()) return;
    const orderedIds = rows.map((it) => it.id);
    const oldIndex = orderedIds.indexOf(active.id);
    const newIndex = orderedIds.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    pushBomUndo('순서 이동'); // Ctrl+Z로 되돌리기 가능
    // 체크한 줄 중 하나를 끌면 체크한 줄 전부가 같이 간다 (2026-09-04 대표님)
    const newIds = moveMany(orderedIds, delPick, active.id, over.id);
    const orderById = new Map(newIds.map((id, idx) => [id, idx]));
    // 낙관적 로컬 반영 → 실패 시 토스트 (기존 발주서는 복사본이라 영향 없음)
    setBomItems((prev) => prev.map((b) => ({ ...b, order: orderById.has(b.id) ? orderById.get(b.id) : b.order })));
    try {
      await saveBomItemsOrder(newIds);
    } catch {
      toast('순서 저장 중 오류가 발생했습니다', 'error');
    }
  }

  // 화면에 보이는 구매처 목록 (필터 드롭다운용)
  // 인쇄물 제목 — 무엇을 걸러 뽑았는지 종이에 그대로 남는다
  // (2026-09-02 대표님 「필터 걸어서 뽑을때 제목 옆에 박스명 적어줘」)
  const printTitle = [
    'BOM 리스트',
    supplyTab === 'free' ? '(사급)' : supplyTab === 'paid' ? '(도급)' : supplyTab === MADE ? `(${MADE})` : '',
    boxFilter ? `— ${boxFilter}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const boxOptions = useMemo(() => {
    const set = new Set(displayItems.map((it) => (it.box || '').trim() || NO_BOX));
    return [...set].sort((a, b) => (a === NO_BOX ? 1 : b === NO_BOX ? -1 : a.localeCompare(b)));
  }, [displayItems]);

  const supplierOptions = useMemo(() => {
    const set = new Set(displayItems.map((it) => it.supplier || '(구매처 미지정)'));
    return [...set].sort();
  }, [displayItems]);

  // 묶음 [{ name, items, subtotal }] — 기준은 groupBy 가 정한다
  const groupNameOf = (it) => it.supplier || '(구매처 미지정)';
  const supplierGroups = useMemo(() => {
    const map = new Map();
    for (const it of rows) {
      const key = it.supplier || '(구매처 미지정)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return (
      [...map.entries()]
        // 도급을 먼저 — 우리가 사는 것이 본줄기다
        .sort((a, b) => (groupBy === 'supply' ? (a[0] === '도급' ? -1 : 1) : a[0].localeCompare(b[0])))
        .map(([name, items]) => ({
          name,
          items,
          // 사급은 고객사 제공 자재라 우리 돈이 안 나간다 — 합계에서 뺀다 (2026-09-02 대표님)
          subtotal: items.reduce(
            (s, it) => s + (isFreeIssue(it) ? 0 : (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
            0,
          ),
        }))
    );
  }, [rows, groupBy]);

  const total = useMemo(
    () =>
      displayItems.reduce(
        (s, it) => s + (isFreeIssue(it) ? 0 : (Number(it.qty) || 0) * (Number(it.unitPrice) || 0)),
        0,
      ),
    [displayItems],
  );

  // 수량은 사급도 센다 — 실제로 쓰는 자재라 「몇 개 필요한가」는 그대로 유효하다.
  // 다만 갈라 보여 준다 (2026-09-02 대표님 「놓고 따로 센다」).
  // 판금은 도급·사급과 나란한 네 번째 구분 — 품목 대분류에 적어 둔 것을 따른다
  const madeCount = useMemo(() => displayItems.filter(isMadeRow).length, [displayItems, isMadeRow]);
  // 사급 → 도급으로 바꿀 때는 재고도 함께 옮길지 묻는다. BOM 만 바꾸면 사급 통에 남은 양이
  // 갈 곳을 잃고, 도급 쪽은 들어옴이 0 이라 남음이 음수가 된다
  // (2026-09-12 대표님 「bom에서 버튼눌러서 그냥 옮기면안됨?」).
  // 정·역 — 줄마다 어느 방향 호기에 쓰는지. 둘 다 켜짐이 공통(기본)이고, 하나만 켜면 반대쪽
  // 호기 화면에 회색으로 보이며 셈에서 빠진다 (2026-09-21 대표님 「정역 공통 정,역 개별로 체크」).
  // 둘 다 끄면 아무 호기에도 안 쓰이는 줄이 되어 뜻이 없으므로 공통으로 되돌린다.
  function toggleDir(it, d) {
    const cur = dirsOf(it);
    const on = { 정: cur.length === 0 || cur.includes('정'), 역: cur.length === 0 || cur.includes('역') };
    on[d] = !on[d];
    const list = DIRS.filter((x) => on[x]);
    const next = { dirs: list.length === 1 ? list : [], skipForward: false };
    updateField(it.id, next);
    flushItem(it.id, next);
  }

  // 줄 나누기 — 「LOCAL 3개 중 1개를 MP 로」. 수량을 덜어 다른 BOX 로 옮긴다. 그 BOX 에 같은
  // 품목·타입·방향 줄이 이미 있으면 새로 만들지 않고 수량만 더한다
  // (2026-09-21 대표님 「local -> mp로 nx-ecc201 1개만 이동 같은 경우」).
  async function doSplit() {
    const row = splitOf?.row;
    if (!row) return;
    const have = Number(row.qty) || 0;
    const n = Math.max(1, Math.min(Number(splitOf.n) || 0, have));
    const to = String(splitOf.box || '').trim();
    if (!to || to === String(row.box || '').trim()) {
      toast('옮길 BOX 를 고르세요', 'error');
      return;
    }
    if (!guard()) return;
    setSplitBusy(true);
    pushBomUndo('줄 나누기');
    try {
      const rest = have - n;
      if (rest <= 0) {
        // 전부 옮기면 BOX 만 바꾸는 것과 같다 — 호기 체크 기록도 함께 따라간다 (v158.2)
        await flushItem(row.id, { box: to });
        setBomItems((prev) => prev.map((b) => (b.id === row.id ? { ...b, box: to } : b)));
      } else {
        const sameKey = (b) =>
          b.id !== row.id &&
          String(b.box || '').trim() === to &&
          (b.itemId || '') === (row.itemId || '') &&
          JSON.stringify(b.variantKeys || []) === JSON.stringify(row.variantKeys || []) &&
          JSON.stringify(dirsOf(b)) === JSON.stringify(dirsOf(row));
        const twin = bomItems.find(sameKey);
        await flushItem(row.id, { qty: rest });
        setBomItems((prev) => prev.map((b) => (b.id === row.id ? { ...b, qty: rest } : b)));
        if (twin) {
          const sum = (Number(twin.qty) || 0) + n;
          await flushItem(twin.id, { qty: sum });
          setBomItems((prev) => prev.map((b) => (b.id === twin.id ? { ...b, qty: sum } : b)));
        } else {
          const order = Math.max(0, ...bomItems.map((b) => Number(b.order) || 0)) + 1;
          const data = {
            itemId: row.itemId || '',
            name: row.name || '',
            spec: row.spec || '',
            unit: row.unit || '',
            qty: n,
            unitPrice: Number(row.unitPrice) || 0,
            box: to,
            note: row.note || '',
            supplyType: row.supplyType || '',
            drawingNo: row.drawingNo || '',
            variantKeys: Array.isArray(row.variantKeys) ? row.variantKeys : [],
            dirs: dirsOf(row),
            order,
          };
          const ref = await addBomItem(projectId, data);
          setBomItems((prev) => [...prev, { ...data, id: ref.id, siteId: projectId }]);
        }
      }
      setSplitOf(null);
      toast(`${n}개를 「${to}」 로 옮겼습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('나누는 중 오류가 발생했습니다 — 화면을 새로 불러와 확인해 주세요', 'error', 0);
    } finally {
      setSplitBusy(false);
    }
  }

  async function toggleSupply(it) {
    const nextType = nextKind(it); // 도급 → 사급 → 판금 → 도급 (대표님 「누를 때마다 돌아가게」)
    const apply = () => {
      const next = { supplyType: nextType };
      updateField(it.id, next);
      flushItem(it.id, next); // 바뀔 값을 함께 넘긴다 — 상태 갱신을 기다리지 않게
    };
    // 사급이던 줄이 사급이 아니게 되는 순간 — 그 회사 사급 통에 남은 것이 갈 곳을 잃는다
    const leavingFree = isFreeIssue(it) && nextType !== 'free';
    if (!leavingFree || !bomCompany || !it.itemId) return apply();
    let gone = {};
    let left = 0;
    try {
      gone = await goneByItem(bomCompany, [it.itemId]);
      const { getFreeStockSplit } = await import('../../services/freeStockService');
      left = (await getFreeStockSplit(bomCompany, it.itemId)).qty;
    } catch {
      /* 못 읽으면 옮기기는 묻지 않고 구분만 바꾼다 */
      return apply();
    }
    const move = left + (Number(gone[it.itemId]) || 0);
    if (move <= 0) return apply(); // 옮길 것이 없다
    const ok = await confirm(
      `${it.name || it.code} 을 ${nextType === MADE_TYPE ? '판금' : '도급'}으로 바꿉니다.
` +
        `${bomCompany} 사급 재고에 남은 ${left}개와 지금까지 나간 ${Number(gone[it.itemId]) || 0}개를 ` +
        `도급 재고로 함께 옮길까요?

취소를 누르면 구분만 바꿉니다.`,
    );
    if (ok) {
      try {
        await moveFreeToPaid(bomCompany, [it], { by: userProfile?.name || '', gone });
        toast(`${it.name || it.code} ${move}개를 도급 재고로 옮겼습니다`, 'success', 0);
      } catch (err) {
        console.error(err);
        toast('재고를 옮기지 못했습니다 — 재고 화면에서 확인해 주세요', 'error', 0);
      }
    }
    apply();
  }

  const freeCount = useMemo(
    () => displayItems.filter((it) => !isMadeRow(it) && isFreeIssue(it)).length,
    [displayItems, isMadeRow],
  );
  const paidCount = displayItems.length - freeCount - madeCount;

  function updateField(id, patch) {
    if (!guard()) return;
    recordHistory('칸 수정', { bump: false }); // 바뀌기 «전» 상태를 이력에
    setBomItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // 저장할 값을 함께 받을 수 있게 한다.
  //
  // 입력칸은 onChange 로 고치고 onBlur 로 저장하니 그 사이에 상태가 이미 갱신돼 있다.
  // 그런데 버튼처럼 「누르는 즉시 저장」인 것은 setState 가 비동기라 flushItem 이
  // 바뀌기 전 값을 집는다 — 눌러도 저장이 안 되던 이유다 (2026-09-02 대표님).
  async function flushItem(id, patch = null) {
    const cur = bomItems.find((b) => b.id === id);
    if (!cur) return;
    const item = patch ? { ...cur, ...patch } : cur;
    recordHistory('칸 수정');
    try {
      const { id: _, createdAt: __, updatedAt: ___, ...data } = item;
      const res = await updateBomItem(id, data);
      if (res.moved > 0) toast(`${res.moved}개 호기의 체크 기록을 「${data.box}」 로 옮겼습니다`, 'success');
      if (res.pair === 'missing')
        toast('짝 BOM 에 같은 줄이 없어 거기엔 적용하지 못했습니다 — 「다름 찾기」로 맞춰 주세요', 'error');
      if (res.pair === 'error') toast('짝 BOM 에 적용하지 못했습니다 — 「다름 찾기」로 확인해 주세요', 'error', 0);
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  }

  // BOM 에서 친 도번을 품목 마스터에 올린다.
  //
  // 도면 번호는 품목마다 정해진 값이라 원본은 품목 마스터다. 그래서 한동안 BOM 에서는
  // 못 고치게 막아 두었는데, 정작 도번을 확인하는 자리가 BOM 이라 매번 품목 화면으로
  // 건너가야 했다. 이제 여기서 쳐도 마스터로 올라가고, 그러면 이 프로젝트뿐 아니라
  // 다른 BOM·발주서에도 함께 바뀐다 — 「BOM 마다 도번이 달라지는」 일은 그대로 막힌다
  // (2026-09-02 대표님 「BOM 에서 도번 적어도 품목이랑 연동 되게 BOM 입력 풀어줘」).
  async function saveDrawingNo(row, value) {
    const next = (value || '').trim();
    setEditingDrawing(null);
    if ((row.drawingNo || '') === next) return;
    if (!guard()) return;
    try {
      if (row.itemId) {
        await updatePurchaseItem(row.itemId, { drawingNo: next });
        // 마스터를 구독하고 있어 화면은 저절로 따라온다 (subscribePurchaseItems)
      } else {
        // 품목에 없는 줄(손으로 적어 넣은 것)은 이 BOM 에만 남긴다
        updateField(row.id, { drawingNo: next });
        await flushItem(row.id, { drawingNo: next });
      }
    } catch {
      toast('도번 저장 중 오류가 발생했습니다', 'error');
    }
  }

  function toggleDelPick(id) {
    setDelPick((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 고른 줄을 한꺼번에 휴지통으로. 영구 삭제가 아니라 되살릴 수 있다.
  async function removePicked() {
    if (!guard()) return;
    const ids = [...delPick].filter((id) => rows.some((r) => r.id === id));
    if (ids.length === 0) return;
    // 지우려는 줄이 이미 호기에 체크돼 있으면 먼저 알린다. 줄을 지워도 그 체크와, 그 줄로
    // 통에서 빼 간 자재는 남는데 주인이 없어져 어느 집계에도 안 잡히고 통으로도 안 돌아간다
    // (2026-09-18 대표님 「A B 전부 ㄱㄱ」).
    let warn = '';
    try {
      const mats = await getAllMaterials();
      const hits = [];
      for (const id of ids) {
        let qty = 0;
        const panels = new Set();
        for (const [pid, boxes] of Object.entries(mats)) {
          for (const items of Object.values(boxes)) {
            const n = Number(items?.[id]?.qty) || 0;
            if (n > 0) {
              qty += n;
              panels.add(pid);
            }
          }
        }
        if (qty > 0) hits.push({ id, qty, panels: panels.size });
      }
      if (hits.length > 0) {
        const total = hits.reduce((a, h) => a + h.qty, 0);
        const list = hits
          .slice(0, 5)
          .map((h) => {
            const d = displayItems.find((x) => x.id === h.id);
            return `· ${[d?.name, d?.spec].filter(Boolean).join(' ') || '(이름 없음)'} — ${h.panels}개 호기에 ${h.qty}개`;
          })
          .join('\n');
        const more = hits.length > 5 ? `\n… 그 밖 ${hits.length - 5}줄` : '';
        warn =
          `\n\n⚠ 이 중 ${hits.length}줄은 이미 호기에 체크돼 있습니다 (합 ${total}개):\n${list}${more}\n` +
          `지우면 그 체크와, 그 줄로 재고 통에서 빼 간 자재가 주인을 잃습니다 — 통으로 돌아가지 않습니다.\n` +
          `먼저 자재 체크 화면에서 「빼기 → 수량 줄어듦」으로 통에 돌려주는 편이 안전합니다.`;
      }
    } catch (err) {
      console.error('[BOM 삭제] 호기 체크 확인 실패', err);
      warn = '\n\n⚠ 호기에 체크된 몫을 확인하지 못했습니다 — 자재 체크 화면을 먼저 살펴 주세요.';
    }
    if (
      !(await confirm(`고른 ${ids.length}건을 BOM 에서 삭제하시겠습니까?
(휴지통에서 되살릴 수 있습니다)${warn}`))
    )
      return;
    pushBomUndo('선택 삭제');
    setDelPick(new Set());
    const targets = bomItems.filter((b) => ids.includes(b.id));
    setBomItems((prev) => prev.filter((b) => !ids.includes(b.id)));
    try {
      for (const b of targets) {
        const d = displayItems.find((x) => x.id === b.id);
        const title = [d?.name, d?.spec].filter(Boolean).join(' ') || '(이름 없음)';
        await trashBomItem(b.id, { title }, userProfile?.name || '');
      }
      toast(`${targets.length}건을 삭제했습니다`, 'success');
    } catch {
      toast('삭제 중 오류가 발생했습니다 — 화면을 새로 불러옵니다', 'error', 0);
      setBomItems(bomItems);
    }
  }

  function openPicker() {
    setPickerTargetId(null); // 추가 모드
    setPicked(new Map());
    setPickerSearch('');
    setPasteOpen(false);
    setPasteText('');
    setPasteResult(null);
    setPickerOpen(true);
  }
  // 특정 BOM 행의 품목을 다른 품목으로 교체하기 위해 picker 열기
  function openPickerReplace(id) {
    if (!guard()) return;
    setPickerTargetId(id);
    setPicked(new Map());
    setPickerSearch('');
    setPasteOpen(false);
    setPasteText('');
    setPasteResult(null);
    setPickerOpen(true);
  }
  // 선택한 마스터 품목으로 해당 행 교체 (수량·비고 유지, 단가는 표준단가로)
  async function replaceBomItemWithMaster(targetId, m) {
    if (!targetId || !m) return;
    pushBomUndo('품목 교체');
    const patch = {
      itemId: m.id,
      name: m.name || '',
      spec: m.spec || '',
      unit: m.unit || '',
      drawingNo: m.drawingNo || '', // 품목에 적힌 도번을 물려받는다 (2026-09-02 대표님)
      unitPrice: Number(m.standardPrice) || 0,
      code: m.code || '',
    };
    setBomItems((prev) => prev.map((b) => (b.id === targetId ? { ...b, ...patch } : b)));
    setPickerOpen(false);
    setPickerTargetId(null);
    try {
      await updateBomItem(targetId, patch);
    } catch {
      toast('변경 저장 중 오류가 발생했습니다', 'error');
    }
  }
  function closePicker() {
    setPickerOpen(false);
    setPickerTargetId(null);
  }

  // 붙여넣은 코드 목록을 "입력 순서 그대로" BOM에 바로 추가 (중복도 그대로 추가)
  async function applyPaste() {
    const lines = pasteText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const notFound = [];
    const matched = []; // { m, qty } — 입력 순서 유지, 중복 허용
    for (const line of lines) {
      // 「도번 <탭> 1EA」처럼 엑셀에서 그대로 긁어 온 줄을 가른다 (domain/pasteMatch)
      const { token, qty } = splitQty(line);
      if (!token) continue; // 모델명 없이 숫자만 있는 빈 줄은 건너뜀
      const m = findMasterByToken(itemMaster, token);
      if (!m) {
        notFound.push(line);
        continue;
      }
      matched.push({ m, qty: qty > 0 ? qty : 1 });
    }
    if (matched.length === 0) {
      setPasteResult({ added: 0, notFound });
      return;
    }
    pushBomUndo('붙여넣기 추가');
    let nextOrder = bomItems.length === 0 ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    for (const { m, qty } of matched) {
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        drawingNo: m.drawingNo || '', // 품목에 적힌 도번을 물려받는다 (2026-09-02 대표님)
        supplyType: supplyTab === MADE ? MADE_TYPE : addAsFree ? 'free' : '', // 담는 자리가 곧 구분 (2026-09-02·09-12 대표님)
        qty,
        unitPrice: Number(m.standardPrice) || 0,
        note: '',
        order: nextOrder++,
      };
      try {
        const ref = await addBomItem(projectId, data);
        added.push({ ...data, id: ref.id, siteId: projectId, code: m.code });
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPasteText('');
    setPasteResult({ added: added.length, notFound });
  }

  function togglePick(itemId) {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.set(itemId, 1); // 체크 시 기본 수량 1
      return next;
    });
  }

  // 선택한 품목의 수량 입력값 변경
  function setPickQty(itemId, value) {
    setPicked((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.set(itemId, value);
      return next;
    });
  }

  // 이미 BOM에 있는 품목도 목록에 남긴다 — 같은 자재를 BOX 별로 여러 줄 두는 일이 흔하다.
  // 대신 「이미 있음」 표시를 달아 실수로 또 담는 것과 구분한다.
  const inBomIds = useMemo(() => new Set(bomItems.map((b) => b.itemId).filter(Boolean)), [bomItems]);

  const filteredMaster = useMemo(() => {
    const kw = pickerSearch.trim().toLowerCase();
    // 대분류(베어 메인) 제외: 코드 형식 + 하위 품목의 groupKey가 가리키는 id 양쪽으로
    const mainIds = new Set(itemMaster.map((m) => m.groupKey).filter(Boolean));
    let list = itemMaster.filter((m) => !/^IOPN-\d+$/.test(m.code || '') && !mainIds.has(m.id));
    if (kw) {
      list = list.filter((m) =>
        [m.code, m.drawingNo, m.name, m.spec, m.category].some((v) => (v || '').toLowerCase().includes(kw)),
      );
    }
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return list.sort((a, b) => collator.compare(a.code || '', b.code || ''));
  }, [itemMaster, pickerSearch]);

  async function addPickedToBom() {
    if (picked.size === 0) {
      setPickerOpen(false);
      return;
    }
    pushBomUndo('품목 추가');
    let nextOrder = bomItems.length === 0 ? 1 : Math.max(...bomItems.map((b) => Number(b.order) || 0)) + 1;
    const added = [];
    for (const [itemId, qtyInput] of picked) {
      const m = masterMap[itemId];
      if (!m) continue;
      const data = {
        itemId: m.id,
        name: m.name || '',
        spec: m.spec || '',
        unit: m.unit || '',
        drawingNo: m.drawingNo || '', // 품목에 적힌 도번을 물려받는다 (2026-09-02 대표님)
        supplyType: supplyTab === MADE ? MADE_TYPE : addAsFree ? 'free' : '', // 담는 자리가 곧 구분 (2026-09-02·09-12 대표님)
        qty: Number(qtyInput) || 0,
        unitPrice: Number(m.standardPrice) || 0,
        note: '',
        order: nextOrder++,
      };
      try {
        const ref = await addBomItem(projectId, data);
        added.push({ ...data, id: ref.id, siteId: projectId, code: m.code });
      } catch (err) {
        console.error(err);
      }
    }
    setBomItems((prev) => [...prev, ...added]);
    setPicked(new Map());
    setPickerOpen(false);
  }

  // 모달에서 Enter → 추가 실행 (선택된 항목이 있을 때만)
  function handlePickerSubmit(e) {
    e.preventDefault();
    if (picked.size > 0) addPickedToBom();
  }

  // 프로젝트명 수정
  function openNameModal() {
    setNameInput(project?.name || '');
    setCompanyInput(project?.회사 || '');
    setNameModalOpen(true);
  }
  async function saveName() {
    const n = nameInput.trim();
    if (!n) return;
    try {
      await updateBomProject(projectId, { name: n, 회사: companyInput });
      setProject((p) => ({ ...p, name: n, 회사: companyInput }));
      setNameModalOpen(false);
    } catch {
      toast('프로젝트명 수정 중 오류가 발생했습니다', 'error');
    }
  }

  // ---- 타입(형번) ----
  // 타입을 만들어 두면 품목마다 「어느 형번에 들어가는지」를 정할 수 있고,
  // 발주서로 가져올 때 형번 하나를 고르면 그 형번 자재만 담긴다.
  async function addVariant() {
    if (!guard()) return;
    const label = newVariant.trim();
    if (!label) return;
    if (variants.some((v) => v.label === label)) {
      toast('같은 이름의 타입이 이미 있습니다', 'error');
      return;
    }
    // key 는 라벨을 바꿔도 품목 연결이 끊기지 않도록 따로 둔다
    const key = `v${Date.now().toString(36)}`;
    const next = [...variants, { key, label }];
    try {
      await setBomVariants(projectId, next);
      setProject((p) => ({ ...p, variants: next }));
      setNewVariant('');
    } catch {
      toast('타입 추가 중 오류가 발생했습니다', 'error');
    }
  }

  async function renameVariant(key, label) {
    if (!guard()) return;
    const next = variants.map((v) => (v.key === key ? { ...v, label } : v));
    setProject((p) => ({ ...p, variants: next }));
    try {
      await setBomVariants(projectId, next);
    } catch {
      toast('타입 이름 저장 중 오류가 발생했습니다', 'error');
    }
  }

  async function deleteVariant(v) {
    if (!guard()) return;
    const only = bomItems.filter((b) => {
      const ks = Array.isArray(b.variantKeys) ? b.variantKeys : [];
      return ks.length === 1 && ks[0] === v.key;
    });
    const ok = await confirm({
      title: '타입 삭제',
      message:
        only.length > 0
          ? `"${v.label}" 타입을 지웁니다.\n\n이 타입에만 들어있던 품목 ${only.length}개는 공통으로 바뀝니다(사라지지 않습니다).`
          : `"${v.label}" 타입을 지웁니다.`,
    });
    if (!ok) return;
    try {
      await removeBomVariant(projectId, v.key);
      setProject((p) => ({ ...p, variants: variants.filter((x) => x.key !== v.key) }));
      setBomItems((list) =>
        list.map((b) => {
          const ks = Array.isArray(b.variantKeys) ? b.variantKeys : [];
          return ks.includes(v.key) ? { ...b, variantKeys: ks.filter((k) => k !== v.key) } : b;
        }),
      );
    } catch {
      toast('타입 삭제 중 오류가 발생했습니다', 'error');
    }
  }

  // 드롭다운에서 타입 하나 고르기 — 빈값이면 공통
  async function setItemVariant(itemId, key) {
    if (!guard()) return;
    const next = key ? [key] : [];
    recordHistory('칸 수정', { bump: false });
    setBomItems((list) => list.map((b) => (b.id === itemId ? { ...b, variantKeys: next } : b)));
    try {
      await updateBomItem(itemId, { variantKeys: next });
      recordHistory('칸 수정');
    } catch {
      toast('타입 저장 중 오류가 발생했습니다', 'error');
    }
  }

  // 품목이 들어갈 타입 켜고 끄기 — 전부 끄면 공통(모든 타입에 포함)
  async function toggleItemVariant(itemId, key) {
    if (!guard()) return;
    const cur = bomItems.find((b) => b.id === itemId);
    if (!cur) return;
    const ks = Array.isArray(cur.variantKeys) ? cur.variantKeys : [];
    const next = ks.includes(key) ? ks.filter((k) => k !== key) : [...ks, key];
    setBomItems((list) => list.map((b) => (b.id === itemId ? { ...b, variantKeys: next } : b)));
    setVariantPick((p) => (p && p.id === itemId ? { ...p, variantKeys: next } : p));
    try {
      await updateBomItem(itemId, { variantKeys: next });
    } catch {
      toast('타입 저장 중 오류가 발생했습니다', 'error');
    }
  }

  if (loading || !project) return <Skeleton.Rows count={6} />;

  return (
    <div className={`bom-page printable-page${locked ? ' bom-locked editmode-off' : ''}`}>
      <style>{`
        .bom-readonly-input { word-break: break-word; overflow-wrap: break-word; white-space: normal; min-width: 0; }
        .bom-detail-table td, .bom-flat-table td { min-width: 0; }
        .bom-sort { display: flex; align-items: stretch; gap: 4px; }
        .bom-sort .btn { min-height: 36px; }
        .bom-flat-table tbody tr { min-height: 40px; vertical-align: middle; }
        .bom-flat-table th { padding: 6px !important; line-height: 1.4; }
        .bom-flat-table td { padding: 6px !important; line-height: 1.4; }
        .bom-supplier-header tr, .bom-supplier-header td { min-height: 40px; vertical-align: middle; }
        .bom-supplier-header-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; white-space: normal; }
        @media (max-width: 480px) {
          .bom-readonly-input { min-width: 60px; }
          .bom-filters { flex-direction: column !important; gap: 8px !important; }
          .bom-supplier-select { width: 100% !important; }
          .bom-sort { width: 100%; display: flex; gap: 4px; }
          .bom-flat-table { font-size: 12px; }
          .bom-flat-table th, .bom-flat-table td { padding: 6px 4px !important; }
          .bom-flat-table th { min-width: 60px; }
          .bom-supplier-header td, .bom-supplier-subtotal td { font-size: 12px; padding: 4px 8px !important; }
        }
        @media (max-width: 390px) {
          .bom-flat-table th { min-width: 40px; }
          .bom-flat-table .bom-action-col { display: table-cell !important; }
          .bom-flat-table .bom-action-col .bom-goto-item { width: 32px; height: 32px; padding: 0; }
        }
        .bom-action-col { white-space: nowrap; vertical-align: middle; }
        .bom-action-wrap { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
        .bom-action-wrap .bom-goto-item {
          flex: 0 0 auto; width: 28px; height: 28px; padding: 0; margin: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid var(--border); border-radius: 6px;
          background: var(--bg-card); cursor: pointer; color: var(--primary);
        }
        .bom-action-wrap .bom-goto-item svg { width: 16px; height: 16px; }
        .bom-goto-item:hover { background: var(--navy-soft, #e7eefb); border-color: var(--primary); }
        @media (max-width: 360px) {
          .bom-sort { flex-wrap: wrap; }
          .bom-sort .btn { padding: 0 8px; min-height: 32px; font-size: 12px; }
          .bom-supplier-select { max-width: 100%; }
        }
      `}</style>
      <div className="page-header screen-only">
        <div className="bom-title-wrap">
          {/* (2026-09-05 뒤로가기 표준) */}
          <button type="button" className="btn btn-sm btn-outline" onClick={back}>
            <Icon name="chevronLeft" className="btn-ic" />
            구매
          </button>
          <h2>
            {project.name}
            {project.회사 && <span className="pmat-title-sub"> · {project.회사}</span>}
          </h2>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={openNameModal}
            title="프로젝트 수정"
            aria-label="프로젝트 수정"
          >
            <Icon name="edit" className="btn-ic" />
            수정
          </button>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setVariantModalOpen(true)}
            title="형번마다 자재가 다를 때, BOM 한 벌로 관리하기"
          >
            타입 {variants.length > 0 && <strong>{variants.length}</strong>}
          </button>
          {/* 짝 BOM — 같은 판넬, 고객사만 다른 BOM 과 묶어 한쪽을 고치면 다른 쪽도 같이 바뀌게
              (2026-09-18 대표님 「두개 어느 범위까지 연동할지 선택목록을 두고 연동되게」) */}
          <button
            type="button"
            className={`btn btn-sm ${project?.pair?.projectId ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => {
              setPairDraft({
                projectId: project?.pair?.projectId || guessTwin(projects, project)?.id || '',
                sync: { ...PAIR_DEFAULT, ...(project?.pair?.sync || {}) },
              });
              setPairOpen(true);
            }}
            title="같은 판넬의 다른 고객사 BOM 과 묶어, 한쪽을 고치면 다른 쪽도 같이 바뀌게 합니다"
          >
            {project?.pair?.projectId
              ? `짝 · ${projects.find((p) => p.id === project.pair.projectId)?.name || 'BOM'}`
              : '짝 BOM'}
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => guard() && openPicker()}>
            <Icon name="plus" className="btn-ic" />
            품목 불러오기
          </button>
          <PdfFabGroup
            inline
            showLibrary={false}
            defaultFileName={() => `${project?.name || 'BOM'}_BOM`}
            onBeforeOutput={() => setPrintStamp(fmtDateTime(new Date()))}
            options={
              <>
                <div className="toggle-row" style={{ marginBottom: 10 }}>
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">금액 표기</span>
                    <small className="text-muted">단가·금액·합계를 함께 출력합니다. 끄면 수량·품목만 나갑니다</small>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={printShowAmount}
                      onChange={(e) => setPrintShowAmount(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-row" style={{ marginBottom: 10 }}>
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">도번 표시</span>
                    <small className="text-muted">도면 번호 열을 추가합니다</small>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={printShowDrawing}
                      onChange={(e) => setPrintShowDrawing(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-row" style={{ marginBottom: 10 }}>
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">구매처 표시</span>
                    <small className="text-muted">
                      구매처 열을 추가합니다. 「구매처별」로 묶어 출력하면 위에 띠로 나오므로 꺼 두는 편이 낫습니다
                    </small>
                  </div>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={printShowSupplier}
                      onChange={(e) => setPrintShowSupplier(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div className="toggle-row" style={{ marginBottom: 10 }}>
                  <div className="toggle-row-text">
                    <span className="toggle-row-title">BOX 표시</span>
                    <small className="text-muted">
                      품목표에 BOX 열을 추가합니다
                      {hasBox ? '' : ' (이 BOM 에는 BOX 가 적힌 품목이 없습니다)'}
                    </small>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={printShowBox} onChange={(e) => setPrintShowBox(e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              </>
            }
          />
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={openCompare}
            title="같아야 하는 다른 BOM 과 맞대어 빠진 줄·수량 차이를 찾습니다"
          >
            <Icon name="doc" className="btn-ic" />
            다름 찾기
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={openHistory}
            title="누가 언제 무엇을 고쳤는지 · 그 시점으로 되돌리기"
          >
            <Icon name="clock" className="btn-ic" />
            수정 이력
          </button>
        </div>
      </div>

      {/* 인쇄 전용 IOPN_v4 양식 (자재 명세서) */}
      {(() => {
        const today = new Date();
        const docNo = `BOM${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        // 페이지 직접 분할 — 페이지를 거의 채우고 하단엔 특이사항 크기(NOTES_ROWS)만큼만 공백을 남김.
        // 1페이지는 상단 정보표 높이(INFO_ROWS)만큼 행을 줄여 다른 페이지와 하단 공백을 동일하게 맞춤.
        const OTHER_PAGE_ROWS = 33; // 일반 페이지(페이지를 거의 채우는 행수)
        // 정보표(열두 칸짜리)를 걷어 첫 장에 남은 것은 제목 밴드뿐이다. 밴드를 납작하게
        // 줄여 다른 장과 같은 줄 수를 담는다 — 31 줄과 특이사항이 한 장에 들어간다
        // (2026-09-02 대표님 「31번 과 특이사항 까지 첫페이지에」).
        const INFO_ROWS = 0;
        const NOTES_ROWS = 2; // 섹션 마지막 페이지 특이사항이 차지하는 행수(= 모든 페이지 하단 공백 크기)
        const FIRST_PAGE_ROWS = OTHER_PAGE_ROWS - INFO_ROWS;
        const pageData = [];
        const pushPages = (list, secName) => {
          let i = 0;
          while (i < list.length) {
            const size = pageData.length === 0 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
            const chunk = list.slice(i, i + size);
            pageData.push({
              chunk,
              startNo: i,
              size,
              supplierName: secName,
              isSectionLast: i + size >= list.length,
            });
            i += size;
          }
        };
        // 구매처별이면 구매처 순서대로 정렬해 연속 출력 (페이지 분할 X)
        const printRows = groupBySupplier ? supplierGroups.flatMap((g) => g.items) : rows;
        // 도급과 사급은 성격이 다른 표다 — 「전체」로 뽑을 때도 장을 갈라 찍는다
        // (2026-09-02 대표님 「도급 사급 페이지를 따로」·「인쇄물 따로」).
        // 탭으로 한쪽만 보고 있으면 그것만 나온다.
        if (supplyTab === 'all') {
          const paid = printRows.filter((it) => !isFreeIssue(it));
          const free = printRows.filter(isFreeIssue);
          if (paid.length > 0 || free.length === 0) pushPages(paid, '도급');
          if (free.length > 0) pushPages(free, '사급');
        } else {
          pushPages(printRows, supplyTab === 'free' ? '사급' : '도급');
        }
        if (pageData.length === 0)
          pageData.push({ chunk: [], startNo: 0, size: FIRST_PAGE_ROWS, supplierName: null, isSectionLast: true });
        // 특이사항은 마지막 내용 페이지의 남는 공간에 그대로 출력. 물리적으로 꽉 찼을 때만 전용 페이지 추가.
        {
          const lastP = pageData[pageData.length - 1];
          const lastFill = (pageData.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS) + NOTES_ROWS;
          if (lastP && lastP.chunk.length + NOTES_ROWS > lastFill) {
            lastP.isSectionLast = false;
            pageData.push({
              chunk: [],
              startNo: printRows.length,
              size: OTHER_PAGE_ROWS,
              supplierName: null,
              isSectionLast: true,
            });
          }
        }
        const pageCount = pageData.length;
        return (
          <div className="print-form-iopn print-form-paged print-only">
            {pageData.map(({ chunk, startNo, size, supplierName, isSectionLast }, pageIdx) => {
              const isFirst = pageIdx === 0;
              // 사급 장에는 금액이 없다. 단가·금액 열을 그대로 두면 그 열에 값이 하나도
              // 없어 폭이 무너지고, 뒤따르는 수량·비고 글자가 칸에서 밀려난다
              // (2026-09-02 대표님 「사급 출력물 수량 글씨 틀어짐」).
              const freePage = chunk.length > 0 && chunk.every(isFreeIssue);
              const showAmount = printShowAmount && !freePage;
              const targetRows = size - (isSectionLast ? NOTES_ROWS : 0);
              const padded = [...chunk];
              while (padded.length < targetRows) padded.push(null);
              return (
                <div className="bom-print-page" key={pageIdx}>
                  {isFirst ? (
                    <>
                      <IopnDocBrand
                        title={printTitle}
                        // 걸러 뽑으면 제목에 범위가 붙어 길어진다 — 그만큼 줄여 로고를
                        // 침범하지 않게 (2026-09-02 대표님 「글 겹침」)
                        titleClass={`bom-list-title ${effLen(printTitle) > 32 ? 'is-longer' : effLen(printTitle) > 20 ? 'is-long' : ''}`}
                      />
                    </>
                  ) : null}

                  {/* 도급·사급은 제목이 말해 준다 — 띠는 구매처별로 묶어 뽑을 때만
                      남긴다 (2026-09-02 대표님 「이거 없애고」) */}
                  {supplierName && supplierName !== '도급' && supplierName !== '사급' && (
                    <div className="bom-print-supplier-band">구매처 : {supplierName}</div>
                  )}

                  <table
                    className={`iopn-items-table${showAmount ? '' : ' bom-no-price'}${printShowBox ? ' has-box' : ''}${printShowSupplier ? ' has-supplier' : ''}${printShowDrawing ? ' has-drawing' : ''}`}
                  >
                    <thead>
                      <tr>
                        <th scope="col" className="c-no">
                          NO
                        </th>
                        {printShowBox && (
                          <th scope="col" className="c-box">
                            BOX
                          </th>
                        )}
                        <th scope="col" className="c-name">
                          품목명
                        </th>
                        {printShowDrawing && (
                          <th scope="col" className="c-drawing">
                            도번
                          </th>
                        )}
                        <th scope="col" className="c-qty">
                          수량
                        </th>
                        <th scope="col" className="c-maker">
                          메이커
                        </th>
                        <th scope="col" className="c-spec">
                          규격
                        </th>
                        {showAmount && (
                          <>
                            <th scope="col" className="c-price">
                              단가
                            </th>
                            <th scope="col" className="c-amount">
                              금액
                            </th>
                          </>
                        )}
                        {/* 금액을 켜면 열이 열 개라 빡빡하다. 구매처는 「구매처별」로 묶어
                            출력하면 띠로 따로 나오므로 여기서 뺀다 (2026-09-01 대표님) */}
                        {printShowSupplier && (
                          <th scope="col" className="c-supplier">
                            구매처
                          </th>
                        )}
                        {/* 손으로 적는 칸 — 값은 비워 둔다. FROM·TO 로 반을 갈랐다가
                            다시 「비고」 한 칸으로 합쳤다 (2026-09-16 대표님 「프롬 투 나눈거
                            다시 그냥 비고로 합쳐줘」) */}
                        <th scope="col" className="c-note">
                          비고
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {padded.map((it, r) => {
                        if (!it)
                          return (
                            <tr key={`e-${r}`}>
                              <td className="c-no"></td>
                              {printShowBox && <td className="c-box"></td>}
                              <td className="c-name"></td>
                              {printShowDrawing && <td className="c-drawing"></td>}
                              <td className="c-qty"></td>
                              <td className="c-maker"></td>
                              <td className="c-spec"></td>
                              {showAmount && (
                                <>
                                  <td className="c-price"></td>
                                  <td className="c-amount"></td>
                                </>
                              )}
                              {printShowSupplier && <td className="c-supplier"></td>}
                              <td className="c-note"></td>
                            </tr>
                          );
                        return (
                          <tr key={r}>
                            <td className="c-no">{startNo + r + 1}</td>
                            {printShowBox && <td className={`c-box ${specFontClass(it.box, 10)}`}>{it.box || ''}</td>}
                            <td className={`c-name ${specFontClass(it.name, 11)}`}>{it.name || ''}</td>
                            {printShowDrawing && (
                              <td className={`c-drawing ${specFontClass(it.drawingNo, 10)}`}>{it.drawingNo || ''}</td>
                            )}
                            <td className="c-qty">{Number(it.qty) ? Number(it.qty).toLocaleString() : ''}</td>
                            <td className={`c-maker ${specFontClass(it.maker, 8)}`}>{it.maker || ''}</td>
                            <td className={`c-spec ${specFontClass(it.spec, 26)}`}>{it.spec || ''}</td>
                            {showAmount &&
                              (isFreeIssue(it) ? (
                                /* 사급은 고객사가 대준다 — 숫자 대신 이유를 적는다 (2026-09-02 대표님) */
                                <td className="c-amount c-free" colSpan={2}>
                                  사급
                                </td>
                              ) : (
                                <>
                                  <td className="c-price">
                                    {Number(it.unitPrice) ? Number(it.unitPrice).toLocaleString() : ''}
                                  </td>
                                  <td className="c-amount">
                                    {Number(it.qty) && Number(it.unitPrice)
                                      ? (Number(it.qty) * Number(it.unitPrice)).toLocaleString()
                                      : ''}
                                  </td>
                                </>
                              ))}
                            {printShowSupplier && (
                              <td className={`c-supplier ${specFontClass(it.supplier, 18)}`}>{it.supplier || ''}</td>
                            )}
                            <td className="c-note"></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {isSectionLast && (
                    <table className="iopn-notes-table">
                      <tbody>
                        <tr>
                          <th scope="col" className="lbl">
                            특이사항
                          </th>
                          <td className="val"></td>
                        </tr>
                      </tbody>
                    </table>
                  )}

                  <div className="bom-print-footer">
                    <span>(주)아이오피엔 · BOM 리스트 · {docNo}</span>
                    <span>{printStamp ? `출력 ${printStamp}` : ''}</span>
                    <span>
                      페이지 {pageIdx + 1} / {pageCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* 도급 / 사급 — 무엇을 보고 무엇을 인쇄할지 가르는 자리 */}
      <div className="bom-supply-tabs no-print">
        <ViewSwitch
          options={[
            { value: 'all', label: '전체', count: displayItems.length },
            { value: 'paid', label: '도급', count: paidCount },
            { value: 'free', label: '사급', count: freeCount },
            { value: MADE, label: MADE, count: madeCount },
          ]}
          value={supplyTab}
          onChange={setSupplyTab}
          ariaLabel="도급 사급 구분"
        />
        <span className="bom-supply-tabs-hint">
          {/* 탭 이름이 이미 말해 준다. 사급만은 「왜 금액이 안 잡히지」에서 멈추지
              않게 한 줄 남긴다 (2026-09-03 대표님 「제거」) */}
          {supplyTab === 'free' ? '고객사 제공 자재 — 금액 합계와 발주서에서 빠집니다' : ''}
        </span>
      </div>

      {!locked && delPick.size > 0 && (
        <div className="bom-pick-bar no-print">
          <span className="bom-pick-count">
            <strong>{delPick.size}</strong>건 골랐습니다
          </span>
          <button type="button" className="btn btn-sm btn-danger" onClick={removePicked}>
            <Icon name="trash" className="btn-ic" />
            선택 삭제
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => setDelPick(new Set())}>
            선택 해제
          </button>
        </div>
      )}

      <div className="purchase-filters bom-filters no-print">
        <input
          type="text"
          className="purchase-filter-search"
          placeholder="코드 · 도번 · 품명 · 규격 · 메이커 · 분류 · 비고 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {/* 정렬 하나로 — 「구매처순」이 곧 구매처별 묶어 보기(띠·소계·출력 순서) (2026-09-05 대표님) */}
        <ViewSwitch
          className="bom-sort"
          options={[
            { value: 'order', label: '추가순' },
            { value: 'code', label: '코드순' },
            { value: 'supplier', label: '구매처순' },
          ]}
          value={groupBy === 'supplier' ? 'supplier' : sortBy}
          onChange={(v) => {
            if (v === 'supplier') return setGroupBy('supplier');
            setGroupBy('none');
            setSortBy(v);
          }}
          ariaLabel="정렬 방식"
        />
        {boxOptions.length > 1 && (
          <Select
            className="bom-supplier-select"
            value={boxFilter}
            onChange={(v) => setBoxFilter(v)}
            options={[{ value: '', label: 'BOX 전체' }, ...boxOptions.map((b) => ({ value: b, label: b }))]}
            placeholder="BOX 전체"
            ariaLabel="BOX 필터"
          />
        )}
        <Select
          className="bom-supplier-select"
          value={supplierFilter}
          onChange={(v) => setSupplierFilter(v)}
          options={[{ value: '', label: '구매처 전체' }, ...supplierOptions.map((s) => ({ value: s, label: s }))]}
          placeholder="전체"
          ariaLabel="구매처 필터"
        />
        <div className="bom-summary">
          <span>
            항목 <strong>{bomItems.length}</strong>건
          </span>
          <span>
            예상 합계 <strong>{total.toLocaleString()}원</strong>
          </span>
          {freeCount > 0 && (
            <span className="bom-free-note" title="사급은 고객사 제공 자재라 금액에 안 들어갑니다">
              사급 <strong>{freeCount}</strong>건 제외
            </span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="purchase-empty screen-only">
          {bomItems.length === 0
            ? '품목이 없습니다 — 우측 상단 "품목 불러오기"로 추가하세요.'
            : '검색 조건에 맞는 품목이 없습니다.'}
        </p>
      ) : (
        <div className="item-group is-expanded bom-flat-group screen-only">
          <div className="item-group-detail">
            <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
              <SortableContext items={rows.map((it) => it.id)} strategy={verticalListSortingStrategy}>
                <div className="table-scroll-x">
                  <table className="table inline-edit-table bom-flat-table">
                    {/* 칸 폭 배분(%) — 규격이 가장 넓다. 합이 100 인지는 테스트가 붙든다
                        (2026-09-02 대표님 「BOM 규격 칸 좀더 확장」). */}
                    <colgroup>
                      {(typeQtyMode
                        ? bomColsTypeQty(variants.length)
                        : variants.length > 0
                          ? BOM_COLS_WITH_VARIANT
                          : BOM_COLS_NO_VARIANT
                      ).map((pct, i) => (
                        <col key={i} style={{ width: `${pct}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col" className="bom-spacer-col" aria-hidden="true"></th>
                        <th scope="col" className="col-no">
                          <span className="bom-no-wrap">
                            {!locked && (
                              <input
                                type="checkbox"
                                className="bom-del-check"
                                checked={rows.length > 0 && rows.every((r) => delPick.has(r.id))}
                                onChange={(e) =>
                                  setDelPick(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                                }
                                aria-label="보이는 줄 모두 고르기"
                              />
                            )}
                            No
                          </span>
                        </th>
                        <th scope="col">코드</th>
                        <th scope="col">도번</th>
                        <th scope="col">BOX</th>
                        {variants.length > 0 && !typeQtyMode && <th scope="col">타입</th>}
                        <th scope="col">품명</th>
                        <th scope="col">메이커</th>
                        <th scope="col">규격</th>
                        <th scope="col">분류</th>
                        <th scope="col" style={{ minWidth: 66 }}>
                          구분
                        </th>
                        {typeQtyMode ? (
                          <th scope="col" className="bom-qty-th">
                            수량
                            <span className="bom-qty-th-sub">
                              <span title="타입을 안 정한 호기가 쓰는 수량">공통</span>
                              {variants.map((v) => (
                                <span key={v.key} title={v.label}>
                                  {shortV(v.label)}
                                </span>
                              ))}
                            </span>
                          </th>
                        ) : (
                          <th scope="col">수량</th>
                        )}
                        <th scope="col">단가</th>
                        <th scope="col">합계</th>
                        <th scope="col">구매처</th>
                        <th scope="col">비고</th>
                        <th scope="col" className="bom-action-col no-print" aria-hidden="true"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(groupBySupplier ? supplierGroups.flatMap((g) => g.items) : rows).map((it, idx, arr) => {
                        const amount = (Number(it.qty) || 0) * (Number(it.unitPrice) || 0);
                        const sup = groupNameOf(it);
                        const prevSup = idx > 0 ? groupNameOf(arr[idx - 1]) : null;
                        const nextSup = idx < arr.length - 1 ? groupNameOf(arr[idx + 1]) : null;
                        const isGroupStart = groupBySupplier && sup !== prevSup;
                        const isGroupEnd = groupBySupplier && sup !== nextSup;
                        const grp = isGroupEnd ? supplierGroups.find((g) => g.name === sup) : null;
                        // BOX 가 바뀌는 자리에 구분줄 — 코드순·구매처별·BOX 필터 중엔 뜻이 없어 안 건다
                        const boxName = (it.box || '').trim() || '(BOX 없음)';
                        const prevBoxName = idx > 0 ? (arr[idx - 1].box || '').trim() || '(BOX 없음)' : null;
                        const isBoxStart =
                          !groupBySupplier &&
                          sortBy !== 'code' &&
                          !boxFilter &&
                          boxOptions.length > 1 &&
                          boxName !== prevBoxName;
                        return (
                          <Fragment key={it.id}>
                            {isBoxStart && (
                              <tr className="bom-supplier-header bom-box-header">
                                <td className="bom-spacer-col" aria-hidden="true"></td>
                                <td colSpan={15} title={boxName}>
                                  <span className="bom-supplier-header-text" style={{ padding: '6px 8px' }}>
                                    {boxName}
                                  </span>
                                </td>
                              </tr>
                            )}
                            {isGroupStart && (
                              <tr className="bom-supplier-header">
                                <td className="bom-spacer-col" aria-hidden="true"></td>
                                <td colSpan={15} title={sup} style={{ minHeight: 40, verticalAlign: 'middle' }}>
                                  <span
                                    className="bom-supplier-header-text"
                                    title={sup}
                                    style={{
                                      padding: '6px 8px',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                      wordBreak: 'break-word',
                                      whiteSpace: 'normal',
                                      minWidth: 0,
                                      maxWidth: '100%',
                                    }}
                                  >
                                    <Icon name="folder" className="btn-ic" /> {sup}
                                  </span>
                                </td>
                              </tr>
                            )}
                            <SortableBomRow
                              id={it.id}
                              canDrag={canDragRows && !locked}
                              showCheck={!locked}
                              no={idx + 1}
                              checked={delPick.has(it.id)}
                              onCheck={toggleDelPick}
                            >
                              <td data-label="코드" title={it.code || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input bom-code-input"
                                  value={it.code || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              {/* 여기서 친 도번은 품목 마스터로 올라간다 — 다른 BOM·발주서도 따라 바뀐다 */}
                              <td data-label="도번" title={it.drawingNo || ''}>
                                <input
                                  type="text"
                                  value={editingDrawing?.id === it.id ? editingDrawing.value : it.drawingNo || ''}
                                  title={
                                    it.itemId
                                      ? `${it.drawingNo || '도번 없음'} — 여기서 고치면 품목에도 함께 반영됩니다`
                                      : `${it.drawingNo || '도번 없음'} — 품목에 없는 줄이라 이 BOM 에만 남습니다`
                                  }
                                  placeholder="-"
                                  aria-label="도번"
                                  onChange={(e) => setEditingDrawing({ id: it.id, value: e.target.value })}
                                  onBlur={(e) => saveDrawingNo(it, e.target.value)}
                                />
                              </td>
                              {/* BOX 는 목록에서 고른다 — 손으로 치면 띄어쓰기 하나로 생산현황과
                                  이어지지 않는다 (2026-09-03 대표님 「1대1 매칭을 완벽하게」).
                                  목록에 없는 옛 값이 들어 있으면 그 값도 보여 줘 잃지 않게 한다. */}
                              <td data-label="BOX" title={it.box || ''}>
                                <Select
                                  className="po-supplier-select"
                                  value={it.box || ''}
                                  onChange={(v) => {
                                    updateField(it.id, { box: v });
                                    flushItem(it.id, { box: v });
                                  }}
                                  options={[
                                    { value: '', label: '-' },
                                    ...BOX_OPTIONS.map((bx) => ({ value: bx, label: bx })),
                                    ...(it.box && !BOX_OPTIONS.includes(it.box)
                                      ? [{ value: it.box, label: `${it.box} (목록에 없음)` }]
                                      : []),
                                  ]}
                                  ariaLabel="BOX"
                                  native
                                />
                              </td>
                              {variants.length > 0 && !typeQtyMode && (
                                <td data-label="타입">
                                  {/* BOX 처럼 드롭다운으로 (2026-09-03 대표님). 여러 타입에 든 줄은 그 묶음이
                                      항목으로 보이고, 「여러 타입…」을 고르면 예전 창에서 낱개로 켜고 끈다 */}
                                  <Select
                                    value={
                                      variantKeysOf(it).length === 0
                                        ? ''
                                        : variantKeysOf(it).length === 1
                                          ? variantKeysOf(it)[0]
                                          : '__multi'
                                    }
                                    onChange={(v) => {
                                      if (v === '__pick') setVariantPick(it);
                                      else if (v !== '__multi') setItemVariant(it.id, v);
                                    }}
                                    options={[
                                      { value: '', label: '공통' },
                                      ...variants.map((v) => ({ value: v.key, label: v.label })),
                                      ...(variantKeysOf(it).length > 1
                                        ? [{ value: '__multi', label: variantLabelOf(it) }]
                                        : []),
                                      { value: '__pick', label: '여러 타입…' },
                                    ]}
                                    ariaLabel="타입"
                                    native
                                  />
                                </td>
                              )}
                              <td data-label="품명" title={it.name || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={it.name || ''}
                                  title={it.name || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="메이커" title={it.maker || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={it.maker || ''}
                                  title={it.maker || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="규격" title={it.spec || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={it.spec || ''}
                                  title={it.spec || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="분류" title={it.category || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={it.category || ''}
                                  title={it.category || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              {/* 줄마다 눌러서 도급↔사급을 바꾼다 — 대표님이 쓰시던 방식
                                  (2026-09-03 「이전 버튼으로 리스트마다 사급 도급 있던거」) */}
                              <td data-label="구분">
                                <button
                                  type="button"
                                  className={`bom-supply-btn${isFreeIssue(it) ? ' is-free' : ''}${isMade(it) ? ' is-made' : ''}`}
                                  onClick={() => toggleSupply(it)}
                                  title={
                                    isMade(it)
                                      ? '판금 — 도면대로 만들어 넣는 것. 눌러서 도급으로'
                                      : isFreeIssue(it)
                                        ? '사급 — 고객사 제공 자재. 금액 합계에서 빠집니다. 눌러서 판금으로'
                                        : '도급 — 우리가 사서 넣는 자재. 눌러서 사급으로'
                                  }
                                >
                                  {kindLabel(it)}
                                </button>
                                {/* 정·역 — 둘 다 켜짐이 공통(기본)이라 흐리게, 한쪽만 쓰는 줄만 진하게 보인다
                                  (2026-09-21 대표님 「정역 공통 정,역 개별로 체크」) */}
                                <span className="bom-dirs">
                                  {DIRS.map((d) => {
                                    const only = dirsOf(it);
                                    const on = only.length === 0 || only.includes(d);
                                    return (
                                      <button
                                        key={d}
                                        type="button"
                                        className={`bom-dir-btn${only.length === 1 && on ? ' on' : ''}${
                                          on ? '' : ' off'
                                        }`}
                                        onClick={() => toggleDir(it, d)}
                                        aria-pressed={on}
                                        aria-label={`${d}방향 호기에 쓰는 자재`}
                                        title={
                                          only.length === 0
                                            ? `공통 — 정·역 호기 모두에 씁니다. 눌러서 「${d}」 를 빼기`
                                            : on
                                              ? `${d}방향 호기에만 쓰는 자재 — 눌러서 공통으로`
                                              : `${d}방향 호기에는 안 쓰는 자재 — 눌러서 공통으로`
                                        }
                                      >
                                        {d}
                                      </button>
                                    );
                                  })}
                                </span>
                              </td>
                              <td data-label="수량">
                                {/* 타입별 수량 — 「공통」 한 칸과 타입마다 한 칸. 타입 칸을 비우면 공통 수량을
                                  쓰고(흐린 숫자로 보인다), 적으면 그 타입만 다른 값이 된다. 0 을 적으면
                                  그 타입에는 없는 자재 (2026-09-21 대표님 「리스트에 타입별 수량 바로 보이게」) */}
                                {typeQtyMode ? (
                                  <div className="bom-qty-split">
                                    <div className="bom-qv">
                                      <input
                                        className="num-input bom-qv-input"
                                        type="number"
                                        min="0"
                                        value={it.qty || ''}
                                        onChange={(e) => updateField(it.id, { qty: e.target.value })}
                                        onBlur={() => flushItem(it.id)}
                                        aria-label="공통 수량"
                                      />
                                    </div>
                                    {variants.map((v) => (
                                      <div className="bom-qv" key={v.key}>
                                        <input
                                          className={`num-input bom-qv-input${
                                            vqOfRow(it)[v.key] === undefined ? ' is-base' : ''
                                          }`}
                                          type="number"
                                          min="0"
                                          value={vqOfRow(it)[v.key] ?? ''}
                                          placeholder={String(Number(it.qty) || 0)}
                                          onChange={(e) => setVQty(it, v.key, e.target.value)}
                                          onBlur={() => flushItem(it.id)}
                                          aria-label={`${v.label} 수량`}
                                          title={`${v.label} — 비우면 공통 수량을 씁니다`}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <input
                                    className="num-input"
                                    type="number"
                                    min="0"
                                    value={it.qty || ''}
                                    onChange={(e) => updateField(it.id, { qty: e.target.value })}
                                    onBlur={() => flushItem(it.id)}
                                  />
                                )}
                                {/* 타입마다 개수가 다를 때 — 줄을 쪼개지 않고 이 줄에 예외로 적는다.
                                  적은 줄만 값이 보이고, 안 적은 줄은 작은 「타입별」 점만 (2026-09-21 대표님) */}
                              </td>
                              <td data-label="단가">
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={Number(it.unitPrice) ? Number(it.unitPrice).toLocaleString() : ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="합계" className="bom-cell-amount" title={amount.toLocaleString()}>
                                <input
                                  type="text"
                                  className="bom-readonly-input bom-amount-input"
                                  value={amount.toLocaleString()}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="구매처" title={it.supplier || ''}>
                                <input
                                  type="text"
                                  className="bom-readonly-input"
                                  value={it.supplier || ''}
                                  title={it.supplier || ''}
                                  readOnly
                                  tabIndex={-1}
                                />
                              </td>
                              <td data-label="비고" title={it.note || ''}>
                                <input
                                  type="text"
                                  value={it.note || ''}
                                  title={it.note || ''}
                                  placeholder="-"
                                  onChange={(e) => updateField(it.id, { note: e.target.value })}
                                  onBlur={() => flushItem(it.id)}
                                />
                              </td>
                              <td className="bom-action-col no-print">
                                <div className="bom-action-wrap">
                                  <button
                                    type="button"
                                    className="bom-goto-item"
                                    onClick={() =>
                                      navigate(`/admin/purchase/items?focus=${encodeURIComponent(it.code || '')}`)
                                    }
                                    aria-label="품목 등록 페이지로 이동"
                                    title="이 품목 등록(구매품목 관리) 페이지로 이동"
                                  >
                                    <Icon name="chevronRight" />
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    onClick={() => setSplitOf({ row: it, n: 1, box: '' })}
                                    aria-label="줄 나누기"
                                    title="이 줄의 수량 일부를 다른 BOX 로 옮깁니다"
                                  >
                                    나누기
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline"
                                    onClick={() => openPickerReplace(it.id)}
                                    aria-label="품목 변경"
                                    title="이 행의 품목을 다른 품목으로 변경"
                                  >
                                    <Icon name="edit" className="btn-ic" />
                                    변경
                                  </button>
                                  {/* 행별 삭제는 뺐다 — 「순서·삭제」 켜고 체크 → 선택 삭제 (2026-09-04 대표님) */}
                                </div>
                              </td>
                            </SortableBomRow>
                            {isGroupEnd && grp && (
                              <tr className="bom-supplier-subtotal">
                                <td className="bom-spacer-col" aria-hidden="true"></td>
                                <td
                                  colSpan={9}
                                  className="u-wrap"
                                  style={{ textAlign: 'right', overflowWrap: 'break-word', wordBreak: 'break-word' }}
                                  title={`${sup} 소계`}
                                >
                                  {sup} 소계
                                </td>
                                <td
                                  className="u-right-numeric"
                                  style={{ textAlign: 'right' }}
                                  title={`${grp.subtotal.toLocaleString()}원`}
                                >
                                  {grp.subtotal.toLocaleString()}원
                                </td>
                                <td colSpan={3}></td>
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
        </div>
      )}

      <Modal
        isOpen={pickerOpen}
        onClose={closePicker}
        title={pickerTargetId ? '품목 변경 (다른 품목으로 교체)' : '품목 선택'}
      >
        <form onSubmit={handlePickerSubmit}>
          <p className="field-hint">
            {pickerTargetId
              ? '교체할 품목을 클릭하면 해당 행이 그 품목으로 바뀝니다. (수량·비고 유지, 단가는 표준단가 적용)'
              : '구매 품목 관리에 등록된 품목 중에서 선택해 BOM에 추가합니다. 이미 담긴 품목도 다시 담을 수 있습니다(BOX가 다르면 따로 관리).'}
          </p>

          {/* 코드 여러 개 붙여넣기 → 자동 선택 */}
          <div className="bom-paste-box">
            <button type="button" className="bom-paste-toggle" onClick={() => setPasteOpen((v) => !v)}>
              <Icon name={pasteOpen ? 'chevronDown' : 'chevronRight'} className="btn-ic" />
              {pasteOpen ? '코드 붙여넣기 닫기' : '코드(+수량) 여러 개 붙여넣어 한 번에 추가'}
            </button>
            {pasteOpen && (
              <div className="bom-paste-panel">
                <textarea
                  className="bom-paste-textarea"
                  rows={5}
                  placeholder={
                    '코드를 한 줄에 하나씩. 코드 뒤에 수량을 적으면 함께 인식됩니다.\n(엑셀에서 모델명·수량 2개 열을 그대로 복사해 붙여넣어도 됩니다)\n예)\nNV50-SVFU-2P 2\nSCK12-2R 4\nDE-15F (2열,땜) 1'
                  }
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <div className="bom-paste-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={applyPaste}
                    disabled={!pasteText.trim()}
                  >
                    코드로 찾아 추가
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setPasteText('');
                      setPasteResult(null);
                    }}
                  >
                    지우기
                  </button>
                </div>
                {pasteResult && (
                  <div className="bom-paste-result">
                    <span className="ok">
                      <Icon name="check" className="btn-ic" /> {pasteResult.added}개 추가됨
                    </span>
                    {pasteResult.notFound.length > 0 && (
                      <div className="miss">
                        <Icon name="alert" className="btn-ic" /> 못 찾은 코드 {pasteResult.notFound.length}개:
                        <ul className="miss-list">
                          {pasteResult.notFound.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="form-group">
            <input
              type="text"
              className="purchase-filter-search"
              style={{ width: '100%' }}
              placeholder="코드 · 도번 · 품명 · 규격 · 분류 검색"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
            />
          </div>
          <div className="bom-picker-list">
            {filteredMaster.length === 0 ? (
              <p className="purchase-empty">
                {itemMaster.length === 0
                  ? '등록된 품목이 없습니다. "구매 품목 관리"에서 먼저 품목을 등록하세요.'
                  : pickerSearch
                    ? '검색 결과가 없습니다.'
                    : '추가 가능한 품목이 없습니다 (모두 BOM에 포함됨).'}
              </p>
            ) : (
              filteredMaster.map((m) => {
                const meta = (
                  <>
                    <span className="bom-picker-code">{m.code || '-'}</span>
                    <span className="bom-picker-name">
                      <strong>{m.name}</strong>
                      {m.spec && <span className="bom-picker-spec"> ({m.spec})</span>}
                      {inBomIds.has(m.id) && <span className="bom-picker-already">이미 있음</span>}
                    </span>
                    {m.standardPrice > 0 && (
                      <span className="bom-picker-price">{Number(m.standardPrice).toLocaleString()}원</span>
                    )}
                  </>
                );
                // 교체 모드 — 클릭 즉시 해당 행 품목 교체
                if (pickerTargetId) {
                  return (
                    <button
                      type="button"
                      key={m.id}
                      className="bom-picker-row bom-picker-row--btn"
                      onClick={() => replaceBomItemWithMaster(pickerTargetId, m)}
                    >
                      {meta}
                      <span className="bom-picker-pick">변경</span>
                    </button>
                  );
                }
                return (
                  <label key={m.id} className={`bom-picker-row ${picked.has(m.id) ? 'is-checked' : ''}`}>
                    <input type="checkbox" checked={picked.has(m.id)} onChange={() => togglePick(m.id)} />
                    {meta}
                    {picked.has(m.id) && (
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
                          value={picked.get(m.id)}
                          onChange={(e) => setPickQty(m.id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          autoFocus
                          aria-label={`${m.name} 수량`}
                        />
                        <span className="bom-picker-qty-unit">{m.unit || '개'}</span>
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={closePicker}>
              취소
            </button>
            {!pickerTargetId && (
              <button type="submit" className="btn btn-primary" disabled={picked.size === 0}>
                {picked.size}개 추가
              </button>
            )}
          </div>
        </form>
      </Modal>

      <Modal isOpen={nameModalOpen} onClose={() => setNameModalOpen(false)} title="프로젝트 수정">
        <div className="form-group">
          <label>프로젝트명</label>
          <input
            aria-label="프로젝트명"
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="프로젝트명 입력"
            autoFocus
            maxLength={60}
          />
        </div>
        <div className="form-group">
          <label>회사</label>
          <Select
            value={companyInput}
            onChange={setCompanyInput}
            options={COMPANIES.map((c) => ({ value: c, label: c }))}
            placeholder="회사 선택"
            ariaLabel="회사"
          />
          <p className="field-hint">이 BOM 에 걸린 발주서의 입고가 어느 회사 도급·판금 재고로 들어갈지 정합니다.</p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setNameModalOpen(false)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={!nameInput.trim()} onClick={saveName}>
            저장
          </button>
        </div>
      </Modal>

      {/* 타입 관리 — 형번마다 자재가 조금씩 다를 때 BOM을 한 벌로 유지한다 */}
      <Modal isOpen={historyOpen} onClose={() => setHistoryOpen(false)} title="수정 이력" size="lg">
        <p className="field-hint" style={{ marginTop: 0 }}>
          수정 «직전»의 BOM 전체가 시점마다 남습니다. 「되돌리기」를 누르면 그 시점의 목록으로 돌아가고, 지금 상태도
          이력에 남아 다시 되돌릴 수 있습니다. 몇 분 안에 이어진 같은 종류의 수정은 한 건으로 묶입니다. 최근 30건 보관.
        </p>
        {history === null ? (
          <p className="text-muted">불러오는 중…</p>
        ) : history.length === 0 ? (
          <p className="text-muted">아직 남은 이력이 없습니다 — 이제부터 고치는 내용이 여기 쌓입니다.</p>
        ) : (
          <div className="table-scroll-x">
            <table className="table bom-hist-table">
              <thead>
                <tr>
                  <th scope="col">시각</th>
                  <th scope="col">담당</th>
                  <th scope="col">내용</th>
                  <th scope="col" className="u-num">
                    당시 줄 수
                  </th>
                  <th scope="col" className="col-action">
                    작업
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="u-nowrap">
                      {h.atLocal}
                      {h.count > 1 && h.until && h.until !== h.atLocal ? (
                        <small className="text-muted"> ~ {h.until.slice(11)}</small>
                      ) : null}
                    </td>
                    <td>{h.by || '—'}</td>
                    <td>
                      {h.label}
                      {h.count > 1 && <span className="status-badge status-badge--wait bom-hist-n">{h.count}회</span>}
                    </td>
                    <td className="u-num">{h.rows ?? (h.snapshot || []).length}</td>
                    <td className="col-action">
                      {/* 타입별 수량으로 줄을 합친 «전»의 스냅샷은 되돌릴 수 없다 — 되돌리면 합쳐진 줄이
                        다시 쪼개지고 호기 체크 기록이 주인을 잃는다 (2026-09-21 이전) */}
                      {beforeMigration(h) ? (
                        <span className="text-muted" style={{ fontSize: 12 }}>
                          타입별 수량 이전 전 — 되돌릴 수 없음
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          disabled={historyBusy === h.id}
                          onClick={() => revertTo(h)}
                          title="이 수정 직전 상태로"
                        >
                          <Icon name="restore" className="btn-ic" />
                          되돌리기
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* 다른 BOM 과 맞대기 — 빠진 줄·수량 차이만. 구분(도급·사급)은 회사마다 다른 것이 정상이라
          차이로 보지 않는다 (2026-09-16 대표님) */}
      <Modal isOpen={cmpOpen} onClose={() => setCmpOpen(false)} title="다름 찾기" size="xl">
        <div className="form-group">
          <label>어느 BOM 과 맞댈까요</label>
          <select
            className="form-control"
            value={cmpId}
            onChange={(e) => {
              setCmpId(e.target.value);
              setCmpDone(new Set());
              loadCompare(e.target.value);
            }}
          >
            <option value="">— 고르세요 —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="field-hint">
            짝은 «품목 + BOX» 로 맞춥니다. 도급·사급 구분은 회사마다 다른 것이 정상이라 차이로 보지 않습니다. 가져온
            줄의 구분은 이 BOM 에 같은 품목이 있으면 그 구분을, 없으면 도급으로 들어갑니다.
          </p>
        </div>
        {cmpBusy === 'load' ? (
          <p className="text-muted">맞대는 중…</p>
        ) : !cmpId ? (
          <p className="text-muted">맞댈 BOM 을 골라 주세요.</p>
        ) : (
          (() => {
            const list = diffBomRows(bomItems, cmpRows, {
              mineVariants: variants,
              theirVariants: cmpProject?.variants || [],
            }).filter((d) => !cmpDone.has(d.key));
            if (list.length === 0)
              return (
                <div className="empty-state">
                  <p>다른 곳이 없습니다 — 두 BOM 의 줄과 수량이 같습니다.</p>
                </div>
              );
            return (
              <div className="table-scroll-x">
                <table className="table cards-sm bom-diff-table">
                  <colgroup>
                    {['9%', '7%', '11%', null, '12%', '6%', '8%', '230px'].map((w, i) => (
                      <col key={i} style={w ? { width: w } : undefined} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">무엇</th>
                      <th scope="col">BOX</th>
                      <th scope="col">품명</th>
                      <th scope="col">규격</th>
                      <th scope="col">타입</th>
                      <th scope="col" className="col-num">
                        이 BOM
                      </th>
                      <th scope="col" className="col-num">
                        {cmpProject?.name || '상대'}
                      </th>
                      <th scope="col" className="col-action">
                        맞추기
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.key}>
                        <td data-label="무엇">
                          {d.kind === 'onlyTheirs'
                            ? '이 BOM 에 없음'
                            : d.kind === 'onlyMine'
                              ? '상대에 없음'
                              : d.kind === 'qty'
                                ? '수량 다름'
                                : '타입 다름'}
                        </td>
                        <td data-label="BOX">{d.box}</td>
                        <td data-label="품명" className="u-wrap">
                          {d.name}
                        </td>
                        <td data-label="규격" className="u-wrap">
                          {d.spec}
                        </td>
                        {/* 타입은 프로젝트마다 키가 달라(vM7H ↔ vmtwa6plx) 라벨로 견주고, 옮길 때도 라벨로 짝짓는다 */}
                        <td data-label="타입" className="u-wrap">
                          {(d.mineVariants || []).join(', ') || '—'}
                          {(d.theirVariants || []).join(', ') !== (d.mineVariants || []).join(', ') && (
                            <span className="text-muted"> ↔ {(d.theirVariants || []).join(', ') || '—'}</span>
                          )}
                        </td>
                        <td data-label="이 BOM" className="col-num">
                          {d.mineQty || '—'}
                        </td>
                        <td data-label="상대" className="col-num">
                          {d.theirQty || '—'}
                        </td>
                        <td className="col-action">
                          <div className="btn-group">
                            {d.kind !== 'onlyMine' && (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={!!cmpBusy}
                                onClick={() => applyDiff(d, 'pull')}
                                title="이 BOM 을 상대에 맞춥니다"
                              >
                                {d.kind === 'qty'
                                  ? `이 BOM 을 ${d.theirQty} 로`
                                  : d.kind === 'variant'
                                    ? '타입 맞추기'
                                    : '가져오기'}
                              </button>
                            )}
                            {d.kind !== 'onlyTheirs' && (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                disabled={!!cmpBusy}
                                onClick={() => applyDiff(d, 'push')}
                                title="상대를 이 BOM 에 맞춥니다"
                              >
                                {d.kind === 'qty'
                                  ? `상대를 ${d.mineQty} 로`
                                  : d.kind === 'variant'
                                    ? '상대 타입 맞추기'
                                    : '보내기'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={() => setCmpOpen(false)}>
            닫기
          </button>
        </div>
      </Modal>

      {splitOf && (
        <Modal isOpen onClose={() => setSplitOf(null)} title="줄 나누기" size="md">
          <p className="field-hint" style={{ marginTop: 0 }}>
            <strong>{splitOf.row.name || splitOf.row.itemId}</strong> · 지금{' '}
            <strong>
              {String(splitOf.row.box || '(BOX 없음)')} {Number(splitOf.row.qty) || 0}개
            </strong>
          </p>
          <div className="form-row">
            <div className="form-group">
              <label>옮길 개수</label>
              <input
                type="number"
                min="1"
                max={Number(splitOf.row.qty) || 1}
                value={splitOf.n}
                onChange={(e) => setSplitOf((s) => ({ ...s, n: e.target.value }))}
                aria-label="옮길 개수"
              />
            </div>
            <div className="form-group">
              <label>어느 BOX 로</label>
              <Select
                value={splitOf.box}
                onChange={(v) => setSplitOf((s) => ({ ...s, box: v }))}
                options={BOX_OPTIONS.filter((b) => b !== String(splitOf.row.box || '').trim()).map((b) => ({
                  value: b,
                  label: b,
                }))}
                placeholder="BOX 고르기"
                ariaLabel="어느 BOX 로"
              />
            </div>
          </div>
          <p className="field-hint">
            그 BOX 에 같은 품목·타입·방향 줄이 있으면 새로 만들지 않고 수량만 더합니다. 호기에 이미 체크해 둔 수량은
            지금 줄에 그대로 남아, 나눈 뒤 초과·부족으로 보일 수 있습니다.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setSplitOf(null)} disabled={splitBusy}>
              취소
            </button>
            <button type="button" className="btn btn-primary" onClick={doSplit} disabled={splitBusy || !splitOf.box}>
              옮기기
            </button>
          </div>
        </Modal>
      )}
      <Modal isOpen={pairOpen} onClose={() => setPairOpen(false)} title="짝 BOM">
        <p className="field-hint">
          같은 판넬인데 고객사만 다른 BOM 과 묶습니다. 한쪽에서 줄을 넣고 빼고 고치면 다른 쪽도 같이 바뀝니다.
          품목·도번·비고·단가·줄 순서·줄 추가/삭제는 늘 같이 갑니다.
        </p>
        <div className="form-group">
          <label>짝이 될 BOM</label>
          <Select
            value={pairDraft.projectId}
            onChange={(v) => setPairDraft((d) => ({ ...d, projectId: v }))}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="BOM 고르기"
            ariaLabel="짝이 될 BOM"
          />
        </div>
        {PAIR_OPTIONS.map((o) => (
          <div className="toggle-row" key={o.key} style={{ marginBottom: 10 }}>
            <div className="toggle-row-text">
              <span className="toggle-row-title">{o.label}</span>
              {o.key === 'supplyType' && <small className="text-muted">고객사마다 달라서 보통은 끕니다</small>}
              {o.key === 'variant' && (
                <small className="text-muted">타입은 이름으로 짝짓습니다 — 상대에 없는 타입은 건너뜁니다</small>
              )}
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={!!pairDraft.sync[o.key]}
                onChange={(e) => setPairDraft((d) => ({ ...d, sync: { ...d.sync, [o.key]: e.target.checked } }))}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        ))}
        <div className="modal-actions">
          {project?.pair?.projectId && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={pairBusy}
              onClick={async () => {
                if (!guard()) return;
                setPairBusy(true);
                try {
                  await clearBomPair(projectId);
                  setProject((p) => ({ ...p, pair: null }));
                  setPairOpen(false);
                  toast('짝을 풀었습니다', 'success');
                } catch {
                  toast('짝을 풀지 못했습니다', 'error', 0);
                } finally {
                  setPairBusy(false);
                }
              }}
            >
              짝 풀기
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={pairBusy || !pairDraft.projectId}
            onClick={async () => {
              if (!guard()) return;
              setPairBusy(true);
              try {
                await setBomPair(projectId, pairDraft.projectId, pairDraft.sync);
                setProject((p) => ({ ...p, pair: { projectId: pairDraft.projectId, sync: pairDraft.sync } }));
                setCmpId(pairDraft.projectId);
                setPairOpen(false);
                toast('짝을 맺었습니다 — 지금 다른 곳은 「다름 찾기」로 한 번 맞춰 주세요', 'success', 0);
              } catch (err) {
                toast(err?.message || '짝을 맺지 못했습니다', 'error', 0);
              } finally {
                setPairBusy(false);
              }
            }}
          >
            저장
          </button>
        </div>
      </Modal>
      <Modal isOpen={variantModalOpen} onClose={() => setVariantModalOpen(false)} title="타입 관리">
        <p className="field-hint" style={{ marginTop: 0 }}>
          같은 제품인데 형번마다 자재가 다를 때 씁니다. 타입을 만들어 두면 발주서로 가져올 때 하나만 고르면 됩니다.
        </p>

        {variants.length === 0 ? (
          /* 처음 쓰는 사람에게만 자세히 — 이미 만들어 둔 사람에게는 자리만 차지한다 */
          <div className="variant-empty">
            <Icon name="folder" className="variant-empty-ic" />
            <p>
              아직 타입이 없습니다.
              <br />
              BOM 을 여러 벌로 나눠 두면 자재가 바뀔 때마다 양쪽을 다 고쳐야 해서 한쪽을 빠뜨리기 쉽습니다. 한 벌로 두고
              타입만 갈라 두세요.
            </p>
          </div>
        ) : (
          <div className="variant-list">
            {variants.map((v) => {
              const n = bomItems.filter((b) => {
                const ks = variantKeysOf(b);
                return ks.length === 0 || ks.includes(v.key);
              }).length;
              return (
                <div className="variant-row" key={v.key}>
                  <input
                    className="variant-name"
                    type="text"
                    value={v.label}
                    onChange={(e) => renameVariant(v.key, e.target.value)}
                    maxLength={40}
                    aria-label="타입 이름"
                  />
                  <span className="variant-count" title="이 타입으로 발주하면 들어가는 품목 수 (공통 포함)">
                    {n}개
                  </span>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => deleteVariant(v)}>
                    <Icon name="trash" className="btn-ic" />
                    삭제
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="form-group variant-add-group">
          <label>타입 추가</label>
          <div className="bom-variant-add">
            <input
              type="text"
              value={newVariant}
              onChange={(e) => setNewVariant(e.target.value)}
              placeholder="예) T5391 / MT8311"
              maxLength={40}
              aria-label="새 타입 이름"
            />
            <button type="button" className="btn btn-primary" disabled={!newVariant.trim()} onClick={addVariant}>
              <Icon name="plus" className="btn-ic" />
              추가
            </button>
          </div>
        </div>
      </Modal>

      {/* 품목 한 줄이 어느 타입에 들어가는지 고르기 */}
      <Modal isOpen={!!variantPick} onClose={() => setVariantPick(null)} title="이 품목이 들어갈 타입">
        <p className="field-hint" style={{ marginBottom: 12 }}>
          {variantPick?.name}
          {variantPick?.spec ? ` · ${variantPick.spec}` : ''}
        </p>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          아무것도 고르지 않으면 <strong>공통</strong>입니다 — 어느 타입으로 발주해도 함께 들어갑니다.
        </p>
        <div className="bom-variant-picks">
          {variants.map((v) => {
            const on = variantPick ? variantKeysOf(variantPick).includes(v.key) : false;
            return (
              <label key={v.key} className={`bom-variant-pick${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggleItemVariant(variantPick.id, v.key)} />
                {v.label}
              </label>
            );
          })}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => setVariantPick(null)}>
            닫기
          </button>
        </div>
      </Modal>
    </div>
  );
}
