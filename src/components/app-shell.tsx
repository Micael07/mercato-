"use client";

import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3, ShoppingCart, Receipt, Wallet, Package, Boxes, ClipboardCheck,
  FolderOpen, Truck, Users, Landmark, Building2, UserCog, ShieldCheck,
  Settings, FileSearch, KeyRound, LifeBuoy, ChevronDown, ChevronRight, LogOut, Search, UserRound, Store,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog, Input, Modal } from "@/components/ui/primitives";
import { formatCnpjCpf, formatDate } from "@/lib/format";
import { ROLE_DEFINITIONS, type PermissionCode } from "@/lib/permissions";

type Icon = ComponentType<{ className?: string }>;
interface NavEntry { href: string; label: string; icon: Icon; permission?: PermissionCode; platformOnly?: boolean }
interface Module { id: string; label: string; icon: Icon; entries: NavEntry[]; direct?: boolean }
const MODULES: Module[] = [
  { id: "overview", label: "Visão geral", icon: BarChart3, direct: true, entries: [{ href: "/", label: "Visão geral", icon: BarChart3 }] },
  { id: "purchases", label: "Compras", icon: FolderOpen, entries: [
    { href: "/compras", label: "Pedidos de compra", icon: FolderOpen, permission: "purchases.read" },
    { href: "/fornecedores", label: "Fornecedores", icon: Truck, permission: "purchases.read" },
  ] },
  { id: "sales", label: "Vendas", icon: ShoppingCart, entries: [
    { href: "/pdv", label: "Ponto de venda", icon: ShoppingCart, permission: "sales.create" },
    { href: "/vendas", label: "Consultar vendas", icon: Receipt, permission: "sales.read" },
    { href: "/clientes", label: "Clientes", icon: Users, permission: "customers.read" },
    { href: "/caixa", label: "Movimentação de caixa", icon: Wallet, permission: "sales.read" },
  ] },
  { id: "products", label: "Produtos", icon: Package, entries: [
    { href: "/produtos", label: "Cadastro de produtos", icon: Package, permission: "products.read" },
    { href: "/estoque", label: "Movimentação de estoque", icon: Boxes, permission: "stock.read" },
    { href: "/inventario", label: "Inventário", icon: ClipboardCheck, permission: "stock.inventory" },
  ] },
  { id: "finance", label: "Financeiro", icon: Landmark, direct: true, entries: [
    { href: "/financeiro", label: "Financeiro", icon: Landmark, permission: "finance.read" },
  ] },
  { id: "reports", label: "Relatórios", icon: BarChart3, direct: true, entries: [
    { href: "/relatorios", label: "Relatórios", icon: BarChart3, permission: "reports.read" },
  ] },
  { id: "system", label: "Sistema", icon: Settings, entries: [
    { href: "/plataforma", label: "Clientes e licenças", icon: KeyRound, platformOnly: true },
    { href: "/empresas", label: "Empresas e estabelecimentos", icon: Building2, permission: "companies.manage" },
    { href: "/usuarios", label: "Usuários", icon: UserCog, permission: "users.manage" },
    { href: "/perfis", label: "Perfis e permissões", icon: ShieldCheck, permission: "users.manage" },
    { href: "/configuracoes", label: "Configurações", icon: Settings, permission: "settings.manage" },
    { href: "/auditoria", label: "Auditoria", icon: FileSearch, permission: "audit.read" },
  ] },
  { id: "help", label: "Ajuda rápida", icon: LifeBuoy, direct: true, entries: [{ href: "/ajuda", label: "Ajuda rápida", icon: LifeBuoy }] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, hasPermission, switchContext, logout } = useSession();
  const { toast } = useToast();
  const navigation = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [changingContext, setChangingContext] = useState(false);
  const [pendingContext, setPendingContext] = useState<{ companyId: string; establishmentId?: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setQuickOpen((value) => !value);
      }
      if (event.key === "Escape") setOpenMenu(null);
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) setOpenMenu(null);
    };
    window.addEventListener("keydown", keyboard);
    document.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", keyboard); document.removeEventListener("pointerdown", outside); };
  }, []);

  if (!session) return <>{children}</>;
  const visibleModules = MODULES.map((module) => ({ ...module, entries: module.entries.filter((entry) => entry.platformOnly ? Boolean(session.isPlatformAdmin) : !entry.permission || hasPermission(entry.permission)) })).filter((module) => module.entries.length > 0);
  const entries = visibleModules.flatMap((module) => module.entries);
  const matching = (entry: NavEntry) => entry.href === "/" ? pathname === "/" : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
  const activeModule = visibleModules.find((module) => module.entries.some(matching));
  const activeEntry = entries.find(matching);
  const currentLabel = pathname === "/configuracoes/publicacao" ? "Publicação e diagnóstico" : pathname === "/plataforma" ? "Clientes e licenças" : pathname === "/ajuda" ? "Ajuda rápida" : activeEntry?.label || "Sistema";
  const companyEntry = session.availableCompanies.find((company) => company.companyId === session.company.id);
  const role = ROLE_DEFINITIONS[session.membership.roleCode]?.name || session.membership.roleCode;
  const quickEntries = entries.filter((entry) => entry.label.toLocaleLowerCase("pt-BR").includes(quickQuery.toLocaleLowerCase("pt-BR")));

  async function applyContext(target: { companyId: string; establishmentId?: string }) {
    setChangingContext(true);
    try {
      await switchContext(target.companyId, target.establishmentId);
      setPendingContext(null);
      setOpenMenu(null);
    } catch {
      toast({ type: "error", title: "Não foi possível trocar de empresa", description: "Seu contexto anterior foi mantido. Confira a conexão e tente novamente." });
    } finally { setChangingContext(false); }
  }
  function requestContext(target: { companyId: string; establishmentId?: string }) {
    if (document.querySelector('[data-unsaved-sale="true"]')) setPendingContext(target);
    else void applyContext(target);
  }
  async function leave() {
    setLoggingOut(true);
    try { await logout(); }
    catch { toast({ type: "error", title: "Não foi possível encerrar a sessão. Tente novamente." }); }
    finally { setLoggingOut(false); }
  }
  function menuKeyboard(event: KeyboardEvent<HTMLElement>, id: string) {
    const button = document.getElementById(`module-trigger-${id}`);
    if (event.key === "Escape") { setOpenMenu(null); button?.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    setOpenMenu(id);
    requestAnimationFrame(() => {
      const links = [...(document.getElementById(`module-menu-${id}`)?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
      const index = links.indexOf(document.activeElement as HTMLAnchorElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : event.key === "ArrowUp" ? (index <= 0 ? links.length - 1 : index - 1) : (index + 1) % links.length;
      links[next]?.focus();
    });
  }

  return (
    <div className="erp-shell">
      <header className="erp-top no-print">
        <div className="erp-identity-row">
          <Link href="/" className="erp-brand" aria-label="Mercato, início"><Image src="/brand/mercato-symbol.svg" alt="" width={29} height={29} priority /><span className="erp-brand-word">mercato</span><span className="erp-brand-caption">gestão comercial</span></Link>
          <div className="erp-context" aria-busy={changingContext}>
            <label className="erp-context-field"><Building2 className="h-3.5 w-3.5" /><div><small>Empresa</small><select aria-label="Empresa ativa" value={session.company.id} disabled={changingContext} onChange={(event) => requestContext({ companyId: event.target.value })}>{session.availableCompanies.map((company) => <option key={company.companyId} value={company.companyId}>{company.tradeName}</option>)}</select></div><span className="erp-context-id">{formatCnpjCpf(session.company.cnpj)}</span></label>
            <label className="erp-context-field"><Store className="h-3.5 w-3.5" /><div><small>Estabelecimento</small><select aria-label="Estabelecimento ativo" value={session.establishment.id} disabled={changingContext} onChange={(event) => requestContext({ companyId: session.company.id, establishmentId: event.target.value })}>{companyEntry?.establishments.map((establishment) => <option key={establishment.id} value={establishment.id}>{establishment.code} · {establishment.name}</option>)}</select></div></label>
            <div className="erp-user"><span className="erp-user-icon"><UserRound className="h-4 w-4" /></span><div><strong title={session.user.name}>{session.user.name}</strong><small>{role} · <Link href="/trocar-senha" className="underline">Alterar senha</Link></small></div></div>
          </div>
        </div>
        <div className="erp-navigation-row">
          <nav ref={navigation} aria-label="Módulos do sistema">
            <ul className="erp-modules">
              {visibleModules.map((module) => {
                const Icon = module.icon;
                const active = module.id === activeModule?.id;
                if (module.direct) return <li className="erp-module" key={module.id}><Link href={module.entries[0].href} className={`erp-module-trigger ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpenMenu(null)}><Icon /><span className="erp-module-label">{module.label}</span></Link></li>;
                return (
                  <li className="erp-module" key={module.id} onMouseEnter={() => setOpenMenu(module.id)} onMouseLeave={() => setOpenMenu((value) => value === module.id ? null : value)} onKeyDown={(event) => menuKeyboard(event, module.id)}>
                    <button type="button" id={`module-trigger-${module.id}`} className={`erp-module-trigger ${active ? "is-active" : ""}`} aria-haspopup="menu" aria-expanded={openMenu === module.id} aria-controls={openMenu === module.id ? `module-menu-${module.id}` : undefined} onClick={() => setOpenMenu(module.id)}><Icon /><span className="erp-module-label">{module.label}<ChevronDown className="h-2.5 w-2.5" /></span></button>
                    {openMenu === module.id && <ul className="erp-module-menu" id={`module-menu-${module.id}`} role="menu" aria-labelledby={`module-trigger-${module.id}`}>{module.entries.map((entry) => { const EntryIcon = entry.icon; return <li key={entry.href} role="none"><Link role="menuitem" href={entry.href} aria-current={matching(entry) ? "page" : undefined} onClick={() => setOpenMenu(null)}><EntryIcon />{entry.label}</Link></li>; })}</ul>}
                  </li>
                );
              })}
              <li className="erp-module"><button type="button" className="erp-module-trigger erp-module-logout" onClick={() => void leave()} disabled={loggingOut} aria-label="Sair do sistema"><LogOut /><span className="erp-module-label">{loggingOut ? "Saindo…" : "Sair"}</span></button></li>
            </ul>
          </nav>
          <button type="button" className="erp-jump" onClick={() => setQuickOpen(true)} aria-label="Buscar módulo"><Search className="h-3.5 w-3.5" /><span>Localizar módulo</span><kbd>Ctrl K</kbd></button>
        </div>
      </header>
      {session.company.licenseState === "expiring" && !session.isPlatformAdmin && (session.membership.roleCode === "admin" || session.membership.roleCode === "manager") && (() => {
        const d = session.company.licenseDaysLeft ?? 0;
        const urgent = d <= 3;
        const contact = process.env.NEXT_PUBLIC_SUPPORT_CONTACT?.trim();
        return (
          <p role="status" className={`no-print border-b px-6 py-2 text-[11px] ${urgent ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            <strong>Lembrete de pagamento:</strong> a licença do Mercato vence {d <= 1 ? "amanhã" : `em ${d} dias`}{session.company.licenseExpiresAt ? ` (${formatDate(session.company.licenseExpiresAt)})` : ""}. Após o vencimento ninguém da empresa consegue entrar. Regularize{contact ? ` com ${contact}` : " com o fornecedor do sistema"}.
          </p>
        );
      })()}
      {session.user.recoveryConfigured === false && !session.isPlatformAdmin && (
        <p role="status" className="no-print border-b border-sky-200 bg-sky-50 px-6 py-2 text-[11px] text-sky-800">
          Cadastre seus dados de recuperação (CPF e nascimento) para poder redefinir a senha sozinho. <Link href="/trocar-senha" className="font-semibold underline">Completar agora</Link>
        </p>
      )}
      <div className="erp-breadcrumb-row no-print"><nav aria-label="Caminho da página" className="erp-breadcrumb"><Link href="/">Início</Link>{pathname !== "/" && <><ChevronRight className="h-2.5 w-2.5" /><span>{activeModule?.label}</span></>}<ChevronRight className="h-2.5 w-2.5" /><span className="erp-breadcrumb-current" aria-current="page">{currentLabel}</span></nav><span className="erp-breadcrumb-extra">{session.company.tradeName} · {session.establishment.code}</span></div>
      <main className="erp-page-body" key={`${session.company.id}:${session.establishment.id}`}>{children}</main>
      <footer className="erp-footer no-print"><span>Mercato <span className="mx-1.5 text-slate-300">|</span> Gestão comercial</span><span>{session.establishment.name} <span className="mx-1.5 text-slate-300">|</span> {role}</span></footer>
      <Modal open={quickOpen} onClose={() => setQuickOpen(false)} title="Localizar módulo" size="sm">
        <Input aria-label="Nome do módulo" value={quickQuery} onChange={(event) => setQuickQuery(event.target.value)} placeholder="Digite para localizar…" />
        <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100">{quickEntries.length ? quickEntries.map((entry) => { const Icon = entry.icon; return <li key={entry.href}><button type="button" className="flex w-full items-center gap-3 px-2 py-3 text-left text-xs text-slate-500 hover:bg-sky-50 hover:text-sky-700" onClick={() => { router.push(entry.href); setQuickOpen(false); setQuickQuery(""); setOpenMenu(null); }}><Icon className="h-4 w-4" />{entry.label}</button></li>; }) : <li className="py-6 text-center text-xs text-slate-400">Nenhum módulo encontrado.</li>}</ul>
      </Modal>
      <ConfirmDialog open={pendingContext !== null} onClose={() => { if (!changingContext) setPendingContext(null); }} onConfirm={() => { if (pendingContext) void applyContext(pendingContext); }} title="Trocar de empresa ou estabelecimento?" description="Há itens na venda em edição. Suspenda a venda para retomá-la depois, ou confirme para descartar os itens desta tela e trocar de contexto. Nenhuma venda concluída será alterada." confirmLabel="Descartar itens e trocar" danger loading={changingContext} />
    </div>
  );
}
