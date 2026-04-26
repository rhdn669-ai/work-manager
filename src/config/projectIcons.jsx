// 프로젝트 카드에 사용할 아이콘 옵션 — feather/lucide 스타일 24x24 SVG path
// 현장 / 사무실 / 지원 3가지 카테고리를 구분할 수 있는 핵심 아이콘만 유지

export const PROJECT_ICONS = [
  {
    key: 'site',
    label: '현장',
    paths: (
      <>
        <path d="M2 20h20"/>
        <path d="M5 20V8.5a2 2 0 0 1 .8-1.6l5-3.5a2 2 0 0 1 2.4 0l5 3.5a2 2 0 0 1 .8 1.6V20"/>
        <path d="M9 20v-6h6v6"/>
      </>
    ),
  },
  {
    key: 'office',
    label: '사무실',
    paths: (
      <>
        <path d="M3 21h18"/>
        <path d="M5 21V7l7-4 7 4v14"/>
        <path d="M9 9h.01"/><path d="M9 13h.01"/><path d="M9 17h.01"/>
        <path d="M15 9h.01"/><path d="M15 13h.01"/><path d="M15 17h.01"/>
      </>
    ),
  },
  {
    key: 'support',
    label: '지원',
    paths: (
      <>
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      </>
    ),
  },
];

export function getProjectIcon(key) {
  return PROJECT_ICONS.find((i) => i.key === key);
}
