"use client";

import React from "react";
import { formatCnpjCpf, formatCurrency, formatDate, formatDateTime } from "@/lib/format";

export interface PurchaseOrderDocData {
  companyName: string;
  companyCnpj: string;
  establishmentName: string;
  establishmentAddress?: string | null;
  establishmentPhone?: string | null;
  orderNumber: number;
  createdAt: string;
  createdByName?: string | null;
  statusLabel: string;
  supplierName: string;
  supplierDocument?: string | null;
  supplierContact?: string | null;
  supplierPhone?: string | null;
  supplierAddress?: string | null;
  supplierCity?: string | null;
  supplierState?: string | null;
  paymentTerms?: string | null;
  expectedDelivery?: string | null;
  notes?: string | null;
  subtotal: number;
  discount: number;
  freight: number;
  taxes: number;
  total: number;
  items: Array<{
    productName: string;
    sku: string;
    unit: string;
    quantityOrdered: number;
    unitCost: number;
    discount: number;
    total: number;
  }>;
}

const qty = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Pedido de compra no mesmo estilo do comprovante de venda (bobina 80 mm). */
export function PurchaseOrderDocument({ data }: { data: PurchaseOrderDocData }) {
  const place = [data.supplierCity, data.supplierState].filter(Boolean).join("/");
  const totalUnits = data.items.reduce((s, i) => s + i.quantityOrdered, 0);
  return (
    <div className="thermal-receipt mx-auto w-full max-w-[340px] rounded border border-slate-200 bg-white p-4 font-mono text-[11px] leading-relaxed text-slate-900">
      <div className="border-b border-dashed border-slate-400 pb-2 text-center">
        <p className="text-xs font-bold uppercase">{data.companyName}</p>
        <p>CNPJ: {formatCnpjCpf(data.companyCnpj)}</p>
        <p>{data.establishmentName}</p>
        {data.establishmentAddress && <p>{data.establishmentAddress}</p>}
        {data.establishmentPhone && <p>Tel: {data.establishmentPhone}</p>}
      </div>

      <div className="border-b border-dashed border-slate-400 py-2">
        <div className="flex justify-between">
          <span className="font-bold">PEDIDO DE COMPRA</span>
          <span className="font-bold">Nº #{data.orderNumber}</span>
        </div>
        <p>Emissão: {formatDateTime(data.createdAt)}</p>
        {data.createdByName && <p>Emitido por: {data.createdByName}</p>}
        <p>Situação: {data.statusLabel}</p>
      </div>

      <div className="border-b border-dashed border-slate-400 py-2">
        <p className="font-bold">FORNECEDOR</p>
        <p className="font-semibold">{data.supplierName}</p>
        {data.supplierDocument && <p>CNPJ/CPF: {formatCnpjCpf(data.supplierDocument)}</p>}
        {data.supplierAddress && <p>{data.supplierAddress}</p>}
        {place && <p>{place}</p>}
        {data.supplierContact && <p>Contato: {data.supplierContact}</p>}
        {data.supplierPhone && <p>Tel: {data.supplierPhone}</p>}
      </div>

      <div className="border-b border-dashed border-slate-400 py-2">
        <div className="mb-1 flex justify-between font-bold">
          <span>ITEM / QTD x CUSTO</span>
          <span>TOTAL</span>
        </div>
        {data.items.map((item, idx) => (
          <div key={idx} className="mb-1.5">
            <p className="font-semibold">
              {idx + 1}. {item.productName}
            </p>
            <p className="text-slate-600">Cód: {item.sku}</p>
            <div className="flex justify-between text-slate-700">
              <span>
                {qty(item.quantityOrdered)} {item.unit} x {formatCurrency(item.unitCost)}
                {item.discount > 0 ? ` (-${formatCurrency(item.discount)})` : ""}
              </span>
              <span className="font-semibold text-slate-900">{formatCurrency(item.total)}</span>
            </div>
          </div>
        ))}
        <p className="pt-1 text-slate-600">
          {data.items.length} {data.items.length === 1 ? "item" : "itens"} · {qty(totalUnits)} un.
        </p>
      </div>

      <div className="space-y-0.5 border-b border-dashed border-slate-400 py-2">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCurrency(data.subtotal)}</span>
        </div>
        {data.discount > 0 && (
          <div className="flex justify-between">
            <span>Descontos</span>
            <span>-{formatCurrency(data.discount)}</span>
          </div>
        )}
        {data.freight > 0 && (
          <div className="flex justify-between">
            <span>Frete</span>
            <span>+{formatCurrency(data.freight)}</span>
          </div>
        )}
        {data.taxes > 0 && (
          <div className="flex justify-between">
            <span>Impostos</span>
            <span>+{formatCurrency(data.taxes)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 text-xs font-bold">
          <span>TOTAL DO PEDIDO</span>
          <span>{formatCurrency(data.total)}</span>
        </div>
      </div>

      <div className="space-y-0.5 border-b border-dashed border-slate-400 py-2">
        <p className="font-bold">CONDIÇÕES</p>
        <p>Pagamento: {data.paymentTerms || "A combinar"}</p>
        <p>
          Entrega prevista: {data.expectedDelivery ? formatDate(data.expectedDelivery) : "A combinar"}
        </p>
        {data.notes && <p>Obs.: {data.notes}</p>}
      </div>

      <div className="pt-6 text-center text-[10px] text-slate-600">
        <div className="mx-auto w-4/5 border-t border-slate-500 pt-1">Responsável pela compra</div>
        <p className="mt-2">Documento interno, sem valor fiscal.</p>
        <p className="mt-1">Emitido via Mercato ERP</p>
      </div>
    </div>
  );
}
