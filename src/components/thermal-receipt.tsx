"use client";

import React from "react";
import { formatCurrency, formatDateTime, formatCnpjCpf } from "@/lib/format";

export interface ReceiptData {
  companyName: string;
  companyCnpj: string;
  establishmentName: string;
  establishmentAddress?: string | null;
  establishmentPhone?: string | null;
  saleNumber: number;
  /** Rótulo no lugar do número (ex.: venda offline com número provisório). */
  saleLabel?: string;
  createdAt: string;
  operatorName: string;
  customerName?: string | null;
  customerDocument?: string | null;
  subtotal: number;
  discountTotal: number;
  surchargeTotal: number;
  total: number;
  changeAmount: number;
  receiptFooter: string;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    total: number;
  }>;
  payments: Array<{
    paymentMethodName: string;
    amount: number;
    installments?: number;
  }>;
}

export function ThermalReceipt({ data }: { data: ReceiptData }) {
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
          <span>CUPOM NÃO FISCAL</span>
          <span className="font-bold">Nº {data.saleLabel ?? `#${data.saleNumber}`}</span>
        </div>
        <p>Data: {formatDateTime(data.createdAt)}</p>
        <p>Operador: {data.operatorName}</p>
        <p>
          Cliente: {data.customerName || "Consumidor final"}
          {data.customerDocument ? ` (${formatCnpjCpf(data.customerDocument)})` : ""}
        </p>
      </div>

      <div className="border-b border-dashed border-slate-400 py-2">
        <div className="mb-1 flex justify-between font-bold">
          <span>ITEM / QTD x UNIT</span>
          <span>TOTAL</span>
        </div>
        {data.items.map((item, idx) => (
          <div key={idx} className="mb-1.5">
            <p className="truncate font-semibold">
              {idx + 1}. {item.productName}
            </p>
            <div className="flex justify-between text-slate-700">
              <span>
                {item.quantity} x {formatCurrency(item.unitPrice)}
                {item.discountAmount > 0
                  ? ` (-${formatCurrency(item.discountAmount)})`
                  : ""}
              </span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(item.total)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-b border-dashed border-slate-400 py-2 space-y-0.5">
        <div className="flex justify-between">
          <span>Subtotal</span>
          <span>{formatCurrency(data.subtotal)}</span>
        </div>
        {data.discountTotal > 0 && (
          <div className="flex justify-between">
            <span>Descontos</span>
            <span>-{formatCurrency(data.discountTotal)}</span>
          </div>
        )}
        {data.surchargeTotal > 0 && (
          <div className="flex justify-between">
            <span>Acréscimos</span>
            <span>+{formatCurrency(data.surchargeTotal)}</span>
          </div>
        )}
        <div className="flex justify-between pt-1 text-xs font-bold">
          <span>TOTAL A PAGAR</span>
          <span>{formatCurrency(data.total)}</span>
        </div>
      </div>

      <div className="border-b border-dashed border-slate-400 py-2 space-y-0.5">
        <p className="font-bold">PAGAMENTOS</p>
        {data.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {p.paymentMethodName}
              {p.installments && p.installments > 1 ? ` (${p.installments}x)` : ""}
            </span>
            <span>{formatCurrency(p.amount)}</span>
          </div>
        ))}
        {data.changeAmount > 0 && (
          <div className="flex justify-between font-bold">
            <span>Troco</span>
            <span>{formatCurrency(data.changeAmount)}</span>
          </div>
        )}
      </div>

      <div className="pt-2 text-center text-[10px] text-slate-600">
        <p>{data.receiptFooter}</p>
        <p className="mt-1">Emitido via Mercato ERP</p>
      </div>
    </div>
  );
}
