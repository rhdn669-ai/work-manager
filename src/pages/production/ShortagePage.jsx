import { useEffect, useMemo, useState } from 'react';
import { useFillHeight } from '../../utils/useFillHeight';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import ViewSwitch from '../../components/common/ViewSwitch';
import IopnDocBrand from '../../components/admin/IopnDocBrand';
import { useDialog } from '../../components/common/useDialog';
import { subscribePanels } from '../../services/productionService';
import { getBomBySite, bomItemsForVariant } from '../../services/bomService';
import { MADE, inKindTab } from '../../domain/itemKind';
import { subscribePurchaseItems } from '../../services/purchaseService';
import { subscribeAllMaterials } from '../../services/panelMaterialsService';
import { CHECKABLE_BOXES, hasBomLink, bomRowsForBox, isMatStarted } from '../../domain/panelBom';
import { aggregateShortage } from '../../domain/panelMaterials';
import { consumedByItem } from '../../domain/paidSets';
import { subscribeReceivedFor, subscribePaidSetSettings } from '../../services/paidSetService';
import { specFontClass, localStamp } from '../../utils/printText';

// 부족 집계 — «지금 체크하고 있는» 호기가 앞으로 더 넣어야 할 양
// (2026-09-14 대표님 「부족집계를 살려서 현재 체크 진행중인 호기의 배정된 부족수량을 표시하고
// 재고에는 배정안된 실제 수량만 표시하자」).
//
// 처음에는 호기 범위를 골라 세었는데(2026-09-03), 계획만 있는 호기까지 들어가 아직 사지
// 않아도 될 양이 부족으로 잡혔다. 그래서 범위 고르기를 걷어내고 «수량을 하나라도 적은 호기»
// 만 센다 — 그 호기가 곧 「지금 만들고 있는 것」이다.
//
// 그 호기들의 BOM 구성품을 품목 마스터 id 로 합쳐 「무엇이 총 몇 개 모자란지」와
// 「어느 호기가 모자란지」를 보여준다. 호기마다 BOM 이 달라도 같은 품목이면 한 줄이다.
// 발주로 바로 넘기도록 붙여넣기 형식(코드 <탭> 수량)으로 복사할 수 있다.
// 출력 열 폭(%) — NO·품목명·도번·규격·필요수량·입고수량·부족·호기, 합 100
const SHT_PRINT_COLS = [5, 22, 12, 23, 6, 6, 6, 20];
// 화면 열 폭 — 숫자·코드는 고정, 품명·규격이 남는 폭을 흡수(§28 「좌측부터 채운다」). null = 가변
// 코드 열은 뺐다 — 생산 화면은 도번·품명으로 본다 (2026-09-08 대표님)
const SHT_SCREEN_COLS = [44, 140, null, null, 76, 76, 76, 84, 84, 200];

const hogiOf = (p) =>
  [p.프로젝트, p.호기]
    .map((v) => (v || '').trim())
    .filter(Boolean)
    .join(' · ');

