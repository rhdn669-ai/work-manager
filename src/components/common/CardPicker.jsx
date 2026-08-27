import Select from './Select';
import { useAuth } from '../../contexts/useAuth';
import { BUSINESS_CARD_NAMES } from '../../utils/mailTemplate';

// 메일 하단에 붙일 명함 고르기.
//
// 보통은 보내는 사람 명함이 붙으면 된다 — 받는 업체가 누구에게 회신할지 바로 안다.
// 다만 관리자는 남의 건을 대신 보낼 때가 있어 고를 수 있게 한다 (2026-08-27 대표님).
// 명함이 없는 사람이 보내면 명함 없이 나간다(발주서와 같은 규칙).
export default function CardPicker({ value, onChange, label = '명함' }) {
  const { isAdmin } = useAuth();

  // 일반 직원은 고르지 못한다 — 자기 명함이 자동으로 붙는다
  if (!isAdmin) {
    return (
      <p className="field-hint">
        {BUSINESS_CARD_NAMES.includes(value) ? (
          <>
            메일 하단에 <strong>{value}</strong> 명함이 붙습니다.
          </>
        ) : (
          '등록된 명함이 없어 명함 없이 나갑니다.'
        )}
      </p>
    );
  }

  return (
    <div className="form-group">
      <label>{label}</label>
      <Select
        value={value || ''}
        onChange={onChange}
        options={[
          { value: '', label: '명함 없이 보내기' },
          ...BUSINESS_CARD_NAMES.map((n) => ({ value: n, label: n })),
        ]}
        ariaLabel="명함 선택"
      />
      <p className="field-hint">메일 하단에 붙습니다. 받는 업체가 누구에게 회신할지 알 수 있습니다.</p>
    </div>
  );
}
