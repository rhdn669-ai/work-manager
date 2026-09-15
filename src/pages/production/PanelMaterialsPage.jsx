import { Fragment, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { useFillHeight } from '../../utils/useFillHeight';
import { useArrived } from '../../utils/useArrived';
import ViewSwitch from '../../components/common/ViewSwitch';
import ReceiptChip from '../../components/common/ReceiptChip';
import MemoInput from '../../components/common/MemoInput';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { useEditLock } from '../../contexts/useEditLock';
import { subscribePanels, updatePanel } from '../../services/productionService';
import { getBomProjectById, getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribeStock, takeStock, returnStock, getStockQty, getStockSplit } from '../../services/stockService';
import { ledgerOn, stockKindOf } from '../../domain/stockLedger';
import {
  subscribePanelMaterials,
  setReceived,
  getPanelMaterials,
  setSkipped,
  setNote,
  addFromStock,
  addFromOurs,
} from '../../services/panelMaterialsService';
import { subscribeReceivedFor, subscribePaidSetSettings } from '../../services/paidSetService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { consumedByItem } from '../../domain/paidSets';
import { CHECKABLE_BOXES, hasBomLink, bomRowsForBox, isForwardExcluded, isMatStarted } from '../../domain/panelBom';
import { OUT_WHYS, IN_WHYS, WHY_WHYS, needsMate, rowSummary, shortPanel } from '../../domain/matLog';
import { writeMatLog } from '../../services/matLogService';
import { receivedQty, shortageOf, rowDone, boxKindComplete, boxSummary, isSkipped } from '../../domain/panelMaterials';
import { stockMoves } from '../../domain/stockSync';
import { MADE, MADE_TYPE, isMade, inKindTab, kindOf } from '../../domain/itemKind';
import { specFontClass, localStamp } from '../../utils/printText';

// 호기 자재 체크 — 이 호기, 이 BOX 의 BOM 구성품이 몇 개 들어왔는지
// (2026-09-03 대표님 「호기별로 자재 사급 도급 리스트 … 구성품 체크 수량」).
//
// 기록은 호기마다 따로(panelMaterials). 같은 BOM 을 여러 호기가 쓰므로 BOM 에 적으면
// 섞인다. 구성품이 전부 차면 생산현황의 「자재 도급 / 자재 사급」 칸이 저절로 켜진다.
// embedded: 자재 허브(MaterialsHubPage) 탭 안에서 그릴 때 — 뒤로 버튼·큰 제목 없이 (2026-09-05 안 B 2단계)
export default function PanelMaterialsPage({ embedded = false, panelId: panelIdProp = '' } = {}) {
  const params = useParams();
  const panelId = panelIdProp || params.panelId;
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();

  const [panel, setPanel] = useState(null);
  const [loadedPanels, setLoadedPanels] = useState(false);
  const [project, setProject] = useState(null);
  const [bomRows, setBomRows] = useState([]);
  const [bomFor, setBomFor] = useState(''); // 어느 프로젝트의 BOM 을 받아 뒀는지
  const { take, has } = useArrived(); // 어느 구독이 첫 값을 줬는지
  const [master, setMaster] = useState([]);
  const [received, setReceivedMap] = useState({}); // { [box]: { [bomItemId]: {qty,at,by} } }
  const [supplyTab, setSupplyTab] = useState('paid'); // 'paid' | 'free'
  const [draft, setDraft] = useState({}); // 입력 중인 개수 { [bomItemId]: '3' }
  // 숫자를 직접 적는 칸은 «길게 누를 때»만 연다 — 100번 중 96번은 필요 수량 그대로 들어오기 때문
  // (2026-09-08 대표님 「자동 채우기 버튼으로, 한 번 더 누르면 수량 입력」 → 실측 후 A안 확정)
  const [typing, setTyping] = useState(null); // 지금 숫자를 적고 있는 줄 id
  const pressRef = useRef({ timer: 0, long: false });
  // 표 상자를 화면 아래까지 늘려 그 안에서 스크롤 — 머리줄·도번 열을 붙여 두기 위해 (2026-09-08 대표님)
  const scrollRef = useFillHeight();

  // ── 판넬 ──
  useEffect(() => {
    const unsub = subscribePanels((rows) => {
      setPanel(rows.find((p) => p.id === panelId) || null);
      setLoadedPanels(true);
    });
    return unsub;
  }, [panelId]);

  const link = panel?.bomLink || null;

  // ── BOM (연결된 프로젝트) ──
  useEffect(() => {
    // 연결이 없으면 아래 「연결 없음」 화면이 나가므로 여기서 상태를 비울 일이 없다
    if (!link?.projectId) return undefined;
    let alive = true;
    Promise.all([getBomProjectById(link.projectId), getBomBySite(link.projectId)])
      .then(([p, rows]) => {
        if (!alive) return;
        setProject(p || null);
        setBomRows(rows || []);
        setBomFor(link.projectId);
      })
      .catch(() => {
        if (alive) toast('BOM 을 불러오지 못했습니다', 'error');
      });
    return () => {
      alive = false;
    };
  }, [link?.projectId, toast]);

  // ── 품목 마스터 (코드·품명·규격·도번은 여기서 읽는다) ──
  useEffect(() => subscribePurchaseItems(take('master', setMaster)), [take]);
  // 사급 재고 — 호기를 정하지 않고 들어온 고객사 물건 (2026-09-10 대표님)
  const [freeStock, setFreeStock] = useState({});
  const [paidStock, setPaidStock] = useState({}); // 회사 도급 통 — 부족분을 여기서 끌어온다
  const company = panel?.회사 || '';
  // 설정 — 옛 현장 발주서(siteId)와 「굳히기」 플래그(stockLedger). 아래 여러 곳이 보므로 먼저 둔다
  const [settings, setSettings] = useState({});
  useEffect(() => subscribePaidSetSettings(take('settings', setSettings)), [take]);
  useEffect(() => {
    if (!company) return undefined;
    return subscribeStock('free', company, take('freeStock', setFreeStock));
  }, [company, take]);
  useEffect(() => {
    if (!company) return undefined;
    return subscribeStock('paid', company, take('paidStock', setPaidStock));
  }, [company, take]);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // ── 갈래: 도급 · 사급 · 판금 — BOM 줄에 담긴 자리가 곧 구분이다 (2026-09-12 대표님) ──
  const inTab = useCallback((r) => inKindTab(r, supplyTab === MADE ? 'made' : supplyTab), [supplyTab]);

  // ── 이 호기의 입고 기록 ──
  useEffect(() => subscribePanelMaterials(panelId, take('received', setReceivedMap)), [panelId, take]);

  // ── BOX ──
  // 품목 정보를 붙인 BOM 줄 — 갈래(전장/가공)는 품목 코드로 가리므로 먼저 붙여야 한다
  const bomRowsFull = useMemo(
    () =>
      bomRows.map((r) => {
        const m = r.itemId ? masterMap[r.itemId] : null;
        return {
          ...r,
          code: m?.code || r.code || '',
          name: m?.name || r.name || '',
          spec: m?.spec || r.spec || '',
          drawingNo: m?.drawingNo || r.drawingNo || '',
        };
      }),
    [bomRows, masterMap],
  );

  const boxesWithRows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRowsFull, link?.variantKey || '');
    return CHECKABLE_BOXES.filter((b) => bomRowsForBox(forVariant, b).length > 0);
  }, [bomRowsFull, link?.variantKey]);
  // 「전체」 — 모든 BOX 줄을 한 표에 BOX 구분줄과 함께 늘어놓는다. 저장은 줄마다 제 BOX 로 간다
  // (2026-09-16 대표님 「준비작업 앞에 박스 전체 필터 하나만 걸어줘」)
  const ALL_BOXES = '전체';
  // 처음 열면 「전체」 — BOX 를 고르기 전에 호기 전체가 한눈에 (2026-09-16 대표님 「첫 호기체크 화면은 박스 전체 보이게」)
  const box = sp.get('box') || ALL_BOXES;
  const allBoxes = box === ALL_BOXES;
  const boxList = allBoxes ? boxesWithRows : [box];
  // 주소의 다른 값(고른 호기·탭)은 그대로 두고 box 만 바꾼다 —
  // 예전엔 통째로 갈아 끼워 BOX 를 누르면 첫 호기로 튀었다 (2026-09-05 대표님)
  const setBox = (b) => {
    const q = new URLSearchParams(sp);
    q.set('box', b);
    setSp(q, { replace: true });
  };

  // ── 이 BOX 의 구성품 (타입 → BOX 순으로 거른다) ──
  const rows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRowsFull, link?.variantKey || '');
    // 줄마다 제 BOX 를 붙여 둔다 — 「전체」에서는 여러 BOX 줄이 섞이므로 저장할 곳을 줄이 안다
    return boxList.flatMap((b) => bomRowsForBox(forVariant, b).map((r) => ({ ...r, _box: b })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomRowsFull, link?.variantKey, box, boxesWithRows]);
  const boxOf = (r) => r?._box || box;
  // BOM 줄 id 는 BOX 를 가리지 않고 하나뿐이라, 「전체」에서는 BOX 별 기록을 한 사전으로 합쳐 읽는다
  const rec = useMemo(
    () => (allBoxes ? Object.assign({}, ...boxList.map((b) => received[b] || {})) : received[box] || {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBoxes, box, boxesWithRows, received],
  );
  // 정방향 제외 줄 — 이 호기(정)에는 안 오는 자재. 표에는 회색으로 두고 셈에서는 뺀다
  // (2026-09-15 대표님 「Bom에 정을 표시한것만 생산현황 호기 자재리스트에 회색처리」)
  const inScope = useCallback((r) => !isForwardExcluded(r, panel), [panel]);
  // 세트를 배정한 호기의 도급 수량은 세트가 정한다 — 손으로 못 고친다 (2026-09-03 대표님
  // 「도급 세트 배정하면 이 페이지는 수동으로 입력하는 게 안 되어야」). 사급은 그대로 손 체크.
  // 도급은 «항상» 읽기 전용 — 우리가 사서 넣는 자재라 「도급 세트」 배정으로만 채운다
  // (2026-09-03 대표님 「도급은 발주서에 체크하는 방식 … 개별로 체크하게 되어 있는데?」). 사급만 손 체크.
  // 잠금 — 사급 개수도 실수로 고쳐지지 않게 (2026-09-05 대표님 「잠금이 왜 없지」).
  // 도급은 잠금과 무관하게 «항상» 읽기 전용(발주 입고가 채운다).
  const editMode = useEditLock();
  // 도급도 사급처럼 손으로 체크한다 — 호기에서 세트를 실제로 만들면서 세는 것이 실물과 맞는다
  // (2026-09-12 대표님 「호기수마다 실제로 세트를 만들면서 수량체크가 되어야할거겉은데」).
  // 도급 재고는 «발주 입고 + 손으로 적은 몫 − 호기에 들어간 양»이라, 여기서 체크만 하면
  // 재고가 저절로 줄고 지우면 저절로 돌아온다 — 재고를 따로 건드릴 일이 없다.
  const locked = !editMode;
  // BOX 마다 이 탭(도급/사급)의 부족 줄 수 — 탭 오른쪽 배지로 보여 어느 BOX 가 모자란지 한눈에
  // (2026-09-05 대표님 「부족 떠있는 위치 확인이 안 되니 박스 우측에 부족 수량」)
  const shortByBox = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    const out = {};
    for (const b of CHECKABLE_BOXES) {
      const list = bomRowsForBox(forVariant, b).filter(inTab);
      const got = received[b] || {};
      out[b] = list.filter(
        (r) => inScope(r) && !isSkipped(got, r.id) && shortageOf(r.qty, receivedQty(got, r.id)) > 0,
      ).length;
    }
    return out;
  }, [bomRowsFull, link?.variantKey, received, inTab, inScope]);

  // 완료 / 부족만 보기 (2026-09-05 대표님 「완료 부족 토글」)
  const [rowView, setRowView] = useState('all'); // 'all' | 'short' | 'done'
  // 도번·품명·규격으로 찾기 — 이 호기 «전체»에서 찾고, 고르면 그 BOX·갈래 탭으로 옮겨 간다
  // (2026-09-15 대표님 「전체리스트중에 검색 되고 해당 위치에 맞게 탭 움직이는걸로」)
  const [q, setQ] = useState('');
  // 줄에서 한 일을 적는 창 — kind 'out'(줄임) | 'in'(채움) | 'why'(0 인 줄 까닭)
  // (2026-09-15 대표님 「없는 이유가 남아야하고 그걸 채우면 어떻게 채웠는지가 남아야」)
  const [logForm, setLogForm] = useState(null);
  const [logSaving, setLogSaving] = useState(false);
  const whyList = (k) => (k === 'out' ? OUT_WHYS : k === 'in' ? IN_WHYS : WHY_WHYS);
  const openLog = (r, kind, n = 1) =>
    setLogForm({ row: r, kind, why: whyList(kind)[0], n: String(n), mate: '', note: rec[r.id]?.note || '' });
  const panelName = (p) => `${p?.프로젝트 || ''}${p?.호기 ? ` ${p.호기}` : ''}`.trim() || p?.id || '';
  const nameOfId = (id) => panelName(allPanels.find((x) => x.id === id));
  const shortOfId = (id) => shortPanel(nameOfId(id));
  // 상대 호기 목록 — 창을 열 때 셈한다. 여기서 바로 allPanels 를 읽으면 그 선언보다 위라 TDZ 다
  // (2026-09-15 「Cannot access before initialization」)
  const mateList = () =>
    allPanels
      .filter(
        (p) =>
          p.id !== panelId &&
          (!p.회사 || p.회사 === company) &&
          p.bomLink?.projectId === link?.projectId &&
          // 끝난 호기는 뺀다 — 이미 출고된 호기에서 빌려 올 수는 없다
          // (2026-09-15 대표님 「가져간 호기 끝난호기는 미포함」)
          p.overallStatus !== '출고완료' &&
          p.overallStatus !== '출고숨김',
      )
      .map((p) => ({ value: p.id, label: panelName(p) }));
  async function submitLog(e) {
    e.preventDefault();
    const f = logForm;
    if (!f) return;
    setLogSaving(true);
    try {
      await writeMatLog(panel, boxOf(f.row), f.row, {
        kind: f.kind,
        why: f.why,
        n: Math.max(1, Number(f.n) || 1),
        mate: f.mate,
        by: by(),
        note: f.note,
        stockKind: stockKindOf(f.row),
      });
      // 창의 비고가 곧 줄 비고 — «덮어쓴다». 이어 붙였더니 「미입고 · 미입고로 차용중 · ㅊ」처럼
      // 쌓이기만 하고 고칠 수가 없었다 (2026-09-16 대표님 「비고내용이 수정이 안되고 자꾸 쌓이네」)
      const memo = String(f.note || '').trim();
      if (memo !== String(rec[f.row.id]?.note || '').trim()) await saveNote(f.row, memo);
      setLogForm(null);
      toast('기록했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast(err?.message || '기록하지 못했습니다', 'error', 0);
    } finally {
      setLogSaving(false);
    }
  }
  const hit = (r) => {
    const kw = q.trim().toLowerCase();
    if (!kw) return false;
    return [r.drawingNo, r.name, r.spec, r.code].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(kw),
    );
  };
  // 이 호기의 모든 BOX·모든 갈래에서 찾은 줄 — 지금 보고 있는 자리가 맨 위
  const found = useMemo(() => {
    if (!q.trim()) return [];
    const forVariant = bomItemsForVariant(bomRowsFull, link?.variantKey || '');
    const out = [];
    for (const b of boxesWithRows.length ? boxesWithRows : CHECKABLE_BOXES) {
      for (const r of bomRowsForBox(forVariant, b)) {
        if (!hit(r)) continue;
        out.push({ row: r, box: b, kind: kindOf(r) });
      }
    }
    return out.sort((a, c) => (a.box === box ? -1 : c.box === box ? 1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, bomRowsFull, link?.variantKey, boxesWithRows, box]);
  const goTo = (f) => {
    setSupplyTab(f.kind === 'made' ? MADE : f.kind);
    if (!allBoxes && f.box !== box) setBox(f.box);
    setQ('');
    // 그 줄이 보이게 — 표가 다시 그려진 뒤에
    setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${f.row.id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('is-hit');
        setTimeout(() => el.classList.remove('is-hit'), 1600);
      }
    }, 120);
  };
  const shown = rows.filter(inTab).filter((r) => {
    if (rowView === 'all') return true;
    const done = rowDone(r, rec);
    return rowView === 'done' ? done : !done;
  });
  const isMadeRow = useCallback((r) => isMade(r), []);
  const summary = useMemo(() => boxSummary(rows.filter(inScope), rec, isMadeRow), [rows, rec, isMadeRow, inScope]);
  // 줄이 없는 탭도 그대로 보여 준다 — 예전에는 줄 있는 쪽으로 저절로 옮겨 갔는데,
  // 그러면 「이 BOX 에는 도급이 없다」를 확인할 길이 없었다
  // (2026-09-12 대표님 「도급0/0이어도 눌러지게 해줘 다른박스 비어있는걸 못보니까」).
  // 덤으로, 줄·요약·탭이 서로를 참조하던 고리도 사라졌다.
  // 기록이 하나도 없는 탭에서는 「기록」 열을 빼서 오른쪽이 비지 않게 (2026-09-05 대표님 「우측 공백 X」)
  const hasMeta = shown.some((r) => rec[r.id]?.at || rec[r.id]?.fromStock);
  // 비고 — 호기·줄마다 메모. 잠금을 풀어야 적는다 (2026-09-05 대표님 「비고란도 하나 만들어줘」).
  // 칸은 글 길이에 맞춰 아래로 늘어난다 (MemoInput, 2026-09-15 대표님 「비고글이 짤리는데」)
  const saveNote = async (r, v) => {
    try {
      await setNote(panelId, boxOf(r), r.id, v);
    } catch {
      toast('비고 저장에 실패했습니다', 'error');
    }
  };

  // ── ④ 연동: 이 BOX 의 도급/사급이 전부 차면 생산현황 자재 칸을 켠다, 하나라도 빠지면 끈다 ──
  useEffect(() => {
    if (!panel || rows.length === 0) return;
    // 기록이 하나도 없는 BOX 는 건드리지 않는다 — BOM 만 연결하고 페이지를 연 것만으로
    // 손으로 켜 둔 자재 칸이 「0개 입고」로 꺼지던 문제 (2026-09-03 대표님 「자재 칸 보호」)
    if (Object.keys(rec).length === 0) return;
    // 이 호기에 수량을 하나라도 적기 전에는 판정하지 않는다 — 정방향 제외로 줄이 다 빠진 BOX 가
    // 「다 들어옴」으로 켜지면 안 된다 (2026-09-15 대표님 「하나라도 체크가 시작 되었을때 시작」)
    if (!isMatStarted(received)) return;
    const today = new Date().toISOString().slice(0, 10);
    const 박스입고 = { ...(panel.박스입고 || {}) };
    const 박스입고일자 = { ...(panel.박스입고일자 || {}) };
    let changed = false;
    // BOX 마다 따로 판정한다 — 「전체」에서도 줄은 제 BOX 로 셈한다
    for (const b of boxList) {
      const scoped = rows.filter((r) => boxOf(r) === b).filter(inScope); // 정방향 제외 줄은 셈에 없다
      if (scoped.length === 0) continue;
      const recB = received[b] || {};
      if (Object.keys(recB).length === 0) continue;
      const cur = 박스입고[b] || {};
      const nextPaid = boxKindComplete(scoped, recB, 'paid', isMadeRow);
      const nextFree = boxKindComplete(scoped, recB, 'free', isMadeRow);
      // 판금도 같은 방식으로 생산현황의 「판금」 칸과 그 입고일에 이어 준다
      // (2026-09-12 대표님 「생산현황에 판금 입고일이랑 연동되면 됨」)
      const nextMade = boxKindComplete(scoped, recB, 'made', isMadeRow);
      const hasMadeRow = scoped.some(isMadeRow);
      if (!!cur.자재_도급 === nextPaid && !!cur.자재_사급 === nextFree && (!hasMadeRow || !!cur.판금 === nextMade))
        continue; // 그대로면 쓰지 않는다
      const curDate = 박스입고일자[b] || {};
      박스입고[b] = { ...cur, 자재_도급: nextPaid, 자재_사급: nextFree, ...(hasMadeRow ? { 판금: nextMade } : {}) };
      박스입고일자[b] = {
        ...curDate,
        자재_도급: nextPaid ? curDate.자재_도급 || today : '',
        자재_사급: nextFree ? curDate.자재_사급 || today : '',
        ...(hasMadeRow ? { 판금: nextMade ? curDate.판금 || today : '' } : {}),
      };
      changed = true;
    }
    if (!changed) return;
    updatePanel(panel.id, { 박스입고, 박스입고일자 }).catch(() => toast('자재 칸 갱신에 실패했습니다', 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, rows, rec, received, box, toast, isMadeRow, inScope]);

  // ── 개수 저장 ──
  // 한 번 누르면 필요 수량만큼 채우고, 채워진 것을 다시 누르면 0 으로 되돌린다.
  // 저장 뒤 몇 초 동안 「되돌리기」를 띄운다 — 한 번 누르기로 바뀌면서 잘못 누를 일이 생겼다 (2026-09-08 대표님)
  const undoable = (message, restore) =>
    toast({ message, type: 'success', duration: 6000, action: { label: '되돌리기', onClick: restore } });
  // 태블릿에서 글자판이 올라오면 화면이 절반으로 줄어 적고 있는 칸이 가려진다.
  // 칸에 들어가는 순간 그 줄을 표 가운데로 올려 둔다 (2026-09-14 대표님 「비고입력할때 칸이 안보이고」).
  const keepInView = (el) => {
    if (!el) return;
    // 글자판이 올라오면 보이는 자리가 반으로 준다. 그 «보이는 자리» 안에 적는 칸이 오도록
    // 두 단계로 굴린다 — ① 창을 굴려 표 상자를 화면 머리(고정 헤더 바로 밑)까지 올리고,
    // ② 상자 안에서 그 줄을 보이는 높이의 1/3 자리에 둔다.
    // 전에는 ②만 했다. 그런데 글자판이 서면 위쪽에 남는 자리가 제목·탭·요약 줄로 다 차서
    // 상자 자체가 글자판 밑으로 내려가 있었다 — 상자 안에서 아무리 굴려도 안 보였다
    // (2026-09-14 대표님 「아직 입력하는 칸이 키보드에 가려져 안보임」 태블릿 사진).
    const 굴리기 = () => {
      try {
        const box = el.closest('.pmat-scroll');
        const row = el.closest('tr');
        if (!box || !row) return el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // 보이는 높이 — 글자판이 가린 만큼 뺀 값. 창 크기가 줄지 않는 브라우저도 이건 맞게 준다
        const 보임 = window.visualViewport?.height || window.innerHeight;
        const 헤더 = document.querySelector('.header')?.getBoundingClientRect().bottom || 0;
        // ① 창 — 상자 위 테두리를 헤더 바로 밑으로
        const 상자위 = box.getBoundingClientRect().top;
        const 창이동 = 상자위 - 헤더 - 8;
        if (Math.abs(창이동) > 4) window.scrollBy({ top: 창이동, behavior: 'smooth' });
        // ② 상자 — 줄을 «보이는» 상자 높이의 1/3 자리에
        const 상자보임 = Math.max(120, Math.min(box.clientHeight, 보임 - (헤더 + 8)));
        const 머리 = box.querySelector('thead')?.offsetHeight || 0;
        box.scrollTo({ top: Math.max(0, row.offsetTop - 머리 - 상자보임 / 3), behavior: 'smooth' });
      } catch {
        /* 오래된 브라우저는 그냥 둔다 */
      }
    };
    // 글자판이 다 선 뒤에 재야 자리가 맞는다 — 기기마다 올라오는 속도가 달라 두 번 잰다
    setTimeout(굴리기, 300);
    setTimeout(굴리기, 800);
  };

  const by = () => userProfile?.name || '';
  // 되돌리기는 «되돌린 양만큼» 재고도 되돌려야 한다.
  // 호기 수량만 되돌리고 통을 그대로 두면, 통에서 빠진 것이 사라진 채로 남는다 (2026-09-11).
  const restoreOne = (r, prevQty, appliedQty) => async () => {
    try {
      await applyQty(r, appliedQty, prevQty, { quiet: true });
    } catch {
      toast('되돌리지 못했습니다', 'error');
    }
  };

  // ── 호기에 있는 자재는 전부 통을 거친 것 ──
  //
  // 규칙 (2026-09-15 설계 「재고를 통 실값 하나로」, 대표님 「통에 없으면 안채워짐으로 가자 전부」):
  //   · 수량을 늘리면 통에 있는 만큼까지만 적힌다. 5 를 적었는데 통에 3 이면 3 만 들어가고
  //     「재고에 2개 부족」을 알린다 — 먼저 재고 화면에서 입고한 뒤 다시 적는다.
  //   · 줄이면 통에서 꺼냈던 만큼 돌아간다(옛 줄에 통을 안 거친 몫이 섞여 있으면 그만큼은 안 간다
  //     — domain/stockSync 가 fromStock 으로 가른다).
  // 이 규칙은 통이 실값인 갈래에만 켜진다: 사급은 늘, 도급·판금은 굳힌 뒤(ledgerOn).
  // 그 전의 도급·판금은 예전대로 통을 안 건드린다.
  const ledger = (r) => !!company && !!r?.itemId && ledgerOn(settings, company, stockKindOf(r));

  /** 통과 줄을 함께 맞춘다 — 늘릴 때 통에 있는 만큼까지만. 실제로 적힌 수량을 돌려준다 */
  const applyQty = async (r, before, want, { quiet = false } = {}) => {
    const b = Number(before) || 0;
    let after = Math.max(0, Number(want) || 0);
    const kind = stockKindOf(r);
    if (ledger(r) && after > b) {
      const { qty: have, ours } = await getStockSplit(kind, company, r.itemId);
      if (after - b > have) {
        const short = after - b - have;
        after = b + have;
        if (!quiet) toast(`${r.name} 재고에 ${short}개 부족 — 재고 화면에서 입고한 뒤 다시 적어 주세요`, 'error');
      }
      // 사급은 고객사 것부터 나간다 — 그것으로 모자라 «당사» 몫까지 쓰게 되면 한 번 묻는다
      // (2026-09-15 대표님 「당사껄 사용하게되면 확인 문구 한번더」)
      const need = after - b;
      const fromOurs = kind === 'free' ? Math.max(0, need - (have - ours)) : 0;
      if (fromOurs > 0 && !quiet) {
        const ok = await confirm(`${r.name} ${fromOurs}개를 당사 재고에서 사용합니다. 계속할까요?`);
        if (!ok) return b;
      }
    }
    if (after === b) return b;
    await setReceived(panelId, boxOf(r), r.id, after, by());
    await syncStock(r, b, after);
    return after;
  };

  const syncStock = async (r, before, after) => {
    if (!ledger(r)) return;
    const d = (Number(after) || 0) - (Number(before) || 0);
    if (d === 0) return;
    const kind = stockKindOf(r);
    const who = by();
    const where = `${panel?.프로젝트 || ''} · ${boxOf(r)}`;
    try {
      // 통에서 온 누계는 «저장된 값»으로 — 화면 값은 되돌리기처럼 연달아 고칠 때 한 박자 늦다 (2026-09-16)
      const stored = (await getPanelMaterials(panelId))?.[boxOf(r)]?.[r.id] || {};
      const kept = Math.max(0, Number(stored.fromStock) || 0);
      const keptOurs = Math.max(0, Number(stored.fromOurs) || 0); // 그중 「우리가 댄」 몫 (사급)
      const have = d > 0 ? await getStockQty(kind, company, r.itemId) : 0;
      const mv = stockMoves({ before, after, have, fromStock: kept });
      if (!mv) return;
      if (mv.take > 0) {
        // 사급은 고객사 것부터 나간다 — 우리 몫에서 나간 만큼만 따로 적어 둔다 (2026-09-12 대표님)
        const { take, fromOurs } = await takeStock(kind, company, r.itemId, mv.take, { by: who, note: where });
        if (take > 0) {
          await addFromStock(panelId, boxOf(r), r.id, take, kept);
          if (fromOurs > 0) await addFromOurs(panelId, boxOf(r), r.id, fromOurs, keptOurs);
        }
      }
      if (mv.giveBack > 0) {
        await returnStock(kind, company, r.itemId, mv.giveBack, {
          by: who,
          note: `${where} 되돌림`,
          tookOurs: keptOurs,
        });
        await addFromStock(panelId, boxOf(r), r.id, -mv.giveBack, kept);
        if (keptOurs > 0) await addFromOurs(panelId, boxOf(r), r.id, -Math.min(mv.giveBack, keptOurs), keptOurs);
      }
    } catch (err) {
      console.error('[재고] 맞추기 실패', err);
      toast('재고를 맞추지 못했습니다 — 재고 화면에서 확인해 주세요', 'error');
    }
  };

  const toggleRow = async (r, got) => {
    const want = got > 0 ? 0 : Number(r.qty) || 0;
    try {
      const n = await applyQty(r, got, want);
      if (n === got) return;
      undoable(n > 0 ? `${r.name} ${n}개 들어옴` : `${r.name} 0 으로`, restoreOne(r, got, n));
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };

  // 길게 누르면 숫자 칸이 열린다 (일부만 들어온 드문 경우)
  const startPress = (r) => {
    pressRef.current.long = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => {
      pressRef.current.long = true;
      setTyping(r.id);
    }, 500);
  };
  const endPress = (r, got) => {
    clearTimeout(pressRef.current.timer);
    if (pressRef.current.long) return; // 길게 눌러 숫자 칸이 열린 경우는 여기서 끝
    toggleRow(r, got);
  };
  const cancelPress = () => {
    clearTimeout(pressRef.current.timer);
  };

  const commit = async (r) => {
    const raw = draft[r.id];
    if (raw === undefined) return;
    const n = Math.max(0, Number(raw) || 0);
    setDraft((d) => {
      const nd = { ...d };
      delete nd[r.id];
      return nd;
    });
    setTyping(null);
    const before = receivedQty(rec, r.id);
    if (n === before) return;
    // 줄어들면 「왜 줄었나」를 묻는다 — 창에서 적으면 수량도 거기서 내려간다
    // (2026-09-15 대표님 「-수량으로 입력하게 되면 사유를 선택하고 남는 방식」)
    if (n < before) {
      setLogForm({
        row: r,
        kind: 'out',
        why: OUT_WHYS[0],
        n: String(before - n),
        mate: '',
        note: rec[r.id]?.note || '',
      });
      return;
    }
    try {
      const applied = await applyQty(r, before, n);
      if (applied === before) return;
      undoable(`${r.name} ${applied}개`, restoreOne(r, before, applied));
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };
  // 이 호기에서만 줄을 일시 제외/복귀 — 기본 BOM 은 그대로 (세트 배정 호기의 도급 탭에서)
  const title = `${panel?.프로젝트 || ''}${panel?.호기 ? ` ${panel.호기}` : ''}`.trim() || '호기';
  const toggleSkip = async (r, on) => {
    try {
      await setSkipped(panelId, boxOf(r), r.id, on, userProfile?.name || '');
    } catch {
      toast('저장에 실패했습니다', 'error');
    }
  };
  // 부족한 도급 줄을 창고 재고에서 (2026-09-05 대표님 「부족한 거 재고에서 땡겨오는 버튼 없나」)
  // 도급은 창고 재고(우리가 산 물건), 사급은 사급 재고(고객사 물건)를 본다
  // 도급은 그 회사 도급 통을 본다. 예전에는 창고 장부(purchaseItems.stockQty)를 봤는데,
  // 도급 재고를 회사별 통으로 옮기면서 창고가 0 이 되어 「가져오기」가 먹통이 됐다
  // (2026-09-12 대표님 「가져오기가 왜 안되지」).
  const stockOf = (r) => {
    const kind = stockKindOf(r);
    if (kind === 'free') return Math.max(0, Number(freeStock[r.itemId]?.qty) || 0);
    // 굳힌 도급·판금은 통 값 그대로 (2026-09-15 설계)
    if (ledgerOn(settings, company, kind)) return Math.max(0, Number(paidStock[r.itemId]?.qty) || 0);
    // 굳히기 전 — 손으로 적어 둔 몫 + 발주 여유 (「부족분 채우기」가 보는 것과 같은 곳).
    // 여유를 안 보던 탓에, 발주로 넉넉히 들어왔어도 누가 수동으로 적지 않았으면
    // 줄마다의 「재고에서」가 아예 안 떴다 (2026-09-12).
    const kept = Math.max(0, Number(paidStock[r.itemId]?.qty) || 0);
    const spare = Math.max(0, Number(spareByItem[r.itemId]) || 0);
    return kept + spare;
  };
  // 발주 여유 = 이 BOM 으로 들어온 입고 − 배정 호기들이 가져간 양 (부족 집계와 같은 셈)
  const siteId = settings?.[panel?.회사 || '']?.siteId || '';
  const [receivedByItem, setReceivedByItem] = useState({});
  useEffect(() => {
    if (!link?.projectId) return undefined;
    return subscribeReceivedFor({ bomProjectId: link.projectId, siteId }, take('receivedByItem', setReceivedByItem));
  }, [link?.projectId, siteId, take]);
  const [allMaterials, setAllMaterials] = useState({});
  const [allPanels, setAllPanels] = useState([]);
  useEffect(() => subscribeAllMaterials(take('allMaterials', setAllMaterials)), [take]);
  useEffect(() => subscribePanels(take('allPanels', setAllPanels)), [take]);
  const spareByItem = useMemo(() => {
    if (!link?.projectId) return {};
    const assigned = allPanels.filter((p) => p.paidSet && p.bomLink?.projectId === link.projectId);
    const consumed = consumedByItem(
      bomRows,
      assigned.map((p) => allMaterials[p.id] || {}),
    );
    const out = {};
    for (const [itemId, q] of Object.entries(receivedByItem)) out[itemId] = q - (consumed[itemId] || 0);
    return out;
  }, [link?.projectId, allPanels, bomRows, allMaterials, receivedByItem]);

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/production', { replace: true }));

  if (!loadedPanels)
    return (
      <div className="page">
        <p className="text-muted">불러오는 중…</p>
      </div>
    );
  if (!panel)
    return (
      <div className="page">
        <p className="text-muted">판넬을 찾을 수 없습니다.</p>
        {/* (2026-09-05 뒤로가기 표준) */}
        <button type="button" className="btn btn-sm btn-outline" onClick={back}>
          <Icon name="chevronLeft" className="btn-ic" />
          생산현황
        </button>
      </div>
    );
  if (!hasBomLink(panel))
    return (
      <div className="page">
        <h2 className="page-title pmat-title">{title}</h2>
        <p className="text-muted">
          이 호기에 연결된 BOM 이 없습니다. 생산현황 표의 「상세」에서 BOM 프로젝트와 타입을 먼저 골라 주세요.
        </p>
        {/* (2026-09-05 뒤로가기 표준) */}
        <button type="button" className="btn btn-sm btn-outline" onClick={back}>
          <Icon name="chevronLeft" className="btn-ic" />
          생산현황
        </button>
      </div>
    );

  // 다 받기 전엔 그리지 않는다 — 입고 기록이 오기 전에 그리면 요약이 「0/14」로 떴다가
  // 「14/14」로 튀고, 「재고 N」도 나중에 붙는다 (2026-09-14 대표님 잔상 조사)
  const ready =
    bomFor === link.projectId &&
    has('master', 'received', 'settings', 'receivedByItem', 'allMaterials', 'allPanels') &&
    (!company || has('freeStock', 'paidStock'));
  if (!ready)
    return (
      <div className="page">
        <p className="text-muted">불러오는 중…</p>
      </div>
    );

  const docNo = `MAT${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const stamp = localStamp();

  return (
    <div className="page pmat-page">
      {/* ── 화면 ── */}
      <div className={`page-header no-print${embedded ? ' page-header--sub' : ''}`}>
        <div>
          {!embedded && (
            <button type="button" className="btn btn-sm btn-outline" onClick={back}>
              <Icon name="chevronLeft" className="btn-ic" />
              생산현황
            </button>
          )}
          {/* 제목과 BOM 정보를 한 줄로 — 표 볼 자리를 넓힌다 (2026-09-08 대표님 「상단이 너무 많이 차지」) */}
          <h2 className="page-title pmat-title">
            {title} <span className="pmat-title-sub">· {box} 자재 체크</span>
            <span className="pmat-link">
              BOM <strong>{link.projectName || project?.name || ''}</strong>
              {link.variantLabel ? (
                <span className="pmat-variant">{link.variantLabel}</span>
              ) : (
                <span className="pmat-variant is-common">공통</span>
              )}
            </span>
          </h2>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-outline" onClick={() => window.print()}>
            <Icon name="doc" className="btn-ic" />
            체크리스트 출력
          </button>
        </div>
      </div>

      {/* BOX 탭 — 이 BOM 에 줄이 있는 BOX 만. 오른쪽 끝에 보기(전체·부족·완료) */}
      <div className="pmat-boxes no-print">
        <ViewSwitch
          options={[
            {
              value: ALL_BOXES,
              label: ALL_BOXES,
              count: (() => {
                const n = boxesWithRows.reduce((a, b) => a + (shortByBox[b] || 0), 0);
                return n > 0 ? n : ' ';
              })(),
            },
            ...(boxesWithRows.length ? boxesWithRows : CHECKABLE_BOXES).map((b) => ({
              value: b,
              label: b,
              count: shortByBox[b] > 0 ? shortByBox[b] : ' ',
            })),
          ]}
          value={box}
          onChange={setBox}
          ariaLabel="BOX"
          className="pmat-box-switch"
        />
        <div className="pmat-search-wrap">
          <input
            className="fstock-search pmat-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이 호기 전체에서 찾기 (도번·품명·규격)"
            aria-label="자재 찾기"
          />
          {q.trim() && (
            <div className="pmat-found" role="listbox" aria-label="찾은 자재">
              {found.length === 0 ? (
                <p className="field-hint">찾는 자재가 없습니다</p>
              ) : (
                found.slice(0, 40).map((f) => (
                  <button
                    type="button"
                    key={`${f.box}:${f.row.id}`}
                    className="pmat-found-item"
                    onClick={() => goTo(f)}
                  >
                    <span className="pmat-found-box">{f.box}</span>
                    <span className="pmat-found-kind">
                      {f.kind === 'made' ? MADE : f.kind === 'free' ? '사급' : '도급'}
                    </span>
                    <span className="pmat-found-dn">{f.row.drawingNo}</span>
                    <span className="pmat-found-name">{f.row.name}</span>
                    <span className="pmat-found-spec">{f.row.spec}</span>
                  </button>
                ))
              )}
              {found.length > 40 && <p className="field-hint">외 {found.length - 40}줄 — 더 적어서 좁혀 주세요</p>}
            </div>
          )}
        </div>
        <ViewSwitch
          className="pmat-rowview"
          options={[
            { value: 'all', label: '전체' },
            { value: 'short', label: '부족' },
            { value: 'done', label: '완료' },
          ]}
          value={rowView}
          onChange={setRowView}
          ariaLabel="줄 보기"
        />
      </div>

      {/* 도급 / 사급 탭 + 진행 */}
      <div className="pmat-kinds no-print">
        <ViewSwitch
          options={[
            {
              value: 'paid',
              label: '도급',
              count: (
                <span className={summary.paid.done < summary.paid.total ? 'is-short' : ''}>
                  {summary.paid.done}/{summary.paid.total}
                </span>
              ),
            },
            {
              value: 'free',
              label: '사급',
              count: (
                <span className={summary.free.done < summary.free.total ? 'is-short' : ''}>
                  {summary.free.done}/{summary.free.total}
                </span>
              ),
            },
            // 판금은 도급·사급과 나란한 네 번째 구분 — 줄이 아직 없어도 늘 보인다
            // (2026-09-12 대표님 「여기도 도급 사급 옆에 판금 들어가야지」)
            {
              value: MADE,
              label: MADE,
              count: (
                <span className={summary.made.done < summary.made.total ? 'is-short' : ''}>
                  {summary.made.done}/{summary.made.total}
                </span>
              ),
            },
          ]}
          value={supplyTab}
          onChange={setSupplyTab}
          ariaLabel="도급 사급 구분"
        />
        {/* 안내는 잠겨 있을 때만 — 잠금을 풀면 그 자리를 「전부 비움·전부 들어옴」이 쓴다.
            둘을 함께 두면 줄이 하나 늘어 표가 그만큼 짧아졌다
            (2026-09-12 대표님 「잠금해제를하면 리스트가 다시작아짐」). */}
        {supplyTab === 'paid' && locked && (
          <span className="pmat-hint pmat-hint-paid">
            발주서를 입고하면 도급 재고에 쌓이고, 여기서 세트를 만들며 체크한 만큼 빠집니다
          </span>
        )}
        {/* 「전부 비움·전부 들어옴」은 없앴다 — 줄마다 «왜 없나 / 어떻게 채웠나»를 남기는 방향과
            어긋나고, 한 번에 밀면 사유가 통째로 비게 된다 (2026-09-15 대표님) */}
      </div>

      {shown.length === 0 ? (
        <p className="purchase-empty no-print">
          {rowView === 'short'
            ? '부족한 줄이 없습니다.'
            : rowView === 'done'
              ? '완료된 줄이 없습니다.'
              : `이 BOX 에 ${supplyTab === MADE ? MADE : supplyTab === 'free' ? '사급' : '도급'} 구성품이 없습니다.`}
        </p>
      ) : (
        <div className="table-scroll-x pmat-scroll no-print" ref={scrollRef}>
          <table className="table pmat-table no-fit">
            {/* 도급·사급 탭이 같은 폭이 되도록 열 폭을 고정한다. 규격은 남는 자리를 채워
                오른쪽에 빈 공간이 남지 않는다 (2026-09-05 대표님) */}
            <colgroup>
              {/* 코드 열은 뺐다 — 현장에서는 도번·품명으로 찾는다 (2026-09-08 대표님) */}
              {['44px', '11%', '13%', null, '6.5%', '6.5%', '10%', hasMeta ? '10%' : null, '8%', '124px']
                .filter((_, i) => hasMeta || i !== 7)
                .map((w, i) => (
                  <col key={i} style={w ? { width: w } : undefined} />
                ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="pmat-num">
                  필요 수량
                </th>
                <th scope="col" className="pmat-num">
                  입고 수량
                </th>
                <th scope="col">상태</th>
                {hasMeta && <th scope="col">기록</th>}
                <th scope="col">비고</th>
                {/* 제외/포함은 사급·도급, 배정 전후 가리지 않고 항상. 작업 열이라 맨 오른쪽·좁게
                    (2026-09-05 대표님 「폭을 줄이고 맨 우측으로」) */}
                <th scope="col" className="col-action pmat-act">
                  이 호기
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const got = receivedQty(rec, r.id);
                const outScope = !inScope(r); // 정방향 제외 — 회색, 셈 없음
                const skipped = isSkipped(rec, r.id);
                const short = skipped || outScope ? 0 : shortageOf(r.qty, got);
                const done = outScope || rowDone(r, rec);
                const meta = rec[r.id];
                // 「전체」— BOX 가 바뀌는 자리에 구분줄 (재고 표와 같은 모양)
                const newBox = allBoxes && (i === 0 || boxOf(shown[i - 1]) !== boxOf(r));
                const colCount = 9 + (hasMeta ? 1 : 0);
                return (
                  <Fragment key={r.id}>
                    {newBox && (
                      <tr className="fstock-boxrow">
                        <th scope="colgroup" colSpan={colCount}>
                          {boxOf(r)}
                          <em>{shown.filter((x) => boxOf(x) === boxOf(r)).length}품목</em>
                        </th>
                      </tr>
                    )}
                    <tr
                      data-row-id={r.id}
                      className={
                        outScope
                          ? 'is-scope-out'
                          : skipped
                            ? 'is-skipped'
                            : done
                              ? 'is-done'
                              : // 사유(미입고 말고)를 적었는데 아직 모자란 줄 — 줄 전체를 빨갛게
                                // (2026-09-15 대표님 「사유를 입력한 수량 부족은 1번처럼 … 1줄 전체에 칠해줘」)
                                (rec[r.id]?.log || []).some((l) => !(l.kind === 'why' && l.why === '미입고'))
                                ? 'is-flagged'
                                : short > 0 && got > 0
                                  ? 'is-partial'
                                  : ''
                      }
                    >
                      <td className="col-no">{i + 1}</td>
                      <td className="pmat-drawing">{r.drawingNo}</td>
                      {/* 긴 이름만 줄바꿈 — 코드·도번·기록은 한 줄로 (2026-09-05 대표님) */}
                      <td className="u-wrap">{r.name}</td>
                      <td className="pmat-spec u-wrap" title={r.spec}>
                        {r.spec}
                      </td>
                      <td className="pmat-num">{Number(r.qty) || 0}</td>
                      <td className="pmat-num">
                        {outScope ? (
                          <span className="pmat-locked-qty" title="정방향 호기에는 우리 손을 거치지 않는 자재">
                            —
                          </span>
                        ) : locked ? (
                          <span
                            className={`pmat-locked-qty pmat-got${
                              skipped
                                ? ' is-skip'
                                : rec[r.id]?.fromOurs > 0
                                  ? ' is-ours'
                                  : got >= (Number(r.qty) || 0)
                                    ? ' is-full'
                                    : got > 0
                                      ? ' is-partial'
                                      : ''
                            }`}
                            title={
                              (skipped ? '이 호기에서 제외' : `${got || 0} / ${Number(r.qty) || 0}`) +
                              (rec[r.id]?.fromOurs > 0 ? ` · 당사가 댄 몫 ${rec[r.id].fromOurs}개` : '') +
                              (meta?.at ? ` · ${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : '')
                            }
                          >
                            {got || 0}
                          </span>
                        ) : typing === r.id ? (
                          <input
                            className="num-input pmat-input"
                            onFocus={(e) => keepInView(e.currentTarget)}
                            type="number"
                            min="0"
                            inputMode="numeric"
                            autoFocus
                            value={draft[r.id] !== undefined ? draft[r.id] : got || ''}
                            placeholder="0"
                            onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                            onBlur={() => commit(r)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') setTyping(null);
                            }}
                            aria-label={`${r.name} 입고 수량`}
                          />
                        ) : (
                          <button
                            type="button"
                            className={`pmat-qty-btn${got > 0 ? ' is-filled' : ''}`}
                            onPointerDown={() => startPress(r)}
                            onPointerUp={() => endPress(r, got)}
                            onPointerLeave={cancelPress}
                            onPointerCancel={cancelPress}
                            onContextMenu={(e) => e.preventDefault()}
                            title={
                              got > 0
                                ? '누르면 0 으로 되돌립니다 · 길게 누르면 수량을 적습니다'
                                : `누르면 ${Number(r.qty) || 0}개(필요 수량)로 채웁니다 · 길게 누르면 수량을 적습니다`
                            }
                            aria-label={`${r.name} 입고 수량 ${got || 0}`}
                          >
                            {got || 0}
                          </button>
                        )}
                      </td>
                      {/* 「부족」 열도 없앴다 — 필요·입고 수량에서 바로 읽히고, 모자란 줄은 입고 수량이
                        주황·회색으로 보인다 (2026-09-15 대표님 「둘다」). 재고는 상태 칸으로 옮겼다 */}
                      <td className="pmat-state">
                        {got < (Number(r.qty) || 0) &&
                          (ledger(r) || stockOf(r) > 0) &&
                          (stockKindOf(r) === 'free' ? (
                            // 사급은 고객사 통·우리 통을 따로 (2026-09-15 대표님 「우리것과 고객사 사급재고표시를 따로」)
                            (() => {
                              const all = Math.max(0, Number(freeStock[r.itemId]?.qty) || 0);
                              const ours = Math.min(Math.max(0, Number(freeStock[r.itemId]?.ours) || 0), all);
                              return (
                                <span className={`pmat-instock${all <= 0 ? ' is-empty' : ''}`}>
                                  고객사 {all - ours} · 당사 {ours}
                                </span>
                              );
                            })()
                          ) : (
                            <span className={`pmat-instock${stockOf(r) <= 0 ? ' is-empty' : ''}`}>
                              재고 {stockOf(r)}
                            </span>
                          ))}
                        {/* 분실·파손 장부에 걸린 줄 — 「파손 1 · 수리 대기」 / 「207에 빌려줌 1」. 운용은
                          자재 허브의 「분실·파손」 탭에서 (2026-09-15 대표님 「글자만」) */}
                        {(() => {
                          const s = rowSummary(rec[r.id]?.log || [], shortOfId);
                          return s ? (
                            <span className="pmat-incident" title={`${s} — 자재 이력 탭에서 볼 수 있습니다`}>
                              {s}
                            </span>
                          ) : null;
                        })()}
                        {/* 옛 「분실·파손」 장부의 한 줄(「…에 빌려줌 1」)은 뺐다 — 지금은 자재 이력이
                          그 자리를 쓴다 (2026-09-16 대표님 「저 빌려줌 문구 삭제」) */}
                      </td>
                      {hasMeta && (
                        <td className="pmat-meta">
                          {meta?.at ? `${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : ''}
                          {/* 「재고에서 N」은 뺐다 — 이제 채우는 길이 재고뿐이라 늘 같은 말이 된다
                            (2026-09-15 대표님 「무조건 재고에서만 채울수있는데」) */}
                        </td>
                      )}
                      {/* 비고 — 호기·줄마다 한 줄 메모, 잠금을 풀어야 적는다 (2026-09-05 대표님) */}
                      <td className="pmat-note-cell">
                        <MemoInput
                          value={rec[r.id]?.note || ''}
                          readOnly={!editMode}
                          title={rec[r.id]?.note || (r.note ? `BOM 비고: ${r.note}` : '')}
                          ariaLabel={`${r.name} 비고`}
                          onFocus={(e) => keepInView(e.currentTarget)}
                          onCommit={(v) => saveNote(r, v)}
                        />
                      </td>
                      {
                        <td className="col-action pmat-act">
                          {/* 「입고」는 사연이 있는 줄에만 — 아직 손 안 댄 미입고 줄에 붙으면 평소 채우는 법
                            (수량 칸에 적기)과 겹쳐 헷갈린다 (2026-09-15 대표님 「배정 되기 전이라 미입고인것에
                            입고 버튼이 있으면 헷갈리지않을까?」). 「미입고」로만 적은 줄도 평범한 상태라 안 붙는다 */}
                          {!outScope &&
                            !skipped &&
                            got < (Number(r.qty) || 0) &&
                            (rec[r.id]?.log || []).some((l) => !(l.kind === 'why' && l.why === '미입고')) && (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary pmat-act-btn"
                                onClick={() => openLog(r, 'in', Math.max(1, (Number(r.qty) || 0) - got))}
                                title="어떻게 채웠는지 적고 수량을 올립니다"
                              >
                                입고
                              </button>
                            )}
                          {/* 사유를 아직 안 적은 줄은 「사유」, 적은 줄은 「입고」 옆에 「수정」 —
                            사유를 다시 적을 수 있게 (2026-09-16 대표님 「입고 버튼 옆에 수정 버튼」) */}
                          {!outScope && !skipped && got < (Number(r.qty) || 0) && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline pmat-act-btn"
                              onClick={() => openLog(r, 'why')}
                              title={
                                (rec[r.id]?.log || []).some((l) => !(l.kind === 'why' && l.why === '미입고'))
                                  ? '사유를 다시 적습니다 — 수량은 그대로, 옛 기록은 자재 이력에 남습니다'
                                  : '왜 모자란지만 적습니다 — 수량은 그대로'
                              }
                            >
                              {(rec[r.id]?.log || []).some((l) => !(l.kind === 'why' && l.why === '미입고'))
                                ? '수정'
                                : '사유'}
                            </button>
                          )}
                          {/* 「제외」는 없앴다 — 까닭 없이 줄을 셈에서 빼는 것이라 「왜 없나 / 어떻게 채웠나」를
                            남기는 방향과 어긋난다 (2026-09-15 대표님 「그냥 제외 시키는건 컨셉에 안맞으니」).
                            BOM 에 안 들어가는 자재는 BOM 의 「정방향 제외」나 타입으로 가른다.
                            이미 제외해 둔 줄에만 「포함」을 남겨 되돌릴 수 있게 한다. */}
                          {skipped && !outScope && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline pmat-act-btn"
                              onClick={() => toggleSkip(r, false)}
                              disabled={!editMode}
                              title={editMode ? '이 호기에서 다시 넣기' : '오른쪽 아래 「잠금」을 푼 뒤에'}
                            >
                              포함
                            </button>
                          )}
                        </td>
                      }
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 출력 — 종이로 대조하고 나중에 옮겨 적는 체크리스트 (대표님 「출력도 가능해야함」) ── */}
      <div className="print-form-iopn print-form-paged print-only">
        <div className="bom-print-page">
          <IopnDocBrand title={`${title} · ${box} 자재 체크`} titleClass="bom-list-title is-long" />
          <div className="bom-print-supplier-band">
            {link.projectName || ''}
            {link.variantLabel ? ` · ${link.variantLabel}` : ''} —{' '}
            {supplyTab === 'free' ? '사급 (고객사 제공)' : '도급'}
          </div>
          <table className="iopn-items-table pmat-print-table">
            <thead>
              <tr>
                <th scope="col" className="c-no">
                  NO
                </th>
                <th scope="col" className="c-name">
                  품목명
                </th>
                <th scope="col" className="c-drawing">
                  도번
                </th>
                <th scope="col" className="c-spec">
                  규격
                </th>
                <th scope="col" className="c-qty">
                  필요 수량
                </th>
                <th scope="col" className="c-qty">
                  입고 수량
                </th>
                <th scope="col" className="c-qty">
                  부족
                </th>
                <th scope="col" className="c-from">
                  확인
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const got = receivedQty(rec, r.id);
                return (
                  <tr key={r.id}>
                    <td className="c-no">{i + 1}</td>
                    <td className={`c-name ${specFontClass(r.name, 13)}`}>{r.name}</td>
                    <td className={`c-drawing ${specFontClass(r.drawingNo, 12)}`}>{r.drawingNo}</td>
                    <td className={`c-spec ${specFontClass(r.spec, 36)}`}>{r.spec}</td>
                    <td className="c-qty">{Number(r.qty) || 0}</td>
                    <td className="c-qty">{got || ''}</td>
                    <td className="c-qty">{shortageOf(r.qty, got) || ''}</td>
                    <td className="c-from"></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="bom-print-footer">
            <span>(주)아이오피엔 · 호기 자재 체크 · {docNo}</span>
            <span>출력 {stamp}</span>
            <span>페이지 1 / 1</span>
          </div>
        </div>
      </div>

      {/* 줄에서 한 일을 적는 창 — 왜 줄었나 / 어떻게 채웠나 / 왜 비어 있나 (2026-09-15 대표님) */}
      {logForm && (
        <Modal
          isOpen
          onClose={() => setLogForm(null)}
          title={logForm.kind === 'in' ? '어떻게 채웠나요' : logForm.kind === 'out' ? '왜 줄었나요' : '왜 모자란가요'}
        >
          <form onSubmit={submitLog}>
            <p className="field-hint" style={{ marginTop: 0 }}>
              <strong>{logForm.row.name || logForm.row.code}</strong>
              {logForm.row.spec ? ` · ${logForm.row.spec}` : ''} · {boxOf(logForm.row)}
            </p>
            <div className="form-group">
              <label>사유</label>
              <Select
                value={logForm.why}
                onChange={(v) => setLogForm((f) => ({ ...f, why: v, mate: needsMate(f.kind, v) ? f.mate : '' }))}
                options={whyList(logForm.kind).map((w) => ({ value: w, label: w }))}
                ariaLabel="사유"
                native
              />
            </div>
            {needsMate(logForm.kind, logForm.why) && (
              <div className="form-group">
                <label>
                  {logForm.kind === 'in' ? '어느 호기에서 가져왔나요' : '어느 호기가 가져갔나요'}
                  <span className="pmat-opt"> (고르지 않아도 됩니다)</span>
                </label>
                <Select
                  value={logForm.mate}
                  onChange={(v) => setLogForm((f) => ({ ...f, mate: v }))}
                  options={[{ value: '', label: '호기 아님 — 비고에 적기' }, ...mateList()]}
                  placeholder="호기 선택"
                  ariaLabel="상대 호기"
                  native
                />
                <p className="field-hint">
                  {logForm.kind === 'out'
                    ? '호기를 고르면 그 호기 줄이 그만큼 늘고 양쪽에 기록이 남습니다.'
                    : logForm.kind === 'in'
                      ? '호기를 고르면 그 호기 줄이 그만큼 줄어(0 밑이면 빚) 부족 집계에 뜹니다.'
                      : '수량은 그대로 두고 양쪽에 기록만 남깁니다.'}{' '}
                  고객사처럼 호기가 아닌 곳이면 고르지 말고 비고에 적어 주세요.
                </p>
              </div>
            )}
            {logForm.kind !== 'why' && (
              <div className="form-group">
                <label>개수</label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={logForm.n}
                  onChange={(e) => setLogForm((f) => ({ ...f, n: e.target.value.replace(/[^0-9]/g, '') }))}
                  aria-label="개수"
                />
              </div>
            )}
            <div className="form-group">
              <label>비고</label>
              <input
                type="text"
                value={logForm.note}
                onChange={(e) => setLogForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="예) 커넥터 깨짐"
                aria-label="비고"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setLogForm(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={logSaving}>
                {logSaving ? '저장 중…' : '저장'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