// embedded: 자재 허브 탭 안 (2026-09-05 안 B 2단계)
export default function ShortagePage({ embedded = false, company: companyProp = '' } = {}) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useDialog();
  const scrollRef = useFillHeight();
  // 주소에 회사가 없으면 화면(자재 허브)이 정한 회사를 쓴다 — 안 그러면 메티스·디에이치가
  // 한 표에 합쳐진다 (2026-09-14 대표님 점검 요청)
  const company = sp.get('company') || companyProp || '';

  const [panels, setPanels] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [bomByProject, setBomByProject] = useState({}); // { projectId: rows[] }
  const [master, setMaster] = useState([]);
  const [materials, setMaterials] = useState({}); // { panelId: { box: items } }
  const [supplyTab, setSupplyTab] = useState('paid');

  useEffect(
    () =>
      subscribePanels((rows) => {
        setPanels(rows.filter((p) => !company || !p.회사 || p.회사 === company));
        setLoaded(true);
      }),
    [company],
  );
  useEffect(() => subscribePurchaseItems(setMaster), []);
  useEffect(() => subscribeAllMaterials(setMaterials), []);
  const masterMap = useMemo(() => Object.fromEntries(master.map((m) => [m.id, m])), [master]);

  // ── 집계 대상 — «지금 체크하고 있는» 호기만 ──
  // 끝난 호기는 뺀다(나갈 자재가 없다). 남은 호기 중 수량을 하나라도 적은 것이 「세는 호기」다.
  const living = useMemo(
    () => panels.filter((p) => p.overallStatus !== '출고완료' && p.overallStatus !== '출고숨김' && hasBomLink(p)),
    [panels],
  );
  const linked = useMemo(() => living.filter((p) => isMatStarted(materials[p.id])), [living, materials]);
  // 아직 수량을 한 개도 안 적은 호기 — 계획만 있는 것이라 세지 않는다
  const waiting = living.length - linked.length;

  // ── 범위 안 호기가 쓰는 BOM 을 프로젝트별로 한 번씩만 읽는다 ──
  useEffect(() => {
    const ids = [...new Set(linked.map((p) => p.bomLink.projectId))].filter((id) => !(id in bomByProject));
    if (ids.length === 0) return undefined;
    let alive = true;
    Promise.all(ids.map((id) => getBomBySite(id).then((rows) => [id, rows || []])))
      .then((pairs) => {
        if (!alive) return;
        setBomByProject((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
      })
      .catch(() => {
        if (alive) toast('BOM 을 불러오지 못했습니다', 'error');
      });
    return () => {
      alive = false;
    };
  }, [linked, bomByProject, toast]);

  // ── 집계 ──
  const entries = useMemo(() => {
    const out = [];
    for (const p of linked) {
      const all = bomByProject[p.bomLink.projectId];
      if (!all) continue;
      const forVariant = bomItemsForVariant(all, p.bomLink.variantKey || '');
      const label = hogiOf(p) || p.id;
      for (const box of CHECKABLE_BOXES) {
        const rows = bomRowsForBox(forVariant, box)
          .filter((r) => inKindTab(r, supplyTab === MADE ? 'made' : supplyTab))
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
        if (rows.length === 0) continue;
        out.push({ panelLabel: label, rows, received: (materials[p.id] || {})[box] || {} });
      }
    }
    return out;
  }, [linked, bomByProject, materials, masterMap, supplyTab]);
  const list = useMemo(() => aggregateShortage(entries), [entries]);

  // 부족 품목을 어디서 끌어올 수 있나 — 발주 여유(입고 − 배정 호기가 가져간 양) · 창고 재고 (2026-09-05 대표님)
  const [settings, setSettings] = useState({});
  useEffect(() => subscribePaidSetSettings(setSettings), []);
  const projectIds = useMemo(() => [...new Set(linked.map((p) => p.bomLink.projectId))].sort(), [linked]);
  const siteId = settings?.[company]?.siteId || '';
  const [receivedByProject, setReceivedByProject] = useState({});
  useEffect(() => {
    const unsubs = projectIds.map((pid) =>
      subscribeReceivedFor({ bomProjectId: pid, siteId }, (byItem) =>
        setReceivedByProject((prev) => ({ ...prev, [pid]: byItem })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [projectIds, siteId]);
  const spareByItem = useMemo(() => {
    const received = {};
    const seenSite = new Set(); // 현장 발주서는 프로젝트마다 겹쳐 들어오니 한 번만
    for (const pid of projectIds) {
      for (const [itemId, q] of Object.entries(receivedByProject[pid] || {})) {
        if (seenSite.has(itemId) && siteId) continue;
        received[itemId] = (received[itemId] || 0) + q;
        if (siteId) seenSite.add(itemId);
      }
    }
    const allRows = projectIds.flatMap((pid) => bomByProject[pid] || []);
    const assigned = panels.filter(
      (p) => p.paidSet && p.bomLink?.projectId && projectIds.includes(p.bomLink.projectId),
    );
    const consumed = consumedByItem(
      allRows,
      assigned.map((p) => materials[p.id] || {}),
    );
    const out = {};
    for (const [itemId, q] of Object.entries(received)) out[itemId] = q - (consumed[itemId] || 0);
    return out;
  }, [projectIds, receivedByProject, siteId, bomByProject, panels, materials]);
  const stockOf = (itemId) => {
    const m = itemId ? masterMap[itemId] : null;
    return m && m.stockQty !== undefined && m.stockQty !== null ? Math.max(0, Number(m.stockQty) || 0) : null;
  };
  const totalShort = list.reduce((s, a) => s + a.short, 0);

  // 발주서 「품목 불러오기 → 코드 붙여넣기」 형식 그대로 — 코드(없으면 도번) <탭> 수량
  const copyForOrder = async () => {
    const text = list.map((a) => `${a.code || a.drawingNo || a.name}\t${a.short}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 API 가 막힌 환경(포커스 없음·http) — 숨은 textarea 로 복사
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) {
        toast('복사에 실패했습니다', 'error');
        return;
      }
    }
    toast(`${list.length}건을 복사했습니다 — 발주서 「품목 불러오기」에 붙여넣으세요`, 'success');
  };

  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/production', { replace: true }));
  const docNo = `SHT${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const stamp = localStamp();

  if (!loaded)
    return (
      <div className="page">
        <p className="text-muted">불러오는 중…</p>
      </div>
    );

  return (
    <div className="page pmat-page sht-page">
      {/* 머리: 제목(좌) · 주행동 1개(발주용 복사)+출력(우측 끝). 범위는 아래 카드로 — 제목이 길어지지 않게 */}
      <div className={`page-header no-print${embedded ? ' page-header--sub is-actions-only' : ''}`}>
        <div>
          {!embedded && (
            <>
              <button type="button" className="btn btn-sm btn-outline" onClick={back}>
                <Icon name="chevronLeft" className="btn-ic" />
                생산현황
              </button>
              <h2 className="page-title pmat-title">
                부족 자재 집계 <span className="pmat-title-sub">· {company || '전체'}</span>
              </h2>
            </>
          )}
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-sm btn-primary" disabled={list.length === 0} onClick={copyForOrder}>
            <Icon name="copy" className="btn-ic" />
            발주용 복사
          </button>
          <button type="button" className="btn btn-sm btn-outline" onClick={() => window.print()}>
            <Icon name="doc" className="btn-ic" />
            출력
          </button>
        </div>
      </div>

      {/* 조건 카드: 무엇을 세는지(좌) · 도급/사급/판금(우) */}
      <div className="card sht-controls no-print">
        <div className="sht-range">
          <span className="sht-range-label">집계 대상</span>
          <span className="sht-range-what">수량을 적기 시작한 호기 {linked.length}대</span>
        </div>
        <div className="sht-kinds">
          <ViewSwitch
            options={[
              { value: 'paid', label: '도급' },
              { value: 'free', label: '사급' },
              // 판금도 나란히 — 안 넣으면 판금 줄이 도급 탭에 섞인다 (2026-09-14 대표님 점검)
              { value: MADE, label: MADE },
            ]}
            value={supplyTab}
            onChange={setSupplyTab}
            ariaLabel="도급 사급 구분"
          />
        </div>
      </div>

      {/* 요약 카드 — 발주 판단에 쓰는 숫자 4개 */}
      <div className="admin-stats sht-stats no-print">
        <div className="admin-stat">
          <div className="admin-stat-label">부족 품목</div>
          <div className="admin-stat-value">
            {list.length}
            <span>종</span>
          </div>
          <div className="admin-stat-sub">
            {supplyTab === MADE ? MADE : supplyTab === 'free' ? '사급' : '도급'} 기준
          </div>
        </div>
        <div className={`admin-stat${totalShort > 0 ? ' is-warning' : ''}`}>
          <div className="admin-stat-label">총 부족 수량</div>
          <div className="admin-stat-value">
            {totalShort.toLocaleString()}
            <span>개</span>
          </div>
          <div className="admin-stat-sub">{totalShort > 0 ? '발주 필요' : '모자란 구성품 없음'}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">집계 호기</div>
          <div className="admin-stat-value">
            {linked.length}
            <span>개</span>
          </div>
          <div className="admin-stat-sub">체크 진행 중</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">아직 시작 안 함</div>
          <div className="admin-stat-value">
            {waiting}
            <span>개</span>
          </div>
          <div className="admin-stat-sub">
            {waiting > 0 ? '수량을 적으면 집계에 들어옵니다' : '남은 호기가 전부 집계 중'}
          </div>
        </div>
      </div>

      {list.length > 0 ? (
        <div className="table-scroll-x pmat-scroll no-print" ref={scrollRef}>
          <table className="table pmat-table sht-table">
            <colgroup>
              {SHT_SCREEN_COLS.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* (2026-09-05 No 열 표준) */}
                <th scope="col" className="col-no">
                  No
                </th>
                <th scope="col">도번</th>
                <th scope="col">품명</th>
                <th scope="col">규격</th>
                <th scope="col" className="pmat-num">
                  필요 수량 합
                </th>
                <th scope="col" className="pmat-num">
                  입고 수량 합
                </th>
                <th scope="col" className="pmat-num">
                  부족
                </th>
                <th scope="col" className="pmat-num" title="발주 입고분 중 아직 호기에 안 들어간 양">
                  발주 여유
                </th>
                <th scope="col" className="pmat-num" title="창고 재고 (재고 화면에 올린 품목만)">
                  창고 재고
                </th>
                <th scope="col">모자란 호기</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={a.itemId || `${a.code}-${i}`}>
                  <td className="col-no">{i + 1}</td>
                  <td className="sht-drawing">{masterMap[a.itemId]?.drawingNo || ''}</td>
                  <td className="sht-name">{a.name}</td>
                  <td className="sht-spec" title={a.spec}>
                    {a.spec}
                  </td>
                  <td className="pmat-num">{a.need}</td>
                  <td className="pmat-num">{a.got}</td>
                  <td className="pmat-num">
                    <span className="status-badge status-badge--cancel sht-short">{a.short}</span>
                  </td>
                  <td className={`pmat-num${(spareByItem[a.itemId] || 0) > 0 ? ' is-have' : ''}`}>
                    {a.itemId && spareByItem[a.itemId] !== undefined ? Math.max(0, spareByItem[a.itemId]) : '–'}
                  </td>
                  <td className={`pmat-num${(stockOf(a.itemId) || 0) > 0 ? ' is-have' : ''}`}>
                    {stockOf(a.itemId) === null ? '–' : stockOf(a.itemId)}
                  </td>
                  <td className="sht-panels">
                    {a.panels.slice(0, 3).map((h) => (
                      <span key={h} className="status-badge status-badge--wait">
                        {h}
                      </span>
                    ))}
                    {a.panels.length > 3 && (
                      <span className="sht-more" title={a.panels.slice(3).join(', ')}>
                        +{a.panels.length - 3}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card sht-empty no-print">
          <Icon name="check" className="sht-empty-ic" />
          <strong>모자란 구성품이 없습니다</strong>
          <span>
            {linked.length === 0
              ? '아직 수량을 적기 시작한 호기가 없습니다 — 호기 체크에서 수량을 적으면 여기에 모입니다'
              : `체크 중인 ${linked.length}대의 ${supplyTab === MADE ? MADE : supplyTab === 'free' ? '사급' : '도급'} 구성품이 전부 들어왔습니다`}
          </span>
        </div>
      )}

      {/* ── 출력 ── */}
      <div className="print-form-iopn print-form-paged print-only">
        <div className="bom-print-page">
          <IopnDocBrand title={`부족 자재 · ${company || '전체'}`} titleClass="bom-list-title is-long" />
          <div className="bom-print-supplier-band">
            {supplyTab === MADE ? MADE : supplyTab === 'free' ? '사급' : '도급'} · 체크 중인 호기 {linked.length}대 ·{' '}
            {stamp}
          </div>
          <table className="iopn-items-table sht-print-table">
            {/* 열 구성이 BOM 출력과 달라 폭은 여기서 준다 — BOM 출력 폭 규칙(:not 체인)이 클래스 규칙보다
                세서 CSS 로는 못 이기고, table-layout: fixed 는 col 폭을 첫 줄 칸보다 먼저 본다 */}
            <colgroup>
              {SHT_PRINT_COLS.map((w, i) => (
                <col key={i} style={{ width: `${w}%` }} />
              ))}
            </colgroup>
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
                  필요 수량
                </th>
                <th scope="col" className="c-qty">
                  입고 수량
                </th>
                <th scope="col" className="c-qty">
                  부족
                </th>
                <th scope="col" className="c-from">
                  호기
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={a.itemId || `${a.code}-${i}`}>
                  <td className="c-no">{i + 1}</td>
                  <td className={`c-name ${specFontClass(a.name, 13)}`}>{a.name}</td>
                  <td className={`c-drawing ${specFontClass(masterMap[a.itemId]?.drawingNo || '', 12)}`}>
                    {masterMap[a.itemId]?.drawingNo || ''}
                  </td>
                  <td className={`c-spec ${specFontClass(a.spec, 36)}`}>{a.spec}</td>
                  <td className="c-qty">{a.need}</td>
                  <td className="c-qty">{a.got}</td>
                  <td className="c-qty">{a.short}</td>
                  <td className={`c-from ${specFontClass(a.panels.join(' '), 18)}`}>{a.panels.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bom-print-footer">
            <span>(주)아이오피엔 · 부족 자재 집계 · {docNo}</span>
            <span>출력 {stamp}</span>
            <span>페이지 1 / 1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
