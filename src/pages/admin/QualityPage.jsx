import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import Icon from '../../components/common/Icon';
import { useAuth } from '../../contexts/useAuth';
import { canProduction } from '../../utils/workspace';
import { QUALITY_TABS, VERDICT } from '../../domain/qualityForms';
import { AreaChart, Donut, Sparkline } from '../../components/quality/QualityCharts';
import QualityAssetLedger from '../../components/quality/QualityAssetLedger';
import '../../styles/quality.css';

// 품질 (MES 모드) — /quality
// 1단계: 화면 골격 + 차트. 데이터는 아직 더미이며 Firestore 연계는 다음 단계.
// 설계 근거: MES-QUALITY-PLAN.md / 서식 정의: MES-QUALITY-FORM-SPEC.md

// ── 더미 데이터 (연계 붙일 때 전부 교체) ────────────────────────────────
const KPI = [
  {
    key: 'index',
    label: '당월 불량지수',
    value: '0.42',
    delta: '▼ 0.08',
    good: true,
    spark: [0.58, 0.61, 0.55, 0.49, 0.52, 0.5, 0.42],
    hero: true,
  },
  {
    key: 'pass',
    label: '수입검사 합격률',
    value: '98.2',
    unit: '%',
    delta: '▲ 1.4%p',
    good: true,
    spark: [95.8, 96.4, 96.1, 97.2, 96.9, 97.8, 98.2],
  },
  {
    key: 'open',
    label: '미종결 부적합',
    value: '3',
    unit: '건',
    delta: '조치 대기',
    good: false,
    spark: [5, 4, 6, 5, 4, 4, 3],
  },
  {
    key: 'cal',
    label: '교정 임박',
    value: '2',
    unit: '건',
    delta: '30일 이내',
    good: false,
    spark: [0, 1, 1, 0, 2, 1, 2],
  },
];

const TREND_LABELS = ['1월', '2월', '3월', '4월', '5월', '6월', '7월'];
const TREND_SERIES = [
  {
    key: 'actual',
    name: '실적',
    color: 'var(--accent)',
    fill: true,
    values: [0.58, 0.61, 0.55, 0.49, 0.52, 0.5, 0.42],
  },
  { key: 'target', name: '목표', color: 'var(--grey-400)', dashed: true, values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] },
];

const DEFECT_SLICES = [
  { label: '배선정리', value: 10, color: 'var(--chart-1)' },
  { label: '조립불량', value: 6, color: 'var(--chart-2)' },
  { label: '크리닝', value: 4, color: 'var(--chart-3)' },
  { label: '케이블타이', value: 2, color: 'var(--accent)' },
  { label: '기타', value: 2, color: 'var(--grey-400)' },
];

const RECENT = [
  { kind: '수입검사', title: '분전반 외함 수입검사 성적서', sub: 'IOPN-2026-014 · 김하늬 · 07-29', verdict: 'fail' },
  { kind: '출하검사', title: '판넬 출하검사 실적', sub: 'IOPN-2026-011 · 김신혜 · 07-29', verdict: 'pass' },
  { kind: '계측기', title: '버니어캘리퍼스 교정 등록', sub: 'CAL-003 · 김하늬 · 07-28', verdict: 'pass' },
  { kind: '변경관리', title: '결선 방식 변경 신청', sub: 'IOPN-2026-014 · 이종나 · 07-28', verdict: 'hold' },
  { kind: '부적합', title: '결선 상태 불량 보고', sub: '분전반 외함 · 이종나 · 07-27', verdict: 'fail' },
  { kind: '수입검사', title: '단자대 수입검사 성적서', sub: 'IOPN-2026-012 · 하수연 · 07-27', verdict: 'pass' },
];

const CAL_DUE = [
  { name: '버니어캘리퍼스', no: 'CAL-003', next: '2026-08-12', days: 13 },
  { name: '디지털 토크렌치', no: 'CAL-007', next: '2026-08-24', days: 25 },
];

const NCR_OPEN = [
  { no: 'NCR-2026-0031', title: '결선 상태 불량', days: 12 },
  { no: 'NCR-2026-0029', title: '도장면 기포 발생', days: 6 },
  { no: 'NCR-2026-0028', title: '치수 허용공차 초과', days: 4 },
];

