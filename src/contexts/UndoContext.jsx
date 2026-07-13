import { createContext, useContext, useRef, useCallback, useEffect } from 'react';
import { useDialog } from '../components/common/DialogProvider';

const UndoContext = createContext(null);
const MAX_STACK = 30;

export function UndoProvider({ children }) {
  const stackRef = useRef([]);
  const { toast } = useDialog();

  const push = useCallback((label, undoFn) => {
    stackRef.current = [...stackRef.current.slice(-(MAX_STACK - 1)), { label, undo: undoFn }];
  }, []);

  const undoLast = useCallback(async () => {
    const item = stackRef.current.pop();
    if (!item) {
      toast('되돌릴 작업이 없습니다.', 'info');
      return;
    }
    try {
      await item.undo();
      toast(`실행 취소됨: ${item.label}`);
    } catch (err) {
      console.error('[Undo]', err);
      toast(`실행 취소 실패: ${err.message}`, 'error');
    }
  }, [toast]);

  const clear = useCallback(() => {
    stackRef.current = [];
  }, []);

  useEffect(() => {
    function handler(e) {
      if (!(e.ctrlKey || e.metaKey) || e.key !== 'z' || e.shiftKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable)
        return;
      e.preventDefault();
      undoLast();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoLast]);

  return <UndoContext.Provider value={{ push, undoLast, clear }}>{children}</UndoContext.Provider>;
}

export const useUndo = () => useContext(UndoContext);
