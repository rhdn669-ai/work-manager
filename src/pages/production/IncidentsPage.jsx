import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import Modal from '../../components/common/Modal';
import Select from '../../components/common/Select';
import MemoInput from '../../components/common/MemoInput';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { useArrived } from '../../utils/useArrived';
import { useFillHeight } from '../../utils/useFillHeight';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getBomBySite } from '../../services/bomService';
import { addIncident, closeIncident } from '../../services/incidentService';
import { CHECKABLE_BOXES, hasBomLink, bomRowsForBox, rowsForPanel } from '../../domain/panelBom';
import { stockKindOf } from '../../domain/stockLedger';
import { REASONS, allIncidents, isOpen, statusLabel } from '../../domain/incidents';

// 분실·파손 장부 — 사건 하나 = 줄 하나. (2026-09-15 대표님 「분실 파손 이력 탭하나를 만들고 거기서 운용」)
// 등록하면 빌려준 호기 줄이 −n 되어 부족 집계에 뜨고, 사건 난 호기 줄에는 「파손 1 · 수리 대기」가 붙는다.
// 파손은 수리품이 돌아오면 「수리 입고」(통 +n), 분실은 재구매가 들어오면 「입고됨」으로 닫는다.
const nameOf = (p) => `${p?.프로젝트 || ''}${p?.호기 ? ` ${p.호기}` : ''}`.trim() || p?.id || '';

