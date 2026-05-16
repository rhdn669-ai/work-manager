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
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
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
