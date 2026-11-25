"use client";

import React from "react";
import { columnKind, columnLabel, formatCell, translateValue } from "@/lib/report-format";

export interface ThermalReportProps {
  company: string;
  cnpj: string;
  establishment: string;
  title: string;
  periodText: string;
  emittedAt: string;
  emittedBy: string;
  keys: string[];
  rows: Array<Record<string, unknown>>;
  totals: Record<string, number>;
  signature?: boolean;
}

const MAX_ROWS = 25;
const Line = () => <div className="my-1.5 border-t border-dashed border-slate-500" />;

/** Resumo do relatório no estilo da nota de 80 mm (usa a mesma regra de impressão do comprovante de venda). */
export function ReportThermal(p: ThermalReportProps) {
  const labelKey = p.keys.find((k) => columnKind(k) === "text" && !["status", "type", "justification"].includes(k)) ?? p.keys[0];
  const valueKeys = p.keys.filter((k) => ["money", "number"].includes(columnKind(k)));
  const shown = p.rows.slice(0, MAX_ROWS);

  return (
    <div className="thermal-receipt mx-auto w-full max-w-[340px] rounded border border-slate-200 bg-white p-4 font-mono text-[11px] leading-relaxed text-slate-900">
      <div className="text-center">
        <p className="font-bold uppercase">{p.company}</p>
        <p>CNPJ {p.cnpj}</p>
        <p>{p.establishment}</p>
      </div>
      <Line />
      <p className="text-center font-bold uppercase">{p.title}</p>
      <p className="text-center">{p.periodText}</p>
      <p className="text-center text-[10px]">Emitido em {p.emittedAt} por {p.emittedBy}</p>
      <Line />
      {shown.map((r, i) => (
        <div key={i} className="mb-1.5 break-inside-avoid">
          <p className="font-bold">{translateValue(r[labelKey]).trim() || "—"}</p>
          {valueKeys.slice(0, 5).map((k) => (
            <p key={k} className="flex justify-between gap-2">
              <span>{columnLabel(k)}</span>
              <span>{formatCell(k, r[k])}</span>
            </p>
          ))}
        </div>
      ))}
      {p.rows.length > MAX_ROWS && <p className="text-center text-[10px]">… e mais {p.rows.length - MAX_ROWS} linha(s). Veja o relatório completo.</p>}
      {Object.keys(p.totals).length > 0 && p.rows.length > 1 && (
        <>
          <Line />
          <p className="font-bold">TOTAIS</p>
          {Object.entries(p.totals).map(([k, v]) => (
            <p key={k} className="flex justify-between gap-2 font-bold">
              <span>{columnLabel(k)}</span>
              <span>{formatCell(k, v)}</span>
            </p>
          ))}
        </>
      )}
      {p.signature && (
        <>
          <div className="mt-8 border-t border-slate-700 pt-1 text-center">Responsável</div>
          <div className="mt-8 border-t border-slate-700 pt-1 text-center">Conferido por</div>
        </>
      )}
      <Line />
      <p className="text-center text-[10px]">Mercato · gestão comercial</p>
    </div>
  );
}
