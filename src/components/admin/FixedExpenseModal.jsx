import { useState } from 'react';
import Modal from '../common/Modal';
import { FIXED_EXPENSE_CATEGORIES } from '../../services/fixedExpenseService';

export default function FixedExpenseModal({ isOpen, onClose, onSave, initial }) {
  const [category, setCategory] = useState(initial?.category || FIXED_EXPENSE_CATEGORIES[0]);
  const [name, setName] = useState(initial?.name || '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');

  const handleSubmit = (e) => {
    e.preventDefault();
    const numeric = Number(String(amount).replace(/,/g, ''));
    if (!name.trim()) return;
    if (!Number.isFinite(numeric) || numeric < 0) return;
    onSave({
      id: initial?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      category,
      name: name.trim(),
      amount: numeric,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={initial ? '고정지출 수정' : '고정지출 추가'}>
      <form onSubmit={handleSubmit} className="fixed-expense-form">
        <div className="form-row">
          <label>카테고리</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {FIXED_EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
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
          <input
            type="text"
            inputMode="numeric"
            value={amount ? Number(String(amount).replace(/,/g, '')).toLocaleString() : ''}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="0"
          />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>취소</button>
          <button type="submit" className="btn btn-primary" disabled={!name.trim() || !amount}>
            {initial ? '수정' : '추가'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
