
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
