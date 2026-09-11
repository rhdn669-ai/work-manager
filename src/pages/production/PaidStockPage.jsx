import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/common/Icon';
import ViewSwitch from '../../components/common/ViewSwitch';
import { subscribePanels } from '../../services/productionService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { getBomBySite, bomItemsForVariant, isFreeIssue } from '../../services/bomService';
import { subscribeReceivedFor, subscribePaidSetSettings } from '../../services/paidSetService';
import { CHECKABLE_BOXES, bomRowsForBox, hasBomLink } from '../../domain/panelBom';
import { receivedQty } from '../../domain/panelMaterials';

// 도급 재고 — 「우리가 사서 들어온 것 중 아직 어느 호기에도 안 간 양」.
//
// 사급은 통(사급 재고)이 눈에 보이는데 도급은 그렇지 않았다. 발주서 입고량에서 이미
// 배정된 양을 뺀 값이라 계산으로만 있었고, 「지금 몇 대분 되나」를 알려면 도급 배정
// 화면을 열어 봐야 했다 (2026-09-11 대표님 「도급 통은 발주서 입고로 체크하고
// 사급은 사급재고가 통이 되는거맞음?」).
//
// 사급 재고 화면과 같은 표로 보여 준다 — 두 통이 같은 모양이라야 헷갈리지 않는다.
//   들어옴   이 BOM 으로 묶인 발주서들의 입고 수량 합
//   나감     호기들에 이미 들어간 양
//   남음     들어옴 − 나감
//   1대당    호기 하나가 쓰는 개수 (BOX 합)
//   가능 SET 남음 ÷ 1대당 (버림)
const won = (n) => (Number(n) || 0).toLocaleString();

export default function PaidStockPage({ company = '' }) {
  const [panels, setPanels] = useState([]);
  const [materials, setMaterials] = useState({});
  const [master, setMaster] = useState([]);
  const [bomByProject, setBomByProject] = useState({});
  const [received, setReceived] = useState({}); // { itemId: 들어온 합 }
  const [settings, setSettings] = useState({});
  const [q, setQ] = useState('');
  const [view, setView] = useState('all'); // all | have

  useEffect(() => subscribePanels(setPanels), []);
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribePaidSetSettings(setSettings), []);

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

  const projectId = mine[0]?.bomLink?.projectId || '';

  // 들어온 양 — BOM 으로 묶인 발주서 + (옛 방식) 설정된 현장의 발주서.
  // 볼 곳이 없으면 구독만 걸지 않는다 — 그릴 때 상태를 건드리면 화면을 두 번 그린다.
  const siteId = settings?.[company]?.siteId || '';
  useEffect(() => {
    if (!projectId && !siteId) return undefined;
    return subscribeReceivedFor({ bomProjectId: projectId, siteId }, (byItem) => setReceived(byItem || {}));
  }, [projectId, siteId]);

  // BOM 은 프로젝트마다 한 번만 읽는다
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

  const { rows, allRows } = useMemo(() => {
    const perOne = new Map(); // 1대당 (호기마다 다르면 가장 큰 값)
    const gone = new Map(); // 호기들에 이미 들어간 양
    const info = new Map(); // 품목 정보

    for (const p of mine) {
      const all = bomByProject[p.bomLink.projectId];
      if (!all) continue;
      const forVariant = bomItemsForVariant(all, p.bomLink.variantKey || '');
      const one = new Map();
      for (const box of CHECKABLE_BOXES) {
        const list = bomRowsForBox(forVariant, box).filter((r) => !isFreeIssue(r));
        const rec = (materials[p.id] || {})[box] || {};
        for (const r of list) {
          if (!r.itemId) continue;
          one.set(r.itemId, (one.get(r.itemId) || 0) + (Number(r.qty) || 0));
          gone.set(r.itemId, (gone.get(r.itemId) || 0) + receivedQty(rec, r.id));
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
      const gotIn = projectId || siteId ? Math.max(0, Number(received[it.itemId]) || 0) : 0;
      const out = Math.max(0, gone.get(it.itemId) || 0);
      const left = Math.max(0, gotIn - out);
      const one = perOne.get(it.itemId) || 0;
      return { ...it, gotIn, out, left, perOne: one, sets: one > 0 ? Math.floor(left / one) : 0 };
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
  }, [mine, bomByProject, materials, masterMap, received, projectId, siteId, q, view]);

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
              {['44px', '14%', '15%', null, '7%', '8%', '8%', '8%'].map((w, i) => (
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
                <th scope="col" className="col-num" title="지금 남은 것으로 몇 대분이 되나">
                  가능 SET
                </th>
                <th scope="col" className="col-num" title="호기들에 이미 들어간 양">
                  나감
                </th>
                <th scope="col" className="col-num" title="들어온 양 − 나간 양">
                  남음
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
                  <td className={`col-num${r.perOne > 0 && r.sets === 0 ? ' is-short' : ''}`}>
                    {r.perOne > 0 ? `${won(r.sets)} SET` : ''}
                  </td>
                  <td className="col-num">{won(r.out)}</td>
                  <td className="col-num">
                    <b>{won(r.left)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
