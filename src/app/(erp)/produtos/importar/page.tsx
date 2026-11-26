"use client";

import React, { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/components/session-provider";
import { downloadCsv } from "@/lib/format";
import { Badge, Button, Panel, Select } from "@/components/ui/primitives";
import {
  detectMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  parseCsv,
  TEMPLATE_HEADERS,
  TEMPLATE_ROWS,
  type ImportFieldKey,
  type RawImportRow,
} from "@/lib/product-import";

type Step = "file" | "map" | "review" | "done";
interface RowResult { line: number; name: string; status: "create" | "update" | "skip" | "error"; message?: string; warnings?: string[] }
interface Summary { total: number; create: number; update: number; skip: number; error: number; newCategories: string[] }

const STATUS_LABEL = { create: "Novo", update: "Atualizar", skip: "Ignorado", error: "Erro" } as const;
const STATUS_TONE = { create: "success", update: "info", skip: "neutral", error: "danger" } as const;

async function readFileRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) {
    const { readXlsxRows } = await import("@/lib/xlsx-read");
    try {
      return readXlsxRows(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      throw new Error(e instanceof Error && e.message ? e.message : "Não foi possível ler o arquivo .xlsx.");
    }
  }
  if (name.endsWith(".xls")) {
    throw new Error("Arquivo .xls (Excel antigo) não é aceito. Abra no Excel e salve como .xlsx ou CSV.");
  }
  const buf = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf); // CSV do Excel brasileiro
  }
  return parseCsv(text);
}

