import { createContext, useContext, useEffect, useRef } from 'react';

export const EditLockContext = createContext(null);

/**
 * 「잠금」 — 화면 오른쪽 아래에 떠 있는 자물쇠 하나를 앱 전체가 나눠 쓴다.
 *
 * 전에는 화면마다 위쪽 버튼 줄에 있었다. 표를 한참 내려보다 잠금을 누르려면 다시 맨 위로
 * 올라가야 해서, 작은 화면에서 특히 불편했다 (2026-09-11 대표님).
 *
 * 쓰는 쪽은 한 줄이면 된다:
 *   const editMode = useEditLock({ onLock: () => setPick(new Set()) });
 *
 * @param {object}   o
 * @param {boolean}  o.enabled  이 화면에서 잠금을 쓸지 (예: 관리자만이면 isAdmin)
 * @param {Function} o.onLock   다시 잠길 때 할 일 (보통 골라 둔 것 풀기)
 * @returns {boolean} 지금 풀려 있는가
 */
export function useEditLock({ enabled = true, onLock } = {}) {
  const ctx = useContext(EditLockContext);
  const on = !!ctx?.on && enabled;

  // 이 화면이 잠금을 쓴다고 알린다 — 쓰는 화면에서만 자물쇠가 뜬다
  const register = ctx?.register;
  useEffect(() => {
    if (!register || !enabled) return undefined;
    return register();
  }, [register, enabled]);

  // 다시 잠길 때 뒷정리 — 골라 둔 것을 함께 푼다.
  // 그릴 때 ref 를 건드리면 안 되므로(React 규칙) 손대는 것도 전부 effect 안에서 한다.
  const lockCb = useRef(onLock);
  useEffect(() => {
    lockCb.current = onLock;
  });
  const was = useRef(on);
  useEffect(() => {
    if (was.current && !on) lockCb.current?.();
    was.current = on;
  }, [on]);

  return on;
}
