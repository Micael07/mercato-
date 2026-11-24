# Mercato · Gestão comercial

Aplicação Next.js (App Router), React e TypeScript com PostgreSQL via Drizzle ORM. Possui módulos de produtos, estoque, inventário, compras, clientes, vendas/PDV, caixa, financeiro, relatórios e administração.

> **Status: homologação.** Build e testes locais não certificam prontidão comercial ou segurança absoluta. Há pendências de autenticação/isolamento no banco, revisão de APIs, e-mail, concorrência, backups e validação financeira. Não use dados reais de clientes até concluir [o checklist de produção](docs/CHECKLIST_PRODUCAO.md).

## Publicar e obter um endereço HTTPS

Leia **[o passo a passo completo — Render Free + Neon Free](docs/PUBLICACAO.md)**. Feito para quem só tem tablet: GitHub (Codespaces), Neon, Render, conta de dono, venda e liberação de acesso, atualização e erros comuns.

- `render.yaml`: Blueprint de um Web Service Node Free; gera `AUTH_SECRET` e solicita `DATABASE_URL`.
- `railway.json`: alternativa Railpack. Railway tem créditos e planos com cobrança; não é promessa de hospedagem grátis ilimitada.
- `.node-version`: Node 22.
- `scripts/check-deploy.mjs`: valida configuração pública sem exibir segredos.
- `scripts/apply-migrations.mjs`: histórico, checksums, transação por migration e lock de execução.
- **Configurações → Publicação e diagnóstico** (`/configuracoes/publicacao`): painel de administrador com diagnóstico sem segredos, roteiro e download dos documentos.
- `scripts/export-project.mjs`: gera `exports/mercato-publicacao.zip` com arquivos selecionados de código, guia e manifesto SHA-256 (requer Node.js 22.18+). Não transfere banco nem publica automaticamente.
- Download do ZIP pelo painel exige `DEPLOYMENT_TARGET=preview` e `ALLOW_SOURCE_EXPORT=true`. A API bloqueia esse recurso em modo público, exige administrador/permissão e registra auditoria. O pacote exclui `.env`, backups, uploads e links simbólicos; revise possíveis segredos escritos manualmente no código antes de compartilhar.

O Render Free pode dormir após 15 minutos sem tráfego; não é recomendado pelo provedor para produção. O endereço `e2b.app` do sandbox não é publicação pública nem persistente.

## Executar localmente

1. Instale Node.js 22 e PostgreSQL 15+.
2. Execute `npm ci --include=dev`.
3. Copie `.env.example` para `.env.local`, ajuste `DATABASE_URL` e gere uma `AUTH_SECRET` aleatória.
4. Para um banco local novo, use migrations com a conexão direta em `.env.migrations.local`, conforme o guia. `npx drizzle-kit push` é uma alternativa somente para schema local de desenvolvimento; não misture estratégias em um banco existente.
5. Execute `npm run dev`.
6. Abra `/register` para criar sua conta e a empresa no seu banco local.

A configuração Drizzle existente em `drizzle.config.json` aponta para o PostgreSQL local; não use essa configuração para alterar um banco remoto.

## Autenticação e Supabase: arquitetura atual

O login usa `src/lib/auth.ts`, tabela `users`, senha com scrypt e cookie HttpOnly assinado. O provedor de autenticação atual **não é Supabase Auth**. Somente alterar `DATABASE_URL` ou adicionar chaves Supabase não modifica esse comportamento.

As migrations contêm políticas baseadas em `auth.uid()`. Fora do Supabase, o executor cria uma função que retorna NULL apenas para compatibilidade SQL. O backend atual, quando usa o proprietário do banco, pode ignorar essas políticas; portanto, não é correto afirmar que o isolamento por usuário é garantido por RLS nesse modo. Não exponha as tabelas via Data API.

Para Supabase real, integre a identidade autenticada no backend, revise todos os privilégios, policies, views e funções, e teste com usuários/papéis sem BYPASSRLS antes de publicar dados reais. Não coloque service_role nem DATABASE_URL no frontend.

## Acesso pago (licenças)

O Mercato é vendido por assinatura e **só o administrador da plataforma** (`PLATFORM_ADMIN_EMAILS`) libera o acesso. Cada empresa tem situação de licença (`pending`, `trial`, `active`, `suspended`) e vencimento. Cadastro novo nasce `pending` e não entra; licença vencida ou bloqueada impede login e invalida sessões abertas no próximo request. Clientes não criam empresas nem alteram a própria licença. Histórico em `license_events`. A cobrança é manual: o sistema não processa pagamentos.

## Variáveis de publicação

