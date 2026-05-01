import { useState } from 'react';
import FixedExpenseModal from './FixedExpenseModal';

// 목록 행에 표시할 핵심 정보 칩 (간결하게 1~3개)
function buildDetailChips(it) {
  const chips = [];
  const d = it.details || {};
  if (it.category === '대출') {
    if (d.lender) chips.push(d.lender);
    if (d.interestRate) chips.push(`금리 ${d.interestRate}%`);
  } else if (it.category === '보험' && d.insurer) {
    chips.push(d.insurer);
  } else if (it.category === '월세' && d.landlord) {
    chips.push(`임대인 ${d.landlord}`);
  } else if (it.category === '통신비' && d.telecom) {
    chips.push(d.telecom);
  } else if (it.category === '구독료' && d.service) {
    chips.push(d.service);
  } else if (it.category === '세무' && d.office) {
    chips.push(d.office);
  }
  if (it.endDate) {
    const [y, m] = it.endDate.split('-');
    if (y && m) chips.push(`~${y}.${m}`);
  }
  return chips;
}

export default function FixedExpensePanel({ year, month, items, onChange, saving }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const total = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  const openAdd = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (it) => { setEditing(it); setModalOpen(true); };
  const handleSave = (payload) => {
    const next = editing
      ? items.map((it) => (it.id === editing.id ? payload : it))
      : [...items, payload];
    onChange(next);
    setModalOpen(false);
    setEditing(null);
  };
  const handleDelete = (id) => {
    if (!window.confirm('이 항목을 삭제할까요?')) return;
    onChange(items.filter((it) => it.id !== id));
  };

  return (
    <div className="fixed-expense-panel">
      <div className="fixed-expense-header">
        <div className="fixed-expense-title">
          <span>🏢 고정지출</span>
          <span className="fixed-expense-period">{year}.{String(month).padStart(2, '0')}</span>
        </div>
        <div className="fixed-expense-actions">
          {saving && <span className="fixed-expense-saving">저장 중...</span>}
          <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ 항목 추가</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="fixed-expense-empty">등록된 고정지출이 없습니다. 항목을 추가하세요.</div>
      ) : (
        <ul className="fixed-expense-list">
          {items.map((it) => {
            const chips = buildDetailChips(it);
            return (
              <li key={it.id} className="fixed-expense-row">
                <span className="fixed-expense-cat">{it.category}</span>
                <span className="fixed-expense-name">
                  <span className="fixed-expense-name-text">{it.name}</span>
                  {chips.length > 0 && (
                    <span className="fixed-expense-chips">
                      {chips.map((c, i) => (
                        <span key={i} className="fixed-expense-chip">{c}</span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="fixed-expense-amount">{(Number(it.amount) || 0).toLocaleString()}원</span>
                <span className="fixed-expense-row-actions">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => openEdit(it)}>수정</button>
                  <button type="button" className="btn btn-ghost btn-xs btn-danger-text" onClick={() => handleDelete(it.id)}>삭제</button>
                </span>
              </li>
            );
          })}
          <li className="fixed-expense-row fixed-expense-total-row">
            <span className="fixed-expense-cat" />
            <span className="fixed-expense-name">소계</span>
            <span className="fixed-expense-amount">{total.toLocaleString()}원</span>
            <span className="fixed-expense-row-actions" />
          </li>
        </ul>
      )}

      {modalOpen && (
        <FixedExpenseModal
          key={editing?.id || 'new'}
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSave={handleSave}
          initial={editing}
        />
      )}
    </div>
  );
}
