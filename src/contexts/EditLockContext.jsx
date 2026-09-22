import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { EditLockContext } from './useEditLock';
import Icon from '../components/common/Icon';
import { isFinePointer } from '../utils/finePointer';

// 「잠금」을 앱 전체가 하나로 쓴다 — 화면 오른쪽 아래에 떠 있어 표를 내려봐도 따라온다.
// 화면을 나가면 다시 잠긴다(예전과 같다). 잠금을 쓰는 화면에서만 자물쇠가 보인다.
export function EditLockProvider({ children }) {
  // 「어느 화면에서 풀었는가」를 함께 적어 둔다 — 다른 화면으로 가면 그 자리에서 다시 잠긴 것이 된다.
  // 화면이 바뀔 때마다 값을 되돌리는 방식은 그리는 도중에 상태를 건드려 화면을 두 번 그리게 한다.
  const [lock, setLock] = useState({ path: '', on: false });
  const [users, setUsers] = useState(0); // 지금 화면이 잠금을 쓰는가
  const { pathname } = useLocation();

  // 마우스 PC 에서는 늘 풀려 있고 자물쇠도 안 보인다 — 잠금은 터치로 스치는 실수를 막는 것이라
  // 마우스에서는 군더더기였다 (2026-09-18 대표님 「pc 에서는 잠금버튼 없애자」)
  const pc = isFinePointer();
  const on = pc || (lock.on && lock.path === pathname);
  const toggle = useCallback(
    () => setLock((s) => ({ path: pathname, on: !(s.on && s.path === pathname) })),
    [pathname],
  );

  // 잠금이 뜨는 화면에는 본문 아래에 버튼만큼 자리를 비운다 (CSS 가 --fab-clear 로 받는다)
  useEffect(() => {
    document.body.classList.toggle('has-editlock', users > 0 && !pc);
    return () => document.body.classList.remove('has-editlock');
  }, [users, pc]);

  const register = useCallback(() => {
    setUsers((n) => n + 1);
    return () => setUsers((n) => Math.max(0, n - 1));
  }, []);

  const value = useMemo(() => ({ on, register, toggle }), [on, register, toggle]);

  return (
    <EditLockContext.Provider value={value}>
      {/* 「수정 중」 띄는 없앤다 — 풀릴 때마다 위에 줄이 하나 생겨 표가 그만큼
        짧아졌고, 오른쪽 아래 단추가 이미 「잠금 해제」로 상태를 말해 준다
        (2026-09-22 대표님 「잠금 누르면 상단에 뜨는 문구때문에 칸이좁아짐 삭제」) */}
      {children}
      {users > 0 && !pc && (
        <>
          <button
            type="button"
            className={`editlock-fab${on ? ' on' : ''}`}
            aria-pressed={on}
            aria-label={on ? '잠그기' : '잠금 풀기'}
            title={
              on
                ? '누르면 다시 잠깁니다 — 칸 수정·끌기·선택 삭제 불가'
                : '누르면 칸을 고치고, 끌어서 순서를 바꾸고, 골라서 지울 수 있습니다'
            }
            onClick={toggle}
          >
            <Icon name={on ? 'unlock' : 'lock'} className="editlock-fab-ic" />
            <span className="editlock-fab-text">{on ? '잠금 해제' : '잠금'}</span>
          </button>
        </>
      )}
    </EditLockContext.Provider>
  );
}