export default function IncidentsPage({ company = '' }) {
  const { userProfile } = useAuth();
  const { toast, confirm } = useDialog();
  const me = userProfile?.name || '';
  const scrollRef = useFillHeight();
  const { take, has } = useArrived();

  const [panels, setPanels] = useState([]);
  const [materials, setMaterials] = useState({});
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({});
  useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
  useEffect(() => subscribeAllMaterials(take('materials', setMaterials)), [take]);
  useEffect(() => subscribePurchaseItems(take('master', setMaster)), [take]);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // 이 회사 호기 — 끝난 호기도 (옛 사건이 걸려 있을 수 있다)
  const mine = useMemo(() => panels.filter((p) => (!p.회사 || p.회사 === company) && hasBomLink(p)), [panels, company]);
  const panelById = useMemo(() => Object.fromEntries(mine.map((p) => [p.id, p])), [mine]);
  const living = useMemo(
    () => mine.filter((p) => p.overallStatus !== '출고완료' && p.overallStatus !== '출고숨김'),
    [mine],
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

  const rowOf = (panel, box, rowId) => {
    const rows0 = bomByProject[panel?.bomLink?.projectId];
    if (!rows0) return null;
    return bomRowsForBox(rowsForPanel(rows0, panel), box).find((r) => r.id === rowId) || null;
  };
  const itemName = (row) => {
    const m = row?.itemId ? masterMap[row.itemId] : null;
    return m?.name || row?.name || row?.code || '(품목)';
  };
  const itemDrawing = (row) => {
    const m = row?.itemId ? masterMap[row.itemId] : null;
    return m?.drawingNo || row?.drawingNo || '';
  };

  // 이 회사 호기의 사건만, 최신순
  const list = useMemo(() => allIncidents(materials).filter((x) => panelById[x.panelId]), [materials, panelById]);
  const openCount = list.filter((x) => isOpen(x.inc)).length;

  // ── 등록 창 ──
  const [form, setForm] = useState(null); // { panelId, box, rowId, reason, n, from, note }
  const openForm = () =>
    setForm({ panelId: living[0]?.id || '', box: '', rowId: '', reason: '파손', n: '1', from: '', note: '' });
  const formPanel = form ? panelById[form.panelId] : null;
  const formBoxes = useMemo(() => {
    if (!formPanel) return [];
    const rows0 = bomByProject[formPanel.bomLink.projectId] || [];
    const rows = rowsForPanel(rows0, formPanel);
    return CHECKABLE_BOXES.filter((b) => bomRowsForBox(rows, b).length > 0);
  }, [formPanel, bomByProject]);
  const formRows = useMemo(() => {
    if (!formPanel || !form?.box) return [];
    const rows0 = bomByProject[formPanel.bomLink.projectId] || [];
    return bomRowsForBox(rowsForPanel(rows0, formPanel), form.box);
  }, [formPanel, form?.box, bomByProject]);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!form || !formPanel || !form.box || !form.rowId) return;
    const row = formRows.find((r) => r.id === form.rowId);
    if (!row) return;
    const n = Math.max(1, Number(form.n) || 1);
    const fromName = form.from ? nameOf(panelById[form.from]) : nameOf(formPanel);
    if (
      !(await confirm(
        `${nameOf(formPanel)} · ${form.box} · ${itemName(row)} ${form.reason} ${n}개를 등록합니다.\n${fromName} 줄의 수량이 ${n} 줄어듭니다. 계속할까요?`,
      ))
    )
      return;
    setSaving(true);
    try {
      await addIncident(formPanel, form.box, row, { reason: form.reason, n, from: form.from, by: me, note: form.note });
      setForm(null);
      toast(`${form.reason} ${n}개를 등록했습니다 — ${fromName} 줄이 ${n} 줄었습니다`, 'success');
    } catch (err) {
      console.error(err);
      toast('등록하지 못했습니다', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function close(x) {
    const panel = panelById[x.panelId];
    const row = rowOf(panel, x.box, x.rowId);
    const 파손 = x.inc.reason === '파손';
    const msg = 파손
      ? `${itemName(row)} 수리품 ${x.inc.n}개가 돌아왔습니까? ${company} 재고 통에 ${x.inc.n} 더해집니다.`
      : `${itemName(row)} 재구매분이 들어왔습니까? 이 사건을 닫습니다 (통은 발주 입고가 이미 올렸습니다).`;
    if (!(await confirm(msg))) return;
    try {
      await closeIncident(x.panelId, x.box, x.rowId, x.inc.id, {
        by: me,
        stock: 파손 && row?.itemId ? { kind: stockKindOf(row), company, itemId: row.itemId } : null,
      });
      toast(파손 ? '수리 입고로 닫았습니다 — 재고 통에 더했습니다' : '입고됨으로 닫았습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('닫지 못했습니다', 'error');
    }
  }

  const ready = has('panels', 'materials', 'master') && mine.every((p) => p.bomLink.projectId in bomByProject);
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
            사건 <b>{list.length}건</b>
          </span>
          <span className="fstock-sum" title="수리 대기 · 재구매 대기">
            열림 <b className={openCount > 0 ? 'is-short' : ''}>{openCount}</b>
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-primary" onClick={openForm} disabled={living.length === 0}>
          <Icon name="plus" className="btn-ic" />
          등록
        </button>
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{company} 분실·파손 기록이 없습니다</p>
          <span>호기를 만들다 부품이 파손·분실돼 뒤 호기에서 빌려 왔을 때 여기 적습니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x no-print" ref={scrollRef}>
          <table className="table pmat-table inc-table">
            <colgroup>
              {['44px', '84px', '13%', '9%', '12%', null, '7%', '6%', '11%', '10%', '14%', '96px'].map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">날짜</th>
                <th scope="col">호기</th>
                <th scope="col">BOX</th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">사유</th>
                <th scope="col" className="col-num">
                  수량
                </th>
                <th scope="col">빌려온 호기</th>
                <th scope="col">상태</th>
                <th scope="col">비고</th>
                <th scope="col" className="col-action">
                  {' '}
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((x, i) => {
                const panel = panelById[x.panelId];
                const row = rowOf(panel, x.box, x.rowId);
                const open = isOpen(x.inc);
                return (
                  <tr key={x.inc.id} className={open ? '' : 'is-done'}>
                    <td className="col-no">{i + 1}</td>
                    <td className="pmat-meta">{x.inc.at}</td>
                    <td className="u-wrap">{nameOf(panel)}</td>
                    <td>{x.box}</td>
                    <td className="pmat-drawing">{itemDrawing(row)}</td>
                    <td className="u-wrap">{itemName(row)}</td>
                    <td>
                      <span
                        className={`status-badge ${x.inc.reason === '파손' ? 'status-badge--wait' : 'status-badge--cancel'}`}
                      >
                        {x.inc.reason}
                      </span>
                    </td>
                    <td className="col-num">{x.inc.n}</td>
                    <td className="u-wrap">{x.inc.from ? nameOf(panelById[x.inc.from]) : '— (빈자리 여기)'}</td>
                    <td>
                      <span className={`status-badge ${open ? 'status-badge--wait' : 'status-badge--done'}`}>
                        {statusLabel(x.inc)}
                      </span>
                      {!open && x.inc.doneAt && <span className="pmat-meta"> {x.inc.doneAt}</span>}
                    </td>
                    <td className="pmat-note-cell">
                      <MemoInput value={x.inc.note || ''} readOnly ariaLabel="비고" />
                    </td>
                    <td className="col-action">
                      {open && (
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => close(x)}>
                          {x.inc.reason === '파손' ? '수리 입고' : '입고됨'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <Modal isOpen onClose={() => setForm(null)} title="분실·파손 등록">
          <form onSubmit={submit}>
            <div className="form-group">
              <label>호기</label>
              <Select
                value={form.panelId}
                onChange={(v) => setForm((f) => ({ ...f, panelId: v, box: '', rowId: '' }))}
                options={living.map((p) => ({ value: p.id, label: nameOf(p) }))}
                placeholder="호기 선택"
                ariaLabel="호기"
                native
              />
            </div>
            <div className="form-group">
              <label>BOX</label>
              <Select
                value={form.box}
                onChange={(v) => setForm((f) => ({ ...f, box: v, rowId: '' }))}
                options={formBoxes.map((b) => ({ value: b, label: b }))}
                placeholder="BOX 선택"
                ariaLabel="BOX"
                native
              />
            </div>
            <div className="form-group">
              <label>품목</label>
              <Select
                value={form.rowId}
                onChange={(v) => setForm((f) => ({ ...f, rowId: v }))}
                options={formRows.map((r) => ({
                  value: r.id,
                  label: `${itemDrawing(r) ? `${itemDrawing(r)} · ` : ''}${itemName(r)}`,
                }))}
                placeholder={form.box ? '품목 선택' : 'BOX 를 먼저'}
                ariaLabel="품목"
                native
              />
            </div>
            <div className="form-group inc-form-row">
              <div>
                <label>사유</label>
                <Select
                  value={form.reason}
                  onChange={(v) => setForm((f) => ({ ...f, reason: v }))}
                  options={REASONS.map((r) => ({ value: r, label: r }))}
                  ariaLabel="사유"
                  native
                />
              </div>
              <div>
                <label>수량</label>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={form.n}
                  onChange={(e) => setForm((f) => ({ ...f, n: e.target.value.replace(/[^0-9]/g, '') }))}
                  aria-label="수량"
                />
              </div>
            </div>
            <div className="form-group">
              <label>빌려온 호기</label>
              <Select
                value={form.from}
                onChange={(v) => setForm((f) => ({ ...f, from: v }))}
                options={[
                  { value: '', label: '없음 — 빈자리는 이 호기' },
                  ...living.filter((p) => p.id !== form.panelId).map((p) => ({ value: p.id, label: nameOf(p) })),
                ]}
                ariaLabel="빌려온 호기"
                native
              />
              <p className="field-hint">
                고르면 그 호기 줄의 수량이 줄어 부족 집계에 뜹니다. 재고 통은 움직이지 않습니다.
              </p>
            </div>
            <div className="form-group">
              <label>비고</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="예) 커넥터 깨짐"
                aria-label="비고"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || !form.box || !form.rowId}>
                {saving ? '등록 중…' : '등록'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
