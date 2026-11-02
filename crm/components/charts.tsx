// Small inline SVG charts. No chart library, so nothing extra to load or maintain.

export function BarChart({
  data,
  ariaLabel,
  color = 'var(--dl-teal)',
}: {
  data: { label: string; value: number }[];
  ariaLabel: string;
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const height = 220;
  const pad = { top: 16, right: 8, bottom: 56, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const slot = data.length ? innerW / data.length : innerW;
  const barW = Math.max(8, slot * 0.6);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="chart">
      <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--dl-border)" />
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = pad.left + i * slot + (slot - barW) / 2;
        const y = pad.top + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={h} rx={3} fill={color} />
            <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="11" fill="var(--dl-ink)">
              {d.value}
            </text>
            <text
              x={x + barW / 2}
              y={pad.top + innerH + 14}
              textAnchor="end"
              fontSize="10"
              fill="var(--dl-slate)"
              transform={`rotate(-35 ${x + barW / 2} ${pad.top + innerH + 14})`}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({
  data,
  ariaLabel,
}: {
  data: { label: string; value: number }[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 56, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = pad.left + i * step;
    const y = pad.top + innerH - (d.value / max) * innerH;
    return { x, y, ...d };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="chart">
      <line x1={pad.left} x2={width - pad.right} y1={pad.top + innerH} y2={pad.top + innerH} stroke="var(--dl-border)" />
      {points.length > 0 ? <path d={path} fill="none" stroke="var(--dl-teal)" strokeWidth={2.5} /> : null}
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={3.5} fill="var(--dl-teal)" />
          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="11" fill="var(--dl-ink)">
            {p.value}
          </text>
          <text
            x={p.x}
            y={pad.top + innerH + 14}
            textAnchor="end"
            fontSize="10"
            fill="var(--dl-slate)"
            transform={`rotate(-35 ${p.x} ${pad.top + innerH + 14})`}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function DonutChart({
  data,
  ariaLabel,
}: {
  data: { label: string; value: number; color: string }[];
  ariaLabel: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" role="img" aria-label={ariaLabel} width="160" height="160">
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--dl-border)" strokeWidth="22" />
        {total > 0
          ? data.map((d) => {
              const len = (d.value / total) * c;
              const el = (
                <circle
                  key={d.label}
                  cx="80"
                  cy="80"
                  r={r}
                  fill="none"
                  stroke={d.color}
                  strokeWidth="22"
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 80 80)"
                />
              );
              offset += len;
              return el;
            })
          : null}
        <text x="80" y="86" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--dl-ink)">
          {total}
        </text>
      </svg>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.label}>
            <span className="swatch" style={{ background: d.color }} /> {d.label}: <strong>{d.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
