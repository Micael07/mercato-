"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Search, Plus, Minus, PauseCircle, PlayCircle, CreditCard, UserPlus,
  Printer, Wallet, ShoppingCart, X, UserRound, PackageSearch,
  ChevronLeft, ChevronRight, Info, RefreshCw, Banknote, ReceiptText,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { useToast } from "@/components/ui/toast";
import { formatCnpjCpf, formatCurrency, formatDateTime, roundMoney } from "@/lib/format";
import { calculatePosTotals, formatQuantity, quantityIssue, restoredGlobalDiscount, type PosCartLine, type PosProduct } from "@/lib/pos";
import { Button, ConfirmDialog, Field, Input, Modal, Select } from "@/components/ui/primitives";
import { ThermalReceipt, type ReceiptData } from "@/components/thermal-receipt";

interface Customer { id: string; name: string; document: string | null; phone?: string | null }
interface PaymentMethod { id: string; name: string; code: string; allowsInstallments: boolean; maxInstallments: number; isActive?: boolean }
interface CashRegister { id: string; userId: string; terminalName: string; status: string; currentBalance: number }
interface SuspendedSale { id: string; saleNumber: number; customerName: string | null; total: number; createdAt: string }
interface PaymentLine { code: string; amount: string; installments: number }
interface ProductResponse { items: PosProduct[]; hasMore: boolean }
interface SaleResponse {
  sale: { id: string; saleNumber: number; customerId?: string | null; createdAt: string; subtotal: number; discountTotal: number; surchargeTotal: number; total: number; changeAmount: number };
  items: Array<ReceiptData["items"][number] & { productId: string }>;
  payments: ReceiptData["payments"];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a operação. Tente novamente.");
  return data as T;
}
const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sameCode = (product: PosProduct, value: string) => [product.barcode, product.sku, product.internalCode].some((code) => code?.toLocaleLowerCase("pt-BR") === value.trim().toLocaleLowerCase("pt-BR"));

