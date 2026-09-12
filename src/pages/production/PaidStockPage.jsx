import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import Modal from '../../components/common/Modal';
import ViewSwitch from '../../components/common/ViewSwitch';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getBomBySite, bomItemsForVariant, isFreeIssue } from '../../services/bomService';
import { subscribeReceivedFor, subscribePaidSetSettings } from '../../services/paidSetService';
import { CHECKABLE_BOXES, bomRowsForBox, hasBomLink } from '../../domain/panelBom';
import { STOCK_COLS } from '../../domain/tableWidths';
import { receivedQty } from '../../domain/panelMaterials';
import { subscribePaidStock, receivePaidStock, setPaidStockTo } from '../../services/paidStockService';

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
const ALL_BOX = '전체';

// 기록에 적히는 말 — 사급 재고와 같은 말을 쓴다
const LOG_LABEL = { in: '들어옴', fix: '손으로 맞춤' };
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

export default function PaidStockPage({ company = '' }) {
  const { userProfile } = useAuth();
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
  const [q, setQ] = useState('');
  const [view, setView] = useState('all'); // all | have
  // 어느 BOX 만 볼지 — 「전체」면 BOX 를 가리지 않는다 (2026-09-12 대표님 「박스별로 나눠줄래?」).
  // 남음(재고)은 품목마다 하나뿐이라 BOX 로 못 쪼갠다 — 그 칸만 늘 전체 값이다.
  const [box, setBox] = useState(ALL_BOX);

  useEffect(() => subscribePanels(setPanels), []);
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribePaidSetSettings(setSettings), []);
  useEffect(() => (company ? subscribePaidStock(company, setManual) : undefined), [company]);

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
    return subscribeReceivedFor({ bomProjectId: projectId, siteId }, (byItem) => setReceived(byItem || {}));
  }, [projectId, siteId]);

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

  // 셈에 쓸 BOX — 「전체」면 모두
  const boxesToCount = useMemo(() => (box === ALL_BOX ? CHECKABLE_BOXES : [box]), [box]);

  // 이 BOM 에 도급 줄이 실제로 있는 BOX 만 탭에 올린다 — 빈 탭을 눌러 보게 두지 않는다
  const boxesWithRows = useMemo(() => {
    const has = new Set();
    for (const p of mine) {
      const rows0 = bomByProject[p.bomLink.projectId];
      if (!rows0) continue;
      const forVariant = bomItemsForVariant(rows0, p.bomLink.variantKey || '');
      for (const bx of CHECKABLE_BOXES) {
        if (bomRowsForBox(forVariant, bx).some((r) => !isFreeIssue(r))) has.add(bx);
      }
    }
    return CHECKABLE_BOXES.filter((b) => has.has(b));
  }, [mine, bomByProject]);

  const { rows, allRows } = useMemo(() => {
    const perOne = new Map(); // 1대당 (호기마다 다르면 가장 큰 값)
    const gone = new Map(); // 호기들에 이미 들어간 양
    const info = new Map(); // 품목 정보

    // 나간 양 — 끝난 호기까지 «모든» 호기가 실제로 가져간 만큼
    for (const p of all) {
      const rows = bomByProject[p.bomLink.projectId];
      if (!rows) continue;
      const forVariant = bomItemsForVariant(rows, p.bomLink.variantKey || '');
      for (const bx of boxesToCount) {
        const list = bomRowsForBox(forVariant, bx).filter((r) => !isFreeIssue(r));
        const rec = (materials[p.id] || {})[bx] || {};
        for (const r of list) {
          if (!r.itemId) continue;
          gone.set(r.itemId, (gone.get(r.itemId) || 0) + receivedQty(rec, r.id));
        }
      }
    }

    // 1대당·품목 정보 — 지금 일하는 호기 기준
    for (const p of mine) {
      const rows = bomByProject[p.bomLink.projectId];
      if (!rows) continue;
      const forVariant = bomItemsForVariant(rows, p.bomLink.variantKey || '');
      const one = new Map();
      for (const bx of boxesToCount) {
        const list = bomRowsForBox(forVariant, bx).filter((r) => !isFreeIssue(r));
        for (const r of list) {
          if (!r.itemId) continue;
          one.set(r.itemId, (one.get(r.itemId) || 0) + (Number(r.qty) || 0));
          if (!info.has(r.itemId)) {
            const m = masterMap[r.itemId];
            info.set(r.itemId, {
              itemId: r.itemId,
              code: m?.code || r.code || '',
              name: m?.name || r.name || '',
              spec: m?.spec || r.spec || '',
              drawingNo: m?.drawingNo || r.drawingNo || '',
            });
          }
        }
      }
      for (const [k, v] of one) perOne.set(k, Math.max(perOne.get(k) || 0, v));
    }

    const mapped = [...info.values()].map((it) => {
      const fromPo = projectId || siteId ? Math.max(0, Number(received[it.itemId]) || 0) : 0;
      const out = Math.max(0, gone.get(it.itemId) || 0);
      const base = fromPo - out; // 발주서만으로 설명되는 남음
      const adjust = Number(manual[it.itemId]?.qty) || 0; // 손으로 적어 넣은 몫
      const left = Math.max(0, base + adjust);
      const one = perOne.get(it.itemId) || 0;
      return {
        ...it,
        gotIn: fromPo,
        out,
        base,
        adjust,
        left,
        log: manual[it.itemId]?.log || [],
        perOne: one,
        sets: one > 0 ? Math.floor(left / one) : 0,
      };
    });

    const kw = q.trim().toLowerCase();
    const filtered = mapped
      .filter((r) => {
        if (view === 'have' && r.left <= 0) return false;
        if (!kw) return true;
        return [r.code, r.name, r.spec, r.drawingNo].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(kw),
        );
      })
      .sort((x, y) => {
        const a = x.drawingNo || '힣';
        const b = y.drawingNo || '힣';
        return a.localeCompare(b, 'ko') || (x.name || '').localeCompare(y.name || '', 'ko');
      });
    return { rows: filtered, allRows: mapped };
  }, [all, mine, bomByProject, materials, masterMap, received, manual, projectId, siteId, q, view, boxesToCount]);

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
      await setPaidStockTo(company, row, t, { base: row.base, by: me });
      setFixing(null);
      toast('재고를 수정했습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('수정에 실패했습니다', 'error');
    }
  }

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
    return { kinds: allRows.length, left: allRows.reduce((s, r) => s + r.left, 0), sets, worst };
  }, [allRows]);

  return (
    <div className="fstock">
      {/* BOX 별로 나눠 보기 — 1대당·나감·가능 SET 이 그 BOX 기준으로 바뀐다.
          남음은 품목마다 통이 하나뿐이라 BOX 로 못 쪼갠다(늘 전체 값) (2026-09-12 대표님) */}
      {boxesWithRows.length > 1 && (
        <div className="pmat-boxes no-print">
          <ViewSwitch
            options={[ALL_BOX, ...boxesWithRows].map((b) => ({ value: b, label: b }))}
            value={box}
            onChange={setBox}
            ariaLabel="BOX"
            className="pmat-box-switch"
          />
        </div>
      )}

      <div className="fstock-head no-print">
        <div className="fstock-sums">
          <span className="fstock-sum">
            품목 <b>{sums.kinds}</b>
          </span>
          <span className="fstock-sum">
            남음 <b>{won(sums.left)}</b>
          </span>
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
          aria-label="도급 재고 검색"
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

      {rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{view === 'have' ? '남은 도급 자재가 없습니다' : `${company} 도급 품목이 없습니다`}</p>
          <span>BOM 에 도급으로 표시된 품목이 여기에 모입니다. 발주서를 BOM 에 연결해야 들어온 양이 잡힙니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print">
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
                <th
                  scope="col"
                  className="col-num"
                  title={
                    box === ALL_BOX
                      ? '들어온 양 − 나간 양 (손으로 적어 넣은 몫 포함)'
                      : '재고는 품목마다 하나뿐이라 BOX 로 나뉘지 않습니다 — 늘 전체 값입니다'
                  }
                >
                  남음{box === ALL_BOX ? '' : ' (전체)'}
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
              {rows.map((r, i) => (
                <tr key={r.itemId}>
                  <td className="col-no">{i + 1}</td>
                  <td className="pmat-drawing">{r.drawingNo}</td>
                  <td className="u-wrap">{r.name}</td>
                  <td className="pmat-spec u-wrap" title={r.spec}>
                    {r.spec}
                  </td>
                  <td className="col-num">{won(r.perOne)}</td>
                  {/* 개수 말고 몇 대분인지로 보여 준다 (2026-09-12 대표님 「나감 수량말고 세트로만 표시」).
                      정확한 개수는 칸에 손을 올리면 나온다 — 1대당이 없는 품목은 개수 그대로. */}
                  <td className="col-num" title={`${won(r.out)}개`}>
                    {r.perOne > 0 ? `${won(Math.floor(r.out / r.perOne))} SET` : won(r.out)}
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
                        <b>{won(r.left)}</b>
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
            </tbody>
          </table>
        </div>
      )}

      {/* 오간 기록 — 지금 수량이 왜 이 숫자인지 여기서 다 보인다 */}
      {logOf && (
        <Modal isOpen onClose={() => setLogOf(null)} title={`${logOf.name || logOf.code} 기록`} size="lg">
          <p className="field-hint">
            지금 남음 <b>{won(logOf.left)}</b> · 발주서 입고 {won(logOf.gotIn)} − 호기로 나감 {won(logOf.out)}
            {logOf.adjust ? ` · 손으로 적은 몫 ${won(logOf.adjust)}` : ''}
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
                        <td className="col-num">{l.kind === 'fix' ? `${won(l.to)} 으로` : won(l.n)}</td>
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
