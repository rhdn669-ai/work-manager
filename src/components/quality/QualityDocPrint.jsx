import Modal from '../common/Modal';
import { FORM_FIELDS } from '../../domain/qualityFormFields';

// A4 서식 출력 — 원본 엑셀을 복제하지 않고, 스티치로 통일한 3틀로 찍는다.
// 공통 규격(3틀 동일): 좌상단 IOPN · 우상단 문서번호 · 가운데 네이비 제목+밑줄 · 우하단 결재 2단
// 본문만 서식 성격에 따라 갈린다: 성적서형(라인 표) / 대장형(목록) / 신청서형(섹션 대비)

const VERDICT_CLS = { 합격: 'q-p-pass', 부적합: 'q-p-fail', 보류: 'q-p-hold' };

function DocShell({ docNo, title, children }) {
  return (
    <div className="q-paper">
      <div className="q-paper-top">{docNo}</div>
      <div className="q-paper-brand">
        <b>IOPN</b>
        <small>주식회사 아이오피엔</small>
      </div>
      <h1 className="q-paper-title">{title}</h1>
      <div className="q-paper-rule" />
      {children}
      <div className="q-paper-sign">
        {['작성자', '품질팀장'].map((r) => (
          <div key={r} className="q-sign-box">
            <div className="q-sign-label">{r}</div>
            <div className="q-sign-space" />
            <div className="q-sign-foot">
              <span>성명</span>
              <span>일자</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 라벨-값 2열 (테두리 없음) — 3틀 공통 본문 요소
function InfoGrid({ pairs }) {
  return (
    <div className="q-paper-info">
      {pairs.map(([k, v]) => (
        <div key={k} className="q-info-row">
          <span className="q-info-k">{k}</span>
          <span className="q-info-v">{v || '—'}</span>
        </div>
      ))}
    </div>
  );
}

export default function QualityDocPrint({ formKey, docNo, record, onClose }) {
  const def = FORM_FIELDS[formKey];
  if (!def || !record) return null;

  const label = (k) => def.fields.find((f) => f.key === k)?.label || k;
  const val = (k) => record[k];
  // 본문 라벨-값에 넣을 필드 — 판정·계산·긴 서술은 따로 다룬다
  const infoKeys = def.fields
    .filter((f) => f.type !== 'textarea' && !f.calc && !['passFailResult', 'overallResult'].includes(f.key))
    .slice(0, 8)
    .map((f) => f.key);
  const narratives = def.fields.filter((f) => f.type === 'textarea' && record[f.key]);
  const verdict = record.passFailResult || record.overallResult || record.finalResult || record.finalJudgement;

  const print = () => window.print();

  return (
    <Modal isOpen onClose={onClose} title={`${def.title} 출력`} size="lg">
      <div className="q-print-area">
        <DocShell docNo={docNo} title={def.title}>
          <InfoGrid pairs={[['문서번호', record.recordNo], ...infoKeys.map((k) => [label(k), val(k)])]} />

          {def.lines && (
            <table className="q-paper-table">
              <thead>
                <tr>
                  <th>번호</th>
                  {def.lines.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(record.lines || []).map((r, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    {def.lines.columns.map((c) => (
                      <td key={c.key}>
                        {c.key === 'result' && r[c.key] ? (
                          <span className={`q-p-badge ${VERDICT_CLS[r[c.key]] || ''}`}>{r[c.key]}</span>
                        ) : (
                          r[c.key] || '—'
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {!(record.lines || []).length && (
                  <tr>
                    <td colSpan={def.lines.columns.length + 1}>등록된 항목 없음</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {narratives.map((f) => (
            <div key={f.key} className="q-paper-block">
              <div className="q-block-title">{f.label}</div>
              <div className="q-block-body">{record[f.key]}</div>
            </div>
          ))}

          {(verdict || record.totalScore != null) && (
            <div className="q-paper-verdict">
              <span>종합판정</span>
              <div>
                {record.totalScore != null && record.grade && (
                  <span className="q-p-total">
                    총점 {record.totalScore} · 등급 {record.grade}
                  </span>
                )}
                {verdict && <span className={`q-p-badge lg ${VERDICT_CLS[verdict] || ''}`}>{verdict}</span>}
              </div>
            </div>
          )}
        </DocShell>
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>
          닫기
        </button>
        <button type="button" className="btn btn-primary" onClick={print}>
          인쇄 · PDF 저장
        </button>
      </div>
    </Modal>
  );
}
