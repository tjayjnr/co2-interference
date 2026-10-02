"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { render, type ChartSpec, type View } from "@/lib/charts";
import { downloadPng, downloadSvg } from "@/lib/exportImage";

interface Props {
  spec: ChartSpec;
  title: string; // shown above the plot and printed on exported images
  filename: string; // without extension
}

const MIN_FRACTION = 1e-4; // deepest zoom, as a fraction of the full range

/** Keep a view inside the full domain (shifting rather than shrinking it). */
function clampView(v: View, full: View): View {
  const axis = (a0: number, a1: number, f0: number, f1: number): [number, number] => {
    const span = Math.min(a1 - a0, f1 - f0);
    let lo = a0;
    if (lo < f0) lo = f0;
    if (lo + span > f1) lo = f1 - span;
    return [lo, lo + span];
  };
  const [x0, x1] = axis(v.x0, v.x1, full.x0, full.x1);
  const [y0, y1] = axis(v.y0, v.y1, full.y0, full.y1);
  return { x0, x1, y0, y1 };
}

/**
 * Chart with a title and legend that can be zoomed: drag a box to zoom into a region,
 * Ctrl/⌘ + scroll (or pinch) to zoom about the cursor, +/− buttons, double-click or Reset to return.
 * The PNG/SVG exports contain whatever region is currently shown.
 */
