import { Fragment, useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import MemoInput from '../../components/common/MemoInput';
import { useFillHeight } from '../../utils/useFillHeight';
import { withRunning } from '../../domain/stockRunning';
import { useArrived } from '../../utils/useArrived';
import Modal from '../../components/common/Modal';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useAuth } from '../../contexts/useAuth';
import { useEditLock } from '../../contexts/useEditLock';
import { useDialog } from '../../components/common/useDialog';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getBomBySite } from '../../services/bomService';
import { subscribeReceivedFor, subscribePaidSetSettings, enableStockLedger } from '../../services/paidSetService';
import { CHECKABLE_BOXES, bomRowsForBox, hasBomLink, rowsForPanel } from '../../domain/panelBom';
import { inKindTab } from '../../domain/itemKind';
import { STOCK_COLS } from '../../domain/tableWidths';
import { receivedQty } from '../../domain/panelMaterials';
import { outTally, tallyOut, outSetsOf, outSetsLabel } from '../../domain/outSets';
import { subscribePaidStock, receivePaidStock, setPaidStockTo } from '../../services/paidStockService';
import { setStockTo, setStockMemo } from '../../services/stockService';
import { ledgerOn } from '../../domain/stockLedger';

// 도급 재고 — 「우리가 사서 들어온 것 중 아직 어느 호기에도 안 간 양」.
//
// 사급은 통(사급 재고)이 눈에 보이는데 도급은 그렇지 않았다. 발주서 입고량에서 이미
// 배정된 양을 뺀 값이라 계산으로만 있었고, 「지금 몇 대분 되나」를 알려면 도급 배정
// 화면을 열어 봐야 했다 (2026-09-11 대표님 「도급 통은 발주서 입고로 체크하고
// 사급은 사급재고가 통이 되는거맞음?」).
//
// 사급 재고 화면과 같은 표로 보여 준다 — 두 통이 같은 모양이라야 헷갈리지 않는다.
//   들어옴   이 BOM 으로 묶인 발주서들의 입고 수량 합 + 손으로 적어 넣은 몫
//   나감     호기들에 이미 들어간 양 (끝난 호기까지)
//   남음     들어옴 − 나감 — 실물을 세어 바로 고칠 수 있다 (2026-09-12 대표님)
//   1대당    호기 하나가 쓰는 개수 (BOX 합)
//   가능 SET 남음 ÷ 1대당 (버림)
const won = (n) => (Number(n) || 0).toLocaleString();

// 기록에 적히는 말 — 사급 재고와 같은 말을 쓴다
// po-in·po-cancel 은 발주서 입고 체크가 남긴 자국 — 굳히기 전에는 기록만이라 「(기록만)」을 붙인다
const LOG_LABEL = {
  in: '들어옴',
  out: '호기로',
  back: '되돌림',
  fix: '손으로 맞춤',
  'po-in': '발주 입고',
  'po-cancel': '발주 입고 취소',
};
const logLabel = (l) =>
  `${LOG_LABEL[l.kind] || l.kind || ''}${l.kind?.startsWith('po-') && !l.applied ? ' (기록만)' : ''}`;
