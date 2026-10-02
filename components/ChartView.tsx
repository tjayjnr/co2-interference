"use client";

import { useMemo } from "react";
import { render, type ChartSpec } from "@/lib/charts";
import { downloadPng, downloadSvg } from "@/lib/exportImage";

interface Props {
  spec: ChartSpec;
  title: string; // printed on exported images
  filename: string; // without extension
}

/** Shows a chart (legend included) with buttons to export it as PNG or SVG. */
export default function ChartView({ spec, title, filename }: Props) {
  const screen = useMemo(() => render(spec, "css"), [spec]);
  const exportIt = (kind: "png" | "svg") => {
    const r = render(spec, "light", title);
    if (kind === "svg") downloadSvg(r.svg, `${filename}.svg`);
    else downloadPng(r.svg, r.width, r.height, `${filename}.png`);
  };
  return (
    <div className="chartview">
      <div className="chartbar">
        <button className="ghost" onClick={() => exportIt("png")}>Export PNG</button>
        <button className="ghost" onClick={() => exportIt("svg")}>Export SVG</button>
      </div>
      <div className="chartsvg" role="img" aria-label={title} dangerouslySetInnerHTML={{ __html: screen.svg }} />
    </div>
  );
}
