import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import QualitySheet from '../../components/quality/QualitySheet';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { canProduction } from '../../utils/workspace';
import { QUALITY_TABS } from '../../domain/qualityForms';
import { FORM_FIELDS, computeCalcFields } from '../../domain/qualityFormFields';
import { subscribeRecords, addRecord, updateRecord } from '../../services/qualityRecordService';
import '../../styles/quality.css';

// 양식 낱장 페이지 — 대장에서 행을 누르면 여기로 이동한다(모달 아님).
// /quality/sheet/:formKey/:id   (id === 'new' 이면 신규)

const docNoOf = (formKey) => {
  const [tabKey, subKey] = String(formKey).split('.');
  return QUALITY_TABS.find((t) => t.key === tabKey)?.subTabs?.find((s) => s.key === subKey)?.docNo || '';
};

export default function QualitySheetPage() {
  const { formKey, id } = useParams();
  const navigate = useNavigate();
  const { userProfile } = useAuth();
  const { toast } = useDialog();
  const [rows, setRows] = useState(null); // null = 로딩 중

  useEffect(() => subscribeRecords(formKey, setRows), [formKey]);

  if (userProfile && !canProduction(userProfile)) return <Navigate to="/dashboard" replace />;
  const def = FORM_FIELDS[formKey];
  if (!def) return <Navigate to="/quality" replace />;

  // 히스토리 뒤로가기 — 새 기록을 쌓지 않아야 브라우저 뒤로가기가 양식으로 되돌아오지 않는다.
  // 새 탭에서 URL 로 바로 들어온 경우엔 돌아갈 기록이 없으므로 목록으로 보낸다.
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/quality', { replace: true }));

  if (rows === null) return <div className="q-todo">불러오는 중…</div>;

  const isNew = id === 'new';
  // 문서번호는 사내 규칙대로 입력받는다 (임의 채번하지 않음)
  const record = isNew ? { recordNo: '' } : rows.find((r) => r.id === id);
  if (!isNew && !record) return <Navigate to="/quality" replace />;

  const save = async (draft) => {
    if (!String(draft.recordNo ?? '').trim()) {
      toast('문서번호를 입력하세요 (사내 문서번호 규칙에 따라)', 'error');
      return;
    }
    const { id: rid, ...rest } = computeCalcFields(formKey, draft);
    try {
      if (rid) await updateRecord(rid, rest);
      else await addRecord(formKey, rest);
      toast(rid ? '수정했습니다.' : '등록했습니다.', 'success', 0);
      back();
    } catch (err) {
      console.error('[qualityRecords] 저장 실패:', err);
      toast('저장 중 오류가 발생했습니다', 'error', 0);
    }
  };

  return (
    <div className="q-sheet-page">
      <div className="page-header no-print">
        <h2>{def.title}</h2>
      </div>
      <QualitySheet page formKey={formKey} docNo={docNoOf(formKey)} record={record} onSave={save} onClose={back} />
    </div>
  );
}
