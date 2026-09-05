import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import QualitySheet from '../../components/quality/QualitySheet';
import Icon from '../../components/common/Icon';
import { useAuth } from '../../contexts/useAuth';
import { useDialog } from '../../components/common/useDialog';
import { canProduction } from '../../utils/workspace';
import { QUALITY_TABS, kindOf } from '../../domain/qualityForms';
import { nextDocNo } from '../../domain/qualityDocNo';
import { FORM_FIELDS, computeCalcFields } from '../../domain/qualityFormFields';
import { subscribeAllRecords, addRecord, updateRecord } from '../../services/qualityRecordService';
import { subscribeAssets, addAsset, updateAsset } from '../../services/qualityAssetService';
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
  const [all, setAll] = useState(null); // null = 로딩 중

  // 자산(계측기·지그·치공구·툴)은 저장처만 다르고 화면·양식·출력은 기록 12종과 완전히 같다.
  const [tabKey, subKey] = String(formKey).split('.');
  const isAsset = tabKey === 'assets';
  // 채번은 「양식」이 아니라 「기본 문서번호」 단위라 이 양식 것만 봐서는 모자란다.
  // (치공구·툴이 둘 다 QP-705A, 출하검사 실적·품질목표가 둘 다 QP-105B)
  useEffect(() => {
    if (isAsset) return subscribeAssets(setAll);
    return subscribeAllRecords(setAll);
  }, [isAsset]);
  const rows = useMemo(
    () => (all === null ? null : all.filter((r) => (isAsset ? r.assetType === subKey : r.formKey === formKey))),
    [all, isAsset, subKey, formKey],
  );

  if (userProfile && !canProduction(userProfile)) return <Navigate to="/dashboard" replace />;
  const def = FORM_FIELDS[formKey];
  if (!def) return <Navigate to="/quality" replace />;

  // 히스토리 뒤로가기 — 새 기록을 쌓지 않아야 브라우저 뒤로가기가 양식으로 되돌아오지 않는다.
  // 새 탭에서 URL 로 바로 들어온 경우엔 돌아갈 기록이 없으므로 목록으로 보낸다.
  const back = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/quality', { replace: true }));

  if (rows === null) return <div className="q-todo">불러오는 중…</div>;

  const isNew = id === 'new';
  // 번호 칸의 키가 서로 다르다 — 기록은 문서번호(recordNo), 자산은 관리번호(assetNo)
  const noKey = isAsset ? 'assetNo' : 'recordNo';
  // 채번은 개별 낱장 문서와 자산에만 (2026-08-10 대표님).
  // 통합 대장은 문서번호가 대장 1장에 하나뿐이라 행마다 번호를 매기면 원본 서식과 어긋난다.
  const prefix = kindOf(formKey) === 'ledger' ? '' : docNoOf(formKey);
  // 새 장을 열면 다음 번호를 미리 적어 둔다. 사내 규칙이 따로 있으면 그 위에 고쳐 쓰면 된다.
  const autoNo = nextDocNo(
    prefix,
    (all || []).map((r) => r[noKey]),
  );
  const record = isNew ? { [noKey]: autoNo } : rows.find((r) => r.id === id);
  if (!isNew && !record) return <Navigate to="/quality" replace />;

  const save = async (draft) => {
    let no = String(draft[noKey] ?? '').trim();
    if (!no) {
      toast(
        isAsset
          ? '관리번호를 입력하세요 (사내 관리번호 규칙에 따라)'
          : '문서번호를 입력하세요 (사내 문서번호 규칙에 따라)',
        'error',
      );
      return;
    }
    // 열어 둔 사이에 다른 사람이 같은 번호를 먼저 저장했을 수 있다.
    // 우리가 매긴 번호면 조용히 다음 번호로 밀고, 손으로 적은 번호면 덮어쓰지 않고 알린다.
    if (isNew && (all || []).some((r) => String(r[noKey] ?? '').trim() === no)) {
      if (no !== autoNo) {
        toast(`${no} 은(는) 이미 있는 번호입니다`, 'error');
        return;
      }
      no = nextDocNo(
        prefix,
        (all || []).map((r) => r[noKey]),
      );
    }
    draft = { ...draft, [noKey]: no };
    // 모달 편집기를 없애면서 필수 항목 검사도 이 한 곳으로 모았다
    const missing = def.fields.filter((f) => f.required && !String(draft[f.key] ?? '').trim());
    if (missing.length) {
      toast(`${missing[0].label}을(를) 입력하세요`, 'error');
      return;
    }
    const { id: rid, ...rest } = computeCalcFields(formKey, draft);
    try {
      if (isAsset) {
        const payload = { ...rest, assetType: subKey, cycleMonths: Number(rest.cycleMonths) || 0 };
        if (rid) await updateAsset(rid, payload);
        else await addAsset(payload);
      } else if (rid) await updateRecord(rid, rest);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* (2026-09-05 뒤로가기 표준) */}
          <button type="button" className="btn btn-sm btn-outline" onClick={back}>
            <Icon name="chevronLeft" className="btn-ic" />
            품질보증
          </button>
          <h2>{def.title}</h2>
        </div>
      </div>
      <QualitySheet page formKey={formKey} docNo={docNoOf(formKey)} record={record} onSave={save} onClose={back} />
    </div>
  );
}