export default function ChartView({ spec, title, filename }: Props) {
  const [view, setView] = useState<View | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const r = useMemo(() => render(spec, "css", title, view ?? undefined), [spec, title, view]);
  const lastDown = useRef(0);
  const rRef = useRef(r);
  rRef.current = r;
  const isMap = spec.kind === "map";

  /** Client pixel -> SVG units -> data coordinates for the plot currently drawn. */
  const locate = (clientX: number, clientY: number) => {
    const svg = box.current?.querySelector("svg");
    if (!svg) return null;
    const cur = rRef.current;
    const rc = svg.getBoundingClientRect();
    const k = rc.width / cur.width;
    const sx = (clientX - rc.left) / k;
    const sy = (clientY - rc.top) / k;
    return {
      sx, sy,
      x: cur.view.x0 + ((sx - cur.plot.l) / cur.plot.w) * (cur.view.x1 - cur.view.x0),
      y: cur.view.y1 - ((sy - cur.plot.t) / cur.plot.h) * (cur.view.y1 - cur.view.y0),
    };
  };
  const inPlot = (p: { sx: number; sy: number }) => {
    const { plot } = rRef.current;
    return p.sx >= plot.l && p.sx <= plot.l + plot.w && p.sy >= plot.t && p.sy <= plot.t + plot.h;
  };

  const zoomAbout = (cx: number, cy: number, factor: number) => {
    const { view: cur, domain: full } = rRef.current;
    const nv: View = {
      x0: cx - (cx - cur.x0) * factor, x1: cx + (cur.x1 - cx) * factor,
      y0: cy - (cy - cur.y0) * factor, y1: cy + (cur.y1 - cy) * factor,
    };
    if (nv.x1 - nv.x0 < (full.x1 - full.x0) * MIN_FRACTION || nv.y1 - nv.y0 < (full.y1 - full.y0) * MIN_FRACTION) return;
    if (nv.x1 - nv.x0 >= full.x1 - full.x0 && nv.y1 - nv.y0 >= full.y1 - full.y0) setView(null);
    else setView(clampView(nv, full));
  };
  const zoomCentre = (factor: number) => {
    const { view: cur } = rRef.current;
    zoomAbout((cur.x0 + cur.x1) / 2, (cur.y0 + cur.y1) / 2, factor);
  };

  // Ctrl/⌘ + wheel (also what a trackpad pinch sends) zooms about the cursor; plain scrolling still scrolls the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const p = locate(e.clientX, e.clientY);
      if (!p || !inPlot(p)) return;
      e.preventDefault();
      zoomAbout(p.x, p.y, e.deltaY < 0 ? 0.8 : 1.25);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Box zoom. The window listeners are attached synchronously on mouse-down so a quick click can never leave a drag stuck.
  const finishDrag = (start: { x: number; y: number }, e: MouseEvent) => {
    const a = locate(start.x, start.y);
    const b = locate(e.clientX, e.clientY);
    if (!a || !b || Math.abs(e.clientX - start.x) < 8 || Math.abs(e.clientY - start.y) < 8) return;
    const { domain: full } = rRef.current;
    const clampPt = (p: { x: number; y: number }) => ({ x: Math.min(Math.max(p.x, full.x0), full.x1), y: Math.min(Math.max(p.y, full.y0), full.y1) });
    const p0 = clampPt(a), p1 = clampPt(b);
    let nv: View = { x0: Math.min(p0.x, p1.x), x1: Math.max(p0.x, p1.x), y0: Math.min(p0.y, p1.y), y1: Math.max(p0.y, p1.y) };
    if (spec.kind === "map") {
      // keep the map's aspect ratio: use the larger side of the selection, centred on it
      const side = Math.max(nv.x1 - nv.x0, nv.y1 - nv.y0);
      const cx = (nv.x0 + nv.x1) / 2, cy = (nv.y0 + nv.y1) / 2;
      nv = { x0: cx - side / 2, x1: cx + side / 2, y0: cy - side / 2, y1: cy + side / 2 };
    }
    if (nv.x1 - nv.x0 < (full.x1 - full.x0) * MIN_FRACTION || nv.y1 - nv.y0 < (full.y1 - full.y0) * MIN_FRACTION) return;
    setView(clampView(nv, full));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const p = locate(e.clientX, e.clientY);
    if (!p || !inPlot(p)) return;
    e.preventDefault();
    const now = Date.now(); // two quick presses = double-click: back to the full view
    if (now - lastDown.current < 400) { lastDown.current = 0; setView(null); return; }
    lastDown.current = now;
    const start = { x: e.clientX, y: e.clientY };
    setDrag({ ...start, cx: start.x, cy: start.y });
    const move = (ev: MouseEvent) => setDrag({ ...start, cx: ev.clientX, cy: ev.clientY });
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDrag(null);
      finishDrag(start, ev);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const exportIt = (kind: "png" | "svg") => {
    const out = render(spec, "light", title, view ?? undefined);
    if (kind === "svg") downloadSvg(out.svg, `${filename}.svg`);
    else downloadPng(out.svg, out.width, out.height, `${filename}.png`);
  };

  const boxRect = box.current?.getBoundingClientRect();
  const sel = drag && boxRect
    ? { left: Math.min(drag.x, drag.cx) - boxRect.left, top: Math.min(drag.y, drag.cy) - boxRect.top, width: Math.abs(drag.cx - drag.x), height: Math.abs(drag.cy - drag.y) }
    : null;

  return (
    <div className="chartview">
      <div className="chartbar">
        <span className="zoomhint">{isMap ? "Drag a square on the map to zoom" : "Drag a box on the plot to zoom"} · Ctrl + scroll to zoom · double-click to reset</span>
        <button className="ghost" aria-label="Zoom in" title="Zoom in" onClick={() => zoomCentre(0.6)}>＋</button>
        <button className="ghost" aria-label="Zoom out" title="Zoom out" onClick={() => zoomCentre(1 / 0.6)} disabled={!view}>−</button>
        <button className="ghost" onClick={() => setView(null)} disabled={!view}>Reset zoom</button>
        <button className="ghost" onClick={() => exportIt("png")}>Export PNG</button>
        <button className="ghost" onClick={() => exportIt("svg")}>Export SVG</button>
      </div>
      <div
        ref={box}
        className="chartsvg"
        role="img"
        aria-label={title}
        onMouseDown={onMouseDown}
        onDoubleClick={() => setView(null)}
        dangerouslySetInnerHTML={{ __html: r.svg }}
      />
      {sel && <div className="zoombox" style={{ left: sel.left, top: sel.top + (box.current?.offsetTop ?? 0), width: sel.width, height: sel.height }} />}
    </div>
  );
}
