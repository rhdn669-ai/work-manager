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
import EditModeButton from '../../components/common/EditModeButton';
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
  const [view, setView] = useState('short'); // short | all | have
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState(null); // { row, qty, note }
  const [fixing, setFixing] = useState(null); // { row, to, reason }

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
    for (const p of mine) {
      const all = bomByProject[p.bomLink.projectId];
      if (!all) continue;
      const forVariant = bomItemsForVariant(all, p.bomLink.variantKey || '');
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
    return agg
      .map((a) => {
        const have = Math.max(0, Number(stock[a.itemId]?.qty) || 0);
        const short = Math.max(0, a.short - have); // 재고로 채우고도 남는 부족
        return { ...a, have, shortAfterStock: short, log: stock[a.itemId]?.log || [] };
      })
      .filter((r) => {
        if (view === 'short' && r.shortAfterStock <= 0) return false;
        if (view === 'have' && r.have <= 0) return false;
        if (!kw) return true;
        return [r.code, r.name, r.spec, r.drawingNo].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(kw),
        );
      })
      .sort((x, y) => y.shortAfterStock - x.shortAfterStock || (x.name || '').localeCompare(y.name || ''));
  }, [mine, bomByProject, materials, masterMap, stock, q, view]);

  const sums = useMemo(() => {
    const all = rows;
    return {
      kinds: all.length,
      have: all.reduce((s, r) => s + r.have, 0),
      short: all.reduce((s, r) => s + r.shortAfterStock, 0),
    };
  }, [rows]);

  async function onAdd(e) {
    e.preventDefault();
    const { row, qty, note } = adding;
    const n = Number(qty) || 0;
    if (n <= 0) return toast('수량을 적어 주세요', 'error');
    try {
      await receiveFreeStock(company, { itemId: row.itemId, code: row.code, name: row.name, spec: row.spec }, n, {
        by: me,
        note: note || '',
      });
      setAdding(null);
      toast(`${row.name || row.code} ${n}개 받았습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('저장에 실패했습니다', 'error');
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
          <span className="fstock-sum">
            부족 <b className={sums.short > 0 ? 'is-short' : ''}>{won(sums.short)}</b>
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
            { value: 'short', label: '부족' },
            { value: 'have', label: '재고 있음' },
            { value: 'all', label: '전체' },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="보기"
        />
        <div className="fstock-acts">
          <EditModeButton on={editMode} onToggle={() => setEditMode((v) => !v)} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{view === 'short' ? '모자란 사급 품목이 없습니다' : `${company} 사급 품목이 없습니다`}</p>
          <span>BOM 에 사급으로 표시된 품목이 여기에 모입니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print">
          <table className="table pmat-table">
            <colgroup>
              {['44px', '15%', '16%', null, '7%', '7%', '8%', '7%', '13%'].map((w, i) => (
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
                  필요
                </th>
                <th scope="col" className="col-num">
                  투입
                </th>
                <th scope="col" className="col-num">
                  재고
                </th>
                <th scope="col" className="col-num">
                  부족
                </th>
                <th scope="col" className="col-action">
                  받기
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.itemId || r.code || i} className={r.shortAfterStock > 0 ? '' : 'is-done'}>
                  <td className="col-no">{i + 1}</td>
                  <td className="pmat-drawing">{r.drawingNo}</td>
                  <td className="u-wrap">{r.name}</td>
                  <td className="pmat-spec u-wrap" title={r.spec}>
                    {r.spec}
                  </td>
                  <td className="col-num">{won(r.need)}</td>
                  <td className="col-num">{won(r.got)}</td>
                  <td className="col-num">
                    <b>{won(r.have)}</b>
                  </td>
                  <td className={`col-num${r.shortAfterStock > 0 ? ' is-short' : ''}`}>
                    {r.shortAfterStock > 0 ? won(r.shortAfterStock) : ''}
                  </td>
                  <td className="col-action">
                    <div className="btn-group">
                      {editMode && r.have > 0 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => setFixing({ row: r, to: String(r.have), reason: '' })}
                        >
                          고치기
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => setAdding({ row: r, qty: String(r.shortAfterStock || ''), note: '' })}
                        title={`${r.name || r.code} 받은 수량 적기`}
                      >
                        받기
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <Modal isOpen onClose={() => setAdding(null)} title="사급 받기">
          <form onSubmit={onAdd}>
            <p className="field-hint" style={{ marginTop: 0 }}>
              <strong>{adding.row.name || adding.row.code}</strong>
              {adding.row.spec ? ` · ${adding.row.spec}` : ''}
              <br />
              필요 {won(adding.row.need)} · 투입 {won(adding.row.got)} · 지금 재고 {won(adding.row.have)}
            </p>
            <div className="form-group">
              <label>받은 수량</label>
              <input
                autoFocus
                value={adding.qty}
                onChange={(e) => setAdding((s) => ({ ...s, qty: e.target.value.replace(/[^0-9]/g, '') }))}
                inputMode="numeric"
                placeholder="0"
                aria-label="받은 수량"
              />
            </div>
            <div className="form-group">
              <label>메모</label>
              <input
                value={adding.note}
                onChange={(e) => setAdding((s) => ({ ...s, note: e.target.value }))}
                placeholder="언제·어디서 왔는지 (선택)"
                aria-label="메모"
              />
            </div>
            <p className="field-hint">지금 재고에 더해집니다. 호기 자재 체크에서 「재고에서 N」으로 가져다 씁니다.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setAdding(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                받기
              </button>
            </div>
          </form>
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
              <label>이유</label>
              <input
                value={fixing.reason}
                onChange={(e) => setFixing((s) => ({ ...s, reason: e.target.value }))}
                placeholder="세어 보니 다름 등"
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
