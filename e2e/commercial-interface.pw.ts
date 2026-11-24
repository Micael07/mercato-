import { test, expect, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
const host = new URL(baseURL).hostname;
const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
const mutate = local && process.env.E2E_MUTATE === "true";
let cookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
let api: APIRequestContext;
const createdSales = new Set<string>();
let openedRegister: string | null = null;
const browserErrors: string[] = [];
const currency = (amount: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);

test.skip(!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD, "Configure credenciais de homologação em .env.e2e.local.");

test.beforeAll(async ({ browser, playwright }) => {
  if (!local && process.env.E2E_ALLOW_REMOTE !== "true") throw new Error("Teste remoto exige E2E_ALLOW_REMOTE=true e ambiente de homologação.");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${baseURL}/login`);
  await expect(page.getByRole("heading", { name: "Entrar no Mercato" })).toBeVisible();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/ui-login.png", fullPage: true });
  await page.getByLabel(/^E-mail/).fill(process.env.E2E_EMAIL!);
  await page.getByLabel(/^Senha/).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Acessar sistema" }).click();
  await expect(page.locator(".erp-top")).toBeVisible();
  cookies = await context.cookies();
  api = await playwright.request.newContext({ baseURL, storageState: { cookies, origins: [] }, extraHTTPHeaders: { Origin: baseURL } });
  await context.close();
});

test.beforeEach(async ({ page }) => {
  browserErrors.length = 0;
  await page.context().addCookies(cookies);
  page.on("pageerror", (failure) => browserErrors.push(failure.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("dialog", (dialog) => void dialog.accept());
});

test.afterEach(async () => {
  for (const id of createdSales) {
    const response = await api.post(`/api/sales/${id}`, { data: { action: "cancel", reason: "Cancelamento de teste automatizado da interface em homologação" } });
    expect(response.status(), "A venda de teste deve ser cancelada no final.").toBe(200);
  }
  createdSales.clear();
  expect(browserErrors, "Erros relevantes do navegador").toEqual([]);
});

test.afterAll(async () => {
  if (openedRegister && api) {
    const response = await api.post(`/api/cash-registers/${openedRegister}/close`, { data: { countedClosingAmount: 0, closingNotes: "Caixa de teste de interface em homologação" } });
    expect(response.status()).toBe(200);
  }
  await api?.dispose();
});

async function availableProduct() {
  const response = await api.get("/api/pos/products?limit=100");
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.items.every((product: Record<string, unknown>) => !("costPrice" in product) && !("marginPercent" in product))).toBe(true);
  const product = result.items.find((item: { salePrice: number; currentStock: number; trackStock: boolean }) => item.salePrice >= 10 && (!item.trackStock || item.currentStock >= 5));
  expect(product, "Cadastre um produto de homologação com preço >= 10 e saldo >= 5 para estes testes.").toBeTruthy();
  return product as { id: string; name: string; sku: string; barcode: string | null; salePrice: number; currentStock: number };
}

async function addByCode(page: import("@playwright/test").Page, code: string) {
  const search = page.getByRole("combobox", { name: "Produto:" });
  await search.fill(code);
  await search.press("Enter");
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
}

test("menu superior permite navegar até o ponto de venda", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Módulos do sistema" })).toBeVisible();
  await page.getByRole("button", { name: "Vendas", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Ponto de venda", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Ponto de venda", exact: true }).click();
  await expect(page).toHaveURL(/\/pdv$/);
  await expect(page.getByRole("heading", { name: "Ponto de venda", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Produtos da venda" })).toBeVisible();
  await page.screenshot({ path: "test-results/ui-pdv-desktop.png", fullPage: true });
});

test("PDV funciona em desktop, notebook, tablet e celular sem overflow da página", async ({ page }) => {
  await page.goto("/pdv");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole("combobox", { name: "Produto:" })).toBeVisible();
    await expect(page.getByLabel("Empresa ativa")).toBeVisible();
    await expect(page.getByLabel("Estabelecimento ativo")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Overflow em ${width}px`).toBe(true);
    const main = await page.locator(".pos-main").boundingBox();
    const side = await page.locator(".pos-document").boundingBox();
    if (width >= 768) expect(side!.x).toBeGreaterThan(main!.x + main!.width - 2);
    else expect(side!.y).toBeGreaterThan(main!.y);
    await page.screenshot({ path: `test-results/ui-pdv-${width}.png`, fullPage: true });
  }
});

