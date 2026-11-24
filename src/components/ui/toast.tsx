"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((opts: Omit<ToastItem, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setItems((prev) => [...prev, { ...opts, id }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const remove = (id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="no-print pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {items.map((item) => {
          const styles: Record<ToastType, string> = {
            success: "border-emerald-200 bg-white text-slate-900",
            error: "border-red-200 bg-white text-slate-900",
            warning: "border-amber-200 bg-white text-slate-900",
            info: "border-blue-200 bg-white text-slate-900",
          };
          const icons: Record<ToastType, React.ReactNode> = {
            success: <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />,
            error: <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />,
            warning: <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />,
            info: <Info className="h-4 w-4 text-blue-600 shrink-0" />,
          };
          return (
            <div
              key={item.id}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 shadow-lg ${styles[item.type]}`}
            >
              <div className="mt-0.5">{icons[item.type]}</div>
              <div className="flex-1 text-xs">
                <p className="font-semibold text-slate-900">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 text-slate-600">{item.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(item.id)}
                className="text-slate-400 hover:text-slate-600"
                aria-label="Fechar notificação"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