const TAB_COUNTS = { assets: 12, iqc: 8, oqc: 24, change: 5, training: 7, vendor: 3 };
// ────────────────────────────────────────────────────────────────────

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

function Overview() {
  const total = DEFECT_SLICES.reduce((s, d) => s + d.value, 0);
  return (
    <>
      <div className="q-grid-2 q-section">
        <div className="card q-chart-card">
          <div className="q-section-head">
            <h3>월별 불량률 추이</h3>
            <div className="q-chart-legend">
              <span>
                <i style={{ background: 'var(--accent)' }} />
                실적
              </span>
              <span>
                <i style={{ background: 'var(--grey-400)' }} />
                목표
              </span>
            </div>
          </div>
          <AreaChart labels={TREND_LABELS} series={TREND_SERIES} unit="%" />
        </div>

        <div className="card q-chart-card">
          <div className="q-section-head">
            <h3>불량 유형 분포</h3>
          </div>
          <Donut slices={DEFECT_SLICES} total={total} />
        </div>
      </div>

      <div className="q-grid-2">
        <div className="card">
          <div className="card-header">
            <h3>최근 등록</h3>
          </div>
          <ul className="q-recent">
            {RECENT.map((r) => (
              <li key={r.title}>
                <span className="q-kind">{r.kind}</span>
                <div className="q-recent-main">
                  <div className="q-recent-title">{r.title}</div>
                  <div className="q-recent-sub">{r.sub}</div>
                </div>
                <span className={`badge ${VERDICT[r.verdict].cls}`}>{VERDICT[r.verdict].label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="card q-section">
            <div className="card-header">
              <h3>교정 임박</h3>
            </div>
            <ul className="q-alert-list">
              {CAL_DUE.map((c) => (
                <li key={c.no}>
                  <div className="q-alert-main">
                    <div className="q-alert-title">{c.name}</div>
                    <div className="q-alert-sub">
                      {c.no} · {c.next}
                    </div>
                  </div>
                  <span className="badge badge-caution">D-{c.days}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <div className="card-header">
              <h3>미종결 부적합</h3>
            </div>
            <ul className="q-alert-list">
              {NCR_OPEN.map((n) => (
                <li key={n.no}>
                  <div className="q-alert-main">
                    <div className="q-alert-title">{n.title}</div>
                    <div className="q-alert-sub">{n.no}</div>
                  </div>
                  <span className="badge badge-danger">{n.days}일 경과</span>
                </li>
              ))}
            </ul>
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
        <QualityAssetLedger
          key={active.key}
          assetType={active.key}
          docNo={active.docNo}
          rev={active.rev}
          label={active.label}
        />
      ) : (
        <div className="card">
          <div className="card-header">
            <h3>
              {active.label}
              <span className="q-doc-badge">
                {active.docNo} 개정{active.rev}
              </span>
            </h3>
          </div>
          <div className="q-todo">
            <Icon name="doc" style={{ width: 34, height: 34 }} />
            <b>데이터 연계 준비 중</b>
            <p>서식 정의와 화면 골격은 확정됐습니다. 이 대장의 입력·목록·PDF 출력은 다음 단계에서 연결됩니다.</p>
          </div>
        </div>
      )}
    </>
  );
}

export default function QualityPage() {
  const { userProfile } = useAuth();
  const [tabKey, setTabKey] = useState('overview');
  if (userProfile && !canProduction(userProfile)) return <Navigate to="/dashboard" replace />;

  const tab = QUALITY_TABS.find((t) => t.key === tabKey) ?? QUALITY_TABS[0];

  return (
    <div>
      <div className="page-header">
        <h2>품질보증</h2>
      </div>

      <div className="admin-stats">
        {KPI.map((k) => (
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
            {TAB_COUNTS[t.key] != null && <span className="tab-nav-count">{TAB_COUNTS[t.key]}</span>}
          </button>
        ))}
      </div>

      {tab.key === 'overview' ? <Overview /> : <TabBody key={tab.key} tab={tab} />}
    </div>
  );
}
