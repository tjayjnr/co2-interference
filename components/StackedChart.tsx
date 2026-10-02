"use client";

import type { Series } from "./LineChart";

interface Props {
  layers: Series[]; // all share the same x; stacked bottom-to-top in order
  xLabel: string;
  yLabel: string;
  height?: number;
}

const W = 760;
const M = { l: 62, r: 16, t: 14, b: 44 };

function ticks(hi: number, n = 6) {
  const raw = hi / n || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = 0; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
  return out;
}

export default function StackedChart({ layers, xLabel, yLabel, height = 320 }: Props) {
  const x = layers[0]?.x ?? [];
  const n = x.length;
  const cum: number[][] = [new Array(n).fill(0)];
  layers.forEach((l, i) => cum.push(cum[i].map((v, k) => v + Math.max(l.y[k], 0))));
  const top = cum[layers.length];
  const x1 = Math.max(...x, 1e-9);
  const y1 = Math.max(...top, 1e-9) * 1.06;
  const sx = (v: number) => M.l + (v / x1) * (W - M.l - M.r);
  const sy = (v: number) => height - M.b - (v / y1) * (height - M.t - M.b);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label={`${yLabel} versus ${xLabel}`}>
      {ticks(y1).map((t) => (
        <g key={`y${t}`}>
          <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.l - 8} y={sy(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>
      ))}
      {ticks(x1).map((t) => (
        <text key={`x${t}`} x={sx(t)} y={height - M.b + 18} textAnchor="middle" className="tick">{t}</text>
      ))}
      <text x={(M.l + W - M.r) / 2} y={height - 6} textAnchor="middle" className="axis">{xLabel}</text>
      <text transform={`translate(14 ${height / 2}) rotate(-90)`} textAnchor="middle" className="axis">{yLabel}</text>
      {layers.map((l, i) => {
        const up = x.map((xv, k) => `${sx(xv).toFixed(1)},${sy(cum[i + 1][k]).toFixed(1)}`);
        const down = x.map((xv, k) => `${sx(xv).toFixed(1)},${sy(cum[i][k]).toFixed(1)}`).reverse();
        return <polygon key={l.name} points={[...up, ...down].join(" ")} fill={l.color} fillOpacity={0.85} stroke="var(--panel)" strokeWidth={0.8} />;
      })}
    </svg>
  );
}
