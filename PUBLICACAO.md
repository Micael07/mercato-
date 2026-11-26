
## Usuários da empresa: limite e autorização (migração 006)

- O cliente não convida mais por link: o administrador da empresa cadastra os dados do colaborador (solicitação).
- No painel /plataforma, em cada cliente, o dono define o **máximo de usuários** e **quem autoriza** (somente o dono, ou o administrador da empresa dentro do limite). Solicitações de todas as empresas aparecem numa fila no topo do painel.
- Ao autorizar, o sistema cria o usuário e mostra uma senha provisória uma única vez (sem envio de e-mail).
- Pendentes e ativos contam para o limite; reativar usuário também consome vaga.
- Vendas por colaborador: tela Usuários (cliente) e gaveta do cliente em /plataforma.

## Senha: troca obrigatória e recuperação sem e-mail (migração 007)

- Usuário novo e senha redefinida pelo ADM ou pelo administrador da empresa ficam com **troca obrigatória**: sem trocar, nem o sistema nem a API liberam acesso.
- **Recuperação:** e-mail + CPF + nome completo + data de nascimento. Só um HMAC (com AUTH_SECRET) fica no banco. Nome sem diferenciar maiúscula/minúscula/acento.
- Proteções: 5 erros bloqueiam a conta por 30 min, limite por IP, mensagem única de erro, auditoria, sessões antigas encerradas, conta do dono da plataforma excluída da recuperação.
- **Atenção:** trocar o AUTH_SECRET invalida os dados de recuperação já cadastrados (os usuários precisam recadastrar CPF/nascimento em Alterar senha).
- Usuários antigos veem um aviso para cadastrar CPF e nascimento.
- **Lembrete de pagamento:** só administrador e gerente veem, a 7 dias do vencimento (vermelho a partir de 3). Contato exibido vem de NEXT_PUBLIC_SUPPORT_CONTACT. No painel /plataforma há "Copiar lembrete de cobrança" para enviar ao cliente.

## Painel do ADM: todos os usuários

- /plataforma/usuarios lista os usuários de todas as empresas (busca, filtro por empresa e situação).
- O ADM corrige nome, e-mail, telefone, cadastra/substitui CPF e nascimento (nunca exibidos), gera senha provisória, desconecta, bloqueia (todas as empresas) e ajusta perfil/bloqueio por empresa. Tudo fica na auditoria.
- Trocar o nome limpa a recuperação por CPF (o nome faz parte da verificação), a menos que CPF e nascimento sejam informados junto.
- A conta do ADM master não pode ser bloqueada nem ter o e-mail alterado por essa tela.

## Cadastro completo do usuário no painel do ADM (migração 008)

- Ao tocar em Gerenciar em /plataforma/usuarios o ADM vê CPF, nascimento, datas, origem (quem solicitou/autorizou) e o histórico de alterações.
- CPF e nascimento ficam criptografados (AES-256-GCM, chave derivada do AUTH_SECRET); só o ADM master os lê, e cada consulta é auditada. Trocar o AUTH_SECRET torna esses dados ilegíveis (reinformar).
- Usuários criados antes da migração 008 têm só o hash de recuperação: o CPF aparece depois que o ADM ou o próprio usuário informar de novo.
- Trocar o nome recalcula a recuperação automaticamente quando o CPF está legível.

## Migração 009 — validade, perdas e relatórios favoritos
- Roda sozinha no build (adiciona `products.expiry_date` e a tabela `saved_reports`).
- Novos relatórios: fechamento de caixa, curva ABC, sugestão de compra, vencimentos e perdas.
- PDF direto, resumo térmico 80 mm, comparativo com período anterior, gráficos e detalhe ao tocar na linha.
- Backup: Configurações → "Baixar backup completo" (ZIP de CSVs, sem senhas). O administrador master também baixa o de cada empresa.
- Lembrete de contas a pagar aparece só para administrador e gerente.
- Limitação: a validade é uma data por produto (a mais próxima), não por lote.

## Migração 010 — PDV offline
- Roda sozinha no build (`sales.client_ref` + índice único parcial).
- O PDV precisa ser aberto **uma vez com internet** em cada aparelho; depois abre e vende sem conexão (catálogo e tela ficam guardados no aparelho; sair do sistema apaga esse cache).
- Vendas offline entram numa fila local e são enviadas sozinhas ao voltar a conexão; o identificador da venda impede duplicar.
- Regras offline: preço do balcão é respeitado (divergência fica na observação da venda), estoque pode ficar negativo, desconto acima do limite é registrado com aviso. Crediário, abrir caixa, suspender e retomar vendas exigem internet.
- O número definitivo da venda só existe depois da sincronização (o cupom offline sai como "Nº OFFLINE").
- Se o caixa estiver fechado na hora do envio, a venda aguarda (reabra o caixa). Vendas recusadas aparecem na fila com o motivo.

## Inventário
- Contagem por categoria, folha de contagem cega para impressão, resumo de sobras/faltas antes de aprovar, opção de aprovar ignorando itens não contados.
- Exclusão: inventário em contagem é descartado sem efeito; inventário aprovado só é excluído por administrador/gerente e **não desfaz** os ajustes de estoque.
