import { useState } from 'react';
import Modal from '../common/Modal';
import Select from '../common/Select';
import MoneyInput from '../common/MoneyInput';
import { FIXED_EXPENSE_CATEGORIES } from '../../services/fixedExpenseService';
import { useDialog } from '../common/DialogProvider';

// 카테고리별 추가 필드 정의 — type: 'text' | 'money' | 'percent'
const CATEGORY_FIELDS = {
  월세: [
    { key: 'landlord', label: '임대인', type: 'text', placeholder: '예: 김OO' },
    { key: 'deposit', label: '보증금', type: 'money', placeholder: '0' },
  ],
  대출: [
    { key: 'lender', label: '대출기관', type: 'text', placeholder: '예: 국민은행' },
    { key: 'principal', label: '원금', type: 'money', placeholder: '0' },
    { key: 'interestRate', label: '금리(%)', type: 'percent', placeholder: '예: 4.5' },
  ],
  보험: [
    { key: 'insurer', label: '보험사', type: 'text', placeholder: '예: 삼성화재' },
    { key: 'insuredPerson', label: '피보험자', type: 'text', placeholder: '예: 홍길동' },
  ],
  통신비: [{ key: 'telecom', label: '통신사', type: 'text', placeholder: '예: SKT' }],
  구독료: [{ key: 'service', label: '서비스', type: 'text', placeholder: '예: Notion' }],
  세무: [{ key: 'office', label: '사무소', type: 'text', placeholder: '예: OO 세무사사무소' }],
  기타: [],
};

export default function FixedExpenseModal({ isOpen, onClose, onSave, initial }) {
  const { alert } = useDialog();
  const [category, setCategory] = useState(initial?.category || FIXED_EXPENSE_CATEGORIES[0]);
  const [name, setName] = useState(initial?.name || '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [startDate, setStartDate] = useState(initial?.startDate || '');
  const [endDate, setEndDate] = useState(initial?.endDate || '');
  const [memo, setMemo] = useState(initial?.memo || '');
  const [details, setDetails] = useState(initial?.details || {});

  const fields = CATEGORY_FIELDS[category] || [];

  const setDetail = (key, value) => setDetails((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const numeric = Number(String(amount).replace(/,/g, ''));
    if (!name.trim()) return;
    if (!Number.isFinite(numeric) || numeric < 0) return;
    if (startDate && endDate && endDate < startDate) {
      alert('종료일이 시작일보다 빠를 수 없습니다.');
      return;
    }
    // 현재 카테고리의 details 키만 남기고 나머지는 제거 (카테고리 바꿨을 때 잔여 데이터 정리)
    const cleanDetails = {};
    fields.forEach((f) => {
      const v = details[f.key];
      if (v == null || v === '') return;
      if (f.type === 'money' || f.type === 'percent') {
        const num = Number(String(v).replace(/,/g, ''));
        if (Number.isFinite(num) && num !== 0) cleanDetails[f.key] = num;
      } else {
        cleanDetails[f.key] = String(v).trim();
      }
    });
    onSave({
      id: initial?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      name: name.trim(),
      amount: numeric,
      startDate: startDate || '',
      endDate: endDate || '',
      memo: (memo || '').trim(),
      details: cleanDetails,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? '고정지출 수정' : '고정지출 추가'}>
      <form onSubmit={handleSubmit} className="fixed-expense-form">
        <div className="form-row">
          <label>카테고리</label>
          <Select
            value={category}
            onChange={(v) => setCategory(v)}
            options={FIXED_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
            ariaLabel="분류 선택"
          />
        </div>
        <div className="form-row">
          <label>항목명</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 강남 사무실 월세"
            autoFocus
            maxLength={40}
          />
        </div>
        <div className="form-row">
          <label>금액</label>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>

        <div className="fixed-expense-divider" />

        <div className="form-row form-row-double">
          <div>
            <label>시작일</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>
              종료일 <span className="form-row-hint">(선택)</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
            />
          </div>
        </div>

        {fields.length > 0 && (
          <>
            <div className="fixed-expense-divider" />
            <div className="fixed-expense-section-label">{category} 정보</div>
            {fields.map((f) => (
              <div className="form-row" key={f.key}>
                <label>
                  {f.label} <span className="form-row-hint">(선택)</span>
                </label>
                {f.type === 'money' ? (
                  <MoneyInput
                    value={details[f.key] ?? ''}
                    onChange={(e) => setDetail(f.key, e.target.value)}
                    placeholder={f.placeholder}
                  />
                ) : f.type === 'percent' ? (
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={details[f.key] ?? ''}
                    onChange={(e) => setDetail(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    style={{ textAlign: 'right' }}
                  />
                ) : (
                  <input
                    type="text"
                    value={details[f.key] ?? ''}
                    onChange={(e) => setDetail(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    maxLength={40}
                  />
                )}
              </div>
            ))}
          </>
        )}

        <div className="fixed-expense-divider" />

        <div className="form-row">
          <label>
            메모 <span className="form-row-hint">(선택)</span>
          </label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="기타 참고 사항"
            rows={3}
            maxLength={300}
            className="fixed-expense-memo"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !amount}>
            {initial ? '수정' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
