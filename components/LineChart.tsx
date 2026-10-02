"use client";

export interface Series {
  name: string;
  color: string;
  x: number[];
  y: number[];
  dash?: string;
}

interface Props {
  series: Series[];
  xLabel: string;
  yLabel: string;
  hline?: { y: number; label: string };
  markerX?: number;
  height?: number;
}

const W = 760;
const M = { l: 62, r: 16, t: 14, b: 44 };

function ticks(lo: number, hi: number, n = 6) {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

export default function LineChart({ series, xLabel, yLabel, hline, markerX, height = 340 }: Props) {
  const xs = series.flatMap((s) => s.x);
  const ys = series.flatMap((s) => s.y).concat(hline ? [hline.y] : []);
  const x1 = Math.max(...xs, 1e-9);
  const y1 = Math.max(...ys, 1e-9) * 1.06;
  const sx = (v: number) => M.l + (v / x1) * (W - M.l - M.r);
  const sy = (v: number) => height - M.b - (v / y1) * (height - M.t - M.b);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={`${yLabel} versus ${xLabel}`}>
      {ticks(0, y1).map((t) => (
        <g key={`y${t}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      {ticks(0, x1).map((t) => (
        <text key={`x${t}`} x={sx(t)} y={height - M.b + 18} textAnchor="middle" className="tick">{t}</text>
      ))}
      <text x={(M.l + W - M.r) / 2} y={height - 6} textAnchor="middle" className="axis">{xLabel}</text>
      <text transform={`translate(14 ${height / 2}) rotate(-90)`} textAnchor="middle" className="axis">{yLabel}</text>
      {hline && (
        <g>
          <line x1={M.l} x2={W - M.r} y1={sy(hline.y)} y2={sy(hline.y)} className="limit" />
          <text x={W - M.r - 4} y={sy(hline.y) - 5} textAnchor="end" className="limit-label">{hline.label}</text>
        </g>
      )}
      {markerX !== undefined && markerX <= x1 && (
        <line x1={sx(markerX)} x2={sx(markerX)} y1={M.t} y2={height - M.b} className="marker" />
      )}
      {series.map((s) => (
        <polyline
          key={s.name}
          fill="none"
          stroke={s.color}
          strokeWidth={2}
          strokeDasharray={s.dash}
          points={s.x.map((x, i) => `${sx(x).toFixed(1)},${sy(s.y[i]).toFixed(1)}`).join(" ")}
        />
      ))}
    </svg>
  );
}
