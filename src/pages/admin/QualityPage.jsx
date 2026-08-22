import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { useAuth } from '../../contexts/useAuth';
import { canProduction } from '../../utils/workspace';
import { QUALITY_TABS, VERDICT } from '../../domain/qualityForms';
import { COMPANIES } from '../../domain/production';
import { defectRateTargetOf } from '../../domain/qualityGoalSeed';
import { AreaChart, Donut, Sparkline } from '../../components/quality/QualityCharts';
// 불량 유형 분포 — 등록 화면과 같은 목록을 쓴다 (유형을 더하면 차트도 함께 늘어난다)
import { DEFECT_TYPES } from '../../domain/defectTypes';
import QualityAssetLedger from '../../components/quality/QualityAssetLedger';
import QualityRecordLedger from '../../components/quality/QualityRecordLedger';
import { subscribeAssets } from '../../services/qualityAssetService';
import { backfillNcrFromPanels, subscribeAllRecords } from '../../services/qualityRecordService';
import { seedDemo, clearDemo, countDemo } from '../../services/demoService';
import { useDialog } from '../../components/common/useDialog';
import { assetStatusOf, ASSET_STATUS } from '../../domain/qualityForms';
import { FORM_FIELDS } from '../../domain/qualityFormFields';
import '../../styles/quality.css';

// 품질보증 (MES 모드) — /quality
// 개요 대시보드는 Firestore 실데이터만 집계한다. 가상 데이터를 쓰지 않으므로
// 기록이 없으면 0 과 빈 상태를 그대로 보여준다 — 없는 실적을 지어내지 않는다.
// 설계 근거: MES-QUALITY-PLAN.md / 서식 정의: MES-QUALITY-FORM-SPEC.md

// ── 실집계 헬퍼 ─────────────────────────────────────────────────────
const VERDICT_KEYS = ['passFailResult', 'overallResult', 'finalResult', 'finalJudgement'];
// 라벨('합격') → 배지 클래스
const VERDICT_LABEL = Object.fromEntries(Object.values(VERDICT).map((v) => [v.label, v]));
const verdictOf = (r) => VERDICT_KEYS.map((k) => r[k]).find(Boolean) || '';
const ym = (d) => (d ? String(d).slice(0, 7) : '');
const monthKey = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
const dateOf = (r) => r.inspectionDate || r.occurredDate || r.applyDate || r.trainingDate || r.evalDate || '';

// 서식키 → 탭키 (oqc.shipment → oqc)
const tabOf = (formKey) => String(formKey || '').split('.')[0];

// 최근 6개월 라벨
function recentMonths(n = 6) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(monthKey(t));
  }
  return out;
}

function KpiCard({ item }) {
  return (
    <div className={`admin-stat ${item.hero ? 'q-hero' : ''}`}>
      <div className="admin-stat-label">{item.label}</div>
      <div className="admin-stat-value">
        {item.value}
        {item.unit && <span>{item.unit}</span>}
      </div>
      <div className="q-stat-foot">
        <span className={`q-delta ${item.good ? 'q-delta-good' : 'q-delta-bad'}`}>{item.delta}</span>
        <Sparkline values={item.spark} color={item.hero ? 'rgba(255,255,255,.7)' : 'var(--accent)'} />
      </div>
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="q-todo">
      <Icon name="doc" style={{ width: 30, height: 30 }} />
      <p>{text}</p>
    </div>
  );
}