export default function ImportarProdutosPage() {
  const { toast } = useToast();
  const { hasPermission } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Array<ImportFieldKey | "">>([]);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<RowResult[]>([]);
  const [filter, setFilter] = useState<"all" | "error" | "warn">("all");
  const [dragging, setDragging] = useState(false);

  const canUpdate = hasPermission("products.update");

  const handleFile = async (file: File | undefined | null) => {
    if (!file) return;
    setBusy(true);
    try {
      const rows = await readFileRows(file);
      if (rows.length < 2) throw new Error("A planilha precisa ter o cabeçalho e ao menos um produto.");
      if (rows.length - 1 > MAX_IMPORT_ROWS) {
        throw new Error(`A planilha tem ${rows.length - 1} linhas; o limite é ${MAX_IMPORT_ROWS} por importação. Divida em partes.`);
      }
      setFileName(file.name);
      setHeaders(rows[0].map((h) => h.trim()));
      setDataRows(rows.slice(1));
      setMapping(detectMapping(rows[0]));
      setStep("map");
    } catch (e) {
      toast({ type: "error", title: e instanceof Error ? e.message : "Não foi possível ler o arquivo." });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const mappingIssues = useMemo(() => {
    const issues: string[] = [];
    const used = mapping.filter(Boolean) as string[];
    for (const f of IMPORT_FIELDS) if ("required" in f && f.required && !used.includes(f.key)) issues.push(`Indique a coluna de "${f.label}".`);
    const dup = used.find((k, i) => used.indexOf(k) !== i);
    if (dup) issues.push(`O campo "${IMPORT_FIELDS.find((f) => f.key === dup)?.label}" está ligado a mais de uma coluna.`);
    return issues;
  }, [mapping]);

  const buildRows = (): RawImportRow[] =>
    dataRows.map((cells, i) => {
      const row: RawImportRow = { line: i + 2 };
      mapping.forEach((field, col) => {
        if (field) row[field] = (cells[col] ?? "").trim();
      });
      return row;
    });

  const send = async (dryRun: boolean) => {
    const res = await fetch("/api/products/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: buildRows(), mode, dryRun }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Falha ao processar a planilha.");
    return data as { summary: Summary; rows: RowResult[] };
  };

  const goReview = async () => {
    setBusy(true);
    try {
      const data = await send(true);
      setSummary(data.summary);
      setResults(data.rows);
      setFilter(data.summary.error ? "error" : "all");
      setStep("review");
    } catch (e) {
      toast({ type: "error", title: e instanceof Error ? e.message : "Falha ao validar." });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    setBusy(true);
    try {
      const data = await send(false);
      setSummary(data.summary);
      setResults(data.rows);
      setStep("done");
    } catch (e) {
      toast({ type: "error", title: e instanceof Error ? e.message : "Falha ao importar." });
    } finally {
      setBusy(false);
    }
  };

  const downloadErrors = () => {
    const bad = results.filter((r) => r.status === "error");
    downloadCsv("erros-importacao", ["Linha", "Descrição", "Motivo"], bad.map((r) => [r.line, r.name, r.message ?? ""]));
  };

  const shown = results
    .filter((r) => (filter === "error" ? r.status === "error" : filter === "warn" ? Boolean(r.warnings?.length) : true))
    .slice(0, 200);
  const warnCount = results.filter((r) => r.warnings?.length).length;
  const importable = (summary?.create ?? 0) + (summary?.update ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Importar produtos por planilha</h1>
          <p className="text-xs text-slate-500">Cadastro em massa a partir de Excel (.xlsx) ou CSV, com conferência antes de gravar.</p>
        </div>
        <Link href="/produtos">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4" />
            Voltar aos produtos
          </Button>
        </Link>
      </div>

      <ol className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {(["file", "map", "review", "done"] as Step[]).map((s, i) => (
          <li key={s} className={step === s ? "text-sky-700" : ""}>
            {i + 1}. {{ file: "Arquivo", map: "Colunas", review: "Conferência", done: "Resultado" }[s]}
            {i < 3 && <span className="ml-2 text-slate-300">›</span>}
          </li>
        ))}
      </ol>

      {step === "file" && (
        <Panel title="1. Escolha a planilha" subtitle="Use o modelo ou a planilha que o cliente já tem — as colunas são reconhecidas pelo nome.">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files?.[0]); }}
            className={`flex flex-col items-center gap-3 rounded border-2 border-dashed p-10 text-center ${dragging ? "border-sky-500 bg-sky-50" : "border-slate-300"}`}
          >
            <FileSpreadsheet className="h-8 w-8 text-slate-400" />
            <p className="text-sm text-slate-600">Arraste o arquivo aqui ou</p>
            <input ref={inputRef} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            <Button onClick={() => inputRef.current?.click()} loading={busy}>
              <Upload className="h-4 w-4" />
              Selecionar arquivo
            </Button>
            <p className="text-[11px] text-slate-400">.xlsx ou .csv · até {MAX_IMPORT_ROWS} produtos por vez · obrigatórios: descrição e preço de venda</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <Button variant="outline" size="sm" onClick={() => downloadCsv("modelo-produtos", TEMPLATE_HEADERS, TEMPLATE_ROWS)}>
              <Download className="h-3.5 w-3.5" />
              Baixar modelo
            </Button>
            <span>Dica: formate a coluna de código de barras como Texto no Excel para não perder zeros nem virar notação científica.</span>
          </div>
        </Panel>
      )}

      {step === "map" && (
        <Panel
          title="2. Confira as colunas"
          subtitle={`${fileName} · ${dataRows.length} produto(s). Ajuste o que não foi reconhecido; colunas sem campo são ignoradas.`}
          noPadding
          actions={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setStep("file")}>Trocar arquivo</Button>
              <Button size="sm" onClick={goReview} loading={busy} disabled={mappingIssues.length > 0}>Conferir produtos</Button>
            </div>
          }
        >
          {mappingIssues.length > 0 && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
              {mappingIssues.map((m) => <p key={m}>{m}</p>)}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                <tr><th className="px-3 py-2">Coluna da planilha</th><th className="px-3 py-2">Exemplos</th><th className="px-3 py-2">Vai para o campo</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {headers.map((h, col) => (
                  <tr key={col}>
                    <td className="px-3 py-2 font-semibold">{h || <span className="text-slate-400">(sem título)</span>}</td>
                    <td className="max-w-[320px] truncate px-3 py-2 text-slate-500">{dataRows.slice(0, 3).map((r) => r[col]).filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-3 py-2">
                      <Select
                        value={mapping[col] ?? ""}
                        onChange={(e) => setMapping((prev) => prev.map((m, i) => (i === col ? (e.target.value as ImportFieldKey | "") : m)))}
                        className="w-60"
                      >
                        <option value="">Ignorar esta coluna</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}{"required" in f && f.required ? " *" : ""}</option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-200 p-4 text-xs">
            <p className="mb-2 font-semibold text-slate-700">Se o produto já existir (mesmo SKU ou código de barras):</p>
            <label className="mr-6 inline-flex items-center gap-2">
              <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} /> Ignorar e manter o cadastro atual
            </label>
            <label className={`inline-flex items-center gap-2 ${canUpdate ? "" : "opacity-40"}`}>
              <input type="radio" disabled={!canUpdate} checked={mode === "update"} onChange={() => setMode("update")} /> Atualizar preço, categoria e demais campos da planilha
            </label>
          </div>
        </Panel>
      )}

      {(step === "review" || step === "done") && summary && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["create", "Novos", summary.create],
              ["update", "A atualizar", summary.update],
              ["skip", "Ignorados", summary.skip],
              ["error", "Com erro", summary.error],
            ] as const).map(([k, label, n]) => (
              <div key={k} className={`rounded border bg-white p-3 ${k === "error" && n ? "border-red-200" : "border-slate-200"}`}>
                <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
                <p className={`text-2xl font-bold ${k === "error" && n ? "text-red-700" : "text-slate-900"}`}>{n}</p>
              </div>
            ))}
          </div>
          {summary.newCategories.length > 0 && (
            <p className="text-xs text-slate-500">
              Categorias que serão criadas: <b className="text-slate-700">{summary.newCategories.slice(0, 12).join(", ")}{summary.newCategories.length > 12 ? ` e mais ${summary.newCategories.length - 12}` : ""}</b>
            </p>
          )}

          {step === "done" && (
            <div className="flex items-center gap-3 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 className="h-5 w-5" />
              <div>
                <p className="font-bold">Importação concluída.</p>
                <p className="text-xs">{summary.create} produto(s) criado(s) e {summary.update} atualizado(s). {summary.error > 0 && `${summary.error} linha(s) com erro não foram importadas — baixe o relatório, corrija e envie só essas.`}</p>
              </div>
            </div>
          )}

          <Panel
            title={step === "review" ? "3. Conferência antes de gravar" : "Detalhe por linha"}
            subtitle={step === "review" ? "Nada foi gravado ainda. Linhas com erro ficam de fora; as demais entram." : undefined}
            noPadding
            actions={
              <div className="flex flex-wrap gap-2">
                <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-44">
                  <option value="all">Todas as linhas</option>
                  <option value="error">Só com erro ({summary.error})</option>
                  <option value="warn">Só com aviso ({warnCount})</option>
                </Select>
                {summary.error > 0 && (
                  <Button size="sm" variant="outline" onClick={downloadErrors}><Download className="h-3.5 w-3.5" />Relatório de erros</Button>
                )}
                {step === "review" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setStep("map")}>Voltar</Button>
                    <Button size="sm" onClick={confirmImport} loading={busy} disabled={importable === 0}>
                      Importar {importable} produto(s)
                    </Button>
                  </>
                )}
                {step === "done" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => { setStep("file"); setSummary(null); setResults([]); }}>Nova importação</Button>
                    <Link href="/produtos"><Button size="sm">Ver produtos</Button></Link>
                  </>
                )}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Linha</th><th className="px-3 py-2">Descrição</th><th className="px-3 py-2">Situação</th><th className="px-3 py-2">Observação</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhuma linha neste filtro.</td></tr>}
                  {shown.map((r) => (
                    <tr key={r.line}>
                      <td className="px-3 py-2 font-mono">{r.line}</td>
                      <td className="px-3 py-2 font-medium">{r.name || "—"}</td>
                      <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                      <td className={`px-3 py-2 ${r.status === "error" ? "text-red-700" : "text-slate-500"}`}>
                        {r.message}
                        {r.warnings?.map((w) => (
                          <span key={w} className="mr-2 inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />{w}</span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > shown.length && filter === "all" && (
                <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">Mostrando as primeiras 200 de {results.length} linhas. Use o filtro para ver só os erros.</p>
              )}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
