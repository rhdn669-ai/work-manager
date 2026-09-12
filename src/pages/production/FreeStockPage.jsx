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
import { useFillHeight } from '../../utils/useFillHeight';
import Modal from '../../components/common/Modal';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { getBomBySite, bomItemsForVariant, isFreeIssue } from '../../services/bomService';
import { aggregateShortage } from '../../domain/panelMaterials';
import { CHECKABLE_BOXES, bomRowsForBox } from '../../domain/panelBom';
import { STOCK_COLS } from '../../domain/tableWidths';
import { subscribeFreeStock, receiveFreeStock, setFreeStockQty } from '../../services/freeStockService';

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
  const [view, setView] = useState('all'); // all | have
  // 잠금은 두지 않는다 — 이 화면에서 하는 일은 「들어온 개수 적기」와 「실제 개수로 맞추기」뿐이고,
  // 둘 다 잠가 둘 이유가 없다. 잠금 뒤에 숨겨 두었더니 수정하는 길을 못 찾으셨다 (2026-09-11 대표님).
  const [fixing, setFixing] = useState(null); // { row, to }
  const [logOf, setLogOf] = useState(null); // 기록을 펼쳐 볼 줄
  // 표에서 바로 적는 입고 수량 — 창을 띄우지 않는다 (2026-09-11 대표님)
  const [draft, setDraft] = useState({}); // { [itemId]: '3' }
  const [saving, setSaving] = useState('');

  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribePanels(setPanels), []);
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  useEffect(() => subscribeFreeStock(company, setStock), [company]);

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
  const { groups, allRows } = useMemo(() => {
    // 「1대당」 — 호기 하나가 쓰는 개수. 호기마다 다르면 가장 큰 값을 쓴다.
    const perOneAll = new Map(); // 품목 전체 (가능 SET 용)
    const entriesAll = [];
    const entriesByBox = new Map(); // box → entries[]
    const perOneByBox = new Map(); // box → Map(key → 개수)

    for (const p of mine) {
      const all0 = bomByProject[p.bomLink.projectId];
      if (!all0) continue;
      const forVariant = bomItemsForVariant(all0, p.bomLink.variantKey || '');
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
          };
        });
        if (!oneBox.has(bx)) oneBox.set(bx, new Map());
        const ob = oneBox.get(bx);
        for (const r of list) {
          const k = r.itemId || `row:${r.id}`;
          one.set(k, (one.get(k) || 0) + (Number(r.qty) || 0));
          ob.set(k, (ob.get(k) || 0) + (Number(r.qty) || 0));
        }
        const entry = { panelLabel: p.프로젝트 || p.id, rows: list, received: (materials[p.id] || {})[bx] || {} };
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
      whole.set(a.itemId, {
        ...a,
        have,
        perOneAll: one,
        // 「가능 SET」은 호기 한 대 기준으로 고정 — BOX 몫으로 나누면 같은 재고인데 BOX 마다
        // 다른 SET 이 나와 헷갈린다 (2026-09-12 대표님 「나누니 셋트 숫자가 이상해지네」).
        sets: one > 0 ? Math.floor(have / one) : 0,
        log: stock[a.itemId]?.log || [],
      });
    }

    const kw = q.trim().toLowerCase();
    const keep = (r) => {
      if (view === 'have' && r.have <= 0) return false;
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
      const list = aggregateShortage(es, { onlyShort: false })
        .map((a) => {
          const base = whole.get(a.itemId);
          return base ? { ...base, perOne: ob.get(a.itemId || '') || 0, got: a.got } : null;
        })
        .filter(Boolean)
        .filter(keep)
        .sort(byDrawing);
      if (list.length > 0) out.push({ box: bx, rows: list });
    }
    return { groups: out, allRows: [...whole.values()] };
  }, [mine, bomByProject, materials, masterMap, stock, q, view]);

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
      have: all.reduce((s, r) => s + r.have, 0),
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
      await receiveFreeStock(company, { itemId: r.itemId, code: r.code, name: r.name, spec: r.spec }, n, { by: me });
      toast(`${r.name || r.code} ${n}개 받았습니다`, 'success');
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
    if (t === row.have) return setFixing(null);
    if (!(await confirm(`${row.name || row.code} 재고를 ${won(row.have)} → ${won(t)} 으로 수정할까요?`))) return;
    try {
      await setFreeStockQty(company, row, t, { by: me });
      setFixing(null);
      toast('재고를 수정했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('수정에 실패했습니다', 'error');
    }
  }

  return (
    <div className="fstock">
      <div className="fstock-head no-print">
        <div className="fstock-sums">
          <span className="fstock-sum">
            품목 <b>{sums.kinds}</b>
          </span>
          <span className="fstock-sum">
            남음 <b>{won(sums.have)}</b>
          </span>
          {/* 가장 모자란 품목이 전체 SET 수를 정한다 (2026-09-11 대표님) */}
          {sums.sets !== null && (
            <span className="fstock-sum fstock-sets">
              지금 남은 것으로 <b className={sums.sets === 0 ? 'is-short' : ''}>{won(sums.sets)} SET</b>
              {sums.worst ? <em>모자란 것 · {sums.worst.name || sums.worst.code}</em> : null}
            </span>
          )}
        </div>
        <input
          className="fstock-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="도번·품명·규격으로 찾기"
          aria-label="사급 재고 검색"
        />
        <ViewSwitch
          options={[
            { value: 'have', label: '남은 것' },
            { value: 'all', label: '전체' },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="보기"
        />
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{view === 'have' ? '남은 사급 자재가 없습니다' : `${company} 사급 품목이 없습니다`}</p>
          <span>BOM 에 사급으로 표시된 품목이 여기에 모입니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print" ref={scrollRef}>
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
                <th scope="col" className="col-action" title="이번에 들어온 개수 — 지금 남음에 더해집니다">
                  이번 입고
                </th>
              </tr>
            </thead>
            <tbody>
              {/* BOX 마다 구분줄을 놓고 그 아래 그 BOX 품목을 늘어놓는다. 한 품목이 여러 BOX 에
                  쓰이면 여러 번 나온다 — 1대당·나감은 그 BOX 몫이고, 남음·가능 SET 은 품목
                  하나에 하나뿐이라 어느 줄에서나 같다 (2026-09-12 대표님 「구분선으로 박스명」). */}
              {groups.map((g) => (
                <Fragment key={g.box}>
                  <tr className="fstock-boxrow">
                    <th scope="colgroup" colSpan={9}>
                      {g.box}
                      <em>{g.rows.length}품목</em>
                    </th>
                  </tr>
                  {g.rows.map((r, i) => (
                    <tr key={r.itemId || r.code || i}>
                      <td className="col-no">{i + 1}</td>
                      <td className="pmat-drawing">{r.drawingNo}</td>
                      <td className="u-wrap">{r.name}</td>
                      <td className="pmat-spec u-wrap" title={r.spec}>
                        {r.spec}
                      </td>
                      <td className="col-num">{won(r.perOne)}</td>
                      {/* 개수 말고 몇 대분인지로 보여 준다 (2026-09-12 대표님 「나감 수량말고 세트로만 표시」).
                      정확한 개수는 칸에 손을 올리면 나온다 — 1대당이 없는 품목은 개수 그대로. */}
                      <td className="col-num" title={`${won(r.got)}개`}>
                        {r.perOne > 0 ? `${won(Math.floor(r.got / r.perOne))} SET` : won(r.got)}
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
                            <b>{won(r.have)}</b>
                          </button>
                          {r.have > 0 && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline"
                              onClick={() => setFixing({ row: r, to: String(r.have) })}
                              title="실제 개수로 수정"
                            >
                              수정
                            </button>
                          )}
                        </div>
                      </td>
                      <td className={`col-num${r.perOne > 0 && r.sets === 0 ? ' is-short' : ''}`}>
                        {r.perOne > 0 ? `${won(r.sets)} SET` : ''}
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
                              {won(r.have)} → <b>{won(r.have + Number(draft[r.itemId]))}</b>
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
            지금 재고 <b>{won(logOf.have)}</b>
            {logOf.spec ? ` · ${logOf.spec}` : ''}
          </p>
          {(logOf.log || []).length === 0 ? (
            <div className="empty-state">
              <p>아직 오간 기록이 없습니다</p>
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
                    <th scope="col">메모</th>
                    <th scope="col">적은 사람</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(logOf.log || [])]
                    .sort((a, b) => whenMs(b.at) - whenMs(a.at))
                    .map((l, i) => (
                      <tr key={`${l.at}-${i}`}>
                        <td>{fmtWhen(l.at)}</td>
                        <td>{LOG_LABEL[l.kind] || l.kind || ''}</td>
                        <td className="col-num">{l.kind === 'fix' ? `${won(l.from)} → ${won(l.n)}` : won(l.n)}</td>
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
              <strong>{fixing.row.name || fixing.row.code}</strong> · 지금 {won(fixing.row.have)}
            </p>
            <div className="form-group">
              <label>실제 수량</label>
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
