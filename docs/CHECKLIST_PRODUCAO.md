# Mercato: gate antes de uso comercial

## Não confundir deploy com homologação

Publicar o build em HTTPS e receber `{"ok":true}` em `/api/health` comprova que o processo iniciou e conseguiu consultar o PostgreSQL. Não comprova segurança completa, consistência contábil ou aprovação para operação comercial.

O roteiro gratuito em `PUBLICACAO.md` é de **homologação**, não autorização para usar dados reais.

## Itens conhecidos que ainda precisam de trabalho

### Identidade e banco

- [ ] Decidir e implementar a identidade final: sessão customizada integrada ao contexto do banco ou Supabase Auth real.
- [ ] Separar papel de migrations do papel de runtime; runtime sem superuser/proprietário/BYPASSRLS e com privilégios mínimos compatíveis com o fluxo de autenticação.
- [ ] Revisar RLS por vínculo, ação e estabelecimento, incluindo tabelas filhas e `users`. A política de custo não pode depender apenas da coluna removida da resposta frontend.
- [ ] Endurecer funções SECURITY DEFINER (`search_path`, owner mínimo, EXECUTE restrito, checagens completas de permissão).
- [ ] Revisar views, políticas amplas `FOR ALL` e todas as permissões de Data API. Não expor o schema a `anon`/`authenticated` antes disso.
- [ ] Executar testes reais empresa A/B e usuário sem vínculo com papel de banco sem BYPASSRLS; o stub `auth.uid() = NULL` não fornece a identidade do Mercato.

### Aplicação

- [ ] Revisar autorização e validação de TODAS as APIs, inclusive campos sensíveis, IDs de empresa/estabelecimento e referências cruzadas.
- [ ] Revisar vínculo de convite para contas já existentes, autenticação/posse da conta, uso único e concorrência de tokens.
- [ ] Implementar entrega real de recuperação/convite por serviço de e-mail, com tokens de uso único e testes ponta a ponta.
- [ ] Rate limit atual é em memória; adotar proteção compartilhada/persistente para múltiplas instâncias e validar a cadeia de proxies/IPs confiáveis.
- [ ] Validar sessão expirada/revogada, CSRF, limites de payload, erros redigidos e política CSP adequada (inline scripts ainda são permitidos para compatibilidade Next.js).
- [ ] Tratar bloqueio de custos em todas as respostas de criação/alteração/compra, não só nas listas e no PDV.
- [ ] Revisar logs e auditoria para não armazenar senhas/tokens/dados pessoais desnecessários.

### Integridade da operação

- [ ] Concorrência de saldo/estoque, abertura de caixa e último administrador precisa de testes e locks/constraints consistentes.
- [ ] Validar duplicidade/idempotência de vendas, recebimentos, baixas, estornos e cancelamentos sob reenvio simultâneo.
- [ ] Homologar margem versus markup, regras de desconto, casas decimais, juros, multas e totais financeiros.
- [ ] Homologar devoluções parciais/totais e cancelamentos após baixa/fechamento de caixa, incluindo o financeiro, não só reposição do estoque.
- [ ] Testar relatórios, datas e filtros com timezone oficial, troco e comparação de períodos.
- [ ] Recibos atuais são comprovantes **não fiscais**; não substituem emissão fiscal/obrigações legais.

### Infraestrutura e operação

- [ ] Plano de hospedagem adequado: Render Free dorme e o provedor não o recomenda para produção.
- [ ] Banco separado para desenvolvimento, homologação e produção; nenhuma conta demo no real.
- [ ] Credenciais exclusivas, rotação, 2FA no GitHub/host/banco e revisão de acessos de equipe.
- [ ] Monitoramento externo, alertas de erro/queda, orçamento e procedimento de incidente.
- [ ] Backups criptografados fora do serviço, retenção definida e teste de restauração cronometrado.
- [ ] Storage privado para anexos; MIME/tamanho, URLs assinadas, antivírus quando aplicável e isolamento por empresa.
- [ ] Revisão LGPD: finalidade, minimização, retenção, acesso, contratos e aviso de privacidade.
- [ ] Varredura de dependências, análise de aplicação e avaliação de segurança externa antes de comercializar.

## Licenciamento (acesso pago)

- [x] Acesso por empresa liberado só pelo administrador da plataforma; cadastro novo fica pendente; vencida/bloqueada nega login e sessões abertas.
- [x] Cliente não cria empresas nem lê notas internas da licença.
- [ ] Cobrança/recebimento é manual; integrar gateway de pagamento se quiser renovação automática.
- [ ] Sem limite por plano (nº de usuários/estabelecimentos); definir e aplicar se o preço variar por porte.
- [ ] Conta do dono depende de `PLATFORM_ADMIN_EMAILS` e de cadastrá-la primeiro; não há verificação de e-mail. Ative 2FA no GitHub/Render/Neon e use senha forte.

## Melhorias de deploy já disponíveis

- Configuração Render Free e Railway Railpack versionada, sem segredos.
- `.gitignore` para arquivos de ambiente, chaves e dumps (arquivos já versionados exigem remoção e rotação).
- Executor de migrations com histórico privado, checksum normalizado para Windows/Linux, transação por arquivo, lock e TLS remoto verificado.
- Validador de ambiente de publicação, sem imprimir connection strings.
- Atalhos demo desativados no modo público; cadastro inicial pode ser fechado no servidor e na UI.
- `DEPLOYMENT_TARGET=public` ativa bloqueio de iframe; preview permanece uma configuração separada.
- Painel autenticado de publicação para administradores, com diagnóstico sem credenciais e download de documentos fixos.
- Exportação de código restrita ao preview explicitamente autorizado, com limite de frequência e auditoria; bloqueada no site público. Não é backup e não certifica ausência de segredos inseridos manualmente no código.
- `exports/` é ignorado pelo Git; pacote contém manifesto de arquivos e hashes para conferência.

## Critério para liberar

Registrar os resultados e evidências de cada item, corrigir os reprovados, repetir testes após alterações e obter aceite operacional/segurança. A simples existência desta lista ou de migrations não significa que seus itens foram implementados.
