"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertCircle, ArrowLeft, CheckCircle2, Copy, Download, ExternalLink,
  FileDown, Info, LockKeyhole, RefreshCw, ShieldAlert,
} from "lucide-react";
import { useSession } from "@/components/session-provider";
import { Badge, Button, ConfirmDialog, Panel } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import type { CheckState, DeploymentStatus } from "@/lib/deployment/model";

const LABELS: Record<CheckState, string> = {
  ok: "Conferido", warning: "Revisar", error: "Corrigir", info: "Informação",
};
const TONES = { ok: "success", warning: "warning", error: "danger", info: "info" } as const;
const STEPS: Array<{ title: string; detail: string; href?: string; link?: string; command?: string }> = [
  { title: "Crie o repositório privado no GitHub", detail: "Crie um repositório vazio e privado (sem README). O código vai para ele pelo Codespaces do próprio GitHub, direto do navegador do tablet. O passo a passo completo está no guia.", href: "https://github.com/new", link: "Criar repositório" },
  { title: "Crie o banco no Neon", detail: "Plano Free. Copie duas URLs do mesmo banco: a pooled (DATABASE_URL) e a direta, sem pooler (MIGRATION_DATABASE_URL), ambas com sslmode=verify-full.", href: "https://console.neon.tech/", link: "Abrir Neon" },
  { title: "Publique no Render com Blueprint", detail: "Selecione o repositório e o render.yaml. Informe DATABASE_URL, MIGRATION_DATABASE_URL e PLATFORM_ADMIN_EMAILS (o seu e-mail). As migrations rodam sozinhas no build; AUTH_SECRET é gerada pelo Render.", href: "https://dashboard.render.com/", link: "Abrir Render" },
  { title: "Crie a sua conta de administrador", detail: "No endereço do Render, abra /register e cadastre-se com o e-mail de PLATFORM_ADMIN_EMAILS. Faça isso logo após o deploy: essa conta libera o acesso de todos os clientes." },
  { title: "Libere clientes em Clientes e licenças", detail: "Menu Sistema → Clientes e licenças. Cadastros novos aparecem como “Aguardando liberação”; depois de receber o pagamento, toque em Liberar (+30 dias, +90 dias ou +12 meses)." },
];