const whenMs = (v) => {
  if (!v) return 0;
  const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
};
const fmtWhen = (v) => {
  const ms = whenMs(v);
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// kind: 'paid'(도급) | 'made'(판금) — 셈은 같고 어느 갈래 줄을 세느냐만 다르다 (2026-09-12 대표님)
const ALL_BOX = '전체';

export default function PaidStockPage({ company = '', kind = 'paid' }) {
  const { userProfile, isAdmin } = useAuth();
  const { toast, confirm } = useDialog();
  const me = userProfile?.name || '';

  const [panels, setPanels] = useState([]);
  const [materials, setMaterials] = useState({});
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({});
  const [received, setReceived] = useState({}); // { itemId: 들어온 합 }
  const [settings, setSettings] = useState({});
  const [manual, setManual] = useState({}); // 손으로 적어 넣은 몫 { itemId: { qty, log } }
  const [draft, setDraft] = useState({}); // 「이번 입고」 칸에 적는 중인 글자
  const [saving, setSaving] = useState('');
  const [fixing, setFixing] = useState(null); // { row, to }
  const [logOf, setLogOf] = useState(null); // 기록을 펼쳐 볼 줄
  // 표 상자를 화면 아래까지 늘려 «상자 안에서» 세로로 스크롤하게 한다 — 그래야 머리줄이
  // 위에 붙는다 (2026-09-12 대표님 「위에 줄은 스크롤해도 고정으로 내려가게」).
  const scrollRef = useFillHeight();
  const [q, setQ] = useState('');
  // 어느 BOX 를 볼지 — 품목이 여러 BOX 에 걸쳐 있어 한 통씩 세려면 갈라 봐야 한다
  // (2026-09-16 대표님 「사도급 재고에도 필터 걸어주고」)
  const [boxTab, setBoxTab] = useState(ALL_BOX);

  const { take, has } = useArrived(); // 어느 구독이 첫 값을 줬는지
  useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
  useEffect(() => subscribeAllMaterials(take('materials', setMaterials)), [take]);
  useEffect(() => subscribePurchaseItems(take('master', setMaster)), [take]);
  useEffect(() => subscribePaidSetSettings(take('settings', setSettings)), [take]);
  useEffect(() => (company ? subscribePaidStock(company, take('manual', setManual)) : undefined), [company, take]);

  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // 이 회사 호기 중 BOM 을 연결한 것 «전부» — 끝난 호기도 넣는다.
  // 나간 자재는 호기가 출고됐다고 통으로 돌아오지 않는다. 끝난 호기를 빼고 세면
  // 이미 나간 몫이 그대로 「남아 있는 것」으로 둔갑한다
  // (2026-09-12 대표님 「13세트중 6세트만 나갔다고 되어있는데 뭐지」 — 출고한 6대분이 빠져 있었다).
  const all = useMemo(() => panels.filter((p) => (!p.회사 || p.회사 === company) && hasBomLink(p)), [panels, company]);

  // 표에 어떤 품목을 보일지는 «지금 일하는» 호기의 BOM 으로 정한다 — 끝난 호기의 옛 품목까지
  // 늘어놓을 까닭이 없다. 나간 양만 위의 전부를 센다.
  const mine = useMemo(
    () => all.filter((p) => p.overallStatus !== '출고완료' && p.overallStatus !== '출고숨김'),
    [all],
  );

  const projectId = mine[0]?.bomLink?.projectId || all[0]?.bomLink?.projectId || '';

  // 들어온 양 — BOM 으로 묶인 발주서 + (옛 방식) 설정된 현장의 발주서.
  // 볼 곳이 없으면 구독만 걸지 않는다 — 그릴 때 상태를 건드리면 화면을 두 번 그린다.
  const siteId = settings?.[company]?.siteId || '';
  useEffect(() => {
    if (!projectId && !siteId) return undefined;
    return subscribeReceivedFor(
      { bomProjectId: projectId, siteId },
      take('received', (byItem) => setReceived(byItem || {})),
    );
  }, [projectId, siteId, take]);

  // BOM 은 프로젝트마다 한 번만 읽는다
  useEffect(() => {
    const ids = [...new Set(all.map((p) => p.bomLink.projectId))].filter((id) => !(id in bomByProject));
    if (ids.length === 0) return undefined;
    let alive = true;
    Promise.all(ids.map((id) => getBomBySite(id).then((rows) => [id, rows || []])))
      .then((pairs) => {
        if (alive) setBomByProject((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [all, bomByProject]);

  const { groups, allRows } = useMemo(() => {
    const perOneAll = new Map(); // 호기 한 대가 쓰는 총량 — 「가능 SET」은 늘 이걸로 센다
    const goneAll = new Map(); // 호기들에 들어간 총량
    const started = new Set(); // 이 갈래 자재를 하나라도 가져간 호기 — 「N SET」의 N
    const info = new Map();
    const byBox = new Map(); // box → { perOne: Map, gone: Map, out: 나감 SET 집계 }
    const pick = (bx) => {
      if (!byBox.has(bx)) byBox.set(bx, { perOne: new Map(), gone: new Map(), out: outTally() });
      return byBox.get(bx);
    };

    // 나간 양 — 끝난 호기까지 «모든» 호기가 실제로 가져간 만큼
    for (const p of all) {
      const rows0 = bomByProject[p.bomLink.projectId];
      if (!rows0) continue;
      const forVariant = rowsForPanel(rows0, p);
      for (const bx of CHECKABLE_BOXES) {
        const list = bomRowsForBox(forVariant, bx).filter((r) => inKindTab(r, kind));
        if (list.length === 0) continue;
        const rec = (materials[p.id] || {})[bx] || {};
        const { gone: g, out: o } = pick(bx);
        for (const r of list) {
          if (!r.itemId) continue;
          const got = receivedQty(rec, r.id);
          goneAll.set(r.itemId, (goneAll.get(r.itemId) || 0) + got);
          g.set(r.itemId, (g.get(r.itemId) || 0) + got);
          if (got > 0) started.add(p.id);
          tallyOut(o, r.itemId, p.id, got, Number(r.qty) || 0, !!rec[r.id]?.skip);
        }
      }
    }

    // 1대당·품목 정보 — 지금 일하는 호기 기준. 호기마다 다르면 가장 큰 값을 쓴다.
    for (const p of mine) {
      const rows0 = bomByProject[p.bomLink.projectId];
      if (!rows0) continue;
      const forVariant = rowsForPanel(rows0, p);
      const one = new Map();
      const oneBox = new Map(); // box → Map(itemId → 개수)
      for (const bx of CHECKABLE_BOXES) {
        const list = bomRowsForBox(forVariant, bx).filter((r) => inKindTab(r, kind));
        if (list.length === 0) continue;
        if (!oneBox.has(bx)) oneBox.set(bx, new Map());
        const ob = oneBox.get(bx);
        for (const r of list) {
          if (!r.itemId) continue;
          const q0 = Number(r.qty) || 0;
          one.set(r.itemId, (one.get(r.itemId) || 0) + q0);
          ob.set(r.itemId, (ob.get(r.itemId) || 0) + q0);
          if (!info.has(r.itemId)) {
            const m = masterMap[r.itemId];
            info.set(r.itemId, {
              itemId: r.itemId,
              code: m?.code || r.code || '',
              name: m?.name || r.name || '',
              spec: m?.spec || r.spec || '',
              drawingNo: m?.drawingNo || r.drawingNo || '',
              // 재고에 얼마가 묶여 있는지 보려면 단가가 있어야 한다 (2026-09-12 대표님 「금액도」)
              unitPrice: Number(m?.unitPrice) || Number(m?.standardPrice) || 0,
            });
          }
        }
      }
      for (const [k, v] of one) perOneAll.set(k, Math.max(perOneAll.get(k) || 0, v));
      for (const [bx, m0] of oneBox) {
        const dst = pick(bx).perOne;
        for (const [itemId, v] of m0) dst.set(itemId, Math.max(dst.get(itemId) || 0, v));
      }
    }

    // 품목마다의 재고·가능 SET — BOX 와 무관하게 하나다
    // 통이 실값이면(굳힌 뒤) 남음 = 통 값. 아니면 예전 셈 — 발주 입고 + 손조정 − 나감.
    // (2026-09-15 설계 「재고를 통 실값 하나로」; 대표님 「도급재고 전체 0개로 해줘 실수량 다시 세어보고 넣게」
    //  — 굳히기 대신 0 에서 새로 시작한다)
    const ledger = ledgerOn(settings, company, kind);
    const stockOfItem = new Map();
    for (const it of info.values()) {
      const fromPo = !ledger && (projectId || siteId) ? Math.max(0, Number(received[it.itemId]) || 0) : 0;
      const out0 = ledger ? 0 : Math.max(0, goneAll.get(it.itemId) || 0);
      const base = fromPo - out0;
      const adjust = Number(manual[it.itemId]?.qty) || 0;
      // 0 에서 자르지 않는다 — 들어온 것보다 많이 나갔으면 그 «모자란 만큼»이 진짜 숫자다.
      // 0 으로 올려 두면 「없는데 있다」로 읽혀 발주할 양을 못 잡는다
      // (2026-09-14 대표님 「도급 음수는?」). 통이 실값이면 base 가 0 이라 left = 통 값.
      const left = base + adjust;
      const one = perOneAll.get(it.itemId) || 0;
      stockOfItem.set(it.itemId, {
        ...it,
        gotIn: fromPo,
        base,
        adjust,
        left,
        log: manual[it.itemId]?.log || [],
        memo: manual[it.itemId]?.memo || '',
        amount: Math.max(0, left) * (Number(it.unitPrice) || 0), // 남은 것의 값어치
        perOneAll: one,
        // 「가능 SET」은 호기 한 대 기준으로 고정한다. BOX 몫으로 나누면 같은 재고인데
        // BOX 마다 다른 SET 이 나와 헷갈린다 (2026-09-12 대표님 「나누니 셋트 숫자가 이상해지네」).
        sets: one > 0 ? Math.max(0, Math.floor(left / one)) : 0,
      });
    }

    const kw = q.trim().toLowerCase();
    const keep = (r) => {
      // 「남은 것」 거르기는 없앴다 — 통이 비어 있어도 목록은 전부 보여야 한다 (2026-09-15 대표님)
      if (!kw) return true;
      return [r.code, r.name, r.spec, r.drawingNo].some((v) =>
        String(v || '')
          .toLowerCase()
          .includes(kw),
      );
    };
    const byDrawing = (x, y) =>
      (x.drawingNo || '힣').localeCompare(y.drawingNo || '힣', 'ko') ||
      (x.name || '').localeCompare(y.name || '', 'ko');

    const out = [];
    for (const bx of CHECKABLE_BOXES) {
      const b = byBox.get(bx);
      if (!b) continue;
      const list = [...b.perOne.keys()]
        .map((itemId) => {
          const base = stockOfItem.get(itemId);
          return base
            ? {
                ...base,
                perOne: b.perOne.get(itemId) || 0,
                out: b.gone.get(itemId) || 0,
                outSets: outSetsOf(b.out, itemId, started), // { sets, full, short }
              }
            : null;
        })
        .filter(Boolean)
        .filter(keep)
        .sort(byDrawing);
      if (list.length > 0) out.push({ box: bx, rows: list });
    }
    return { groups: out, allRows: [...stockOfItem.values()] };
  }, [all, mine, bomByProject, materials, masterMap, received, manual, projectId, siteId, q, kind, settings, company]);

  // 칸에 적은 수를 그대로 통에 더한다 — 사급 재고와 같은 방식
  async function commitDraft(r) {
    const raw = draft[r.itemId];
    if (raw === undefined) return;
    setDraft((d) => {
      const nd = { ...d };
      delete nd[r.itemId];
      return nd;
    });
    const n = Math.max(0, Number(raw) || 0);
    if (n <= 0) return;
    setSaving(r.itemId);
    try {
      await receivePaidStock(company, r, n, { by: me });
      toast(`${r.name || r.code} ${n}개 넣었습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('저장에 실패했습니다', 'error');
    } finally {
      setSaving('');
    }
  }

  async function onFix(e) {
    e.preventDefault();
    const { row, to } = fixing;
    const t = Number(to) || 0;
    if (t === row.left) return setFixing(null);
    if (!(await confirm(`${row.name || row.code} 재고를 ${won(row.left)} → ${won(t)} 으로 수정할까요?`))) return;
    try {
      // 통이 실값이면 그 값으로 바로, 아니면 조정치를 셈해서 (굳히기 전)
      if (ledgerOn(settings, company, kind))
        await setStockTo(kind, company, row, t, { by: me, reason: '실물 세어 맞춤' });
      else await setPaidStockTo(company, row, t, { base: row.base, by: me });
      setFixing(null);
      toast('재고를 수정했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('수정에 실패했습니다', 'error');
    }
  }

  // 통을 0 으로 비우고 실값 규칙을 켠다 — 굳히기 대신 «0 에서 새로 시작» (2026-09-15 대표님
  // 「도급재고 전체 0개로 해줘 실수량 다시 세어보고 넣게」). 관리자만, 켜지기 전에만 보인다.
  // 도급·판금은 한 통(paidStock)을 쓰므로 이 회사의 통 전부를 비운다.
  const [restarting, setRestarting] = useState(false);
  // 회사 통을 통째로 비우는 단추 — 같은 무게의 다른 단추(구매 「전체 삭제」·공수표 「초기화」)처럼
  // 잠금을 풀어야 눌린다 (2026-09-16 야간 조사 L2)
  const editMode = useEditLock();
  async function restartFromZero() {
    const rows = Object.values(manual).filter((v) => v?.itemId);
    if (
      !(await confirm(
        `${company} 도급·판금 통 ${rows.length}줄을 모두 0 으로 비우고, 이제부터 통에 적힌 값을 그대로 남음으로 씁니다.
실수량은 「이번 입고」 칸에 다시 적으시면 됩니다. 계속할까요?`,
      ))
    )
      return;
    setRestarting(true);
    try {
      for (const v of rows)
        await setStockTo('paid', company, v, 0, { by: me, reason: '실수량 다시 세어 넣기 위해 0 으로 (통 실값 시작)' });
      await enableStockLedger(company);
      toast(`${rows.length}줄을 0 으로 비우고 실값 규칙을 켰습니다`, 'success', 0);
    } catch (err) {
      console.error(err);
      toast('비우지 못했습니다 — 다시 시도해 주세요', 'error', 0);
    } finally {
      setRestarting(false);
    }
  }

  // 고른 BOX 만 — 「전체」면 그대로. 셈(위 숫자)은 늘 전체 기준이라 건드리지 않는다
  const shownGroups = boxTab === ALL_BOX ? groups : groups.filter((g) => g.box === boxTab);

  const sums = useMemo(() => {
    let sets = null;
    let worst = null;
    for (const r of allRows) {
      if (r.perOne <= 0) continue;
      if (sets === null || r.sets < sets) {
        sets = r.sets;
        worst = r;
      }
    }
    return {
      kinds: allRows.length,
      left: allRows.reduce((s, r) => s + r.left, 0),
      amount: allRows.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      sets,
      worst,
    };
  }, [allRows]);

  const ready =
    has('panels', 'materials', 'master', 'settings') &&
    (!company || has('manual')) &&
    (!(projectId || siteId) || has('received')) &&
    all.every((p) => p.bomLink.projectId in bomByProject);
  // 다 받기 전엔 그리지 않는다 — 첫 자료만 보고 그리면 「0 − 나감」 같은 중간값이 잠깐 보이고,
  // 표 상자도 위쪽 요약이 덜 그려진 채 높이를 재서 작았다 커진다 (2026-09-14 대표님 잔상 조사)
  if (!ready)
    return (
      <div className="fstock">
        <p className="text-muted fstock-loading">불러오는 중…</p>
      </div>
    );

  return (
    <div className="fstock">
      <div className="fstock-head no-print">
        <div className="fstock-sums">
          <span className="fstock-sum">
            품목 <b>{sums.kinds}종</b>
          </span>
          <span className="fstock-sum">
            남음 <b>{won(sums.left)}</b>
          </span>
          <span className="fstock-sum" title="남은 것 × 단가">
            금액 <b>{won(sums.amount)}원</b>
          </span>
        </div>
        <input
          className="fstock-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="도번·품명·규격으로 찾기"
          aria-label="도급 재고 검색"
        />
        {isAdmin && !ledgerOn(settings, company, kind) && (
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={restartFromZero}
            disabled={restarting || !editMode}
            title={
              editMode
                ? '통을 전부 0 으로 비우고, 이제부터 통에 적힌 값을 그대로 남음으로 씁니다'
                : '오른쪽 아래 「잠금」을 푼 뒤에'
            }
          >
            {restarting ? '비우는 중…' : '0에서 다시 시작'}
          </button>
        )}
      </div>

      {/* BOX 탭 — 품목이 있는 BOX 만. 재고도 BOX 로 갈라 봐야 한 통씩 세기 좋다
        (2026-09-16 대표님 「사도급 재고에도 필터 걸어주고」). 자재 허브와 같은 탭이다 */}
      {groups.length > 1 && (
        <div className="fstock-boxtabs no-print">
          <ViewSwitch
            options={[
              { value: ALL_BOX, label: ALL_BOX, count: groups.reduce((a, g) => a + g.rows.length, 0) },
              ...groups.map((g) => ({ value: g.box, label: g.box, count: g.rows.length })),
            ]}
            value={boxTab}
            onChange={setBoxTab}
            ariaLabel="BOX"
            className="fstock-box-switch"
          />
        </div>
      )}

      {groups.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{`${company} ${kind === 'made' ? '판금' : '도급'} 품목이 없습니다`}</p>
          <span>BOM 에 도급으로 표시된 품목이 여기에 모입니다. 발주서를 BOM 에 연결해야 들어온 양이 잡힙니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x pmat-scroll no-print" ref={scrollRef}>
          <table className="table pmat-table">
            <colgroup>
              {STOCK_COLS.map((w, i) => (
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
                <th scope="col" className="col-num">
                  1대당
                </th>
                <th scope="col" className="col-num" title="호기들에 이미 들어간 양">
                  나감
                </th>
                <th scope="col" className="col-num" title="들어온 양 − 나간 양 (손으로 적어 넣은 몫 포함)">
                  남음
                </th>
                <th scope="col" className="col-num" title="지금 남은 것으로 몇 대분이 되나">
                  가능 SET
                </th>
                <th scope="col" title="품목마다 한 줄 메모 — 적고 칸을 나가면 저장">
                  비고
                </th>
                <th scope="col" className="col-action" title="이번에 들어온 개수 — 지금 남음에 더해집니다">
                  이번 입고
                </th>
              </tr>
            </thead>
            <tbody>
              {/* BOX 마다 구분줄을 놓고 그 아래 그 BOX 품목을 늘어놓는다. 한 품목이 여러 BOX 에
                  쓰이면 여러 번 나온다 — 1대당·나감은 그 BOX 몫이고, 남음·가능 SET 은 품목
                  하나에 하나뿐이라 어느 줄에서나 같다 (2026-09-12 대표님 「구분선으로 박스명」). */}
              {shownGroups.map((g) => (
                <Fragment key={g.box}>
                  <tr className="fstock-boxrow">
                    <th scope="colgroup" colSpan={STOCK_COLS.length}>
                      {g.box}
                      <em>{g.rows.length}품목</em>
                    </th>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr key={`${g.box}-${r.itemId}`}>
                      <td className="col-no">{i + 1}</td>
                      <td className="pmat-drawing">{r.drawingNo}</td>
                      <td className="u-wrap">{r.name}</td>
                      <td className="pmat-spec u-wrap" title={r.spec}>
                        {r.spec}
                      </td>
                      <td className="col-num">{won(r.perOne)}</td>
                      {/* 「나감」 = 이 갈래를 시작한 호기 수 SET, 그중 이 줄을 다 못 채운 대수를 「부족」
                          으로 (2026-09-15 대표님 「9set 으로 가야겠지 부족이니까」). 개수는 툴팁에. */}
                      <td
                        className="col-num"
                        title={`${won(r.out)}개 · 다 채운 ${r.outSets.full}대 · 부족 ${won(r.outSets.short)}개`}
                      >
                        {outSetsLabel(r.outSets)}
                      </td>
                      <td className="col-num">
                        {/* 숫자를 누르면 오간 기록, 옆의 「수정」은 실물을 세어 맞출 때.
                        사급 재고와 같은 자리·같은 모양으로 둔다 (2026-09-11 대표님) */}
                        <div className="fstock-have-cell">
                          <button
                            type="button"
                            className="fstock-have"
                            onClick={() => setLogOf(r)}
                            title={`${r.name || r.code} 들어오고 나간 기록 보기`}
                          >
                            {/* 여기는 «배정하지 않은» 실물만 적는다 — 호기에 들어가야 할 부족분은
                                「부족 집계」 탭에서 본다 (2026-09-14 대표님 「재고에는 배정안된
                                실제 수량만 표시」) */}
                            <b className={r.left < 0 ? 'is-minus' : undefined}>{won(r.left)}</b>
                            {r.amount > 0 && <em className="fstock-amt">{won(r.amount)}원</em>}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => setFixing({ row: r, to: String(r.left) })}
                            title="실제 개수로 수정"
                          >
                            수정
                          </button>
                        </div>
                      </td>
                      <td className={`col-num${r.perOne > 0 && r.sets === 0 ? ' is-short' : ''}`}>
                        {r.perOne > 0 ? `${won(r.sets)} SET` : ''}
                      </td>
                      {/* 비고 — 적는 동안 React 가 값을 안 흔들게 key 에 저장값을 넣는다 (호기 체크 비고와 같은 방식) */}
                      <td className="pmat-note-cell">
                        <MemoInput
                          value={r.memo || ''}
                          ariaLabel={`${r.name || r.code} 비고`}
                          onCommit={(v) =>
                            setStockMemo(kind, company, r, v, { by: me }).catch(() =>
                              toast('비고를 저장하지 못했습니다', 'error'),
                            )
                          }
                        />
                      </td>
                      <td className="col-action">
                        <div className="fstock-in-cell">
                          {/* 들어온 개수를 칸에 바로 적는다 — 적고 Enter (창을 띄우지 않는다) */}
                          <input
                            className="num-input pmat-input"
                            type="number"
                            min="0"
                            inputMode="numeric"
                            placeholder="0"
                            disabled={saving === r.itemId}
                            value={draft[r.itemId] ?? ''}
                            onChange={(e) => setDraft((d) => ({ ...d, [r.itemId]: e.target.value }))}
                            onBlur={() => commitDraft(r)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape')
                                setDraft((d) => {
                                  const nd = { ...d };
                                  delete nd[r.itemId];
                                  return nd;
                                });
                            }}
                            aria-label={`${r.name || r.code} 이번 입고 개수`}
                          />
                          {/* 누르기 전에 결과를 먼저 보여 준다 — 「더하기」인지 「맞추기」인지 헷갈려
                          재고가 두 배로 불어난 일이 있었다 (2026-09-11 대표님) */}
                          {Number(draft[r.itemId]) > 0 && (
                            <span className="fstock-preview">
                              {won(r.left)} → <b>{won(r.left + Number(draft[r.itemId]))}</b>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 오간 기록 — 지금 수량이 왜 이 숫자인지 여기서 다 보인다 */}
      {logOf && (
        <Modal isOpen onClose={() => setLogOf(null)} title={`${logOf.name || logOf.code} 기록`} size="lg">
          <p className="field-hint">
            지금 남음 <b>{won(logOf.left)}</b>
            {ledgerOn(settings, company, kind)
              ? ' · 통에 적힌 실제 값 — 발주 입고는 +, 호기로 나감은 −'
              : ` · 발주서 입고 ${won(logOf.gotIn)} − 호기로 나감 ${won(logOf.out)}${logOf.adjust ? ` · 손으로 적은 몫 ${won(logOf.adjust)}` : ''}`}
          </p>
          {(logOf.log || []).length === 0 ? (
            <div className="empty-state">
              <p>손으로 적어 넣은 기록이 없습니다 — 지금 수량은 발주서 입고와 호기 투입으로만 셈한 것입니다</p>
            </div>
          ) : (
            <div className="table-scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">언제</th>
                    <th scope="col">무엇</th>
                    <th scope="col" className="col-num">
                      개수
                    </th>
                    {/* 통장처럼 그 줄 뒤의 통 수량 — 지금 수량에서 거꾸로 되짚는다 (2026-09-16 대표님) */}
                    <th scope="col" className="col-num">
                      뒤 수량
                    </th>
                    <th scope="col">메모</th>
                    <th scope="col">적은 사람</th>
                  </tr>
                </thead>
                <tbody>
                  {withRunning(
                    [...(logOf.log || [])].sort((a, b) => whenMs(b.at) - whenMs(a.at)),
                    logOf.left,
                  ).map((l, i) => (
                    <tr key={`${l.at}-${i}`}>
                      <td>{fmtWhen(l.at)}</td>
                      <td>{logLabel(l)}</td>
                      <td className="col-num">
                        {l.kind === 'fix' ? `${won(l.from)} → ${won(l.n ?? l.to)}` : won(l.n)}
                      </td>
                      <td className="col-num">{won(l.after)}</td>
                      <td className="u-wrap">{l.note || ''}</td>
                      <td>{l.by || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setLogOf(null)}>
              닫기
            </button>
          </div>
        </Modal>
      )}

      {fixing && (
        <Modal isOpen onClose={() => setFixing(null)} title="재고 수량 수정">
          <form onSubmit={onFix}>
            <p className="field-hint" style={{ marginTop: 0 }}>
              <strong>{fixing.row.name || fixing.row.code}</strong> · 지금 {won(fixing.row.left)}
            </p>
            <div className="form-group">
              <label>실제 수량</label>
              <input
                autoFocus
                value={fixing.to}
                onChange={(e) => setFixing((v) => ({ ...v, to: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                aria-label="실제 수량"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setFixing(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                수정
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
