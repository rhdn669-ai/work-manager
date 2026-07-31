import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { useAuth } from '../../contexts/useAuth';
import { canProduction } from '../../utils/workspace';
import { QUALITY_TABS, VERDICT } from '../../domain/qualityForms';
import { AreaChart, Donut, Sparkline } from '../../components/quality/QualityCharts';
import QualityAssetLedger from '../../components/quality/QualityAssetLedger';
import QualityRecordLedger from '../../components/quality/QualityRecordLedger';
import { subscribeAssets } from '../../services/qualityAssetService';
import { subscribeAllRecords } from '../../services/qualityRecordService';
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

// 불량 유형 분포 — 출하검사 실적의 유형별 건수 합계
const DEFECT_TYPES = [
  { key: 'defectWiring', label: '배선정리', color: 'var(--chart-1)' },
  { key: 'defectAssembly', label: '조립불량', color: 'var(--chart-2)' },
  { key: 'defectCleaning', label: '크리닝', color: 'var(--chart-3)' },
  { key: 'defectCableTie', label: '케이블타이', color: 'var(--accent)' },
  { key: 'defectEtc', label: '기타', color: 'var(--grey-400)' },
];

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
  const trend = useMemo(() => {
    const src = records.filter((r) => tabOf(r.formKey) === 'oqc');
    return months.map((m) => {
      const rows = src.filter((r) => ym(dateOf(r)) === m);
      const insp = rows.reduce((a, r) => a + (Number(r.inspectedQty) || 0), 0);
      const def = rows.reduce((a, r) => a + (Number(r.defectQty) || 0), 0);
      return insp ? Math.round((def / insp) * 10000) / 100 : 0;
    });
  }, [records, months]);
  const hasTrend = trend.some((v) => v > 0);

  // ── 불량 유형 분포
  const slices = useMemo(
    () =>
      DEFECT_TYPES.map((t) => ({
        label: t.label,
        color: t.color,
        value: records.reduce((a, r) => a + (Number(r[t.key]) || 0), 0),
      })).filter((x) => x.value > 0),
    [records],
  );
  const sliceTotal = slices.reduce((a, x) => a + x.value, 0);

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
                <span>
                  <i style={{ background: 'var(--accent)' }} />
                  실적
                </span>
              </div>
            )}
          </div>
          {hasTrend ? (
            <AreaChart
              labels={months.map((m) => `${Number(m.slice(5))}월`)}
              series={[{ key: 'actual', name: '실적', color: 'var(--accent)', fill: true, values: trend }]}
              unit="%"
            />
          ) : (
            <EmptyBox text="출하검사·부적합 실적이 쌓이면 월별 추이가 표시됩니다." />
          )}
        </div>

        <div className="card q-chart-card">
          <div className="q-section-head">
            <h3>불량 유형 분포</h3>
          </div>
          {sliceTotal > 0 ? (
            <Donut slices={slices} total={sliceTotal} />
          ) : (
            <EmptyBox text="출하검사 실적에 불량 유형을 입력하면 분포가 표시됩니다." />
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

function TabBody({ tab }) {
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
  const { userProfile } = useAuth();
  const [tabKey, setTabKey] = useState('overview');
  const [assets, setAssets] = useState([]);
  const [records, setRecords] = useState([]);
  // 경과일 기준 시각 — 마운트 시 1회 고정(렌더마다 바뀌지 않게)
  const [now] = useState(() => Date.now());

  useEffect(() => subscribeAssets(setAssets), []);
  useEffect(() => subscribeAllRecords(setRecords), []);

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

  if (userProfile && !canProduction(userProfile)) return <Navigate to="/dashboard" replace />;

  const tab = QUALITY_TABS.find((t) => t.key === tabKey) ?? QUALITY_TABS[0];

  return (
    <div>
      <div className="page-header">
        <h2>품질보증</h2>
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
            onClick={() => setTabKey(t.key)}
          >
            {t.label}
            {tabCounts[t.key] > 0 && <span className="tab-nav-count">{tabCounts[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab.key === 'overview' ? (
        <Overview assets={assets} records={records} now={now} />
      ) : (
        <TabBody key={tab.key} tab={tab} />
      )}
    </div>
  );
}
