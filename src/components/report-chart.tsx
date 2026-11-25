"use client";

import React from "react";
import type { ChartSpec } from "@/lib/report-chart";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const MONEY_KEYS = new Set(["revenue", "total", "amount", "lossValue", "estimatedCost", "stockSaleValue"]);

export function ReportChart({ spec }: { spec: ChartSpec }) {
  const fmt = (v: number) => (MONEY_KEYS.has(spec.valueKey) ? brl.format(v) : num.format(v));
  const max = Math.max(...spec.items.map((i) => i.value), 1);

  return (
    <figure className="report-chart rounded border border-slate-200 bg-white p-4" aria-label={spec.title}>
      <figcaption className="mb-3 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">{spec.title}</figcaption>
      {spec.kind === "rank" ? (
        <ul className="space-y-1.5">
          {spec.items.map((i) => (
            <li key={i.label} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-xs">
              <span className="truncate text-slate-700" title={i.label}>{i.label}</span>
              <span className="h-2.5 bg-slate-100">
                <span className="block h-full bg-[#0f4c5c]" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, printColorAdjust: "exact" }} />
              </span>
              <span className="font-mono text-slate-800">{fmt(i.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <div className="flex h-36 items-end gap-1" role="img" aria-label={spec.title}>
            {spec.items.map((i) => (
              <div key={i.label} className="group relative flex h-full flex-1 items-end" title={`${i.label}: ${fmt(i.value)}`}>
                <div className="w-full bg-[#0f4c5c]" style={{ height: `${Math.max(2, (i.value / max) * 100)}%`, printColorAdjust: "exact" }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[9px] text-slate-400">
            {spec.items.map((i, idx) => (
              <span key={i.label} className="flex-1 truncate text-center">
                {spec.items.length <= 12 || idx % 3 === 0 ? i.label : ""}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Maior dia: <span className="font-mono">{fmt(max)}</span> · Média: <span className="font-mono">{fmt(spec.items.reduce((a, i) => a + i.value, 0) / spec.items.length)}</span>
          </p>
        </div>
      )}
    </figure>
  );
}
