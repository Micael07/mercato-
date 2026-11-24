# Validação da interface comercial

## Escopo

A revisão substitui a navegação lateral pela navegação superior e aplica a referência visual aos painéis, campos, tabelas, login, visão geral e PDV. Os cadastros, transações, migrations e permissões existentes são preservados.

O PDV passa a consultar um endpoint específico sem custo/margem. O cálculo exibido é conferido no frontend, mas a conclusão continua sujeita às validações transacionais do backend. O guia de pendências de produção continua válido.

## Validação manual

1. Entre no sistema; confira empresa, estabelecimento, nome e perfil.
2. Abra Vendas → Ponto de venda. Use também as setas e Escape no menu.
3. Leia ou digite SKU/código de barras e pressione Enter. Para busca por nome, escolha o resultado.
4. Altere quantidade e confirme com Tab ou Enter; confira o subtotal. Teste os botões + e −.
5. Aplique desconto permitido. O servidor deve recusar descontos acima da autorização.
6. Selecione cliente com F4 ou mantenha Consumidor final.
7. Use Novo e cancele a confirmação: os itens devem continuar na tela.
8. Suspenda com F8 e retome. Desconto de item não pode ser aplicado novamente como desconto geral.
9. Abra caixa se necessário. Use F9, divida o pagamento e confira valores e troco.
10. Confirme uma venda de homologação, confira o comprovante e use impressão/PDF.
11. Confira a redução de estoque e os registros de caixa. Cancele a operação de teste com permissão e confirme o estorno.
12. Navegue por Produtos, Compras, Financeiro e Relatórios: botões, formulários e tabelas devem manter o mesmo estilo.
13. Em tela de 390 px, empresa e estabelecimento precisam continuar selecionáveis. A tabela pode rolar internamente, mas a página não deve transbordar horizontalmente.

## Testes automatizados

- `npx vitest run`: inclui cálculos do PDV, retomada de descontos, validação de quantidades e projeção da consulta sem custo/margem.
- `npx playwright install chromium`: instala o navegador de testes.
- Configure `.env.e2e.local` (ignorado pelo Git) com `E2E_EMAIL`, `E2E_PASSWORD` e `E2E_BASE_URL` de homologação.
- Inicie o app no seu ambiente e rode `npx playwright test`.
- Por padrão, testes que escrevem vendas ficam pulados. `E2E_MUTATE=true` habilita esses casos **somente em localhost**. Eles cancelam as vendas de teste ao final e fecham apenas o caixa criado pela própria suíte.
- O ambiente de homologação precisa ter um produto com preço >= R$10 e estoque >=5, duas formas de pagamento ativas e usuário administrador. Os testes não cadastram produtos fictícios diretamente na interface.
- A suíte não inicia servidor automaticamente, não carrega seed e não redefine senhas.
- Sem credenciais de teste, os testes de navegador são pulados; isso não conta como execução aprovada.

## Artefatos e segurança

Capturas, PDFs e resultados ficam em `test-results/`. A suíte não registra traces ou sessões em arquivos de código. Os diretórios de artefatos e `.auth` são excluídos do pacote de publicação. Nunca envie `.env.e2e.local` ao GitHub ou ao chat.

Recebimento em dinheiro, PIX ou cartão na suíte significa registro interno no ERP; não há iniciação de transferência bancária externa. Os testes automatizados não homologam fiscal, impressora física, disponibilidade de provedores ou segurança completa.