function Overview({ assets, records, now }) {
  // ── 월별 불량률 추이 — 출하검사·부적합 실적의 (불량수/검사수)
  const months = useMemo(() => recentMonths(6), []);
  // 전체 · 메티스 · 디에이치 — 발주사별로 불량률이 어떻게 다른지 나눠 본다
  const [trendView, setTrendView] = useState('all');
  const rateOf = (rows) => {
    const insp = rows.reduce((a, r) => a + (Number(r.inspectedQty) || 0), 0);
    const def = rows.reduce((a, r) => a + (Number(r.defectQty) || 0), 0);
    return insp ? Math.round((def / insp) * 10000) / 100 : 0;
  };
  const trendByCompany = useMemo(() => {
    const src = records.filter((r) => tabOf(r.formKey) === 'oqc');
    const of = (filter) => months.map((m) => rateOf(src.filter((r) => ym(dateOf(r)) === m && filter(r))));
    return {
      all: of(() => true),
      ...Object.fromEntries(COMPANIES.map((c) => [c, of((r) => r.customerName === c)])),
    };
  }, [records, months]);
  const trendSeries = useMemo(() => {
    if (trendView !== 'compare')
      return [
        {
          key: trendView,
          name: trendView === 'all' ? '전체' : trendView,
          color: 'var(--accent)',
          fill: true,
          values: trendByCompany[trendView] || [],
        },
      ];
    // 비교 보기 — 전체와 각 발주사를 한 그래프에 겹쳐 본다.
    // 전체선이 있어야 "이 업체가 전사 평균보다 높은가"를 바로 읽는다. 면은 채우지 않는다.
    return [
      { key: 'all', name: '전체', color: 'var(--accent)', fill: false, values: trendByCompany.all || [] },
      ...COMPANIES.map((c, i) => ({
        key: c,
        name: c,
        color: i === 0 ? 'var(--chart-1)' : 'var(--chart-2)',
        fill: false,
        values: trendByCompany[c] || [],
      })),
    ];
  }, [trendView, trendByCompany]);
  const hasTrend = Object.values(trendByCompany).some((arr) => arr.some((v) => v > 0));
  // 목표선 — 기준정보>품질목표에 등록된 '출하검사 불량률' 목표를 쓰고, 없으면 원본 시트 값(7%)
  const target = useMemo(() => defectRateTargetOf(records), [records]);
  const seriesWithTarget = useMemo(
    () => [
      ...trendSeries,
      {
        key: 'target',
        name: `목표 ${target.value}%${target.fromGoal ? '' : ' (임시)'}`,
        color: 'var(--text-muted)',
        dashed: true,
        values: months.map(() => target.value),
      },
    ],
    [trendSeries, target, months],
  );

  // ── 불량 유형 분포
  const [sliceView, setSliceView] = useState('all');
  const slices = useMemo(() => {
    const src = sliceView === 'all' ? records : records.filter((r) => r.customerName === sliceView);
    const byType = DEFECT_TYPES.map((t) => ({
      label: t.label,
      color: t.color,
      value: src.reduce((a, r) => a + (Number(r[t.key]) || 0), 0),
    }));
    // 유형을 고르지 않은 불량 — 이걸 빼 두면 총 불량 수와 분포 합계가 조용히 어긋난다.
    // 몇 건이 분류가 안 됐는지 눈에 보여야 현장에서 채워 넣을 수 있다 (2026-08-22 대표님).
    const unclassified = src.reduce((a, r) => a + (Number(r.defectUnclassified) || 0), 0);
    return [...byType, { label: '유형 미지정', color: 'var(--text-muted)', value: unclassified }].filter(
      (x) => x.value > 0,
    );
  }, [records, sliceView]);
  const sliceTotal = slices.reduce((a, x) => a + x.value, 0);
  // 발주사별로 유형 분포가 다른지 보려면 전환이 필요하다(추이 차트와 같은 방식)
  const hasAnySlice = useMemo(() => DEFECT_TYPES.some((t) => records.some((r) => Number(r[t.key]) > 0)), [records]);

  // ── 최근 등록 (전 서식 통합, 최신 8건)
  const recent = useMemo(
    () =>
      [...records]
        .sort((a, b) => String(dateOf(b)).localeCompare(String(dateOf(a))))
        .slice(0, 8)
        .map((r) => ({
          id: r.id,
          kind: FORM_FIELDS[r.formKey]?.title || r.formKey,
          title: r.itemName || r.trainingName || r.itemTarget || r.applicantName || r.supplierName || r.recordNo,
          sub: [r.recordNo, r.inspector || r.trainer || r.evaluator, dateOf(r)].filter(Boolean).join(' · '),
          verdict: verdictOf(r),
        })),
    [records],
  );

  // ── 교정 임박·초과 자산
  const calDue = useMemo(
    () =>
      assets
        .map((a) => ({ ...a, st: assetStatusOf(a.nextDate) }))
        .filter((a) => a.st.key !== 'normal')
        .sort((a, b) => (a.st.days ?? 0) - (b.st.days ?? 0))
        .slice(0, 5),
    [assets],
  );

  // ── 미종결 부적합 — 판정이 부적합인데 종결일·처리상태가 비었거나 종결이 아닌 것
  const ncrOpen = useMemo(
    () =>
      records
        .filter((r) => verdictOf(r) === '부적합' && r.handlingStatus !== '종결' && !r.closedDate)
        .map((r) => ({
          id: r.id,
          no: r.recordNo,
          title: r.defectSymptom || r.itemName || FORM_FIELDS[r.formKey]?.title || '',
          days: dateOf(r) ? Math.max(0, Math.floor((now - new Date(dateOf(r))) / 86400000)) : null,
        }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
        .slice(0, 5),
    [records, now],
  );

  return (
    <>
      <div className="q-grid-2 q-section">
        <div className="card q-chart-card">
          <div className="q-section-head">
            <h3>월별 불량률 추이</h3>
            {hasTrend && (
              <div className="q-chart-legend">
                {seriesWithTarget.map((s2) => (
                  <span key={s2.key}>
                    <i style={{ background: s2.color }} />
                    {s2.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          {hasTrend && (
            <div className="q-trend-switch">
              {[
                { k: 'all', label: '전체' },
                ...COMPANIES.map((c) => ({ k: c, label: c })),
                { k: 'compare', label: '전체·업체 비교' },
              ].map((o) => (
                <button
                  key={o.k}
                  type="button"
                  className={`q-subtab ${trendView === o.k ? 'active' : ''}`}
                  onClick={() => setTrendView(o.k)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {hasTrend ? (
            <AreaChart labels={months.map((m) => `${Number(m.slice(5))}월`)} series={seriesWithTarget} unit="%" />
          ) : (
            <EmptyBox text="출하검사·부적합 실적이 쌓이면 월별 추이가 표시됩니다." />
          )}
        </div>

        <div className="card q-chart-card">
          <div className="q-section-head">
            <h3>불량 유형 분포</h3>
          </div>
          {hasAnySlice && (
            <div className="q-trend-switch">
              {[{ k: 'all', label: '전체' }, ...COMPANIES.map((c) => ({ k: c, label: c }))].map((o) => (
                <button
                  key={o.k}
                  type="button"
                  className={`q-subtab ${sliceView === o.k ? 'active' : ''}`}
                  onClick={() => setSliceView(o.k)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {sliceTotal > 0 ? (
            <Donut slices={slices} total={sliceTotal} />
          ) : (
            <EmptyBox
              text={
                hasAnySlice
                  ? '이 발주사에는 유형이 집계된 불량이 없습니다.'
                  : '생산현황에서 불량 유형을 고르면 분포가 표시됩니다.'
              }
            />
          )}
        </div>
      </div>

      <div className="q-grid-2">
        <div className="card">
          <div className="card-header">
            <h3>최근 등록</h3>
          </div>
          {recent.length ? (
            <ul className="q-recent">
              {recent.map((r) => (
                <li key={r.id}>
                  <span className="q-kind">{r.kind}</span>
                  <div className="q-recent-main">
                    <div className="q-recent-title">{r.title}</div>
                    <div className="q-recent-sub">{r.sub}</div>
                  </div>
                  {r.verdict && VERDICT_LABEL[r.verdict] && (
                    <span className={`badge ${VERDICT_LABEL[r.verdict].cls}`}>{r.verdict}</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBox text="아직 등록된 기록이 없습니다." />
          )}
        </div>

        <div>
          <div className="card q-section">
            <div className="card-header">
              <h3>교정 임박·초과</h3>
            </div>
            {calDue.length ? (
              <ul className="q-alert-list">
                {calDue.map((c) => (
                  <li key={c.id}>
                    <div className="q-alert-main">
                      <div className="q-alert-title">{c.name}</div>
                      <div className="q-alert-sub">
                        {c.assetNo} · {c.nextDate}
                      </div>
                    </div>
                    <span className={`badge ${ASSET_STATUS[c.st.key].cls}`}>
                      {c.st.days < 0 ? `${-c.st.days}일 초과` : `D-${c.st.days}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyBox text="교정 임박·초과 자산이 없습니다." />
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h3>미종결 부적합</h3>
            </div>
            {ncrOpen.length ? (
              <ul className="q-alert-list">
                {ncrOpen.map((n) => (
                  <li key={n.id}>
                    <div className="q-alert-main">
                      <div className="q-alert-title">{n.title}</div>
                      <div className="q-alert-sub">{n.no}</div>
                    </div>
                    {n.days != null && <span className="badge badge-danger">{n.days}일 경과</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyBox text="미종결 부적합이 없습니다." />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TabBody({ tab, subCounts }) {
  const [sub, setSub] = useState(tab.subTabs[0].key);
  const active = tab.subTabs.find((s) => s.key === sub) ?? tab.subTabs[0];
  return (
    <>
      <div className="q-subtabs">
        {tab.subTabs.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`q-subtab ${s.key === sub ? 'active' : ''}`}
            onClick={() => setSub(s.key)}
          >
            {s.label}
            {subCounts[`${tab.key}.${s.key}`] > 0 && (
              <span className="tab-nav-count">{subCounts[`${tab.key}.${s.key}`]}</span>
            )}
          </button>
        ))}
      </div>

      {tab.key === 'assets' ? (
        <QualityAssetLedger key={active.key} assetType={active.key} docNo={active.docNo} label={active.label} />
      ) : (
        <QualityRecordLedger key={active.key} formKey={`${tab.key}.${active.key}`} docNo={active.docNo} />
      )}
    </>
  );
}

export default function QualityPage() {
  const { userProfile, isAdmin } = useAuth();
  // 보던 탭을 기억한다 — 양식 페이지에 다녀와도 그 탭으로 돌아오게
  const [tabKey, setTabKey] = useState(() => sessionStorage.getItem('qualityTab') || 'overview');
  const [assets, setAssets] = useState([]);
  const [records, setRecords] = useState([]);
  // 경과일 기준 시각 — 마운트 시 1회 고정(렌더마다 바뀌지 않게)
  const [now] = useState(() => Date.now());

  useEffect(() => subscribeAssets(setAssets), []);
  useEffect(() => subscribeAllRecords(setRecords), []);
  // 생산현황을 거치지 않고 품질보증만 열어도 최신 불량이 부적합 실적에 올라오도록 (관리자 1회)
  const backfilled = useRef(false);
  useEffect(() => {
    if (!isAdmin || backfilled.current) return;
    backfilled.current = true;
    backfillNcrFromPanels().catch((e) => console.error('[quality] 소급 연동 실패:', e));
  }, [isAdmin]);

  // ── KPI — 전부 실데이터. 기록이 없으면 0 이 나온다.
  const kpi = useMemo(() => {
    const months = recentMonths(7);
    const oqc = records.filter((r) => tabOf(r.formKey) === 'oqc');

    const rateOf = (m) => {
      const rows = oqc.filter((r) => ym(dateOf(r)) === m);
      const insp = rows.reduce((a, r) => a + (Number(r.inspectedQty) || 0), 0);
      const def = rows.reduce((a, r) => a + (Number(r.defectQty) || 0), 0);
      return insp ? def / insp : 0;
    };
    const rates = months.map(rateOf);
    const cur = rates[rates.length - 1];
    const prev = rates[rates.length - 2] ?? 0;
    const diff = cur - prev;

    const iqc = records.filter((r) => tabOf(r.formKey) === 'iqc');
    const passRate = iqc.length ? (iqc.filter((r) => verdictOf(r) === '합격').length / iqc.length) * 100 : 0;
    const passSpark = months.map((m) => {
      const rows = iqc.filter((r) => ym(dateOf(r)) === m);
      return rows.length ? (rows.filter((r) => verdictOf(r) === '합격').length / rows.length) * 100 : 0;
    });

    const openNcr = records.filter(
      (r) => verdictOf(r) === '부적합' && r.handlingStatus !== '종결' && !r.closedDate,
    ).length;
    const dueAssets = assets.filter((a) => assetStatusOf(a.nextDate).key !== 'normal').length;

    return [
      {
        key: 'index',
        label: '당월 불량지수',
        value: cur.toFixed(2),
        delta: records.length ? `${diff <= 0 ? '▼' : '▲'} ${Math.abs(diff).toFixed(2)}` : '기록 없음',
        good: diff <= 0,
        spark: rates,
        hero: true,
      },
      {
        key: 'pass',
        label: '수입검사 합격률',
        value: passRate.toFixed(1),
        unit: '%',
        delta: iqc.length ? `${iqc.length}건 기준` : '기록 없음',
        good: true,
        spark: passSpark,
      },
      {
        key: 'open',
        label: '미종결 부적합',
        value: String(openNcr),
        unit: '건',
        delta: openNcr ? '조치 대기' : '없음',
        good: openNcr === 0,
        spark: months.map((m) => records.filter((r) => ym(dateOf(r)) === m && verdictOf(r) === '부적합').length),
      },
      {
        key: 'cal',
        label: '교정 임박·초과',
        value: String(dueAssets),
        unit: '건',
        delta: dueAssets ? '확인 필요' : '없음',
        good: dueAssets === 0,
        spark: months.map(() => dueAssets),
      },
    ];
  }, [records, assets]);

  // ── 탭 건수 — 실제 등록 건수
  const tabCounts = useMemo(() => {
    const c = { assets: assets.length };
    records.forEach((r) => {
      const t = tabOf(r.formKey);
      if (t) c[t] = (c[t] || 0) + 1;
    });
    return c;
  }, [records, assets]);

  // 구조 확인용 가상 데이터 — demo:true 문서만 넣고 지운다(진짜 데이터는 안 건드림)
  const { confirm, toast } = useDialog();
  const [demoCount, setDemoCount] = useState(0);
  const [demoBusy, setDemoBusy] = useState(false);
  useEffect(() => {
    if (isAdmin)
      countDemo()
        .then(setDemoCount)
        .catch(() => setDemoCount(0));
  }, [isAdmin, records, assets]);

  const toggleDemo = async () => {
    if (demoBusy) return;
    const has = demoCount > 0;
    const ok = await confirm(
      has
        ? `샘플 데이터 ${demoCount}건을 전부 지울까요?\n샘플로 넣은 것만 지워지고 실제 기록은 그대로 남습니다.`
        : '생산현황·품질보증을 가상 데이터로 채울까요?\n전부 지어낸 값이며, 같은 버튼으로 언제든 한 번에 지울 수 있습니다.',
    );
    if (!ok) return;
    setDemoBusy(true);
    try {
      if (has) {
        const n = await clearDemo();
        toast(`샘플 데이터 ${n}건을 지웠습니다.`, 'success', 0);
      } else {
        const c = await seedDemo();
        toast(`샘플을 넣었습니다 — 판넬 ${c.판넬} · 자산 ${c.자산} · 기록 ${c.기록}건`, 'success', 0);
      }
      setDemoCount(await countDemo());
    } catch (err) {
      console.error('[demo] 실패:', err);
      toast('샘플 처리 중 오류가 발생했습니다', 'error', 0);
    } finally {
      setDemoBusy(false);
    }
  };

  // 소탭 건수 — 기록은 formKey 그대로, 자산은 assets.<종류> 로 키를 맞춘다
  const subCounts = useMemo(() => {
    const c = {};
    records.forEach((r) => {
      if (r.formKey) c[r.formKey] = (c[r.formKey] || 0) + 1;
    });
    assets.forEach((a) => {
      const k = `assets.${a.assetType}`;
      c[k] = (c[k] || 0) + 1;
    });
    return c;
  }, [records, assets]);

  if (userProfile && !canProduction(userProfile)) return <Navigate to="/dashboard" replace />;

  const tab = QUALITY_TABS.find((t) => t.key === tabKey) ?? QUALITY_TABS[0];

  return (
    <div>
      <div className="page-header">
        <h2>품질보증</h2>
        {isAdmin && (
          <div className="page-actions no-print">
            {/* 구조 확인용 가상 데이터 — 넣은 것만 골라 한 번에 지운다 */}
            <button type="button" className="btn btn-sm btn-outline" onClick={toggleDemo} disabled={demoBusy}>
              <Icon name="doc" className="btn-ic" />
              {demoBusy ? '처리 중…' : demoCount > 0 ? `샘플 데이터 지우기 (${demoCount})` : '샘플 데이터 넣기'}
            </button>
          </div>
        )}
      </div>

      <div className="admin-stats">
        {kpi.map((k) => (
          <KpiCard key={k.key} item={k} />
        ))}
      </div>

      <div className="tab-nav">
        {QUALITY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`tab-nav-item ${t.key === tabKey ? 'active' : ''}`}
            onClick={() => {
              setTabKey(t.key);
              sessionStorage.setItem('qualityTab', t.key);
            }}
          >
            {t.label}
            {tabCounts[t.key] > 0 && <span className="tab-nav-count">{tabCounts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab.key === 'overview' ? (
        <Overview assets={assets} records={records} now={now} />
      ) : (
        <TabBody key={tab.key} tab={tab} subCounts={subCounts} />
      )}
    </div>
  );
}
