// 모달 안에서 Enter 가 「저장」을 뜻하는지 — 한 군데서만 판정한다. (2026-09-15)
//
// 자료실에서 폴더를 하나 만들면 둘이 생겼다. 입력칸이 Enter 를 받아 만들고, 그 키가 위로
// 올라가 모달도 주버튼을 눌러 한 번 더 만들었다. 모달이 Enter→주버튼을 맡은 지(v87.2) 두 달
// 됐는데 입력칸마다 남아 있던 Enter 처리가 그대로 겹쳐 있었다 — 12곳.
// 그래서 규칙: 모달 안 입력칸은 Enter 를 직접 다루지 않는다. 모달이 한 번만 누른다.
//
// 한글을 조합하는 도중의 Enter(글자 확정)도 걸러야 한다. React 의 합성 이벤트에는
// isComposing 이 없어 nativeEvent 에서 읽는다 — e.isComposing 은 늘 undefined 였다.

/** 이 키 입력이 「Enter 로 저장」인가 — 아니면 false */
export function isSubmitEnter(e) {
  if (!e || e.key !== 'Enter' || e.shiftKey) return false;
  if (e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return false;
  const tag = e.target?.tagName;
  if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return false;
  return true;
}
