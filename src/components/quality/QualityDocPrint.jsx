import Modal from '../common/Modal';
import { FORM_FIELDS } from '../../domain/qualityFormFields';

// A4 서식 출력 — 원본 엑셀을 복제하지 않고, 스티치로 통일한 3틀로 찍는다.
// 공통 규격(3틀 동일): 좌상단 IOPN · 우상단 문서번호 · 가운데 네이비 제목+밑줄 · 우하단 결재 2단
// 본문만 서식 성격에 따라 갈린다: 성적서형(라인 표) / 대장형(목록) / 신청서형(섹션 대비)

const VERDICT_CLS = { 합격: 'q-p-pass', 부적합: 'q-p-fail', 보류: 'q-p-hold' };
const MIN_LINE_ROWS = 8; // 원본 엑셀처럼 빈 행까지 테두리를 그려 A4를 채운다
const VERDICT_KEYS = ['passFailResult', 'overallResult', 'finalResult', 'finalJudgement'];

// 출력물 상단은 화면 양식(QualitySheet)과 같은 구성 — 문서번호·결재란·회사 로고 밴드
function DocShell({ docNo, title, children }) {
  return (
    <div className="q-paper">
      {/* 상단 — 좌: 로고+문서번호 / 우: 결재란. 제목은 그 아래 중앙 (2026-07-31 대표님) */}
      <div className="q-paper-head">
        <img className="q-paper-logo" src="/iopn-logo-doc.png" alt="IOPN" />
        <div className="q-approve">
          <div className="q-approve-side">결재</div>
          {['작성', '검토', '승인'].map((r) => (
            <div key={r} className="q-approve-col">
              <div className="q-approve-label">{r}</div>
              <div className="q-approve-space" />
            </div>
          ))}
        </div>
      </div>
      <h1 className="q-paper-title">{title}</h1>
      <div className="q-paper-docno">{docNo}</div>
      <div className="q-paper-rule" />
      {/* 본문 — 남은 높이를 흡수해 A4 바닥까지 채운다 */}
      <div className="q-paper-body">{children}</div>
      <div className="q-paper-foot">
        <span>주식회사 아이오피엔</span>
        <span>{docNo}</span>
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

function OneDoc({ def, docNo, record }) {
  const label = (k) => def.fields.find((f) => f.key === k)?.label || k;
  const infoKeys = def.fields
    .filter((f) => f.type !== 'textarea' && !f.calc && !['passFailResult', 'overallResult'].includes(f.key))
    .slice(0, 8)
    .map((f) => f.key);
  const narratives = def.fields.filter((f) => !f.hidden && f.type === 'textarea' && record[f.key]);
  const verdict = record.passFailResult || record.overallResult || record.finalResult || record.finalJudgement;

  return (
    <DocShell docNo={docNo} title={def.title}>
      {/* 번호 칸 이름이 서식 성격에 따라 다르다 — 자산은 관리번호, 기록은 문서번호 */}
      <InfoGrid
        pairs={[
          def.asset ? ['관리번호', record.assetNo] : ['문서번호', record.recordNo],
          ...infoKeys.map((k) => [label(k), record[k]]),
        ]}
      />

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
            {/* 빈 행에도 테두리를 그려 표를 끝까지 채운다(엑셀 서식 방식) */}
            {Array.from({ length: Math.max(0, MIN_LINE_ROWS - (record.lines || []).length) }).map((_, i) => (
              <tr key={`blank-${i}`} className="q-blank-row">
                <td>{(record.lines || []).length + i + 1}</td>
                {def.lines.columns.map((c) => (
                  <td key={c.key} />
                ))}
              </tr>
            ))}
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
  );
}

// 대장형 출력 — 낱장을 반복하지 않고, 대장 그대로 한 장의 표로 뽑는다.
// 원본 엑셀 대장(계측기 203행·부적합 303행)이 그런 모양이다.
function LedgerDoc({ def, docNo, rows }) {
  const cols = def.fields.filter((f) => !f.hidden && !VERDICT_KEYS.includes(f.key));
  const verdict = def.fields.find((f) => VERDICT_KEYS.includes(f.key));
  return (
    <DocShell docNo={docNo} title={def.title}>
      <table className="q-paper-table q-ledger-print">
        <thead>
          <tr>
            <th>번호</th>
            <th>{def.asset ? '관리번호' : '문서번호'}</th>
            {cols.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {verdict && <th>{verdict.label}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{i + 1}</td>
              <td>{(def.asset ? r.assetNo : r.recordNo) || '—'}</td>
              {cols.map((c) => (
                <td key={c.key}>{r[c.key] || '—'}</td>
              ))}
              {verdict && (
                <td>
                  {r[verdict.key] ? (
                    <span className={`q-p-badge ${VERDICT_CLS[r[verdict.key]] || ''}`}>{r[verdict.key]}</span>
                  ) : (
                    '—'
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </DocShell>
  );
}

// record: 배열(대장 전체 또는 선택분) 또는 단건.
export default function QualityDocPrint({ formKey, docNo, record, onClose }) {
  const def = FORM_FIELDS[formKey];
  const list = Array.isArray(record) ? record : record ? [record] : [];
  if (!def || !list.length) return null;

  const isLedger = !def.paper && !def.lines;
  const print = () => window.print();

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isLedger ? `${def.title} 출력 (${list.length}건)` : `${def.title} 출력 (${list.length}건)`}
      size="lg"
    >
      <div className="q-print-area">
        {isLedger ? (
          <div className="q-print-page q-print-land">
            <LedgerDoc def={def} docNo={docNo} rows={list} />
          </div>
        ) : (
          list.map((r) => (
            <div key={r.id} className="q-print-page">
              <OneDoc def={def} docNo={docNo} record={r} />
            </div>
          ))
        )}
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
