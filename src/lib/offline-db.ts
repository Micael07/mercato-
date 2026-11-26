/**
 * Armazenamento local do PDV offline (IndexedDB): catálogo em cache e fila de vendas pendentes.
 * Nada aqui contém custo, margem ou senha — só o que o caixa já enxerga na tela.
 */
const DB_NAME = "mercato-pdv";
const DB_VERSION = 1;

export interface QueuedSale {
  clientRef: string;
  userId: string;
  companyId: string;
  establishmentId: string;
  localNumber: number;
  occurredAt: string;
  total: number;
  payload: Record<string, unknown>;
  receipt: unknown;
  status: "pending" | "error";
  attempts: number;
  lastError?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB indisponível"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "clientRef" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(store: "kv" | "queue", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const kvGet = <T>(key: string) => run<T | undefined>("kv", "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const kvSet = (key: string, value: unknown) => run("kv", "readwrite", (s) => s.put(value, key));
export const queueAdd = (sale: QueuedSale) => run("queue", "readwrite", (s) => s.put(sale));
export const queueAll = () => run<QueuedSale[]>("queue", "readonly", (s) => s.getAll() as IDBRequest<QueuedSale[]>);
export const queueDelete = (clientRef: string) => run("queue", "readwrite", (s) => s.delete(clientRef));

/** Apaga o catálogo em cache (ao sair). A fila de vendas pendentes é preservada de propósito. */
export async function clearOfflineCatalog() {
  try {
    await run("kv", "readwrite", (s) => s.clear());
  } catch {}
  try {
    if ("caches" in window) await caches.delete("mercato-pages-v1");
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage({ type: "clear-pages" });
  } catch {}
}

export function newClientRef(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return "off_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