test("busca por código, quantidade, desconto e nova venda mantêm os totais", async ({ page }) => {
  const product = await availableProduct();
  await page.goto("/pdv");
  await addByCode(page, product.barcode || product.sku);
  const quantity = page.getByLabel(`Quantidade de ${product.name}`, { exact: true });
  await quantity.fill("2");
  await quantity.press("Tab");
  await expect(page.getByTestId("pos-total")).toHaveText(currency(product.salePrice * 2));
  await page.getByRole("button", { name: `Aumentar quantidade de ${product.name}`, exact: true }).click();
  await expect(page.getByTestId("pos-total")).toHaveText(currency(product.salePrice * 3));
  await page.getByRole("button", { name: `Diminuir quantidade de ${product.name}`, exact: true }).click();
  await page.getByLabel("Desconto da venda em reais").fill("1");
  await expect(page.getByTestId("pos-total")).toHaveText(currency(product.salePrice * 2 - 1));
  await page.keyboard.press("F4");
  await expect(page.getByRole("dialog", { name: "Selecionar cliente", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Consumidor final", exact: true }).click();
  await page.screenshot({ path: "test-results/ui-pdv-itens.png", fullPage: true });
  await page.getByRole("button", { name: "Novo", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Iniciar uma nova venda?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
  await page.getByRole("button", { name: "Novo", exact: true }).click();
  await page.getByRole("button", { name: "Limpar e iniciar nova venda", exact: true }).click();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(0);
  await expect(page.getByTestId("pos-total")).toHaveText(currency(0));
});

test("consulta de produtos e menus funcionam por teclado", async ({ page }) => {
  await page.goto("/pdv");
  await page.keyboard.press("F3");
  const dialog = page.getByRole("dialog", { name: "Consulta de produtos", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Pesquisar no catálogo")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  const menu = page.getByRole("button", { name: "Vendas", exact: true });
  await menu.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Ponto de venda", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
});

test("cadastros mantêm tabelas, ordenação, colunas e navegação por módulo", async ({ page }) => {
  await page.goto("/produtos");
  await expect(page.getByRole("heading", { name: "Produtos", exact: true })).toBeVisible();
  const table = page.locator(".erp-data-table table");
  await expect(table).toBeVisible();
  const searchBox = await page.getByPlaceholder("Buscar descrição, SKU ou barras...").boundingBox();
  const firstFilter = await page.locator(".erp-data-table select").first().boundingBox();
  expect(Math.abs(firstFilter!.y - searchBox!.y), "Filtros devem ficar alinhados no monitor largo").toBeLessThan(3);
  const description = table.getByRole("columnheader", { name: "Descrição", exact: true });
  await description.getByRole("button").click();
  await expect(description).toHaveAttribute("aria-sort", "ascending");
  await description.getByRole("button").click();
  await expect(description).toHaveAttribute("aria-sort", "descending");
  await page.getByRole("button", { name: "Colunas", exact: true }).click();
  await page.getByRole("checkbox", { name: "Margem", exact: true }).uncheck();
  await expect(table.getByRole("columnheader", { name: "Margem", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByLabel("Por página:").selectOption("30");
  await expect(page.getByLabel("Por página:")).toHaveValue("30");
  await page.screenshot({ path: "test-results/ui-produtos.png", fullPage: true });
  await page.keyboard.press("Control+k");
  const jump = page.getByRole("dialog", { name: "Localizar módulo", exact: true });
  await jump.getByLabel("Nome do módulo").fill("Financeiro");
  await jump.getByRole("button", { name: "Financeiro", exact: true }).click();
  await expect(page).toHaveURL(/\/financeiro$/);
  await expect(page.getByRole("heading", { name: "Financeiro", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/ui-financeiro.png", fullPage: true });
});

test("suspende e retoma sem duplicar o desconto de item", async ({ page }) => {
  test.skip(!mutate, "Operações de gravação exigem E2E_MUTATE=true em localhost.");
  const product = await availableProduct();
  await page.goto("/pdv");
  await addByCode(page, product.sku);
  await page.getByLabel(`Desconto de ${product.name}`, { exact: true }).fill("0.50");
  await page.getByLabel("Desconto da venda em reais").fill("1");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/sales") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Suspender", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const data = await response.json();
  createdSales.add(data.sale.id);
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(0);
  await page.getByRole("button", { name: /^Retomar \(/ }).click();
  const row = page.getByRole("dialog", { name: "Vendas suspensas", exact: true }).getByRole("row").filter({ hasText: `#${data.sale.saleNumber}` });
  await row.getByRole("button", { name: "Retomar", exact: true }).click();
  await expect(page.getByTestId("pos-cart-line")).toHaveCount(1);
  await expect(page.getByLabel("Desconto da venda em reais")).toHaveValue("1");
  await expect(page.getByTestId("pos-total")).toHaveText(currency(product.salePrice - 1.5));
});

test("recebe com pagamentos múltiplos, emite comprovante e permite nova consulta", async ({ page }) => {
  test.skip(!mutate, "Operações de gravação exigem E2E_MUTATE=true em localhost.");
  const product = await availableProduct();
  await page.goto("/pdv");
  await expect(page.getByText("Consultando caixa…", { exact: true })).not.toBeVisible();
  const open = page.getByRole("button", { name: "Abrir caixa", exact: true });
  if (await open.isVisible()) {
    await open.click();
    await page.getByLabel(/^Terminal \/ caixa/).fill("Caixa teste UI");
    await page.getByLabel(/^Saldo inicial em dinheiro/).fill("0");
    const cashResponse = page.waitForResponse((response) => response.url().endsWith("/api/cash-registers") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Confirmar abertura", exact: true }).click();
    const data = await (await cashResponse).json();
    openedRegister = data.register.id;
  }
  await addByCode(page, product.sku);
  await page.keyboard.press("F9");
  const dialog = page.getByRole("dialog", { name: "Recebimento da venda", exact: true });
  await expect(dialog).toBeVisible();
  const half = Math.floor(product.salePrice * 50) / 100;
  await dialog.getByLabel("Valor (R$)", { exact: true }).first().fill(half.toFixed(2));
  await expect(dialog.getByRole("button", { name: "Confirmar pagamento", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Adicionar pagamento", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Confirmar pagamento", exact: true })).toBeEnabled();
  await page.screenshot({ path: "test-results/ui-pagamento.png", fullPage: true });
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/sales") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Confirmar pagamento", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const data = await response.json();
  createdSales.add(data.sale.id);
  const receipt = page.getByRole("dialog", { name: "Comprovante de venda", exact: true });
  await expect(receipt).toBeVisible();
  await expect(receipt.locator(".thermal-receipt")).toContainText("CUPOM NÃO FISCAL");
  await expect(receipt.locator(".thermal-receipt")).toContainText(currency(product.salePrice));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".pos-workspace")).not.toBeVisible();
  await expect(receipt.locator(".thermal-receipt")).toBeVisible();
  const pdf = await page.pdf({ width: "80mm", printBackground: true, path: "test-results/ui-comprovante.pdf" });
  expect(pdf.byteLength).toBeGreaterThan(1000);
  await page.emulateMedia({ media: "screen" });
  await receipt.getByRole("button", { name: "Fechar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Imprimir", exact: true })).toBeEnabled();
  await page.keyboard.press("F3");
  await expect(page.getByRole("dialog", { name: "Consulta de produtos", exact: true }).getByRole("button", { name: `Adicionar ${product.name}`, exact: true })).toBeVisible();
});
