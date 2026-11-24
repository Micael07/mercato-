export type CheckState = "ok" | "warning" | "error" | "info";

export interface DeploymentCheck {
  id: string;
  label: string;
  state: CheckState;
  detail: string;
}

export interface DeploymentStatus {
  checkedAt: string;
  mode: "public" | "preview";
  checks: DeploymentCheck[];
  sourceExportEnabled: boolean;
  commercialReleaseApproved: false;
  limitations: string[];
}

type Environment = Record<string, string | undefined>;

export function canExportSource(env: Environment): boolean {
  return env.DEPLOYMENT_TARGET === "preview" && env.ALLOW_SOURCE_EXPORT === "true";
}

export function environmentChecks(env: Environment): DeploymentCheck[] {
  const publicMode = env.DEPLOYMENT_TARGET === "public";
  const strongSecret = Boolean(
    env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 &&
    !/change-me|your[-_ ]?secret|seu[-_ ]?segredo/i.test(env.AUTH_SECRET)
  );
  let localDatabase = false;
  let databaseConfigured = false;
  let verifiedTls = false;
  try {
    const url = new URL(env.DATABASE_URL || "");
    databaseConfigured = ["postgres:", "postgresql:"].includes(url.protocol);
    localDatabase = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    verifiedTls = databaseConfigured && url.searchParams.get("sslmode") === "verify-full";
  } catch {
    // Return only a boolean result, never the URL or exception message.
  }
  const platformOwnerConfigured = String(env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .some((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
  return [
    {
      id: "deployment-mode",
      label: "Modo de execução",
      state: publicMode ? "ok" : "info",
      detail: publicMode
        ? "Modo público configurado. Os cabeçalhos dependem do último build; recompile após alterar a variável."
        : "Ambiente de preview. Não é um endereço público permanente.",
    },
    {
      id: "session-secret",
      label: "Segredo de sessão",
      state: strongSecret ? "ok" : "error",
      detail: strongSecret
        ? "Chave configurada com comprimento mínimo. O valor não é enviado ao navegador; a aleatoriedade exige geração segura."
        : "Configure AUTH_SECRET aleatória e exclusiva com pelo menos 32 caracteres no servidor.",
    },
    {
      id: "database-transport",
      label: "Configuração da conexão",
      state: verifiedTls ? "ok" : localDatabase && !publicMode ? "info" : "error",
      detail: verifiedTls
        ? "A URL exige verificação TLS (verify-full). Isso não substitui revisão do papel e dos privilégios do banco."
        : localDatabase && !publicMode
          ? "Banco local de desenvolvimento. No host remoto, use a conexão do provedor com TLS verificado."
          : databaseConfigured
            ? "Configure a URL remota com sslmode=verify-full antes de publicar."
            : "A conexão PostgreSQL está ausente ou inválida.",
    },
    {
      id: "platform-admin",
      label: "Administrador da plataforma",
      state: platformOwnerConfigured ? "ok" : "error",
      detail: platformOwnerConfigured
        ? "PLATFORM_ADMIN_EMAILS definido. Só esse e-mail libera, renova e bloqueia o acesso dos clientes."
        : "Defina PLATFORM_ADMIN_EMAILS com o seu e-mail; sem ele ninguém consegue liberar o acesso dos clientes.",
    },
    {
      id: "development-seed",
      label: "Seed de desenvolvimento",
      state: env.ALLOW_DEV_SEED === "true" ? "error" : "ok",
      detail: env.ALLOW_DEV_SEED === "true"
        ? "Seed habilitado. Desative antes de disponibilizar o site."
        : "Seed não está habilitado. Isso não remove dados ou contas demo previamente cadastrados.",
    },
    {
      id: "demo-shortcuts",
      label: "Atalhos de demonstração",
      state: publicMode || env.NEXT_PUBLIC_ENABLE_DEMO !== "true" ? "ok" : "warning",
      detail: publicMode || env.NEXT_PUBLIC_ENABLE_DEMO !== "true"
        ? "Atalhos demo ocultos. Use banco novo e contas próprias no deploy."
        : "Atalhos demo ativos no preview; não devem aparecer no site público.",
    },
    {
      id: "public-registration",
      label: "Novos cadastros",
      state: env.ALLOW_PUBLIC_REGISTRATION === "false" ? "ok" : "warning",
      detail: env.ALLOW_PUBLIC_REGISTRATION === "false"
        ? "Cadastro público fechado. Contas existentes continuam com acesso."
        : "Cadastro aberto: novos cadastros ficam “aguardando liberação” e só entram depois que você libera em Clientes e licenças.",
    },
    {
      id: "source-export",
      label: "Exportação de código",
      state: canExportSource(env) ? "info" : "ok",
      detail: canExportSource(env)
        ? "Disponível somente neste preview e para administradores autorizados. O ZIP não é backup de dados."
        : "Download de código desativado. O modo público bloqueia a exportação mesmo se a flag estiver ligada.",
    },
  ];
}

export const releaseLimitations = [
  "Este diagnóstico não aprova uso comercial nem executa pentest ou auditoria de permissões.",
  "O login atual não é Supabase Auth. As políticas baseadas em auth.uid() ainda exigem integração e revisão.",
  "Envio de recuperação de senha e convites por e-mail ainda não foi integrado ao backend.",
  "Concorrência, autorização completa das APIs, consistência financeira e restauração de backups precisam de homologação.",
  "Render Free pode dormir por inatividade e não é recomendado pelo provedor para produção.",
];
