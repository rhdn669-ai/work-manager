// 품질 차트 — 외부 라이브러리 없이 인라인 SVG로 그린다(의존성 추가 회피).
// 스파크라인 / 영역차트 / 도넛 3종만 제공. 필요해지기 전에는 늘리지 않는다.

function toPoints(values, w, h, pad = 2) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (values.length - 1 || 1);
  return values.map((v, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (v - min) / span)]);
}

// 부드러운 곡선 경로 (Catmull-Rom → 베지어)
function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function Sparkline({ values, color = 'var(--accent)', width = 96, height = 26 }) {
  if (!values?.length) return null;
  const pts = toPoints(values, width, height);
  return (
    <svg className="q-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={smoothPath(pts)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// viewBox 는 4:1 에 가깝게 잡는다 — 카드 폭이 넓어져도 세로로 과하게 늘어나지 않도록.
export function AreaChart({ labels, series, unit = '', height = 240 }) {
  const W = 960;
  const H = height;
  const padL = 34;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(...all);
  const min = Math.min(0, Math.min(...all));
  const span = max - min || 1;
  const x = (i) => padL + ((W - padL - padR) / (labels.length - 1 || 1)) * i;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const grid = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg className="q-area" viewBox={`0 0 ${W} ${H}`} role="img">
      {grid.map((g) => {
        const gy = padT + (H - padT - padB) * g;
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} className="q-grid" />
            <text x={padL - 8} y={gy + 4} className="q-axis" textAnchor="end">
              {(max - span * g).toFixed(2)}
            </text>
          </g>
        );
      })}
      {labels.map((l, i) => (
        <text key={l} x={x(i)} y={H - 8} className="q-axis" textAnchor="middle">
          {l}
        </text>
      ))}
      {series.map((s) => {
        const pts = labels.map((_, i) => [x(i), y(s.values[i])]);
        const line = smoothPath(pts);
        return (
          <g key={s.name}>
            {s.fill && (
              <path
                d={`${line} L${x(labels.length - 1)},${y(min)} L${x(0)},${y(min)} Z`}
                fill={`url(#qgrad-${s.key})`}
              />
            )}
            <path
              d={line}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.6 : 2.4}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinecap="round"
            />
            {!s.dashed &&
              pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 5 : 3} fill={s.color} />)}
          </g>
        );
      })}
      <defs>
        {series
          .filter((s) => s.fill)
          .map((s) => (
            <linearGradient key={s.key} id={`qgrad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.34" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
      </defs>
      {(() => {
        const main = series.find((s) => !s.dashed);
        if (!main) return null;
        const i = labels.length - 1;
        const v = main.values[i];
        const TW = 42;
        const TH = 20;
        // 말풍선이 viewBox 밖으로 잘리지 않게 가둔다.
        // 점이 최고점이면 위쪽 공간이 없으므로 점 아래로 내린다.
        const above = y(v) - TH - 10;
        const ty = above < 2 ? Math.min(H - padB - TH - 2, y(v) + 10) : above;
        const tx = Math.max(2, Math.min(W - padR - TW, x(i) - TW - 4));
        return (
          <g transform={`translate(${tx},${ty})`}>
            <rect className="q-tip" width={TW} height={TH} rx="6" />
            <text x={TW / 2} y="14" className="q-tip-text" textAnchor="middle">
              {v}
              {unit}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

export function Donut({ slices, total, caption = '총 건수' }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  // 조각별 시작 위치(offset)를 누적 — 렌더 중 변수 변형 없이 reduce 로만 계산
  const arcs = slices.reduce((acc, s) => {
    const frac = total ? s.value / total : 0;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].frac : 0;
    return [...acc, { ...s, frac, offset }];
  }, []);
  return (
    <div className="q-donut-wrap">
      <svg className="q-donut" viewBox="0 0 140 140" role="img">
        <g transform="translate(70,70) rotate(-90)">
          <circle r={R} className="q-donut-track" />
          {arcs.map((s) => (
            <circle
              key={s.label}
              r={R}
              stroke={s.color}
              strokeDasharray={`${C * s.frac} ${C * (1 - s.frac)}`}
              strokeDashoffset={-C * s.offset}
            />
          ))}
        </g>
        <text x="70" y="68" className="q-donut-num" textAnchor="middle">
          {total}
        </text>
        <text x="70" y="86" className="q-donut-cap" textAnchor="middle">
          {caption}
        </text>
      </svg>
      <ul className="q-legend">
        {slices.map((s) => (
          <li key={s.label}>
            <i style={{ background: s.color }} />
            <span className="q-legend-name">{s.label}</span>
            <b>{s.value}건</b>
            <em>{total ? Math.round((s.value / total) * 100) : 0}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}