export function PublicationPanel() {
  const { session } = useSession();
  const { toast } = useToast();
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [confirmExport, setConfirmExport] = useState(false);

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/deployment/status", { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(response.status === 401 ? "Sua sessão expirou. Entre novamente." : "Não foi possível consultar o ambiente. Confira sua permissão de administrador.");
        }
        return await response.json() as DeploymentStatus;
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setStatus(result);
          setError(null);
        }
      })
      .catch((failure: unknown) => {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Falha ao consultar o ambiente.");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision, session?.company.id]);

  async function copyCommand(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: "success", title: "Comando copiado", description: "Execute no terminal da pasta do projeto, no seu computador." });
    } catch {
      toast({ type: "info", title: "Selecione e copie o comando exibido", description: "O navegador não permitiu acesso à área de transferência." });
    }
  }

  async function downloadAsset(url: string, filename: string) {
    setDownloading(filename);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.error || "Download indisponível. Confira sua sessão e a configuração do ambiente.");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast({ type: "success", title: "Arquivo recebido", description: "Confira o download no navegador antes de continuar." });
    } catch (failure) {
      toast({ type: "error", title: "Não foi possível baixar", description: failure instanceof Error ? failure.message : "Tente novamente." });
    } finally {
      setDownloading(null);
      setConfirmExport(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-[#0f4c5c]"><ArrowLeft className="h-3.5 w-3.5" />Voltar às configurações</Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0f4c5c]">Sistema / Publicação</p>
          <h1 className="text-lg font-bold text-slate-900">Publicação e diagnóstico</h1>
          <p className="mt-1 text-xs text-slate-500">Prepare uma instalação de homologação. Nenhum segredo do servidor é exibido aqui.</p>
        </div>
        <Badge tone="warning">Uso comercial ainda não aprovado</Badge>
      </header>

      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-900" role="note">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div><p className="font-semibold">Publicar não significa homologar a segurança e a operação.</p><p className="mt-1">O endereço do sandbox não é o seu site definitivo. O novo endereço será criado na sua conta Render. Comece sem dados reais de clientes e conclua as revisões antes de operar comercialmente.</p></div>
      </div>

      <Panel title="1. Arquivos para começar" subtitle="Baixe os documentos; a exportação de código tem restrições adicionais.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={downloading !== null} onClick={() => void downloadAsset("/api/deployment/guide", "Mercato-Guia-de-Publicacao.md")}><FileDown className="h-4 w-4" />Baixar passo a passo</Button>
          <Button variant="outline" disabled={downloading !== null} onClick={() => void downloadAsset("/api/deployment/guide?document=production", "Mercato-Checklist-de-Producao.md")}><FileDown className="h-4 w-4" />Baixar checklist de produção</Button>
          <Button disabled={loading || !status?.sourceExportEnabled || downloading !== null} onClick={() => setConfirmExport(true)}><Download className="h-4 w-4" />Baixar código para publicação</Button>
        </div>
        <div className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-slate-500">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{status?.sourceExportEnabled ? "O ZIP exclui arquivos de ambiente, banco, backups, uploads e dependências. Revise o código antes de compartilhar: segredos inseridos manualmente em arquivos de código não são automaticamente certificados." : "Download do código indisponível neste ambiente. Ele exige administrador, DEPLOYMENT_TARGET=preview e ALLOW_SOURCE_EXPORT=true. No site público permanece bloqueado. Alternativa local: node scripts/export-project.mjs (Node 22.18+)."}</p>
        </div>
      </Panel>

      <Panel title="2. Diagnóstico da instalação atual" subtitle={status ? `Última consulta: ${formatDateTime(status.checkedAt)} · ${status.mode === "public" ? "Modo público" : "Preview"}` : "Consulta autenticada ao servidor e ao PostgreSQL"} actions={<Button variant="outline" size="sm" loading={loading} onClick={() => { setLoading(true); setRevision((value) => value + 1); }}><RefreshCw className="h-3.5 w-3.5" />Atualizar</Button>} noPadding>
        {error ? (
          <div className="flex items-start gap-2 p-4 text-xs text-red-700" role="alert"><AlertCircle className="h-4 w-4 shrink-0" /><p>{error}</p></div>
        ) : !status ? (
          <div className="space-y-3 p-4" aria-label="Carregando diagnóstico">{[1, 2, 3].map((item) => <div key={item} className="h-6 animate-pulse rounded bg-slate-100" />)}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {status.checks.map((check) => (
              <li key={check.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 gap-2.5">
                  {check.state === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : check.state === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /> : <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${check.state === "error" ? "text-red-600" : "text-amber-600"}`} />}
                  <div><p className="text-xs font-semibold text-slate-800">{check.label}</p><p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">{check.detail}</p></div>
                </div>
                <Badge tone={TONES[check.state]} className="shrink-0">{LABELS[check.state]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="3. Sequência recomendada: Render Free + Neon Free" subtitle="As ações abaixo abrem os provedores ou copiam comandos; não criam contas nem publicam automaticamente." noPadding>
        <ol className="divide-y divide-slate-100">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 p-4">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 font-mono text-[11px] font-semibold text-[#0f4c5c]">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-slate-500">{step.detail}</p>
                {step.command && <div className="mt-2 flex max-w-xl items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-1.5"><code className="break-all text-[11px] text-slate-700">{step.command}</code><Button variant="ghost" size="sm" aria-label={`Copiar ${step.command}`} onClick={() => void copyCommand(step.command!)}><Copy className="h-3.5 w-3.5" />Copiar</Button></div>}
                {step.href && <a href={step.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#0f4c5c] hover:underline">{step.link}<ExternalLink className="h-3 w-3" /></a>}
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {status && <Panel title="Pendências reais antes do uso comercial"><ul className="list-disc space-y-2 pl-4 text-xs leading-relaxed text-slate-600">{status.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></Panel>}
      <p className="text-[11px] leading-relaxed text-slate-500">Não cole senhas, tokens ou URLs de banco neste painel ou no chat. Os planos gratuitos têm cotas e podem suspender o serviço. Consulte os limites e os preços no painel de cada provedor antes de contratar.</p>

      <ConfirmDialog open={confirmExport} onClose={() => { if (!downloading) setConfirmExport(false); }} title="Baixar o código do projeto?" description="Este pacote contém somente arquivos selecionados de código e documentação. Ele não transfere usuários, cadastros, senhas ou banco de dados e não cria um site público. Revise o conteúdo antes de enviar ao GitHub." confirmLabel="Gerar e baixar ZIP" loading={downloading !== null} onConfirm={() => void downloadAsset("/api/deployment/source", "mercato-publicacao.zip")} />
    </div>
  );
}
