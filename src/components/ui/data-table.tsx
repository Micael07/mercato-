"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, AlertCircle, Inbox } from "lucide-react";

export interface ColumnDef<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
  hideable?: boolean;
  defaultHidden?: boolean;
  width?: string;
}
interface DataTableProps<T> {
  data: T[]; columns: ColumnDef<T>[]; rowKey: (row: T) => string;
  loading?: boolean; error?: string | null; emptyTitle?: string; emptyDescription?: string; emptyAction?: ReactNode;
  pageSizeOptions?: number[]; defaultPageSize?: number; configurableColumns?: boolean; onRowClick?: (row: T) => void; toolbar?: ReactNode;
}

export function DataTable<T>({ data, columns, rowKey, loading = false, error = null, emptyTitle = "Nenhum registro encontrado", emptyDescription = "Ajuste os filtros ou cadastre um novo registro.", emptyAction, pageSizeOptions = [15, 30, 50, 100], defaultPageSize = 15, configurableColumns = true, onRowClick, toolbar }: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [columnMenu, setColumnMenu] = useState(false);
  const [hidden, setHidden] = useState(() => new Set(columns.filter((column) => column.defaultHidden).map((column) => column.key)));
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!columnMenu) return;
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target)) setColumnMenu(false); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setColumnMenu(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [columnMenu]);
  const visible = columns.filter((column) => !hidden.has(column.key));
  const sorted = useMemo(() => {
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortValue) return data;
    const value = column.sortValue;
    return [...data].sort((a, b) => {
      const left = value(a); const right = value(b);
      const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "pt-BR");
      return sortDir === "asc" ? result : -result;
    });
  }, [data, columns, sortKey, sortDir]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const rows = sorted.slice((current - 1) * pageSize, current * pageSize);
  const alignment = (column: ColumnDef<T>) => column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left";

  function sort(column: ColumnDef<T>) {
    if (!column.sortable || !column.sortValue) return;
    setSortDir(sortKey === column.key && sortDir === "asc" ? "desc" : "asc"); setSortKey(column.key); setPage(1);
  }
  function toggleColumn(key: string) {
    setHidden((before) => {
      if (!before.has(key) && columns.filter((column) => !before.has(column.key)).length <= 1) return before;
      const next = new Set(before); if (next.has(key)) next.delete(key); else next.add(key); return next;
    });
  }
  return (
    <div className="erp-data-table">
      {(toolbar || configurableColumns) && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#dbe7ee] bg-[#fafcfd] px-3 py-2.5"><div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar}</div>{configurableColumns && columns.some((column) => column.hideable !== false) && <div className="relative" ref={menu}><button type="button" className="erp-button erp-button--outline erp-button--sm" aria-expanded={columnMenu} aria-controls={columnMenu ? menuId : undefined} onClick={() => setColumnMenu(!columnMenu)}><Columns3 className="h-3.5 w-3.5" />Colunas</button>{columnMenu && <div id={menuId} className="absolute right-0 z-20 mt-1 w-52 border border-slate-200 bg-white p-2 shadow-md"><p className="mb-2 px-1 text-[10px] uppercase text-slate-400">Colunas visíveis</p>{columns.filter((column) => column.hideable !== false).map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 px-1 py-1.5 text-[11px] text-slate-500 hover:bg-sky-50"><input type="checkbox" checked={!hidden.has(column.key)} onChange={() => toggleColumn(column.key)} className="accent-sky-600" />{column.header}</label>)}</div>}</div>}</div>}
      {error ? <div role="alert" className="flex flex-col items-center gap-2 p-9 text-center"><AlertCircle className="h-7 w-7 text-red-400" /><p className="text-xs text-slate-600">Não foi possível carregar os registros</p><p className="max-w-md text-[11px] text-slate-400">{error}</p></div> : loading ? <div className="divide-y divide-slate-100 p-3" aria-label="Carregando registros">{[1, 2, 3, 4, 5].map((row) => <div key={row} className="flex items-center gap-5 py-3"><div className="h-3 w-24 animate-pulse bg-slate-100" /><div className="h-3 flex-1 animate-pulse bg-slate-100" /><div className="h-3 w-20 animate-pulse bg-slate-100" /></div>)}</div> : !sorted.length ? <div className="flex flex-col items-center gap-2 px-4 py-12 text-center"><Inbox className="mb-1 h-7 w-7 stroke-1 text-slate-300" /><p className="text-xs text-slate-600">{emptyTitle}</p><p className="max-w-md text-[11px] text-slate-400">{emptyDescription}</p>{emptyAction && <div className="mt-2">{emptyAction}</div>}</div> : <>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{visible.map((column) => <th key={column.key} scope="col" style={column.width ? { width: column.width } : undefined} className={`whitespace-nowrap ${alignment(column)}`} aria-sort={column.sortable ? sortKey === column.key ? sortDir === "asc" ? "ascending" : "descending" : "none" : undefined}>{column.sortable && column.sortValue ? <button type="button" onClick={() => sort(column)} className="inline-flex items-center gap-1.5 text-left hover:text-sky-600">{column.header}{sortKey === column.key ? sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-sky-600" /> : <ArrowDown className="h-3 w-3 text-sky-600" /> : <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />}</button> : column.header}</th>)}</tr></thead><tbody className="divide-y divide-[#e7eef3]">{rows.map((row) => <tr key={rowKey(row)} tabIndex={onRowClick ? 0 : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined} onKeyDown={onRowClick ? (event) => { if (event.target === event.currentTarget && event.key === "Enter") onRowClick(row); } : undefined} className={onRowClick ? "cursor-pointer" : ""}>{visible.map((column) => <td key={column.key} className={alignment(column)}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe7ee] bg-[#f9fcfd] px-3 py-2 text-[10px] text-slate-400"><div className="flex flex-wrap items-center gap-3"><span>Registros <strong className="font-medium text-slate-600">{(current - 1) * pageSize + 1}–{Math.min(current * pageSize, sorted.length)}</strong> de <strong className="font-medium text-slate-600">{sorted.length}</strong></span><label className="flex items-center gap-1.5">Por página:<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="h-6 border border-slate-200 bg-white px-1 text-[10px] text-slate-500">{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div><div className="flex items-center gap-2"><button type="button" className="erp-button erp-button--outline erp-button--sm !h-6 !px-1.5" disabled={current <= 1} aria-label="Página anterior" onClick={() => setPage(Math.max(1, current - 1))}><ChevronLeft className="h-3 w-3" /></button><span>{current} / {pages}</span><button type="button" className="erp-button erp-button--outline erp-button--sm !h-6 !px-1.5" disabled={current >= pages} aria-label="Próxima página" onClick={() => setPage(Math.min(pages, current + 1))}><ChevronRight className="h-3 w-3" /></button></div></div>
      </>}
    </div>
  );
}