export default function PdvPage() {
  const { session, hasPermission } = useSession();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const searchRegion = useRef<HTMLDivElement>(null);
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [suspended, setSuspended] = useState<SuspendedSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resolvedQuery, setResolvedQuery] = useState<string | null>(null);
  const [productOffset, setProductOffset] = useState(0);
  const [productRevision, setProductRevision] = useState(0);
  const [resolvedOffset, setResolvedOffset] = useState(0);
  const [productsLoading, setProductsLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [discount, setDiscount] = useState(0);
  const [surcharge, setSurcharge] = useState(0);
  const [condition, setCondition] = useState("");
  const [resumedId, setResumedId] = useState<string | null>(null);
  const [resumedNumber, setResumedNumber] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [cashModal, setCashModal] = useState(false);
  const [openingAmount, setOpeningAmount] = useState("0.00");
  const [terminalName, setTerminalName] = useState("Caixa 01");
  const [catalogModal, setCatalogModal] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [quickCustomerModal, setQuickCustomerModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", document: "", phone: "" });
  const [suspendedModal, setSuspendedModal] = useState(false);
  const [checkoutModal, setCheckoutModal] = useState(false);
  const [newSaleConfirm, setNewSaleConfirm] = useState(false);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);

  const canDiscount = hasPermission("sales.discount");
  const totals = useMemo(() => calculatePosTotals(cart, discount, surcharge), [cart, discount, surcharge]);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const productPending = productsLoading || resolvedQuery !== query || resolvedOffset !== productOffset;
  const highlighted = products[activeResult] || products[0];
  const paid = roundMoney(payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  const change = Math.max(0, roundMoney(paid - totals.total));
  const customersFound = customers.filter((customer) => `${customer.name} ${customer.document || ""} ${customer.phone || ""}`.toLocaleLowerCase("pt-BR").includes(customerQuery.toLocaleLowerCase("pt-BR")));

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const [customerData, methodData, cashData, suspendedData] = await Promise.all([
        request<{ items: Customer[] }>("/api/customers", { signal }),
        request<{ items: PaymentMethod[] }>("/api/payment-methods", { signal }),
        request<{ registers: CashRegister[] }>("/api/cash-registers", { signal }),
        request<{ items: SuspendedSale[] }>("/api/sales?status=suspended", { signal }),
      ]);
      if (signal?.aborted) return;
      setCustomers(customerData.items);
      const activeMethods = methodData.items.filter((method) => method.isActive !== false);
      setMethods(activeMethods);
      setCondition((value) => activeMethods.some((method) => method.code === value) ? value : activeMethods[0]?.code || "");
      setRegister(cashData.registers.find((item) => item.userId === session?.user.id && item.status === "open") || null);
      setSuspended(suspendedData.items);
      setLoadError(null);
    } catch (failure) {
      if (!signal?.aborted) setLoadError(failure instanceof Error ? failure.message : "Falha ao carregar o ponto de venda.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [session?.user.id]);

  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => { void loadData(abort.signal); }, 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [loadData, session?.company.id, session?.establishment.id]);

  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setProductsLoading(true);
      const parameters = new URLSearchParams({ q: query, offset: String(productOffset), limit: "50" });
      request<ProductResponse>(`/api/pos/products?${parameters}`, { signal: abort.signal })
        .then((data) => {
          if (abort.signal.aborted) return;
          setProducts(data.items); setHasMore(data.hasMore); setResolvedQuery(query); setResolvedOffset(productOffset);
        })
        .catch((failure: unknown) => {
          if (!abort.signal.aborted) setLoadError(failure instanceof Error ? failure.message : "Erro ao consultar produtos.");
        })
        .finally(() => { if (!abort.signal.aborted) setProductsLoading(false); });
    }, query ? 160 : 0);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, productOffset, productRevision, session?.company.id, session?.establishment.id]);

  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !searchRegion.current?.contains(event.target)) setSearchOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  useEffect(() => {
    if (!cart.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cart.length]);

  function updateSearch(value: string) { setQuery(value); setProductOffset(0); setActiveResult(0); setSearchOpen(true); }
  function clearSale() {
    setCart([]); setDiscount(0); setSurcharge(0); setCustomerId(""); setResumedId(null); setResumedNumber(null); setQuery(""); setProductOffset(0); setSearchOpen(false); setNewSaleConfirm(false);
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  function addProduct(product: PosProduct) {
    const existing = cart.find((line) => line.product.id === product.id);
    const nextQuantity = (existing?.quantity || 0) + 1;
    const issue = quantityIssue(product, nextQuantity, session?.settings.allowNegativeStock || false);
    if (issue) { toast({ type: "warning", title: "Não foi possível adicionar o produto", description: issue }); return; }
    setCart(existing ? cart.map((line) => line.product.id === product.id ? { ...line, product, quantity: nextQuantity } : line) : [...cart, { product, quantity: 1, discountAmount: 0 }]);
    setQuery(""); setProductOffset(0); setActiveResult(0); setSearchOpen(false);
    if (!catalogModal) requestAnimationFrame(() => searchRef.current?.focus());
  }
  function updateQuantity(id: string, value: number) {
    const line = cart.find((item) => item.product.id === id);
    if (!line) return;
    if (value === 0) { setCart(cart.filter((item) => item.product.id !== id)); return; }
    const issue = quantityIssue(line.product, value, session?.settings.allowNegativeStock || false);
    if (issue) { toast({ type: "warning", title: "Quantidade inválida", description: issue }); return; }
    setCart(cart.map((item) => item.product.id === id ? { ...item, quantity: value, discountAmount: Math.min(item.discountAmount, roundMoney(value * item.product.salePrice)) } : item));
  }
  async function addSearchedProduct() {
    if (!query.trim()) { setSearchOpen(false); setCatalogModal(true); return; }
    const exact = products.find((product) => sameCode(product, query));
    if (exact) { addProduct(exact); return; }
    if (!productPending && highlighted) { addProduct(highlighted); return; }
    try {
      const result = await request<ProductResponse>(`/api/pos/products?q=${encodeURIComponent(query.trim())}&limit=50`);
      const found = result.items.find((product) => sameCode(product, query)) || (result.items.length === 1 ? result.items[0] : null);
      if (found) addProduct(found);
      else { setSearchOpen(false); setCatalogModal(true); }
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Produto não encontrado." }); }
  }
  function searchKeyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") { event.preventDefault(); void addSearchedProduct(); }
    if (event.key === "Escape") setSearchOpen(false);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); setSearchOpen(true);
      setActiveResult((value) => products.length ? (value + (event.key === "ArrowDown" ? 1 : products.length - 1)) % products.length : 0);
    }
  }
  function openCheckout() {
    if (!cart.length || busy) return;
    setSearchOpen(false);
    if (totals.total < 0) { toast({ type: "warning", title: "O desconto não pode ultrapassar o valor da venda." }); return; }
    if (session?.settings.requireOpenCashRegister && !register) { setCashModal(true); return; }
    const method = methods.find((item) => item.code === condition) || methods[0];
    if (!method) { toast({ type: "error", title: "Nenhuma forma de pagamento ativa.", description: "Solicite a configuração ao administrador." }); return; }
    if (method.code === "store_credit" && !customerId) { setCustomerModal(true); toast({ type: "warning", title: "Identifique o cliente para usar crediário." }); return; }
    setPayments([{ code: method.code, amount: totals.total.toFixed(2), installments: 1 }]);
    setCheckoutModal(true);
  }
  async function openCash(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const data = await request<{ register: CashRegister }>("/api/cash-registers", json({ action: "open", terminalName, openingAmount: Number(openingAmount) }));
      setRegister({ ...data.register, currentBalance: Number(data.register.currentBalance) }); setCashModal(false);
      toast({ type: "success", title: "Caixa aberto para operação." });
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Não foi possível abrir o caixa." }); }
    finally { setBusy(false); }
  }
  async function finalizeSale() {
    if (busy) return;
    const cash = payments.filter((payment) => payment.code === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    if (change > cash + .009) { toast({ type: "warning", title: "O troco deve sair de um pagamento em dinheiro." }); return; }
    setBusy(true);
    try {
      const data = await request<SaleResponse>("/api/sales", json({
        status: "completed", cashRegisterId: register?.id || null, customerId: customerId || null, suspendedSaleId: resumedId,
        discountTotal: discount, surchargeTotal: surcharge,
        items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, discountAmount: line.discountAmount })),
        payments: payments.map((payment) => { const method = methods.find((item) => item.code === payment.code); return { paymentMethodId: method?.id, paymentMethodCode: payment.code, paymentMethodName: method?.name, amount: Number(payment.amount), installments: payment.installments }; }),
      }));
      const document: ReceiptData = {
        companyName: session?.company.tradeName || "", companyCnpj: session?.company.cnpj || "",
        establishmentName: session?.establishment.name || "", establishmentAddress: session?.establishment.address, establishmentPhone: session?.establishment.phone,
        operatorName: session?.user.name || "", customerName: selectedCustomer?.name, customerDocument: selectedCustomer?.document,
        saleNumber: data.sale.saleNumber, createdAt: data.sale.createdAt,
        subtotal: data.sale.subtotal, discountTotal: data.sale.discountTotal, surchargeTotal: data.sale.surchargeTotal, total: data.sale.total, changeAmount: data.sale.changeAmount,
        receiptFooter: session?.settings.receiptFooter || "", items: data.items, payments: data.payments,
      };
      setReceipt(document); setLastReceipt(document); setCheckoutModal(false); clearSale();
      toast({ type: "success", title: `Venda #${data.sale.saleNumber} concluída.` });
      await loadData();
      setResolvedQuery(null); setProductRevision((value) => value + 1);
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Não foi possível concluir a venda." }); }
    finally { setBusy(false); }
  }
  async function suspendSale() {
    if (!cart.length || busy) return;
    setBusy(true);
    try {
      const data = await request<SaleResponse>("/api/sales", json({ status: "suspended", customerId: customerId || null, suspendedSaleId: resumedId, discountTotal: discount, surchargeTotal: surcharge, items: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity, discountAmount: line.discountAmount })), payments: [] }));
      clearSale(); toast({ type: "info", title: `Venda #${data.sale.saleNumber} suspensa.` }); await loadData();
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Não foi possível suspender a venda." }); }
    finally { setBusy(false); }
  }
  async function resumeSale(id: string) {
    if (cart.length) { toast({ type: "warning", title: "Suspenda ou limpe a venda atual antes de retomar outra." }); return; }
    setBusy(true);
    try {
      const data = await request<SaleResponse>(`/api/sales/${id}`);
      const ids = [...new Set(data.items.map((item) => item.productId))];
      const catalog = await request<ProductResponse>(`/api/pos/products?ids=${ids.join(",")}`);
      const map = new Map(catalog.items.map((product) => [product.id, product]));
      if (data.items.some((item) => !map.has(item.productId))) throw new Error("Há produto inativo ou indisponível nesta venda. Revise em Vendas.");
      setCart(data.items.map((item) => ({ product: map.get(item.productId)!, quantity: item.quantity, discountAmount: item.discountAmount })));
      setCustomerId(data.sale.customerId || ""); setDiscount(restoredGlobalDiscount(data.sale.discountTotal, data.items)); setSurcharge(data.sale.surchargeTotal);
      setResumedId(id); setResumedNumber(data.sale.saleNumber); setSuspendedModal(false); setSearchOpen(false);
      toast({ type: "info", title: `Venda #${data.sale.saleNumber} retomada. Preços e saldo serão validados ao concluir.` });
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Não foi possível retomar a venda." }); }
    finally { setBusy(false); }
  }
  async function saveCustomer(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const data = await request<{ item: Customer }>("/api/customers", json(newCustomer));
      setCustomers((items) => [...items, data.item]); setCustomerId(data.item.id); setNewCustomer({ name: "", document: "", phone: "" }); setQuickCustomerModal(false);
      toast({ type: "success", title: "Cliente cadastrado e selecionado." });
    } catch (failure) { toast({ type: "error", title: failure instanceof Error ? failure.message : "Não foi possível cadastrar o cliente." }); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const shortcuts = (event: globalThis.KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === "F2") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "F3") { event.preventDefault(); setSearchOpen(false); setCatalogModal(true); }
      if (event.key === "F4") { event.preventDefault(); setSearchOpen(false); setCustomerModal(true); }
      if (event.key === "F8") { event.preventDefault(); void suspendSale(); }
      if (event.key === "F9") { event.preventDefault(); if (!loading) openCheckout(); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });

  return (
    <div className="pos-page">
      <div className="pos-page-bar no-print">
        <h1 className="pos-page-title"><ShoppingCart className="h-[18px] w-[18px]" />Ponto de venda</h1>
        <div className="pos-toolbar">
          <Button onClick={() => cart.length ? setNewSaleConfirm(true) : clearSale()} disabled={busy}><Plus className="h-3.5 w-3.5" />Novo</Button>
          <Button onClick={openCheckout} disabled={!cart.length || loading || busy}><Banknote className="h-3.5 w-3.5" />Receber</Button>
          <Button variant="warning" onClick={() => setReceipt(lastReceipt)} disabled={!lastReceipt || busy} title="Imprimir o último comprovante desta sessão"><Printer className="h-3.5 w-3.5" />Imprimir</Button>
        </div>
      </div>
      {loadError && <div role="alert" className="no-print mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"><span>{loadError}</span><Button variant="outline" size="sm" onClick={() => { setLoading(true); void loadData(); }}><RefreshCw className="h-3 w-3" />Recarregar</Button></div>}
      <div className="pos-workspace no-print" data-unsaved-sale={cart.length > 0 ? "true" : "false"}>
        <section className="pos-main" aria-label="Itens da venda">
          <div className="pos-search-row">
            <label htmlFor="pos-product-search">Produto:</label>
            <div className="pos-search-control" ref={searchRegion}>
              <Input id="pos-product-search" ref={searchRef} role="combobox" aria-autocomplete="list" aria-expanded={searchOpen && !catalogModal} aria-controls={searchOpen && !catalogModal ? "pos-search-results" : undefined} aria-activedescendant={searchOpen && !productPending && highlighted ? `product-option-${highlighted.id}` : undefined} autoComplete="off" value={query} onChange={(event) => updateSearch(event.target.value)} onFocus={() => setSearchOpen(true)} onKeyDown={searchKeyboard} placeholder="Buscar por código, descrição ou código de barras" />
              <Button aria-label="Buscar produtos" onClick={() => { setSearchOpen(false); setCatalogModal(true); }}><Search className="h-4 w-4" /></Button>
              {searchOpen && !catalogModal && <div className="pos-search-results" id="pos-search-results" role="listbox" aria-label="Produtos encontrados">
                {productPending ? <p className="p-4 text-xs text-slate-400">Consultando produtos…</p> : products.length ? products.slice(0, 8).map((product, index) => <button type="button" role="option" aria-selected={index === activeResult} id={`product-option-${product.id}`} key={product.id} className="pos-search-option" onMouseDown={(event) => event.preventDefault()} onClick={() => addProduct(product)}><span><strong>{product.name}</strong><small>{product.sku} · {product.trackStock ? `${formatQuantity(product.currentStock)} ${product.unit} em estoque` : "Sem controle de estoque"}</small></span><span className="pos-search-option-price">{formatCurrency(product.salePrice)}</span></button>) : <p className="p-4 text-xs text-slate-400">Nenhum produto encontrado. Confira o código ou a descrição.</p>}
              </div>}
            </div>
            <Button variant="primary" disabled={!query.trim() || productPending || !highlighted || busy} onClick={() => void addSearchedProduct()}><ShoppingCart className="h-3.5 w-3.5" />Adicionar</Button>
          </div>
          <div className="pos-grid">
            <div className="pos-grid-scroll">
              <table aria-label="Produtos da venda"><thead><tr><th style={{ width: 35 }}>Nº</th><th style={{ width: 105 }}>Código / SKU</th><th>Descrição</th><th className="text-right">Preço</th><th className="text-center" style={{ width: 126 }}>Quantidade</th><th className="text-right">Desc. R$</th><th className="text-right">Total</th><th style={{ width: 43 }}><span className="sr-only">Opções</span></th></tr></thead>
                <tbody>{cart.length ? cart.map((line, index) => <tr key={line.product.id} data-testid="pos-cart-line"><td className="text-center text-slate-400">{index + 1}</td><td className="whitespace-nowrap text-[10px]">{line.product.sku}</td><td className="pos-item-name"><strong>{line.product.name}</strong><small>{line.product.barcode || line.product.internalCode} · {line.product.unit}</small></td><td className="whitespace-nowrap text-right tabular-nums">{formatCurrency(line.product.salePrice)}</td><td><div className="pos-qty"><button className="pos-round-action" type="button" aria-label={`Aumentar quantidade de ${line.product.name}`} onClick={() => updateQuantity(line.product.id, line.quantity + 1)} disabled={busy}><Plus /></button><input aria-label={`Quantidade de ${line.product.name}`} type="number" min="0" step={line.product.allowFractional ? ".001" : "1"} key={`${line.product.id}-${line.quantity}`} defaultValue={line.quantity} onBlur={(event) => { const amount = Number(event.target.value); const issue = quantityIssue(line.product, amount, session?.settings.allowNegativeStock || false); if (!event.target.value || issue) { event.target.value = String(line.quantity); if (event.target.value && issue) toast({ type: "warning", title: "Quantidade inválida", description: issue }); } else updateQuantity(line.product.id, amount); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} disabled={busy} /><button className="pos-round-action pos-round-action--minus" type="button" aria-label={`Diminuir quantidade de ${line.product.name}`} onClick={() => updateQuantity(line.product.id, Math.max(0, Number((line.quantity - 1).toFixed(3))))} disabled={busy}><Minus /></button></div></td><td className="text-right">{canDiscount ? <input className="pos-discount-input" aria-label={`Desconto de ${line.product.name}`} type="number" min="0" max={line.product.salePrice * line.quantity} step=".01" placeholder="0,00" value={line.discountAmount || ""} onChange={(event) => { const amount = Math.max(0, Math.min(line.product.salePrice * line.quantity, Number(event.target.value) || 0)); setCart(cart.map((item) => item.product.id === line.product.id ? { ...item, discountAmount: roundMoney(amount) } : item)); }} disabled={busy} /> : "—"}</td><td className="whitespace-nowrap text-right font-medium tabular-nums">{formatCurrency(roundMoney(line.product.salePrice * line.quantity - line.discountAmount))}</td><td><button type="button" className="pos-remove" aria-label={`Remover ${line.product.name}`} onClick={() => setCart(cart.filter((item) => item.product.id !== line.product.id))} disabled={busy}><X className="h-3.5 w-3.5" /></button></td></tr>) : <tr><td className="pos-empty-cell" colSpan={8}><div className="pos-empty"><ReceiptText /><strong>Aguardando produtos</strong><p>Leia um código de barras ou pesquise um produto acima.<br />Use F3 para consultar o catálogo.</p></div></td></tr>}</tbody>
              </table>
            </div>
            <div className="pos-grid-foot"><span><strong>{cart.length}</strong> {cart.length === 1 ? "produto lançado" : "produtos lançados"}</span><span>Subtotal dos itens <strong className="ml-2 tabular-nums">{formatCurrency(totals.subtotal - totals.itemDiscounts)}</strong></span></div>
          </div>
          <div className="pos-aux-actions"><Button variant="outline" size="sm" onClick={() => { setSearchOpen(false); setCatalogModal(true); }}><PackageSearch className="h-3.5 w-3.5" />Consultar produtos <span className="ml-1 text-[10px] opacity-60">F3</span></Button><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!cart.length || busy} onClick={() => void suspendSale()}><PauseCircle className="h-3.5 w-3.5" />Suspender</Button><Button variant="outline" size="sm" onClick={() => setSuspendedModal(true)} disabled={!suspended.length || busy}><PlayCircle className="h-3.5 w-3.5" />Retomar{suspended.length ? ` (${suspended.length})` : ""}</Button></div></div>
        </section>

        <aside className="pos-document" aria-label="Dados e fechamento da venda">
          <Select aria-label="Forma de pagamento" id="pos-condition" value={condition} onChange={(event) => setCondition(event.target.value)} disabled={loading || busy}>{!methods.length && <option value="">{loading ? "Carregando…" : "Nenhuma forma ativa"}</option>}{methods.map((method) => <option key={method.id} value={method.code}>{method.name.toLocaleUpperCase("pt-BR")}</option>)}</Select>
          <section className="pos-box" aria-label="Identificação da venda"><div className="pos-document-fields"><Field label="Unidade" htmlFor="pos-unit"><Input id="pos-unit" readOnly value={session?.establishment.code || ""} /></Field><Field label="Nº da venda" htmlFor="pos-sale-number"><Input id="pos-sale-number" readOnly value={resumedNumber ? `#${resumedNumber}` : "Gerado ao concluir"} /></Field></div></section>
          <section className="pos-box"><h2 className="pos-box-title"><UserRound className="h-3.5 w-3.5" />Cliente</h2><div className="pos-client-row"><div className="pos-client-value"><strong>{selectedCustomer?.name || "CONSUMIDOR FINAL"}</strong><small>{selectedCustomer?.document ? formatCnpjCpf(selectedCustomer.document) : "Cliente não identificado"}</small></div><div className="pos-client-buttons"><Button variant="success" aria-label="Selecionar cliente" title="Selecionar cliente (F4)" onClick={() => setCustomerModal(true)}><UserRound className="h-3.5 w-3.5" /></Button>{hasPermission("customers.manage") && <Button variant="success" aria-label="Cadastrar cliente" title="Cadastro rápido" onClick={() => setQuickCustomerModal(true)}><Plus className="h-3.5 w-3.5" /></Button>}</div></div>{selectedCustomer && <button type="button" className="mt-2 text-[10px] text-sky-600 hover:underline" onClick={() => setCustomerId("")}>Remover identificação</button>}</section>
          <table className="pos-summary" aria-label="Resumo da venda"><tbody><tr><th>Subtotal</th><td>{formatCurrency(totals.subtotal)}</td></tr>{totals.itemDiscounts > 0 && <tr><th>Descontos nos itens</th><td>− {formatCurrency(totals.itemDiscounts)}</td></tr>}<tr><th><label htmlFor="pos-discount">Desconto da venda</label></th><td><Input id="pos-discount" aria-label="Desconto da venda em reais" type="number" min="0" step=".01" placeholder="0,00" value={discount || ""} onChange={(event) => setDiscount(Math.max(0, Number(event.target.value) || 0))} disabled={!canDiscount || busy} /></td></tr><tr><th><label htmlFor="pos-surcharge">Acréscimo</label></th><td><Input id="pos-surcharge" aria-label="Acréscimo em reais" type="number" min="0" step=".01" placeholder="0,00" value={surcharge || ""} onChange={(event) => setSurcharge(Math.max(0, Number(event.target.value) || 0))} disabled={busy} /></td></tr></tbody></table>
          <div className="pos-total"><p className="pos-total-label">Total da venda</p><p className="pos-total-value" data-testid="pos-total">{formatCurrency(totals.total)}</p></div>
          <Button className="pos-receive" onClick={openCheckout} disabled={!cart.length || loading || busy || totals.total < 0}><span><Banknote className="h-4 w-4" />Receber venda</span><kbd>F9</kbd></Button>
          <p className="pos-document-note"><Info className="mt-0.5 h-3 w-3 shrink-0" />O recebimento pode ser dividido em mais de uma forma.</p>
        </aside>
      </div>
      <div className="pos-bottom-bar no-print"><div className="pos-register-state"><span className={`pos-state-dot ${!register ? "is-closed" : ""}`} /><span>{loading ? "Consultando caixa…" : register ? `${register.terminalName} aberto` : "Caixa fechado"}</span>{!loading && !register && hasPermission("cash.open") && <button type="button" className="ml-1 text-sky-600 underline underline-offset-2" onClick={() => setCashModal(true)}>Abrir caixa</button>}<span className="mx-1 text-slate-300">|</span><span>{session?.user.name}</span></div><div className="pos-shortcuts"><span><kbd>F2</kbd> Buscar</span><span><kbd>F3</kbd> Produtos</span><span><kbd>F4</kbd> Cliente</span><span><kbd>F8</kbd> Suspender</span><span><kbd>F9</kbd> Receber</span></div></div>

      <Modal open={catalogModal} onClose={() => setCatalogModal(false)} title="Consulta de produtos" subtitle="Pesquise por descrição, SKU, código interno ou código de barras." size="lg" footer={<><span className="mr-auto text-[11px] text-slate-400">{productPending ? "Consultando…" : `${products.length} produto(s) nesta página`}</span><Button variant="outline" size="sm" aria-label="Página anterior de produtos" disabled={!productOffset || productPending} onClick={() => setProductOffset(Math.max(0, productOffset - 50))}><ChevronLeft className="h-3.5 w-3.5" /></Button><Button variant="outline" size="sm" aria-label="Próxima página de produtos" disabled={!hasMore || productPending} onClick={() => setProductOffset(productOffset + 50)}><ChevronRight className="h-3.5 w-3.5" /></Button><Button variant="outline" onClick={() => setCatalogModal(false)}>Fechar</Button></>}>
        <div className="mb-4 flex items-center gap-2"><Search className="h-4 w-4 text-slate-400" /><Input aria-label="Pesquisar no catálogo" value={query} onChange={(event) => updateSearch(event.target.value)} placeholder="Descrição, SKU ou código de barras" /></div><div className="overflow-x-auto"><table className="pos-lookup-table"><thead><tr><th>Código / SKU</th><th>Descrição</th><th className="text-right">Estoque</th><th className="text-right">Preço</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{productPending ? <tr><td colSpan={5} className="py-7 text-center text-slate-400">Consultando…</td></tr> : products.length ? products.map((product) => <tr key={product.id}><td className="whitespace-nowrap text-[10px]">{product.sku}</td><td>{product.name}</td><td className="whitespace-nowrap text-right text-[11px]">{product.trackStock ? `${formatQuantity(product.currentStock)} ${product.unit}` : "Livre"}</td><td className="whitespace-nowrap text-right">{formatCurrency(product.salePrice)}</td><td><Button size="sm" onClick={() => addProduct(product)} aria-label={`Adicionar ${product.name}`}><Plus className="h-3 w-3" />Adicionar</Button></td></tr>) : <tr><td colSpan={5} className="py-8 text-center text-slate-400">Nenhum produto encontrado.</td></tr>}</tbody></table></div>
      </Modal>

      <Modal open={customerModal} onClose={() => setCustomerModal(false)} title="Selecionar cliente" size="lg" footer={<><Button variant="outline" onClick={() => { setCustomerId(""); setCustomerModal(false); }}>Consumidor final</Button>{hasPermission("customers.manage") && <Button variant="success" onClick={() => { setCustomerModal(false); setQuickCustomerModal(true); }}><UserPlus className="h-3.5 w-3.5" />Cadastrar cliente</Button>}</>}>
        <Input aria-label="Pesquisar cliente" value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Pesquisar nome, documento ou telefone" /><div className="mt-4 max-h-80 overflow-auto"><table className="pos-lookup-table"><thead><tr><th>Nome</th><th>CPF / CNPJ</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{customersFound.length ? customersFound.map((customer) => <tr key={customer.id}><td>{customer.name}</td><td className="whitespace-nowrap text-[11px]">{formatCnpjCpf(customer.document)}</td><td className="text-right"><Button size="sm" onClick={() => { setCustomerId(customer.id); setCustomerModal(false); }}>Selecionar</Button></td></tr>) : <tr><td colSpan={3} className="text-center text-slate-400">Nenhum cliente encontrado.</td></tr>}</tbody></table></div>
      </Modal>

      <Modal open={quickCustomerModal} onClose={() => { if (!busy) setQuickCustomerModal(false); }} title="Cadastro rápido de cliente" size="sm"><form onSubmit={(event) => void saveCustomer(event)} className="space-y-4"><Field label="Nome completo" htmlFor="quick-customer-name" required><Input id="quick-customer-name" required value={newCustomer.name} onChange={(event) => setNewCustomer({ ...newCustomer, name: event.target.value })} /></Field><Field label="CPF / CNPJ" htmlFor="quick-customer-doc"><Input id="quick-customer-doc" value={newCustomer.document} onChange={(event) => setNewCustomer({ ...newCustomer, document: event.target.value })} /></Field><Field label="Telefone / WhatsApp" htmlFor="quick-customer-phone"><Input id="quick-customer-phone" value={newCustomer.phone} onChange={(event) => setNewCustomer({ ...newCustomer, phone: event.target.value })} /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setQuickCustomerModal(false)} disabled={busy}>Cancelar</Button><Button type="submit" loading={busy}>Salvar e selecionar</Button></div></form></Modal>

      <Modal open={cashModal} onClose={() => { if (!busy) setCashModal(false); }} title="Abertura de caixa" subtitle="Informe o fundo de troco disponível para iniciar a operação." size="sm"><form onSubmit={(event) => void openCash(event)} className="space-y-4"><Field label="Terminal / caixa" htmlFor="open-terminal" required><Input id="open-terminal" required value={terminalName} onChange={(event) => setTerminalName(event.target.value)} /></Field><Field label="Saldo inicial em dinheiro (R$)" htmlFor="open-amount" required><Input id="open-amount" required type="number" min="0" step=".01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></Field><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCashModal(false)} disabled={busy}>Cancelar</Button><Button type="submit" loading={busy}><Wallet className="h-3.5 w-3.5" />Confirmar abertura</Button></div></form></Modal>

      <Modal open={checkoutModal} onClose={() => { if (!busy) setCheckoutModal(false); }} title="Recebimento da venda" subtitle={`Valor a receber: ${formatCurrency(totals.total)}`} size="md" footer={<><Button variant="outline" onClick={() => setCheckoutModal(false)} disabled={busy}>Voltar à venda</Button><Button onClick={() => void finalizeSale()} loading={busy} disabled={paid + .009 < totals.total || payments.some((payment) => !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0)}><CreditCard className="h-3.5 w-3.5" />Confirmar pagamento</Button></>}>
        <div className="space-y-2">{payments.map((payment, index) => { const method = methods.find((item) => item.code === payment.code); return <div className="pos-payment-row" key={index}><Field label="Forma de pagamento" htmlFor={`payment-method-${index}`}><Select id={`payment-method-${index}`} value={payment.code} onChange={(event) => setPayments(payments.map((line, row) => row === index ? { ...line, code: event.target.value, installments: 1 } : line))} disabled={busy}>{methods.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}</Select></Field><Field label="Valor (R$)" htmlFor={`payment-value-${index}`}><Input id={`payment-value-${index}`} type="number" step=".01" min=".01" value={payment.amount} onChange={(event) => setPayments(payments.map((line, row) => row === index ? { ...line, amount: event.target.value } : line))} disabled={busy} /></Field><Field label="Parcelas" htmlFor={`payment-installments-${index}`}><Select id={`payment-installments-${index}`} value={String(payment.installments)} disabled={!method?.allowsInstallments || busy} onChange={(event) => setPayments(payments.map((line, row) => row === index ? { ...line, installments: Number(event.target.value) } : line))}>{Array.from({ length: method?.allowsInstallments ? Math.max(1, method.maxInstallments) : 1 }, (_, item) => item + 1).map((value) => <option key={value} value={value}>{value}x</option>)}</Select></Field><button type="button" aria-label={`Remover pagamento ${index + 1}`} disabled={payments.length < 2 || busy} onClick={() => setPayments(payments.filter((_, row) => row !== index))} className="mb-1 p-1 text-red-400 disabled:opacity-20"><X className="h-4 w-4" /></button></div>; })}</div>
        <Button variant="outline" size="sm" className="mt-3" disabled={busy || payments.length >= 8} onClick={() => { const method = methods.find((item) => !payments.some((line) => line.code === item.code)) || methods[0]; if (method) setPayments([...payments, { code: method.code, amount: Math.max(0, roundMoney(totals.total - paid)).toFixed(2), installments: 1 }]); }}><Plus className="h-3 w-3" />Adicionar pagamento</Button>
        <div className="pos-payment-totals"><div><span>Total da venda</span><strong>{formatCurrency(totals.total)}</strong></div><div><span>Valor informado</span><strong>{formatCurrency(paid)}</strong></div>{paid < totals.total && <div className="text-red-600"><span>Falta receber</span><strong>{formatCurrency(totals.total - paid)}</strong></div>}<div className="is-total"><span>Troco</span><strong>{formatCurrency(change)}</strong></div></div>
      </Modal>

      <Modal open={suspendedModal} onClose={() => setSuspendedModal(false)} title="Vendas suspensas" size="lg"><div className="overflow-x-auto"><table className="pos-lookup-table"><thead><tr><th>Nº venda</th><th>Cliente</th><th>Data</th><th className="text-right">Total</th><th><span className="sr-only">Ação</span></th></tr></thead><tbody>{suspended.length ? suspended.map((sale) => <tr key={sale.id}><td>#{sale.saleNumber}</td><td>{sale.customerName || "Consumidor final"}</td><td className="whitespace-nowrap text-[11px]">{formatDateTime(sale.createdAt)}</td><td className="whitespace-nowrap text-right">{formatCurrency(sale.total)}</td><td><Button size="sm" disabled={busy} onClick={() => void resumeSale(sale.id)}><PlayCircle className="h-3 w-3" />Retomar</Button></td></tr>) : <tr><td colSpan={5} className="text-center text-slate-400">Não há vendas suspensas.</td></tr>}</tbody></table></div></Modal>
      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title="Comprovante de venda" size="sm" footer={<><Button variant="outline" onClick={() => setReceipt(null)}>Fechar</Button><Button variant="warning" onClick={() => window.print()}><Printer className="h-3.5 w-3.5" />Imprimir / salvar PDF</Button></>}>{receipt && <ThermalReceipt data={receipt} />}</Modal>
      <ConfirmDialog open={newSaleConfirm} onClose={() => setNewSaleConfirm(false)} onConfirm={clearSale} title="Iniciar uma nova venda?" description="Os itens desta venda em edição serão descartados. Se quiser retomá-la depois, use Suspender. Nenhuma venda concluída ou saldo de estoque será alterado." confirmLabel="Limpar e iniciar nova venda" danger />
    </div>
  );
}
