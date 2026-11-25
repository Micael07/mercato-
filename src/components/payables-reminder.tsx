"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "@/components/session-provider";

interface Bucket { count: number; amount: number }
interface Reminders { overdue: Bucket; today: Bucket; soon: Bucket }
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Faixa de lembrete de contas a pagar: só para administrador e gerente com acesso ao financeiro. */
export function PayablesReminder() {
  const { session, hasPermission } = useSession();
  const [data, setData] = useState<Reminders | null>(null);
  const role = session?.membership.roleCode;
  const allowed = !!session && !session.isPlatformAdmin && (role === "admin" || role === "manager") && hasPermission("finance.read");

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    fetch("/api/financial/reminders", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [allowed, session?.company.id]);

  if (!allowed || !data) return null;
  const { overdue, today, soon } = data;
  if (overdue.count + today.count + soon.count === 0) return null;

  const parts: string[] = [];
  if (overdue.count) parts.push(`${overdue.count} vencida(s) (${brl.format(overdue.amount)})`);
  if (today.count) parts.push(`${today.count} vence(m) hoje (${brl.format(today.amount)})`);
  if (soon.count) parts.push(`${soon.count} nos próximos 3 dias (${brl.format(soon.amount)})`);

  return (
    <p role="status" className={`no-print border-b px-6 py-2 text-[11px] ${overdue.count ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
      <strong>Contas a pagar:</strong> {parts.join(" · ")}.{" "}
      <Link href="/financeiro" className="font-semibold underline">Abrir financeiro</Link>
    </p>
  );
}
