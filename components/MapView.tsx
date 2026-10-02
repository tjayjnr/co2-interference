"use client";

import { useEffect, useRef } from "react";
import { isoSegments } from "@/lib/contour";
import type { GridResult, Boundary, Well, Point } from "@/lib/physics";

interface Props {
  grid: GridResult;
  wells: Well[];
  points: Point[];
  boundary: Boundary;
  contourLevels: { level: number; label: string; cls: string }[];
}

const STOPS: [number, number, number][] = [
  [255, 247, 220], [253, 200, 110], [240, 120, 60], [190, 50, 70], [90, 20, 100], [30, 10, 60],
];

function ramp(t: number): [number, number, number] {
  const p = Math.min(Math.max(t, 0), 1) * (STOPS.length - 1);
  const i = Math.min(Math.floor(p), STOPS.length - 2);
  const f = p - i;
  return [0, 1, 2].map((k) => STOPS[i][k] + f * (STOPS[i + 1][k] - STOPS[i][k])) as [number, number, number];
}

export default function MapView({ grid, wells, points, boundary, contourLevels }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { nx, ny, x0, x1, y0, y1, values, max } = grid;
  const S = 600; // svg units; plot is square

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    cv.width = nx;
    cv.height = ny;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = values[j * nx + i];
        const o = ((ny - 1 - j) * nx + i) * 4;
        if (Number.isNaN(v)) { img.data.set([200, 200, 200, 90], o); continue; }
        const [r, g, b] = ramp(max > 0 ? v / max : 0);
        img.data.set([r, g, b, 255], o);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [values, nx, ny, max]);

  const px = (x: number) => ((x - x0) / (x1 - x0)) * S;
  const py = (y: number) => S - ((y - y0) / (y1 - y0)) * S;
  const gx = (i: number) => (i + 0.5) / nx * S;
  const gy = (j: number) => S - (j + 0.5) / ny * S;

  const kmTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, x: x0 + f * (x1 - x0), y: y0 + f * (y1 - y0) }));
  return (
    <div className="mapwrap">
      <div className="mapbox">
        <canvas ref={ref} className="mapcanvas" />
        <svg viewBox={`-44 -8 ${S + 56} ${S + 40}`} className="mapsvg">
          <rect x={0} y={0} width={S} height={S} fill="none" className="frame" />
          {contourLevels.map((c) => (
            <g key={c.label} className={c.cls}>
              {isoSegments(values, nx, ny, c.level).map((s, k) => (
                <line key={k} x1={gx(s[0])} y1={gy(s[1])} x2={gx(s[2])} y2={gy(s[3])} />
              ))}
            </g>
          ))}
          {boundary.type !== "none" && (
            <line
              className={boundary.type === "noflow" ? "bnd-nf" : "bnd-cp"}
              x1={boundary.axis === "x" ? px(boundary.positionM) : 0}
              x2={boundary.axis === "x" ? px(boundary.positionM) : S}
              y1={boundary.axis === "y" ? py(boundary.positionM) : 0}
              y2={boundary.axis === "y" ? py(boundary.positionM) : S}
            />
          )}
          {points.map((p) => (
            <g key={p.id}>
              <rect x={px(p.x) - 5} y={py(p.y) - 5} width={10} height={10} className="pt" />
              <text x={px(p.x) + 8} y={py(p.y) + 4} className="maplabel">{p.name}</text>
            </g>
          ))}
          {wells.map((w) => (
            <g key={w.id}>
              <circle cx={px(w.x)} cy={py(w.y)} r={6} className="wl" />
              <text x={px(w.x) + 9} y={py(w.y) + 4} className="maplabel">{w.name}</text>
            </g>
          ))}
          {kmTicks.map((t) => (
            <g key={t.f}>
              <text x={t.f * S} y={S + 16} textAnchor="middle" className="tick">{(t.x / 1000).toFixed(1)}</text>
              <text x={-6} y={S - t.f * S + 4} textAnchor="end" className="tick">{(t.y / 1000).toFixed(1)}</text>
            </g>
          ))}
          <text x={S / 2} y={S + 32} textAnchor="middle" className="axis">x (km)</text>
        </svg>
      </div>
      <div className="legend">
        <div className="colorbar" style={{ background: `linear-gradient(to top, ${STOPS.map((s) => `rgb(${s})`).join(",")})` }} />
        <div className="legend-scale">
          <span>{max.toFixed(2)} MPa</span>
          <span>0</span>
        </div>
      </div>
    </div>
  );
}
