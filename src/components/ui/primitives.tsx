"use client";

import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline" | "success" | "warning";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, disabled, className = "", children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={`erp-button erp-button--${variant} erp-button--${size} ${className}`} {...rest}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}{children}
    </button>
  );
}

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";
export function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-slate-50 text-slate-500 border-slate-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    info: "bg-sky-50 text-sky-700 border-sky-200",
    primary: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return <span className={`erp-badge ${tones[tone]} ${className}`}>{children}</span>;
}

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}
export function Field({ label, error, hint, required, htmlFor, children, className = "" }: FieldProps) {
  return (
    <div className={`erp-field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}</label>}
      {children}
      {error && <p className="text-[11px] text-red-600" role="alert">{error}</p>}
      {!error && hint && <p className="text-[10px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  );
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={`erp-input ${className}`} {...props} />;
});
export function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`erp-input ${className}`} {...props}>{children}</select>;
}
export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`erp-input ${className}`} {...props} />;
}

export function Panel({ title, subtitle, actions, children, className = "", noPadding = false }: {
  title?: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; noPadding?: boolean;
}) {
  return (
    <section className={`erp-panel ${className}`}>
      {(title || actions) && <div className="erp-panel-header"><div>{title && <h2>{title}</h2>}{subtitle && <p className="erp-panel-subtitle">{subtitle}</p>}</div>{actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}</div>}
      <div className={noPadding ? "" : "erp-panel-body"}>{children}</div>
    </section>
  );
}

function useDialog(open: boolean, onClose: () => void) {
  const reference = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const node = reference.current;
      const initial = node?.querySelector<HTMLElement>("[data-dialog-focus]")
        ?? node?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])")
        ?? node?.querySelector<HTMLElement>("button:not([disabled]), a[href]");
      (initial ?? node)?.focus();
    });
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab") return;
      const elements = [...(reference.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? [])].filter((element) => element.getClientRects().length > 0);
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return reference;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}
export function Modal({ open, onClose, title, subtitle, children, footer, size = "md" }: DialogProps & { size?: "sm" | "md" | "lg" | "xl" }) {
  const reference = useDialog(open, onClose);
  const id = useId();
  if (!open || typeof document === "undefined") return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" };
  return createPortal(
    <div className="erp-dialog-backdrop">
      <div ref={reference} className={`erp-dialog ${widths[size]}`} role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={subtitle ? `${id}-description` : undefined} tabIndex={-1}>
        <div className="erp-dialog-header no-print"><div><h3 id={id}>{title}</h3>{subtitle && <p id={`${id}-description`} className="mt-1 text-[11px] text-slate-400">{subtitle}</p>}</div><button type="button" onClick={onClose} className="erp-dialog-close" aria-label="Fechar janela"><X className="h-4 w-4" /></button></div>
        <div className="erp-dialog-content">{children}</div>
        {footer && <div className="erp-dialog-footer no-print">{footer}</div>}
      </div>
    </div>, document.body,
  );
}
export function Drawer({ open, onClose, title, subtitle, children, footer }: DialogProps) {
  const reference = useDialog(open, onClose);
  const id = useId();
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="erp-dialog-backdrop erp-drawer-backdrop">
      <div ref={reference} className="erp-dialog erp-drawer" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="erp-dialog-header"><div><h3 id={id}>{title}</h3>{subtitle && <p className="mt-1 text-[11px] text-slate-400">{subtitle}</p>}</div><button type="button" className="erp-dialog-close" onClick={onClose} aria-label="Fechar painel"><X className="h-4 w-4" /></button></div>
        <div className="erp-dialog-content">{children}</div>{footer && <div className="erp-dialog-footer">{footer}</div>}
      </div>
    </div>, document.body,
  );
}
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirmar", danger = false, loading = false }: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; description: string; confirmLabel?: string; danger?: boolean; loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={<><Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button><Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button></>}>
      <p className="text-xs leading-relaxed text-slate-500">{description}</p>
    </Modal>
  );
}
