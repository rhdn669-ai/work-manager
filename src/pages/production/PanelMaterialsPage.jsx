import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import ViewSwitch from '../../components/common/ViewSwitch';
import ReceiptChip from '../../components/common/ReceiptChip';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { subscribePanels, updatePanel } from '../../services/productionService';
import { getBomProjectById, getBomBySite, bomItemsForVariant, isFreeIssue } from '../../services/bomService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribePanelMaterials, setReceived, setSkipped } from '../../services/panelMaterialsService';
import {
  pullRowFromStock,
  unassignPaidSet,
  topUpPaidSet,
  subscribeReceivedFor,
  subscribePaidSetSettings,
} from '../../services/paidSetService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { consumedByItem } from '../../domain/paidSets';
import { CHECKABLE_BOXES, hasBomLink, bomRowsForBox } from '../../domain/panelBom';
import { receivedQty, shortageOf, rowDone, boxKindComplete, boxSummary, isSkipped } from '../../domain/panelMaterials';
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
  const [master, setMaster] = useState([]);
  const [received, setReceivedMap] = useState({}); // { [box]: { [bomItemId]: {qty,at,by} } }
  const [supplyTab, setSupplyTab] = useState('paid'); // 'paid' | 'free'
  const [draft, setDraft] = useState({}); // 입력 중인 개수 { [bomItemId]: '3' }

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
      })
      .catch(() => {
        if (alive) toast('BOM 을 불러오지 못했습니다', 'error');
      });
    return () => {
      alive = false;
    };
  }, [link?.projectId, toast]);

  // ── 품목 마스터 (코드·품명·규격·도번은 여기서 읽는다) ──
  useEffect(() => subscribePurchaseItems(setMaster), []);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // ── 이 호기의 입고 기록 ──
  useEffect(() => subscribePanelMaterials(panelId, setReceivedMap), [panelId]);

  // ── BOX ──
  const boxesWithRows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    return CHECKABLE_BOXES.filter((b) => bomRowsForBox(forVariant, b).length > 0);
  }, [bomRows, link?.variantKey]);
  const box = sp.get('box') || boxesWithRows[0] || CHECKABLE_BOXES[0];
  // 주소의 다른 값(고른 호기·탭)은 그대로 두고 box 만 바꾼다 —
  // 예전엔 통째로 갈아 끼워 BOX 를 누르면 첫 호기로 튀었다 (2026-09-05 대표님)
  const setBox = (b) => {
    const q = new URLSearchParams(sp);
    q.set('box', b);
    setSp(q, { replace: true });
  };

  // ── 이 BOX 의 구성품 (타입 → BOX 순으로 거른다) ──
  const rows = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    return bomRowsForBox(forVariant, box).map((r) => {
      const m = r.itemId ? masterMap[r.itemId] : null;
      return {
        ...r,
        code: m?.code || r.code || '',
        name: m?.name || r.name || '',
        spec: m?.spec || r.spec || '',
        drawingNo: m?.drawingNo || r.drawingNo || '',
      };
    });
  }, [bomRows, link?.variantKey, box, masterMap]);
  const rec = received[box] || {};
  // 세트를 배정한 호기의 도급 수량은 세트가 정한다 — 손으로 못 고친다 (2026-09-03 대표님
  // 「도급 세트 배정하면 이 페이지는 수동으로 입력하는 게 안 되어야」). 사급은 그대로 손 체크.
  // 도급은 «항상» 읽기 전용 — 우리가 사서 넣는 자재라 「도급 세트」 배정으로만 채운다
  // (2026-09-03 대표님 「도급은 발주서에 체크하는 방식 … 개별로 체크하게 되어 있는데?」). 사급만 손 체크.
  const locked = supplyTab === 'paid';
  const assigned = !!panel?.paidSet;
  // BOX 마다 이 탭(도급/사급)의 부족 줄 수 — 탭 오른쪽 배지로 보여 어느 BOX 가 모자란지 한눈에
  // (2026-09-05 대표님 「부족 떠있는 위치 확인이 안 되니 박스 우측에 부족 수량」)
  const shortByBox = useMemo(() => {
    const forVariant = bomItemsForVariant(bomRows, link?.variantKey || '');
    const out = {};
    for (const b of CHECKABLE_BOXES) {
      const list = bomRowsForBox(forVariant, b).filter((r) =>
        supplyTab === 'free' ? isFreeIssue(r) : !isFreeIssue(r),
      );
      const got = received[b] || {};
      out[b] = list.filter((r) => !isSkipped(got, r.id) && shortageOf(r.qty, receivedQty(got, r.id)) > 0).length;
    }
    return out;
  }, [bomRows, link?.variantKey, received, supplyTab]);

  // 완료 / 부족만 보기 (2026-09-05 대표님 「완료 부족 토글」)
  const [rowView, setRowView] = useState('all'); // 'all' | 'short' | 'done'
  const shown = rows
    .filter((r) => (supplyTab === 'free' ? isFreeIssue(r) : !isFreeIssue(r)))
    .filter((r) => {
      if (rowView === 'all') return true;
      const done = rowDone(r, rec);
      return rowView === 'done' ? done : !done;
    });
  const summary = useMemo(() => boxSummary(rows, rec), [rows, rec]);

  // ── ④ 연동: 이 BOX 의 도급/사급이 전부 차면 생산현황 자재 칸을 켠다, 하나라도 빠지면 끈다 ──
  useEffect(() => {
    if (!panel || rows.length === 0) return;
    // 기록이 하나도 없는 BOX 는 건드리지 않는다 — BOM 만 연결하고 페이지를 연 것만으로
    // 손으로 켜 둔 자재 칸이 「0개 입고」로 꺼지던 문제 (2026-09-03 대표님 「자재 칸 보호」)
    if (Object.keys(rec).length === 0) return;
    const cur = (panel.박스입고 || {})[box] || {};
    const nextPaid = boxKindComplete(rows, rec, 'paid');
    const nextFree = boxKindComplete(rows, rec, 'free');
    if (!!cur.자재_도급 === nextPaid && !!cur.자재_사급 === nextFree) return; // 그대로면 쓰지 않는다
    const today = new Date().toISOString().slice(0, 10);
    const curDate = (panel.박스입고일자 || {})[box] || {};
    updatePanel(panel.id, {
      박스입고: { ...(panel.박스입고 || {}), [box]: { ...cur, 자재_도급: nextPaid, 자재_사급: nextFree } },
      박스입고일자: {
        ...(panel.박스입고일자 || {}),
        [box]: {
          ...curDate,
          자재_도급: nextPaid ? curDate.자재_도급 || today : '',
          자재_사급: nextFree ? curDate.자재_사급 || today : '',
        },
      },
    }).catch(() => toast('자재 칸 갱신에 실패했습니다', 'error'));
  }, [panel, rows, rec, box, toast]);

  // ── 개수 저장 ──
  const commit = async (r) => {
    const raw = draft[r.id];
    if (raw === undefined) return;
    const n = Math.max(0, Number(raw) || 0);
    setDraft((d) => {
      const nd = { ...d };
      delete nd[r.id];
      return nd;
    });
    if (n === receivedQty(rec, r.id)) return;
    try {
      await setReceived(panelId, box, r.id, n, userProfile?.name || '');
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };
  // 이 탭의 줄을 한 번에 — 통째로 들어온 날은 BOM 수량대로, 잘못 채웠을 땐 0 으로
  const fillAllTo = async (toBom) => {
    if (
      !toBom &&
      !(await confirm(
        `${supplyTab === 'free' ? '사급' : '도급'} ${shown.length}건의 들어온 개수를 모두 0 으로 되돌리시겠습니까?`,
      ))
    )
      return;
    try {
      await Promise.all(
        shown.map((r) => setReceived(panelId, box, r.id, toBom ? Number(r.qty) || 0 : 0, userProfile?.name || '')),
      );
      toast(
        toBom ? `${shown.length}건을 BOM 수량대로 채웠습니다` : `${shown.length}건을 0 으로 되돌렸습니다`,
        'success',
      );
    } catch {
      toast('저장 중 오류가 발생했습니다', 'error');
    }
  };
  // 이 호기에서만 줄을 일시 제외/복귀 — 기본 BOM 은 그대로 (세트 배정 호기의 도급 탭에서)
  const title = `${panel?.프로젝트 || ''}${panel?.호기 ? ` ${panel.호기}` : ''}`.trim() || '호기';
  const toggleSkip = async (r, on) => {
    try {
      await setSkipped(panelId, box, r.id, on, userProfile?.name || '');
    } catch {
      toast('저장에 실패했습니다', 'error');
    }
  };
  // 부족한 도급 줄을 창고 재고에서 (2026-09-05 대표님 「부족한 거 재고에서 땡겨오는 버튼 없나」)
  const stockOf = (r) => {
    const m = r.itemId ? masterMap[r.itemId] : null;
    return m && m.stockQty !== undefined && m.stockQty !== null ? Math.max(0, Number(m.stockQty) || 0) : 0;
  };
  const pullStock = async (r, have, short) => {
    const n = Math.min(short, stockOf(r));
    if (n <= 0) return;
    try {
      await pullRowFromStock(panel, r, { box, have, n, by: userProfile?.name || '' });
      toast(`${r.code || r.name} ${n}개를 창고 재고에서 가져왔습니다 (재고 ${stockOf(r) - n} 남음)`, 'success', 0);
    } catch (err) {
      console.error(err);
      toast('재고에서 가져오기에 실패했습니다', 'error', 0);
    }
  };
  // 도급 배정 탭을 없애며 옮겨 온 것 — 배정 취소 · 부족분 전부 재고에서 (2026-09-05 대표님)
  const stockByItem = useMemo(() => {
    const out = {};
    for (const r of bomRows) if (r.itemId && stockOf(r) > 0) out[r.itemId] = stockOf(r);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomRows, masterMap]);
  const variantRows = useMemo(() => bomItemsForVariant(bomRows, link?.variantKey || ''), [bomRows, link?.variantKey]);
  // 발주 여유 = 이 BOM 으로 들어온 입고 − 배정 호기들이 가져간 양 (부족 집계와 같은 셈)
  const [settings, setSettings] = useState({});
  useEffect(() => subscribePaidSetSettings(setSettings), []);
  const siteId = settings?.[panel?.회사 || '']?.siteId || '';
  const [receivedByItem, setReceivedByItem] = useState({});
  useEffect(() => {
    if (!link?.projectId) return undefined;
    return subscribeReceivedFor({ bomProjectId: link.projectId, siteId }, (byItem) => setReceivedByItem(byItem));
  }, [link?.projectId, siteId]);
  const [allMaterials, setAllMaterials] = useState({});
  const [allPanels, setAllPanels] = useState([]);
  useEffect(() => subscribeAllMaterials(setAllMaterials), []);
  useEffect(() => subscribePanels(setAllPanels), []);
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
  const canFillAll = useMemo(
    () => Object.values(spareByItem).some((v) => v > 0) || Object.keys(stockByItem).length > 0,
    [spareByItem, stockByItem],
  );
  const pullAllStock = async () => {
    try {
      const r = await topUpPaidSet(panel, variantRows, { by: userProfile?.name || '', spareByItem, stockByItem });
      const n = Object.values(r.stockUsed || {}).reduce((a, b) => a + b, 0);
      if (r.added === 0) toast('발주 여유도 창고 재고도 없어 채울 줄이 없습니다', 'error');
      else
        toast(
          `${r.added}줄을 채웠습니다${n > 0 ? ` (재고에서 ${n}개)` : ''}${r.short > 0 ? ` — 아직 ${r.short}줄 부족` : ''}`,
          'success',
          0,
        );
    } catch (err) {
      console.error(err);
      toast('재고에서 채우기에 실패했습니다', 'error', 0);
    }
  };
  const unassign = async () => {
    if (!(await confirm(`${title} 의 도급 배정을 취소하시겠습니까? 도급 줄 수량이 0 이 되고 자재 도급 칸이 꺼집니다.`)))
      return;
    try {
      await unassignPaidSet(panel, variantRows, { by: userProfile?.name || '' });
      toast('도급 배정을 취소했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('취소에 실패했습니다', 'error', 0);
    }
  };
  const fillAll = () => fillAllTo(true);
  const clearAll = () => fillAllTo(false);

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
          <h2 className="page-title pmat-title">
            {title} <span className="pmat-title-sub">· {box} 자재 체크</span>
          </h2>
          <div className="pmat-link">
            BOM <strong>{link.projectName || project?.name || ''}</strong>
            {link.variantLabel ? (
              <span className="pmat-variant">{link.variantLabel}</span>
            ) : (
              <span className="pmat-variant is-common">공통</span>
            )}
          </div>
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
          options={(boxesWithRows.length ? boxesWithRows : CHECKABLE_BOXES).map((b) => ({
            value: b,
            label: b,
            count: shortByBox[b] > 0 ? shortByBox[b] : ' ',
          }))}
          value={box}
          onChange={setBox}
          ariaLabel="BOX"
          className="pmat-box-switch"
        />
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
            { value: 'paid', label: '도급', count: `${summary.paid.done}/${summary.paid.total}` },
            { value: 'free', label: '사급', count: `${summary.free.done}/${summary.free.total}` },
          ]}
          value={supplyTab}
          onChange={setSupplyTab}
          ariaLabel="도급 사급 구분"
        />
        {locked && assigned ? (
          <span className="pmat-assigned-row">
            <span
              className="status-badge status-badge--done pmat-locked-badge"
              title="발주 입고분이 이 호기에 들어온 상태"
            >
              <Icon name="lock" />
              도급 배정 · {panel.paidSet.at}
              {panel.paidSet.by ? ` · ${panel.paidSet.by}` : ''}
            </span>
            {summary.paid.done < summary.paid.total && canFillAll && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={pullAllStock}
                title="모자란 줄 전부를 발주 여유 → 창고 재고 순으로 (있는 만큼만)"
              >
                부족분 채우기
              </button>
            )}
            <button type="button" className="btn btn-sm btn-outline" onClick={unassign}>
              배정 취소
            </button>
          </span>
        ) : locked ? (
          <span className="pmat-hint pmat-hint-paid">
            <Icon name="lock" />
            도급 자재는 손으로 적지 않습니다 — 발주 상세 「생산 호기」에 이 호기를 걸어 두면 입고 때 자동으로 채워집니다
          </span>
        ) : (
          <span className="pmat-hint">들어온 개수를 적으면 BOM 수량에 닿을 때 저절로 체크됩니다</span>
        )}
        {shown.length > 0 && !locked && (
          <span className="pmat-fill">
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={clearAll}
              title="이 탭의 들어온 개수를 전부 0 으로"
            >
              전부 비움
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={fillAll}
              title="이 탭의 줄을 전부 BOM 수량대로"
            >
              전부 들어옴
            </button>
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="purchase-empty no-print">
          {rowView === 'short'
            ? '부족한 줄이 없습니다.'
            : rowView === 'done'
              ? '완료된 줄이 없습니다.'
              : `이 BOX 에 ${supplyTab === 'free' ? '사급' : '도급'} 구성품이 없습니다.`}
        </p>
      ) : (
        <div className="table-scroll-x no-print">
          <table className="table pmat-table no-fit">
            {/* 도급·사급 탭이 같은 폭이 되도록 열 폭을 고정한다. 규격은 남는 자리를 채워
                오른쪽에 빈 공간이 남지 않는다 (2026-09-05 대표님) */}
            <colgroup>
              {['4%', '10%', '10%', '11%', null, '7%', '8%', '5%', '8%', '8%', '12%'].map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">코드</th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="pmat-num">
                  BOM 수량
                </th>
                <th scope="col" className="pmat-num">
                  들어온 개수
                </th>
                <th scope="col" className="pmat-num">
                  부족
                </th>
                <th scope="col" className="pmat-ok">
                  입고
                </th>
                {/* 제외/포함은 사급·도급, 배정 전후 가리지 않고 항상 (2026-09-05 안 B 6단계) */}
                <th scope="col" className="col-action">
                  이 호기
                </th>
                <th scope="col">기록</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const got = receivedQty(rec, r.id);
                const skipped = isSkipped(rec, r.id);
                const short = skipped ? 0 : shortageOf(r.qty, got);
                const done = rowDone(r, rec);
                const meta = rec[r.id];
                return (
                  <tr
                    key={r.id}
                    className={skipped ? 'is-skipped' : done ? 'is-done' : short > 0 && got > 0 ? 'is-partial' : ''}
                  >
                    <td className="col-no">{i + 1}</td>
                    <td className="pmat-code">{r.code}</td>
                    <td>{r.drawingNo}</td>
                    {/* 긴 이름만 줄바꿈 — 코드·도번·기록은 한 줄로 (2026-09-05 대표님) */}
                    <td className="u-wrap">{r.name}</td>
                    <td className="pmat-spec u-wrap" title={r.spec}>
                      {r.spec}
                    </td>
                    <td className="pmat-num">{Number(r.qty) || 0}</td>
                    <td className="pmat-num">
                      {locked ? (
                        <span className="pmat-locked-qty" title="세트 배정 — 도급 배정 화면에서만 바뀝니다">
                          {got || 0}
                        </span>
                      ) : (
                        <input
                          className="num-input pmat-input"
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={draft[r.id] !== undefined ? draft[r.id] : got || ''}
                          placeholder="0"
                          onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                          onBlur={() => commit(r)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                          aria-label={`${r.name} 들어온 개수`}
                        />
                      )}
                    </td>
                    <td className={`pmat-num${short > 0 ? ' is-short' : ''}`}>{short > 0 ? short : ''}</td>
                    {/* 입고 상태는 앱 공통 칩 하나로 (2026-09-05 대표님) */}
                    <td className="pmat-ok">
                      <ReceiptChip
                        got={got}
                        need={Number(r.qty) || 0}
                        skip={skipped}
                        title={meta?.at ? `${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : ''}
                      />
                    </td>
                    {
                      <td className="col-action">
                        {supplyTab === 'paid' && short > 0 && stockOf(r) > 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => pullStock(r, got, short)}
                            title={`창고 재고 ${stockOf(r)}개 중 ${Math.min(short, stockOf(r))}개를 이 호기로`}
                          >
                            재고에서 {Math.min(short, stockOf(r))}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => toggleSkip(r, !skipped)}
                          title={skipped ? '이 호기에서 다시 넣기' : '이 호기에서만 빼기 — 기본 BOM 은 그대로'}
                        >
                          {skipped ? '포함' : '제외'}
                        </button>
                      </td>
                    }
                    <td className="pmat-meta">{meta?.at ? `${meta.at}${meta.by ? ` · ${meta.by}` : ''}` : ''}</td>
                  </tr>
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
                  BOM
                </th>
                <th scope="col" className="c-qty">
                  입고
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
    </div>
  );
}
