// 사급 재고 — 고객사가 호기를 정하지 않고 보내온 물건. (2026-09-10 대표님)
//
// 목록은 «그 회사 BOM 에 있는 사급 품목» 전부다. 재고를 한 번도 안 받은 품목도 줄이 보여야
// 무엇이 들어와야 하는지 알 수 있다(대표님 「BOM 에 있는 사급품이 리스트가 되어야」).
//
// 숫자는 서로 이어져 있다.
// 말은 도급 재고와 하나로 맞춘다 — 두 통을 나란히 보시기 때문이다
// (2026-09-12 대표님 「사급에도 있는게 좋지않나」).
//   1대당    호기 하나가 쓰는 개수 (BOX 합)
//   가능 SET 남음 ÷ 1대당 (버림)
//   나감     호기들에 이미 들어간 양 (끝난 호기까지)
//   남음     통에 쌓여 있는 양 — 「이번 입고」로 늘고, 호기에서 「재고에서 N」으로 줄어든다
import { Fragment, useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import MemoInput from '../../components/common/MemoInput';
import { useFillHeight } from '../../utils/useFillHeight';
import { withRunning } from '../../domain/stockRunning';
import { logsForSide } from '../../domain/stockSide';
import Modal from '../../components/common/Modal';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { getBomBySite, isFreeIssue } from '../../services/bomService';
import { aggregateShortage, receivedQty } from '../../domain/panelMaterials';
import { outTally, tallyOut, outSetsOf, outSetsLabel } from '../../domain/outSets';
import { CHECKABLE_BOXES, bomRowsForBox, rowsForPanel } from '../../domain/panelBom';
import { STOCK_COLS } from '../../domain/tableWidths';
import { subscribeFreeStock, receiveFreeStock, setFreeStockQty } from '../../services/freeStockService';
import { useArrived } from '../../utils/useArrived';
import { setStockMemo } from '../../services/stockService';

const won = (n) => (Number(n) || 0).toLocaleString();
const hasBomLink = (p) => !!p?.bomLink?.projectId;

// 기록에 적히는 말 — 통에 들어옴 / 호기로 나감 / 되돌아옴 / 손으로 맞춤
const LOG_LABEL = { in: '들어옴', out: '호기로', back: '되돌림', fix: '손으로 맞춤' };
// 서버에서 읽어 온 날짜는 «글자가 아니라 값»으로 온다(toDate 를 가진 객체).
// 앱 곳곳이 쓰는 규칙과 같게 둘 다 받는다 — 글자로만 다루면 빈칸이 된다 (2026-09-11 대표님)
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

const ALL_BOX = '전체';

export default function FreeStockPage({ company }) {
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const me = userProfile?.name || '';

  const [master, setMaster] = useState([]);
  const [panels, setPanels] = useState([]);
  const [materials, setMaterials] = useState({});
  const [bomByProject, setBomByProject] = useState({});
  const [stock, setStock] = useState({});
  // 표 상자를 화면 아래까지 늘려 «상자 안에서» 세로로 스크롤하게 한다 — 그래야 머리줄이
  // 위에 붙는다 (2026-09-12 대표님 「위에 줄은 스크롤해도 고정으로 내려가게」).
  const scrollRef = useFillHeight();
  const [q, setQ] = useState('');
  // 어느 BOX 를 볼지 — 품목이 여러 BOX 에 걸쳐 있어 한 통씩 세려면 갈라 봐야 한다
  // (2026-09-16 대표님 「사도급 재고에도 필터 걸어주고」)
  const [boxTab, setBoxTab] = useState(ALL_BOX);
  // 잠금은 두지 않는다 — 이 화면에서 하는 일은 「들어온 개수 적기」와 「실제 개수로 맞추기」뿐이고,
  // 둘 다 잠가 둘 이유가 없다. 잠금 뒤에 숨겨 두었더니 수정하는 길을 못 찾으셨다 (2026-09-11 대표님).
  const [fixing, setFixing] = useState(null); // { row, to }
  // 「이번 입고」가 고객사가 준 것인지 우리가 댄 것인지 — 평소엔 고객사 (2026-09-12 대표님)
  const [inOurs, setInOurs] = useState(false);
  const [logOf, setLogOf] = useState(null); // 기록을 펼쳐 볼 줄
  // 표에서 바로 적는 입고 수량 — 창을 띄우지 않는다 (2026-09-11 대표님)
  const [draft, setDraft] = useState({}); // { [itemId]: '3' }
  const [saving, setSaving] = useState('');

  const { take, has } = useArrived(); // 어느 구독이 첫 값을 줬는지
  useEffect(() => subscribePurchaseItems(take('master', setMaster)), [take]);
  useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
  useEffect(() => subscribeAllMaterials(take('materials', setMaterials)), [take]);
  useEffect(() => subscribeFreeStock(company, take('stock', setStock)), [company, take]);

  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // 이 회사 호기 중 BOM 을 연결한 것 «전부» — 끝난 호기도 넣는다.
  // 나간 자재는 호기가 출고됐다고 통으로 돌아오지 않는다. 끝난 호기를 빼고 세면
  // 「나감」이 실제보다 적게 나온다 (도급 통에서 먼저 드러난 것과 같은 셈, 2026-09-12).
  const mine = useMemo(() => panels.filter((p) => (!p.회사 || p.회사 === company) && hasBomLink(p)), [panels, company]);

  useEffect(() => {
    const ids = [...new Set(mine.map((p) => p.bomLink.projectId))].filter((id) => !(id in bomByProject));
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
  }, [mine, bomByProject]);

  // allRows 는 검색·보기를 거치지 않은 전체 — 위쪽 요약은 늘 전체를 봐야 한다.
  // 타입 열쇠(vM7H) → 라벨(M7H). 호기의 BOM 연결에 스냅샷이 있어 따로 안 읽는다
  const variantLabel = useMemo(() => {
    const m = {};
    for (const p of panels) {
      const k = p.bomLink?.variantKey;
      if (k && !m[k]) m[k] = p.bomLink?.variantLabel || String(k).replace(/^v/, '');
    }
    return m;
  }, [panels]);
  const { groups, allRows } = useMemo(() => {
    // 「1대당」 — 호기 하나가 쓰는 개수. 호기마다 다르면 가장 큰 값을 쓴다.
    const perOneAll = new Map(); // 품목 전체 (가능 SET 용)
    const entriesAll = [];
    const entriesByBox = new Map(); // box → entries[]
    const perOneByBox = new Map(); // box → Map(key → 개수)
    const outByBox = new Map(); // box → 나감 SET 집계 (줄마다 다 채운 호기 · 부족 호기)

    for (const p of mine) {
      const all0 = bomByProject[p.bomLink.projectId];
      if (!all0) continue;
      const forVariant = rowsForPanel(all0, p); // 타입 + 정방향 제외까지 거른 줄
      const one = new Map();
      const oneBox = new Map(); // 이 호기의 BOX 별 개수 — 호기마다 새로 센다
      for (const bx of CHECKABLE_BOXES) {
        const raw = bomRowsForBox(forVariant, bx).filter(isFreeIssue);
        if (raw.length === 0) continue;
        const list = raw.map((r) => {
          const m = r.itemId ? masterMap[r.itemId] : null;
          return {
            ...r,
            code: m?.code || r.code || '',
            name: m?.name || r.name || '',
            spec: m?.spec || r.spec || '',
            drawingNo: m?.drawingNo || r.drawingNo || '',
            // 재고에 얼마가 묶여 있는지 (2026-09-12 대표님 「금액도」)
            unitPrice: Number(m?.unitPrice) || Number(m?.standardPrice) || 0,
          };
        });
        if (!oneBox.has(bx)) oneBox.set(bx, new Map());
        const ob = oneBox.get(bx);
        const rec = (materials[p.id] || {})[bx] || {};
        if (!outByBox.has(bx)) outByBox.set(bx, outTally());
        const o = outByBox.get(bx);
        for (const r of list) {
          const k = r.itemId || `row:${r.id}`;
          one.set(k, (one.get(k) || 0) + (Number(r.qty) || 0));
          ob.set(k, (ob.get(k) || 0) + (Number(r.qty) || 0));
          tallyOut(o, k, p.id, receivedQty(rec, r.id), Number(r.qty) || 0, !!rec[r.id]?.skip);
        }
        const entry = { panelLabel: p.프로젝트 || p.id, rows: list, received: rec };
        entriesAll.push(entry);
        entriesByBox.set(bx, [...(entriesByBox.get(bx) || []), entry]);
      }
      // 호기마다 다르면 가장 큰 값 — 더하면 호기 수만큼 부풀어 「1대당 34」 같은 값이 나온다
      // (2026-09-12: 메티스 호기 34대라 정확히 34배가 돼 있었다)
      for (const [k, v] of one) perOneAll.set(k, Math.max(perOneAll.get(k) || 0, v));
      for (const [bx, m0] of oneBox) {
        if (!perOneByBox.has(bx)) perOneByBox.set(bx, new Map());
        const dst = perOneByBox.get(bx);
        for (const [k, v] of m0) dst.set(k, Math.max(dst.get(k) || 0, v));
      }
    }

    // 품목마다의 재고·가능 SET — BOX 와 무관하게 하나다
    const whole = new Map();
    for (const a of aggregateShortage(entriesAll, { onlyShort: false })) {
      const have = Math.max(0, Number(stock[a.itemId]?.qty) || 0);
      const one = perOneAll.get(a.itemId || '') || 0;
      // 「우리가 댄」 몫 — 고객사 것 = have − ours (2026-09-12 대표님). 두 통은 «따로» 센다
      // (2026-09-15 대표님 「고객사 우리것이 수량이 공유가안되어야하는데 공유되네」)
      const ours = Math.min(Math.max(0, Number(stock[a.itemId]?.ours) || 0), have);
      const theirs = have - ours;
      const main = inOurs ? ours : theirs;
      whole.set(a.itemId, {
        ...a,
        have,
        ours,
        theirs,
        // «본 칸» = 지금 고른 통(고객사 / 우리 것). 셈은 통마다 따로 — 금액·가능 SET 도 그 통 것만
        // (2026-09-15 대표님 「셈도 아예 분리해야함 수량은 본 칸에 입력하고 아래글자를 반대통 수량」)
        main,
        other: inOurs ? theirs : ours,
        // 남은 것의 값어치 — 집계를 거치면 단가가 떨어져 나가 품목에서 바로 읽는다
        amount: main * (Number(masterMap[a.itemId]?.unitPrice) || Number(masterMap[a.itemId]?.standardPrice) || 0),
        perOneAll: one,
        // 「가능 SET」은 호기 한 대 기준으로 고정 — BOX 몫으로 나누면 같은 재고인데 BOX 마다
        // 다른 SET 이 나와 헷갈린다 (2026-09-12 대표님 「나누니 셋트 숫자가 이상해지네」).
        sets: one > 0 ? Math.floor(main / one) : 0,
        log: stock[a.itemId]?.log || [],
        memo: stock[a.itemId]?.memo || '',
      });
    }

    const kw = q.trim().toLowerCase();
    const keep = (r) => {
      // 「남은 것」 거르기는 없앴다 — 통이 비어 있어도 목록은 전부 보여야 한다
      // (2026-09-15 대표님 「아무것도 없어도 리스트전체는 나와야함」)
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
      const es = entriesByBox.get(bx);
      if (!es) continue;
      const ob = perOneByBox.get(bx) || new Map();
      const ob2 = outByBox.get(bx) || outTally();
      const list = aggregateShortage(es, { onlyShort: false })
        .map((a) => {
          const base = whole.get(a.itemId);
          return base
            ? {
                ...base,
                // 타입 전용 표시는 «이 BOX 줄» 기준 — 품목 단위로 보면 다른 BOX 의 공통 줄에 묻혀
                // MP 의 M7H 전용 Relay 에 배지가 안 붙었다 (2026-09-17)
                variantKeys: a.variantKeys,
                perOne: ob.get(a.itemId || '') || 0,
                got: a.got,
                // 사급은 체크 기준 — 이 줄에 실제로 넣은 호기만 (대표님 「체크된 호기에 한해서」)
                outSets: outSetsOf(ob2, a.itemId || ''), // { sets, full, short }
              }
            : null;
        })
        .filter(Boolean)
        .filter(keep)
        .sort(byDrawing);
      if (list.length > 0) out.push({ box: bx, rows: list });
    }
    return { groups: out, allRows: [...whole.values()] };
  }, [mine, bomByProject, materials, masterMap, stock, q, inOurs]);

  // 고른 BOX 만 — 「전체」면 그대로. 셈(위 숫자)은 늘 전체 기준이라 건드리지 않는다
  const shownGroups = boxTab === ALL_BOX ? groups : groups.filter((g) => g.box === boxTab);

  const sums = useMemo(() => {
    const all = allRows;
    // 지금 재고로 몇 SET 을 만들 수 있나 — 가장 모자란 품목이 정한다 (2026-09-11 대표님)
    let sets = null;
    let worst = null;
    for (const r of all) {
      if (r.perOne <= 0) continue;
      if (sets === null || r.sets < sets) {
        sets = r.sets;
        worst = r;
      }
    }
    return {
      kinds: all.length,
      main: all.reduce((s, r) => s + (Number(r.main) || 0), 0),
      other: all.reduce((s, r) => s + (Number(r.other) || 0), 0),
      amount: all.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      sets,
      worst,
    };
  }, [allRows]);

  // 칸에 적은 수를 그대로 재고에 더한다 — 「받기」 창을 없앤 자리 (2026-09-11 대표님
  // 「모달 수량 입력 말고 입고수량 칸에 바로 입력하는 방식으로하자」)
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
      await receiveFreeStock(company, { itemId: r.itemId, code: r.code, name: r.name, spec: r.spec }, n, {
        by: me,
        ours: inOurs,
      });
      toast(`${r.name || r.code} ${n}개 ${inOurs ? '당사 것으로 ' : ''}받았습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('저장에 실패했습니다', 'error');
    } finally {
      setSaving('');
    }
  }

  async function onFix(e) {
    e.preventDefault();
    const { row } = fixing;
    const t = Number(fixing.to) || 0;
    if (t === row.main) return setFixing(null);
    const who = inOurs ? '당사' : '고객사';
    if (!(await confirm(`${row.name || row.code} ${who} 재고를 ${won(row.main)} → ${won(t)} 으로 수정할까요?`))) return;
    try {
      // 고른 통 하나만 넘긴다 — 반대 통은 서비스가 «저장된 값»으로 채운다. 화면 값을 같이
      // 써 넣던 때는 창을 열어 둔 사이 호기가 꺼내 간 몫이 되살아났다 (2026-09-16 조사 S9)
      await setFreeStockQty(company, row, t, {
        by: me,
        side: inOurs ? 'ours' : 'theirs',
        reason: `${who} 실물 세어 맞춤`,
      });
      setFixing(null);
      toast('재고를 수정했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('수정에 실패했습니다', 'error');
    }
  }

  const ready = has('master', 'panels', 'materials', 'stock') && mine.every((p) => p.bomLink.projectId in bomByProject);
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
          <span
            className="fstock-sum"
            title={inOurs ? '당사가 댄 몫 — 고객사 것과 따로 센다' : '고객사가 준 것 — 사급 본래 몫'}
          >
            {inOurs ? '당사' : '고객사'} <b>{won(sums.main)}</b>
          </span>
          <span className="fstock-sum fstock-sum-other" title="반대 통에 있는 양">
            {inOurs ? '고객사' : '당사'} <b>{won(sums.other)}</b>
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
          aria-label="사급 재고 검색"
        />
        {/* 어느 통을 보고 적는지 — 고객사 통 / 우리 통. 본 칸·금액·가능 SET·「이번 입고」·「수정」이
            모두 이 통 기준이고, 줄 아래 작은 글자가 반대 통 (2026-09-15 대표님 「셈도 아예 분리」) */}
        <ViewSwitch
          options={[
            { value: 'them', label: '고객사' },
            { value: 'ours', label: '당사' },
          ]}
          value={inOurs ? 'ours' : 'them'}
          onChange={(v) => setInOurs(v === 'ours')}
          ariaLabel="어느 통을 볼지 — 고객사 / 당사"
          className="fstock-owner-switch"
        />
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
          <p>{`${company} 사급 품목이 없습니다`}</p>
          <span>BOM 에 사급으로 표시된 품목이 여기에 모입니다.</span>
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
                <th scope="col" className="col-num" title="재고에 남아 있는 양">
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
                    <tr key={r.itemId || r.code || i}>
                      <td className="col-no">{i + 1}</td>
                      <td className="pmat-drawing">{r.drawingNo}</td>
                      <td className="u-wrap">
                        {r.name}
                        {/* 타입 전용 품목 — 자재 체크(그 호기 타입만)와 재고(전 타입)의 개수 차이가 여기서
                          난다 (2026-09-17 대표님 「호기체크 MP 갯수와 사급재고 MP 갯수가 다름?」) */}
                        {(r.variantKeys || []).map((k) => (
                          <span key={k} className="stock-variant" title="이 타입 호기에만 쓰이는 품목">
                            {variantLabel[k] || String(k).replace(/^v/, '')}
                          </span>
                        ))}
                      </td>
                      <td className="pmat-spec u-wrap" title={r.spec}>
                        {r.spec}
                      </td>
                      <td className="col-num">{won(r.perOne)}</td>
                      {/* 「나감」 = 이 갈래를 시작한 호기 수 SET, 그중 이 줄을 다 못 채운 대수를 「부족」
                          으로 (2026-09-15 대표님 「9set 으로 가야겠지 부족이니까」). 개수는 툴팁에. */}
                      <td
                        className="col-num"
                        title={`${won(r.got)}개 · 다 채운 ${r.outSets.full}대 · 부족 ${won(r.outSets.short)}개`}
                      >
                        {outSetsLabel(r.outSets)}
                      </td>
                      <td className="col-num">
                        {/* 숫자를 누르면 오간 기록, 옆의 「수정」은 실물을 세어 맞출 때.
                        고치는 대상(남음) 바로 옆에 둔다 (2026-09-11 대표님) */}
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
                            {/* 본 칸 = 고른 통, 아래 작은 글자 = 반대 통. 셈은 통마다 따로
                                (2026-09-15 대표님 「수량은 본 칸에 입력하고 아래글자를 반대통 수량」) */}
                            <b>{won(r.main)}</b>
                            <em className="fstock-ours">
                              {inOurs ? '고객사' : '당사'} {won(r.other)}
                            </em>
                            {r.amount > 0 && <em className="fstock-amt">{won(r.amount)}원</em>}
                          </button>
                          {/* 남음이 0 이어도 눌러진다 — 실물을 세어 맞출 때는 0 인 줄이 오히려
                              더 자주 손이 간다. 도급 재고와 같은 자리·같은 모양으로 둔다
                              (2026-09-14 대표님 「사급 재고에는 수정버튼 왜없지」) */}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onClick={() => setFixing({ row: r, to: String(r.main) })}
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
                            setStockMemo('free', company, r, v, { by: me }).catch(() =>
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
                              {won(r.main)} → <b>{won(r.main + Number(draft[r.itemId]))}</b>
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
        <Modal
          isOpen
          onClose={() => setLogOf(null)}
          title={`${logOf.name || logOf.code} · ${inOurs ? '당사' : '고객사'} 기록`}
          size="lg"
        >
          {/* 보고 있는 칸의 기록만 — 두 칸이 한 목록을 같이 쓰던 때는 고객사 칸을 보는데 당사가
            받은 것까지 떠서 읽을 수가 없었다 (2026-09-16 대표님 「사급재고 기록 고객사와당사 공유x」) */}
          <p className="field-hint">
            {inOurs ? '당사' : '고객사'} 재고 <b>{won(logOf.main)}</b>
            {logOf.spec ? ` · ${logOf.spec}` : ''} · {inOurs ? '고객사' : '당사'} 칸 기록은 위에서 칸을 바꿔 보세요
          </p>
          {logsForSide(logOf.log || [], inOurs ? 'ours' : 'theirs').length === 0 ? (
            <div className="empty-state">
              <p>이 칸에는 아직 오간 기록이 없습니다</p>
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
                    logsForSide(logOf.log || [], inOurs ? 'ours' : 'theirs').sort(
                      (a, b) => whenMs(b.at) - whenMs(a.at),
                    ),
                    logOf.main,
                    inOurs ? 'ours' : 'theirs',
                  ).map((l, i) => (
                    <tr key={`${l.at}-${i}`}>
                      <td>{fmtWhen(l.at)}</td>
                      <td>
                        {LOG_LABEL[l.kind] || l.kind || ''}
                        {/* 어느 칸인지 안 적힌 옛 손맞춤 — 두 칸 합계를 고친 것이라 몫을 못 가른다 */}
                        {l.whole === false && <span className="field-hint"> · 두 칸 합계</span>}
                      </td>
                      <td className="col-num">{l.kind === 'fix' ? `${won(l.from)} → ${won(l.n)}` : won(l.share)}</td>
                      <td className="col-num">{l.after === null ? '—' : won(l.after)}</td>
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
              <strong>{fixing.row.name || fixing.row.code}</strong> · {inOurs ? '당사' : '고객사'} 지금{' '}
              {won(fixing.row.main)} (반대 통 {won(fixing.row.other)})
            </p>
            <div className="form-group">
              <label>{inOurs ? '당사' : '고객사'} 실제 수량</label>
              <input
                autoFocus
                value={fixing.to}
                onChange={(e) => setFixing((s) => ({ ...s, to: e.target.value.replace(/[^0-9]/g, '') }))}
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
