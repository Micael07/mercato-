import { queueAll, queueAdd, queueDelete, type QueuedSale } from "./offline-db";

export type SyncOutcome = { synced: number; failed: number; pending: number; authExpired: boolean; offline: boolean };

/** Classifica a resposta do servidor ao reenviar uma venda offline. */
export function classifyResponse(status: number): "ok" | "retry" | "auth" | "reject" {
  if (status === 200 || status === 201) return "ok";
  if (status === 401) return "auth";
  // 409 (ex.: caixa fechado) e erros de servidor podem passar com o tempo.
  if (status === 409 || status === 429 || status >= 500) return "retry";
  return "reject";
}

/**
 * Envia a fila do usuário, uma venda por vez e na ordem em que ocorreram.
 * Reenviar é seguro: o servidor reconhece o clientRef e não duplica.
 */
export async function syncQueue(
  userId: string,
  send: (payload: Record<string, unknown>) => Promise<{ status: number; error?: string }>
): Promise<SyncOutcome> {
  const all = (await queueAll())
    .filter((q) => q.userId === userId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const out: SyncOutcome = { synced: 0, failed: 0, pending: 0, authExpired: false, offline: false };

  for (const sale of all) {
    let res: { status: number; error?: string };
    try {
      res = await send(sale.payload);
    } catch {
      out.offline = true;
      break;
    }
    const kind = classifyResponse(res.status);
    if (kind === "ok") {
      await queueDelete(sale.clientRef);
      out.synced++;
    } else if (kind === "auth") {
      out.authExpired = true;
      break;
    } else {
      const next: QueuedSale = {
        ...sale,
        attempts: sale.attempts + 1,
        status: kind === "reject" ? "error" : "pending",
        lastError: res.error ?? `Falha ${res.status}`,
      };
      await queueAdd(next);
      if (kind === "reject") out.failed++;
      else out.pending++;
    }
  }
  return out;
}