| Nome | Finalidade |
| --- | --- |
| `DATABASE_URL` | Conexão pooled PostgreSQL apenas no servidor, com `sslmode=verify-full` no host remoto |
| `AUTH_SECRET` | Segredo aleatório de 32+ caracteres; Render Blueprint gera automaticamente |
| `DEPLOYMENT_TARGET` | `public` no site publicado; separa cabeçalhos de enquadramento do preview |
| `ALLOW_DEV_SEED` | `false` no site publicado |
| `NEXT_PUBLIC_ENABLE_DEMO` | `false` no build público |
| `ALLOW_SOURCE_EXPORT` | `false` no site público; download de fontes aceita apenas `preview` explícito com esta flag ligada |
| `ALLOW_PUBLIC_REGISTRATION` | `true` só para cadastro inicial; `false` após criar seu administrador |
| `MIGRATION_DATABASE_URL` | Conexão direta (sem pooler) do mesmo banco. O build aplica as migrations por ela a cada deploy; localmente pode ficar em `.env.migrations.local` |
| `PLATFORM_ADMIN_EMAILS` | E-mail(s) do dono do sistema. Só eles acessam **Sistema → Clientes e licenças** (liberar, renovar, bloquear, criar clientes, senha provisória) |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | Opcional. Contato exibido na mensagem de acesso bloqueado/vencido (valor lido no build) |

O `.gitignore` protege novos arquivos de ambiente, chaves e dumps. Não remove segredos já versionados; nesses casos, revogue e substitua as credenciais.

## Migrations existentes (preservadas)

1. `001_initial_schema.sql`: tabelas e índices iniciais.
2. `002_rls_and_views.sql`: policies e view inicial — precisam de revisão de segurança antes de acesso por clientes de banco não privilegiados/Data API.
3. `003_transactional_rpcs.sql`: trigger de último administrador e RPC de estoque inicial.
4. `004_security_hardening.sql`: coluna de revogação de sessões.
5. `005_licensing.sql`: licenças por empresa (empresas existentes continuam ativas), histórico de liberações e correção do gatilho do último administrador para permitir excluir uma empresa inteira.

No Render, o build executa `node scripts/apply-migrations.mjs` sozinho. Para rodar manualmente, use um banco vazio ou já registrado por este executor. Ele não faz baseline automática de tabelas existentes e não executa seeds. O rollback de código no host **não** desfaz migrations; use migration compensatória ou restauração validada de backup em banco separado.

## Demo, e-mails e armazenamento

- Demonstração é opcional e isolada: nunca habilite `ALLOW_DEV_SEED` em um banco real. Atalhos de login demo ficam ocultos por padrão e sempre no modo público. Ocultar botões não revoga contas demo pré-existentes.
- Convites geram links; não há envio automático de e-mail integrado.
- Recuperação de senha gera tokens, mas não envia e-mails em produção. É necessária integração no backend; configurar SMTP apenas no Supabase não implementa o envio customizado.
- Render Free bloqueia portas SMTP tradicionais; uma futura integração pode usar API HTTPS.
- Disco local de hospedagem gratuita é efêmero. Uploads e anexos exigem armazenamento externo e políticas revisadas.
- Não há política de backup/restore garantida pelo aplicativo. Configure e teste antes do uso real.

## Validações

- Rotas: `npx next typegen`
- Tipos: `npm exec tsc -- --noEmit --pretty false`
- Lint: `npm run lint`
- Testes existentes: `npx vitest run` — inserem e removem dados; use banco descartável/de desenvolvimento, nunca produção.
- Verificações de deploy: `node --test tests/deploy.check.mjs`
- Migrations em banco descartável: `MIGRATION_TEST_DATABASE_URL` + `node --test tests/migrations.check.mjs` (testa primeira execução, repetição e checksum).
- Build: `npm run build`

Os testes existentes cobrem cenários delimitados. Não comprovam pentest, isolamento RLS ponta a ponta, concorrência, disponibilidade nos provedores ou envio de e-mail. A implantação nas suas contas precisa ser validada após seguir o tutorial.

## Interface de operação comercial

A interface segue o modelo de ERP operacional: menu superior por módulos, barras azul-claras, controles compactos e tabelas. No PDV, itens ficam à esquerda e o fechamento à direita, com busca por código de barras, atalhos, suspensão/retomada e pagamentos múltiplos preservados. O catálogo do PDV é consultado em `/api/pos/products` sem selecionar custo ou margem.

Veja [o roteiro de validação visual e funcional](docs/VALIDACAO_INTERFACE.md). A suíte Playwright depende de credenciais de homologação e de um servidor iniciado; não roda contra produção automaticamente e não deve ser contada como aprovada se for pulada.

## Documentos

- [Guia completo de publicação](docs/PUBLICACAO.md)
- [Pendências/checklist de produção](docs/CHECKLIST_PRODUCAO.md)
- [Identidade visual](docs/BRAND_GUIDE.md)
