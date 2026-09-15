import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import { useDialog } from '../../components/common/useDialog';
import { useArrived } from '../../utils/useArrived';
import { useFillHeight } from '../../utils/useFillHeight';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getBomBySite } from '../../services/bomService';
import { removeMatLog } from '../../services/matLogService';
import { hasBomLink, bomRowsForBox, rowsForPanel } from '../../domain/panelBom';
import { allLogs, logLabel, whyOf } from '../../domain/matLog';

// 자재 이력 — 호기 줄에서 한 일(왜 없나 / 어떻게 채웠나)이 여기에 자동으로 쌓인다.
// 적는 곳은 호기 체크 줄이고, 이 탭은 «보는 곳»이다 (2026-09-15 대표님 「이력 확인 용으로
// 줄에서 한 내용들 자동 기록」).
const nameOf = (p) => `${p?.프로젝트 || ''}${p?.호기 ? ` ${p.호기}` : ''}`.trim() || p?.id || '';
const KIND_LABEL = { out: '빠짐', in: '채움', why: '사유' };

export default function MatLogPage({ company = '' }) {
  const { toast, confirm } = useDialog();
  const scrollRef = useFillHeight();
  const { take, has } = useArrived();

  const [panels, setPanels] = useState([]);
  const [materials, setMaterials] = useState({});
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({});
  const [q, setQ] = useState('');
  useEffect(() => subscribePanels(take('panels', setPanels)), [take]);
  useEffect(() => subscribeAllMaterials(take('materials', setMaterials)), [take]);
  useEffect(() => subscribePurchaseItems(take('master', setMaster)), [take]);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  const mine = useMemo(() => panels.filter((p) => (!p.회사 || p.회사 === company) && hasBomLink(p)), [panels, company]);
  const panelById = useMemo(() => Object.fromEntries(mine.map((p) => [p.id, p])), [mine]);

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
  const itemOf = (row) => (row?.itemId ? masterMap[row.itemId] : null);
  const itemName = (row) => itemOf(row)?.name || row?.name || row?.code || '(품목)';
  const itemDrawing = (row) => itemOf(row)?.drawingNo || row?.drawingNo || '';
  const itemSpec = (row) => itemOf(row)?.spec || row?.spec || '';

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return allLogs(materials)
      .filter((x) => panelById[x.panelId])
      .filter((x) => {
        if (!kw) return true;
        const row = rowOf(panelById[x.panelId], x.box, x.rowId);
        return [
          nameOf(panelById[x.panelId]),
          x.box,
          itemDrawing(row),
          itemName(row),
          itemSpec(row),
          whyOf(x.log),
          x.log.note,
        ].some((v) =>
          String(v || '')
            .toLowerCase()
            .includes(kw),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials, panelById, bomByProject, masterMap, q]);

  async function remove(x) {
    const panel = panelById[x.panelId];
    const row = rowOf(panel, x.box, x.rowId);
    if (
      !(await confirm(
        `${nameOf(panel)} · ${x.box} · ${itemName(row)} — 「${logLabel(x.log, (id) => nameOf(panelById[id]))}」 기록을 지웁니다.\n수량은 그대로 둡니다(지금 수량이 실물입니다). 계속할까요?`,
      ))
    )
      return;
    try {
      await removeMatLog(x.panelId, x.box, x.rowId, x.log.id);
      toast('기록을 지웠습니다', 'success');
    } catch (err) {
      console.error(err);
      toast('지우지 못했습니다', 'error');
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
            기록 <b>{list.length}건</b>
          </span>
          <span className="fstock-sum fstock-sum-other">호기 체크 줄에서 적으면 여기에 쌓입니다</span>
        </div>
        <input
          className="fstock-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="호기·품목·사유로 찾기"
          aria-label="이력 찾기"
        />
      </div>

      {list.length === 0 ? (
        <div className="empty-state">
          <Icon name="box" />
          <p>{company} 자재 이력이 없습니다</p>
          <span>호기 체크 줄에서 수량을 줄이거나 「입고」·「사유」를 누르면 여기에 남습니다.</span>
        </div>
      ) : (
        <div className="table-scroll-x pmat-scroll no-print" ref={scrollRef}>
          <table className="table pmat-table inc-table">
            <colgroup>
              {['44px', '88px', '12%', '8%', '11%', '15%', null, '6%', '14%', '11%', '88px'].map((w, i) => (
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
                <th scope="col">규격</th>
                <th scope="col">구분</th>
                <th scope="col">내용</th>
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
                const cls =
                  x.log.kind === 'in'
                    ? 'status-badge--done'
                    : x.log.kind === 'out'
                      ? 'status-badge--cancel'
                      : 'status-badge--wait';
                return (
                  <tr key={`${x.panelId}:${x.log.id}`}>
                    <td className="col-no">{i + 1}</td>
                    <td className="pmat-meta">{x.log.at}</td>
                    <td className="u-wrap">{nameOf(panel)}</td>
                    <td>{x.box}</td>
                    <td className="pmat-drawing">{itemDrawing(row)}</td>
                    <td className="u-wrap">{itemName(row)}</td>
                    <td className="pmat-spec u-wrap" title={itemSpec(row)}>
                      {itemSpec(row)}
                    </td>
                    <td>
                      <span className={`status-badge ${cls}`}>{KIND_LABEL[x.log.kind] || x.log.kind}</span>
                    </td>
                    <td className="u-wrap">{logLabel(x.log, (id) => nameOf(panelById[id]))}</td>
                    <td className="u-wrap">{x.log.note || ''}</td>
                    <td className="col-action">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        onClick={() => remove(x)}
                        title="기록만 지웁니다"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
