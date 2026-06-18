import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const DialogContext = createContext(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within DialogProvider');
  return ctx;
}

function normalize(input) {
  if (typeof input === 'string') return { message: input };
  return input || {};
}

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  // 결과 알림 토스트 — toast('저장됐습니다') / toast('실패', 'error')
  const toast = useCallback((input, type = 'success', duration = 2400) => {
    const opts = normalize(input);
    const id = ++toastIdRef.current;
    setToasts((list) => [...list, { id, message: opts.message || String(input || ''), type: opts.type || type }]);
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, opts.duration || duration);
  }, []);

  const close = useCallback((result) => {
    setDialog(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const confirm = useCallback((input) => {
    const opts = normalize(input);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: 'confirm',
        title: opts.title || '확인',
        message: opts.message || '',
        confirmText: opts.confirmText || '확인',
        cancelText: opts.cancelText || '취소',
        danger: opts.danger ?? /삭제|초기화|되돌릴 수 없|영구|복구할 수 없/.test(opts.message || ''),
      });
    });
  }, []);

  const alert = useCallback((input) => {
    const opts = normalize(input);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setDialog({
        type: 'alert',
        title: opts.title || '알림',
        message: opts.message || '',
        confirmText: opts.confirmText || '확인',
      });
    });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close(dialog.type === 'confirm' ? false : undefined);
      else if (e.key === 'Enter') close(dialog.type === 'confirm' ? true : undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, close]);

  return (
    <DialogContext.Provider value={{ confirm, alert, toast }}>
      {children}
      {toasts.length > 0 && (
        <div className="toast-viewport" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast--${t.type === 'error' ? 'error' : 'success'}`} role="status">
              <svg className="toast__icon" viewBox="0 0 24 24" aria-hidden="true">
                {t.type === 'error'
                  ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><path d="M12 16h.01" /></>
                  : <><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>}
              </svg>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
      {dialog && (
        <div
          className="modal-overlay"
          onClick={() => close(dialog.type === 'confirm' ? false : undefined)}
        >
          <div className="modal app-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{dialog.title}</h3>
            </div>
            <div className="modal-body">
              <p className="app-dialog-message">{dialog.message}</p>
              <div className="modal-actions app-dialog-actions">
                {dialog.type === 'confirm' && (
                  <button className="btn btn-outline" onClick={() => close(false)}>
                    {dialog.cancelText}
                  </button>
                )}
                <button
                  className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
                  onClick={() => close(dialog.type === 'confirm' ? true : undefined)}
                  autoFocus
                >
                  {dialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
