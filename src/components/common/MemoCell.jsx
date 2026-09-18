import { useState } from 'react';
import Modal from './Modal';

// 표 안의 한 줄 메모 — «눌러야» 적을 수 있다.
//
// 전에는 칸이 늘 입력 상태(textarea)라, 옆 칸에 숫자를 적으려다 비고에 숫자가 들어가는 일이
// 잦았다 (2026-09-18 대표님 「자꾸 실수로 비고에 숫자를 입력하는데 비고는 입력할 때 모달로」).
// 이제 표에는 글자만 보이고, 누르면 창이 열린다. 실수로 스치는 일이 없어지고 표도 안 흔들린다.
export default function MemoCell({ value = '', onSave, readOnly = false, title = '비고', ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const has = String(value || '').trim().length > 0;

  const start = () => {
    if (readOnly) return;
    setText(String(value || ''));
    setOpen(true);
  };
  const save = (e) => {
    e.preventDefault();
    const v = text.trim();
    setOpen(false);
    if (v !== String(value || '').trim()) onSave?.(v);
  };

  return (
    <>
      <button
        type="button"
        className={`memo-cell${has ? ' has-text' : ''}`}
        onClick={start}
        disabled={readOnly}
        title={has ? value : readOnly ? '' : '눌러서 비고를 적습니다'}
        aria-label={ariaLabel || title}
      >
        {has ? value : readOnly ? '' : '메모'}
      </button>
      {open && (
        <Modal isOpen onClose={() => setOpen(false)} title={title} size="md">
          <form onSubmit={save}>
            <div className="form-group">
              <label>내용</label>
              {/* 표 전용 클래스(pmat-input)를 쓰면 안 된다 — 창이 표 <td> 안에 그려지는 탓에
                  「.pmat-table .pmat-input { width: 72px }」가 그대로 먹어 칸이 찌부러진다
                  (2026-09-18 대표님 「칸 이상하다」). 창 안은 앱 표준 .form-group 규칙에 맡긴다. */}
              <textarea
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="예) 커넥터 깨짐 · 다음 주 입고 예정"
                aria-label={`${title} 내용`}
                ref={(el) => el?.focus()}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary">
                저장
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
