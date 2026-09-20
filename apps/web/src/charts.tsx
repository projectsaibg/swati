// Small dependency-free charts with real X/Y axes + a colour legend.
export interface ChartPoint { label: string; value: number }

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Number.isInteger(v) ? String(v) : v.toFixed(a < 10 ? 1 : 0);
}

export function AxisChart({
  data, color, name, unit = '', type = 'area', yMin, yMax, height = 150,
}: {
  data: ChartPoint[];
  color: string;
  name: string;
  unit?: string;
  type?: 'area' | 'line' | 'bar';
  yMin?: number;
  yMax?: number;
  height?: number;
}) {
  if (!data || data.length === 0) return <div className="chart-empty muted">No data yet</div>;

  const W = 360, H = height, padL = 38, padR = 10, padT = 8, padB = 20;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = data.map((d) => d.value);
  let lo = yMin ?? Math.min(...vals);
  let hi = yMax ?? Math.max(...vals);
  if (lo === hi) hi = lo + 1;
  if (yMin == null && yMax == null) { const pad = (hi - lo) * 0.12; lo -= pad; hi += pad; }

  const x = (i: number) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const yticks = [lo, (lo + hi) / 2, hi];
  const xIdx = Array.from(new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]));

  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  const barW = Math.min(24, (plotW / data.length) * 0.6);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ maxHeight: H }} role="img" aria-label={name}>
        {yticks.map((t, i) => {
          const yy = y(t);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="var(--line)" strokeWidth={1} opacity={0.5} />
              <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{fmtTick(t)}</text>
            </g>
          );
        })}
        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--muted)">{data[i].label}</text>
        ))}
        {type === 'bar'
          ? data.map((d, i) => {
              const yy = y(d.value); const bh = (padT + plotH) - yy;
              return <rect key={i} x={x(i) - barW / 2} y={yy} width={barW} height={Math.max(0, bh)} rx={2} fill={color} />;
            })
          : (<>
              {type === 'area' && <path d={area} fill={color} opacity={0.15} />}
              <path d={line} fill="none" stroke={color} strokeWidth={2} />
            </>)}
      </svg>
      <div className="chart-legend"><span className="sw" style={{ background: color }} />{name}{unit ? ` (${unit})` : ''}</div>
    </div>
  );
}
