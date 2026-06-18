/* 통일 라인 아이콘 세트 (이모지/기호 → SVG)
   사용: <Icon name="trash" />  ·  버튼: <button className="icon-btn"><Icon name="edit" /></button>
   stroke·크기는 .icon-btn / CSS에서 currentColor·width로 제어된다. */

const PATHS = {
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  move: <><circle cx="9" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="18" r="1" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  restore: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  download: <><path d="M12 3v12" /><path d="M7 12l5 5 5-5" /><path d="M5 21h14" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  chevronRight: <><path d="M9 6l6 6-6 6" /></>,
  chevronDown: <><path d="M6 9l6 6 6-6" /></>,
  calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  fingerprint: <><path d="M12 11a2 2 0 0 1 2 2c0 3-.5 5-1.5 6.5" /><path d="M8.5 8.5A5 5 0 0 1 17 12c0 1.5 0 3.5-.5 5" /><path d="M5.5 11a7 7 0 0 1 1.5-4.3" /><path d="M9 20c1-1.5 1.5-3.5 1.5-7" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5 5h14l3 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
};

export default function Icon({ name, className, size, ...rest }) {
  const inner = PATHS[name];
  if (!inner) return null;
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {inner}
    </svg>
  );
}
