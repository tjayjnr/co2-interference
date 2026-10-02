"use client";

import { useState } from "react";

interface Props {
  value: number;
  onChange: (v: number) => void;
  label?: string;
  unit?: string;
  step?: number;
  min?: number;
  className?: string;
  ariaLabel?: string;
}

/** Number input that keeps the raw text while typing so "0." and "-" don't get clobbered. */
export default function NumField({ value, onChange, label, unit, step, min, className, ariaLabel }: Props) {
  const [text, setText] = useState<string | null>(null);
  const shown = text !== null && Number(text) === value ? text : String(value);
  const input = (
    <input
      type="number"
      inputMode="decimal"
      value={shown}
      step={step ?? "any"}
      min={min}
      aria-label={ariaLabel ?? label}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.valueAsNumber;
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
  if (!label) return input;
  return (
    <label className="field">
      <span>
        {label}
        {unit && <em> {unit}</em>}
      </span>
      {input}
    </label>
  );
}
