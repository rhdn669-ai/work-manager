// 사급 재고 — 고객사가 호기를 정하지 않고 보내온 물건. (2026-09-10 대표님)
//
// 목록은 «그 회사 BOM 에 있는 사급 품목» 전부다. 재고를 한 번도 안 받은 품목도 줄이 보여야
// 무엇이 들어와야 하는지 알 수 있다(대표님 「BOM 에 있는 사급품이 리스트가 되어야」).
//
// 숫자는 서로 이어져 있다.
//   필요   그 회사 호기들이 BOM 대로 쓸 총량
//   투입   이미 호기에 들어간 양(호기 자재 체크에서 체크한 것)
//   재고   여기 쌓여 있는 양 — 「사급 받기」로 늘고, 호기에서 「재고에서 N」으로 줄어든다
//   부족   필요 − 투입 − 재고. 재고를 받으면 곧바로 줄어든다.
import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
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
import { subscribeFreeStock, receiveFreeStock, setFreeStockQty } from '../../services/freeStockService';

const won = (n) => (Number(n) || 0).toLocaleString();
const hasBomLink = (p) => !!p?.bomLink?.projectId;

// 기록에 적히는 말 — 통에 들어옴 / 호기로 나감 / 되돌아옴 / 손으로 맞춤
const LOG_LABEL = { in: '들어옴', out: '호기로', back: '되돌림', fix: '손으로 맞춤' };
const fmtWhen = (v) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
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
  const [q, setQ] = useState('');
  const [view, setView] = useState('all'); // all | have
  // 잠금은 두지 않는다 — 이 화면에서 하는 일은 「들어온 개수 적기」와 「실제 개수로 맞추기」뿐이고,
  // 둘 다 잠가 둘 이유가 없다. 잠금 뒤에 숨겨 두었더니 수정하는 길을 못 찾으셨다 (2026-09-11 대표님).
  const [fixing, setFixing] = useState(null); // { row, to, reason }
  const [logOf, setLogOf] = useState(null); // 기록을 펼쳐 볼 줄
  // 표에서 바로 적는 입고 수량 — 창을 띄우지 않는다 (2026-09-11 대표님)
  const [draft, setDraft] = useState({}); // { [itemId]: '3' }
  const [saving, setSaving] = useState('');

  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribePanels(setPanels), []);
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  useEffect(() => subscribeFreeStock(company, setStock), [company]);

  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // 이 회사 호기 중 BOM 을 연결한 것만 — 끝난 호기(출고)는 뺀다
  const mine = useMemo(
    () =>
      panels.filter(
        (p) =>
          (!p.회사 || p.회사 === company) &&
          hasBomLink(p) &&
          p.overallStatus !== '출고완료' &&
          p.overallStatus !== '출고숨김',
      ),
    [panels, company],
  );

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

  // BOM 의 사급 줄을 호기·BOX 별로 모아 품목 단위로 합친다
  const rows = useMemo(() => {
    const entries = [];
    // 「1대당」 — 호기 하나가 쓰는 개수(BOX 를 합친 값). 호기마다 다르면 가장 큰 값을 쓴다.
    // 회사 전체 합계를 보여 주면 「이 품목 몇 개짜리인지」가 안 보인다 (2026-09-11 대표님)
    const perOne = new Map();
    for (const p of mine) {
      const all = bomByProject[p.bomLink.projectId];
      if (!all) continue;
      const forVariant = bomItemsForVariant(all, p.bomLink.variantKey || '');
      const one = new Map();
      for (const box of CHECKABLE_BOXES) {
        for (const r of bomRowsForBox(forVariant, box).filter(isFreeIssue)) {
          const k = r.itemId || `row:${r.id}`;
          one.set(k, (one.get(k) || 0) + (Number(r.qty) || 0));
        }
      }
      for (const [k, v] of one) perOne.set(k, Math.max(perOne.get(k) || 0, v));
      for (const box of CHECKABLE_BOXES) {
        const list = bomRowsForBox(forVariant, box)
          .filter(isFreeIssue)
          .map((r) => {
            const m = r.itemId ? masterMap[r.itemId] : null;
            return {
              ...r,
              code: m?.code || r.code || '',
              name: m?.name || r.name || '',
              spec: m?.spec || r.spec || '',
              drawingNo: m?.drawingNo || r.drawingNo || '',
            };
          });
        if (list.length === 0) continue;
        entries.push({ panelLabel: p.프로젝트 || p.id, rows: list, received: (materials[p.id] || {})[box] || {} });
      }
    }
    const agg = aggregateShortage(entries, { onlyShort: false });
    const kw = q.trim().toLowerCase();
    return (
      agg
        .map((a) => {
          const have = Math.max(0, Number(stock[a.itemId]?.qty) || 0);
          return { ...a, have, perOne: perOne.get(a.itemId || '') || 0, log: stock[a.itemId]?.log || [] };
        })
        .filter((r) => {
          if (view === 'have' && r.have <= 0) return false;
          if (!kw) return true;
          return [r.code, r.name, r.spec, r.drawingNo].some((v) =>
            String(v || '')
              .toLowerCase()
              .includes(kw),
          );
        })
        // 도번 순 — 표의 첫 열이 도번이라 찾기 쉽다. 도번이 없는 것은 뒤로.
        .sort((x, y) => {
          const a = x.drawingNo || '힣';
          const b = y.drawingNo || '힣';
          return a.localeCompare(b, 'ko') || (x.name || '').localeCompare(y.name || '', 'ko');
        })
    );
  }, [mine, bomByProject, materials, masterMap, stock, q, view]);

  const sums = useMemo(() => {
    const all = rows;
    return {
      kinds: all.length,
      have: all.reduce((s, r) => s + r.have, 0),
    };
  }, [rows]);

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
    const { row, to, reason } = fixing;
    const t = Number(to) || 0;
    if (t === row.have) return setFixing(null);
    if (!(await confirm(`${row.name || row.code} 재고를 ${won(row.have)} → ${won(t)} 으로 고칠까요?`))) return;
    try {
      await setFreeStockQty(company, row, t, { by: me, reason });
      setFixing(null);
      toast('재고를 고쳤습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('고치기에 실패했습니다', 'error');
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
            재고 <b>{won(sums.have)}</b>
          </span>
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
            { value: 'have', label: '재고 있음' },
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
          <p>{view === 'have' ? '재고가 남은 사급 품목이 없습니다' : `${company} 사급 품목이 없습니다`}</p>
          <span>BOM 에 사급으로 표시된 품목이 여기에 모입니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print">
          <table className="table pmat-table">
            <colgroup>
              {['44px', '15%', '16%', null, '8%', '8%', '8%', '13%'].map((w, i) => (
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
                <th scope="col" className="col-num">
                  투입
                </th>
                <th scope="col" className="col-num">
                  재고
                </th>
                <th scope="col" className="col-action">
                  입고 수량
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.itemId || r.code || i}>
                  <td className="col-no">{i + 1}</td>
                  <td className="pmat-drawing">{r.drawingNo}</td>
                  <td className="u-wrap">{r.name}</td>
                  <td className="pmat-spec u-wrap" title={r.spec}>
                    {r.spec}
                  </td>
                  <td className="col-num">{won(r.perOne)}</td>
                  <td className="col-num">{won(r.got)}</td>
                  <td className="col-num">
                    {/* 누르면 그 품목의 오간 기록이 열린다 — 적어 둔 이유도 여기서 보인다
                        (2026-09-11 대표님 「어차피 이유 적어도 표시도 안되네」) */}
                    <button
                      type="button"
                      className="fstock-have"
                      onClick={() => setLogOf(r)}
                      title={`${r.name || r.code} 들어오고 나간 기록 보기`}
                    >
                      <b>{won(r.have)}</b>
                    </button>
                  </td>
                  <td className="col-action">
                    <div className="btn-group">
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
                        aria-label={`${r.name || r.code} 입고 수량`}
                      />
                      {/* 실물을 세어 숫자를 맞출 때 — 잠금과 무관하게 늘 보인다
                          (2026-09-11 대표님, 잠금 뒤에 숨어 있어 못 찾으셨다) */}
                      {r.have > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => setFixing({ row: r, to: String(r.have), reason: '' })}
                          title="실제 개수로 맞추기"
                        >
                          고치기
                        </button>
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
                    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
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
        <Modal isOpen onClose={() => setFixing(null)} title="재고 수량 고치기">
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
            <div className="form-group">
              <label>
                이유 <span className="field-hint-inline">(안 적어도 됩니다)</span>
              </label>
              <input
                value={fixing.reason}
                onChange={(e) => setFixing((s) => ({ ...s, reason: e.target.value }))}
                placeholder="예: 세어 보니 달랐습니다"
                aria-label="이유"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setFixing(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                고치기
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
