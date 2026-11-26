"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { kvGet, kvSet, queueAdd, queueAll, queueDelete, type QueuedSale } from "./offline-db";
import { syncQueue, type SyncOutcome } from "./offline-sync";
import type { PosProduct } from "./pos";

const MAX_CATALOG = 5000;

export function isNetworkError(err: unknown) {
  return err instanceof TypeError;
}

async function ping(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch("/api/health", { cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * PDV offline: detecta a conexão, guarda o catálogo no aparelho, mantém a fila de vendas
 * feitas sem internet e envia essa fila quando a conexão volta.
 */
export function usePdvOffline(opts: {
  userId?: string;
  companyId?: string;
  establishmentId?: string;
  onSynced?: (o: SyncOutcome) => void;
}) {
  const { userId, companyId, establishmentId } = opts;
  const scope = companyId && establishmentId ? `${companyId}:${establishmentId}` : null;
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const onSyncedRef = useRef(opts.onSynced);
  useEffect(() => {
    onSyncedRef.current = opts.onSynced;
  });
  const syncingRef = useRef(false);
  const wasOnline = useRef(true);

  const refreshQueue = useCallback(async () => {
    try {
      const all = await queueAll();
      setQueue(all.filter((q) => !userId || q.userId === userId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)));
    } catch {
      setQueue([]);
    }
  }, [userId]);

  const runSync = useCallback(async () => {
    if (!userId || syncingRef.current) return null;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const outcome = await syncQueue(userId, async (payload) => {
        const res = await fetch("/api/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        return { status: res.status, error: data?.error };
      });
      await refreshQueue();
      if (outcome.synced || outcome.failed || outcome.authExpired) onSyncedRef.current?.(outcome);
      return outcome;
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [userId, refreshQueue]);

  // Registra o service worker e guarda os arquivos que a tela do PDV já carregou.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((reg) => {
        if (cancelled) return;
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.includes("/_next/static/"));
        reg.active?.postMessage({ type: "cache-urls", urls });
        // Guarda também a própria tela do PDV (a primeira visita ainda não passou pelo service worker).
        reg.active?.postMessage({ type: "cache-page", url: "/pdv" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Conexão: eventos do navegador + teste periódico (o evento sozinho não é confiável).
  useEffect(() => {
    let stop = false;
    const check = async () => {
      const ok = await ping();
      if (stop) return;
      setOnline(ok);
      if (ok && !wasOnline.current) void runSync();
      wasOnline.current = ok;
    };
    const t0 = setTimeout(() => void check(), 0);
    const iv = setInterval(() => void check(), 15000);
    const on = () => void check();
    const off = () => {
      setOnline(false);
      wasOnline.current = false;
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      stop = true;
      clearTimeout(t0);
      clearInterval(iv);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [runSync]);

  useEffect(() => {
    const t = setTimeout(() => {
      void refreshQueue();
      if (navigator.onLine) void runSync();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshQueue, runSync]);

  const enqueue = useCallback(
    async (sale: Omit<QueuedSale, "localNumber" | "status" | "attempts">) => {
      let seq = 0;
      try {
        seq = ((await kvGet<number>("localSeq")) ?? 0) + 1;
        await kvSet("localSeq", seq);
      } catch {}
      await queueAdd({ ...sale, localNumber: seq, status: "pending", attempts: 0 });
      await refreshQueue();
      return seq;
    },
    [refreshQueue]
  );

  const discard = useCallback(
    async (clientRef: string) => {
      await queueDelete(clientRef);
      await refreshQueue();
    },
    [refreshQueue]
  );

  const saveMeta = useCallback(
    (meta: unknown) => (scope ? kvSet(`meta:${scope}`, meta).catch(() => {}) : Promise.resolve()),
    [scope]
  );
  const loadMeta = useCallback(async <T,>() => (scope ? kvGet<T>(`meta:${scope}`).catch(() => undefined) : undefined), [scope]);

  /** Baixa todo o catálogo de venda (sem custos) e guarda no aparelho. */
  const cacheCatalog = useCallback(async () => {
    if (!scope) return;
    const all: PosProduct[] = [];
    for (let offset = 0; offset < MAX_CATALOG; offset += 100) {
      const res = await fetch(`/api/pos/products?limit=100&offset=${offset}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: PosProduct[]; hasMore: boolean };
      all.push(...data.items);
      if (!data.hasMore) break;
    }
    await kvSet(`products:${scope}`, { savedAt: Date.now(), items: all }).catch(() => {});
  }, [scope]);

  const loadCatalog = useCallback(
    async () => (scope ? (await kvGet<{ savedAt: number; items: PosProduct[] }>(`products:${scope}`).catch(() => undefined)) ?? null : null),
    [scope]
  );

  /** Baixa do saldo guardado no aparelho o que foi vendido offline. */
  const adjustLocalStock = useCallback(
    async (lines: Array<{ productId: string; quantity: number }>) => {
      if (!scope) return;
      const cat = await kvGet<{ savedAt: number; items: PosProduct[] }>(`products:${scope}`).catch(() => undefined);
      if (!cat) return;
      const qty = new Map<string, number>();
      for (const l of lines) qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.quantity);
      cat.items = cat.items.map((p) => (qty.has(p.id) ? { ...p, currentStock: Number((p.currentStock - qty.get(p.id)!).toFixed(3)) } : p));
      await kvSet(`products:${scope}`, cat).catch(() => {});
    },
    [scope]
  );

  return { online, setOnline, queue, syncing, runSync, enqueue, discard, saveMeta, loadMeta, cacheCatalog, loadCatalog, adjustLocalStock, refreshQueue };
}
