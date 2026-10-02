import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { manualBlocks, SITE_URL } from "@/lib/manual";
import type { Block } from "@/lib/report";

export const metadata: Metadata = {
  title: "User manual | CO2 Interference Analyzer",
  description: "How to use the CO2 injection pressure interference and saturation analyzer",
};

function image(name: string) {
  const file = path.join(process.cwd(), "public", "manual", `${name}.png`);
  if (!fs.existsSync(file)) return undefined;
  const buf = fs.readFileSync(file);
  return { png: `/manual/${name}.png`, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Render({ blk }: { blk: Block }) {
  switch (blk.t) {
    case "title":
      return (
        <header className="doc-title">
          <h1>{blk.title}</h1>
          {blk.subtitle && <p className="doc-sub">{blk.subtitle}</p>}
          <p className="doc-date">{blk.date}</p>
        </header>
      );
    case "h1": return <h2 id={slug(blk.text)} className="doc-h1">{blk.text}</h2>;
    case "h2": return <h3 className="doc-h2">{blk.text}</h3>;
    case "p": return <p>{blk.text}</p>;
    case "bullets": return <ul>{blk.items.map((i) => <li key={i}>{i}</li>)}</ul>;
    case "eq": return <p className="doc-eq"><i>{blk.text}</i> <span>({blk.n})</span></p>;
    case "table":
      return (
        <div className="doc-table">
          <p className="doc-cap"><b>{blk.caption}</b></p>
          <div className="tablewrap">
            <table className="matrix">
              <thead><tr>{blk.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{blk.rows.map((r, i) => <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j}>{c}</th> : <td key={j} className="left">{c}</td>))}</tr>)}</tbody>
            </table>
          </div>
          {blk.note && <p className="doc-note">{blk.note}</p>}
        </div>
      );
    case "fig":
      return (
        <figure className="doc-fig">
          <img src={blk.png} alt={blk.caption} width={blk.w} height={blk.h} />
          <figcaption>{blk.caption}</figcaption>
        </figure>
      );
    case "refs":
      return <><h2 id="references" className="doc-h1">References</h2><ol className="doc-refs">{blk.items.map((r) => <li key={r}>{r}</li>)}</ol></>;
    default: return null;
  }
}

export default function Manual() {
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const blocks = manualBlocks(image, date);
  const toc = blocks.filter((b) => b.t === "h1") as { t: "h1" | "h2"; text: string }[];
  return (
    <main className="doc">
      <nav className="doc-nav">
        <a href="/">← Back to the analyzer</a>
        <span>
          <a href="/manual/user-manual.pdf" download>Download PDF</a>
          {" · "}
          <a href="/manual/user-manual.docx" download>Download Word</a>
        </span>
      </nav>
      <Render blk={blocks[0]} />
      <div className="doc-toc">
        <b>Contents</b>
        <ol>{toc.map((t) => <li key={t.text}><a href={`#${slug(t.text)}`}>{t.text}</a></li>)}<li><a href="#references">References</a></li></ol>
      </div>
      {blocks.slice(1).map((b, i) => <Render key={i} blk={b} />)}
      <p className="doc-note">Live application: <a href={SITE_URL}>{SITE_URL}</a></p>
    </main>
  );
}
