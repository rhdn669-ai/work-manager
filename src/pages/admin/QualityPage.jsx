import Icon from '../../components/common/Icon';

// 관리자 품질 이력 관리 (SSQ 인증 대응) — /admin/quality
// 엑셀 양식(공구관리·부적합·수입검사 등 10종+) 접수 후 양식 엔진으로 모듈별 활성화 예정.
const MODULES = [
  { key: 'tool', name: '공구관리이력', desc: '공구 등록·점검·수리·폐기 이력' },
  { key: 'ncr', name: '부적합 관리', desc: '부적합 발생·조치·재발방지 기록' },
  { key: 'iqc', name: '수입검사', desc: '입고 자재 검사 성적 이력' },
];

export default function QualityPage() {
  return (
    <div>
      <div className="page-header">
        <h2>품질</h2>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        {MODULES.map((m) => (
          <div key={m.key} className="card" style={{ padding: 'var(--space-5)', opacity: 0.8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <b style={{ fontSize: 'var(--font-md)' }}>{m.name}</b>
              <span
                className="badge"
                style={{ background: 'var(--grey-100)', color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}
              >
                준비중
              </span>
            </div>
            <div style={{ fontSize: 'var(--font-sm)', color: 'var(--text-muted)' }}>{m.desc}</div>
          </div>
        ))}
      </div>

      <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
        <Icon name="doc" style={{ width: 36, height: 36 }} />
        <div style={{ fontWeight: 700, marginTop: 10, color: 'var(--text)' }}>양식 등록 대기 중</div>
        <div style={{ fontSize: 'var(--font-sm)', maxWidth: 440, margin: '6px auto 0' }}>
          엑셀 양식(공구관리·부적합·수입검사 등 10종+)을 전달해 주시면, 양식별 입력 화면·이력 목록·PDF 출력이 이 탭에
          채워집니다.
        </div>
      </div>
    </div>
  );
}
